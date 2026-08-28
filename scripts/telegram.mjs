import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHmac } from "node:crypto";

/**
 * Runs the Telegram bridge.
 *
 *   node scripts/telegram.mjs poll        long-poll, for local development
 *   node scripts/telegram.mjs webhook     register a webhook, for a deployment
 *   node scripts/telegram.mjs profile     push name, bio, about and commands
 *   node scripts/telegram.mjs status      what Telegram thinks is configured
 *   node scripts/telegram.mjs clear       remove the webhook
 *
 * Telegram cannot reach localhost, so a webhook is useless while developing.
 * Polling solves that without a tunnel: this process asks Telegram for updates
 * and posts each one into the same route a webhook would hit, so there is only
 * one code path to get right.
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

function env() {
  const out = {};
  for (const file of [".env.local", ".env"]) {
    try {
      for (const line of readFileSync(resolve(root, file), "utf8").split("\n")) {
        const m = line.match(/^([A-Z_0-9]+)=(.*)$/);
        if (m && !(m[1] in out)) out[m[1]] = m[2].trim();
      }
    } catch {
      /* file may not exist */
    }
  }
  return out;
}

const E = env();
const TOKEN = E.TELEGRAM_BOT_TOKEN;
const APP = E.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
const PUBLIC_URL = process.env.VEIL_PUBLIC_URL || E.VEIL_PUBLIC_URL || "";

if (!TOKEN) {
  console.error("TELEGRAM_BOT_TOKEN is not set in .env.local");
  process.exit(1);
}

const API = "https://api.telegram.org/bot" + TOKEN + "/";
const SECRET = createHmac("sha256", TOKEN).update("veilpad-webhook").digest("hex").slice(0, 32);

async function tg(method, payload) {
  const res = await fetch(API + method, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload ?? {}),
  });
  return res.json();
}

/**
 * The bot's name, bio, about text and command list live in
 * `src/lib/telegram.ts` and are applied through the app, so there is one copy
 * rather than a second list here that quietly drifts out of date.
 */
async function applyProfile() {
  const target = APP.replace(/\/+$/, "") + "/api/telegram/profile";
  try {
    const res = await fetch(target, {
      method: "POST",
      headers: { "x-telegram-bot-api-secret-token": SECRET },
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok && json.ok) {
      console.log("profile: " + (json.applied || []).join(", ") + " applied");
    } else {
      console.warn("profile: " + (json.problems || [json.error || res.status]).join("; "));
    }
  } catch {
    console.warn("profile: could not reach " + target + ", is npm run dev up?");
  }
}

async function describe() {
  const me = await tg("getMe");
  if (!me.ok) {
    console.error("Bad token:", me.description);
    process.exit(1);
  }
  console.log("bot    : @" + me.result.username + " (" + me.result.first_name + ")");
  return me.result;
}

async function status() {
  await describe();
  const info = await tg("getWebhookInfo");
  const w = info.result ?? {};
  console.log("webhook:", w.url || "(none, polling mode)");
  if (w.pending_update_count) console.log("pending:", w.pending_update_count);
  if (w.last_error_message) console.log("last error:", w.last_error_message);
  console.log("app    :", APP);
}

async function setWebhook() {
  await describe();

  const base = PUBLIC_URL || APP;
  if (base.includes("localhost") || base.includes("127.0.0.1")) {
    console.error("");
    console.error("Telegram cannot reach " + base + ".");
    console.error("Either deploy and set NEXT_PUBLIC_APP_URL, or run:");
    console.error("  npm run telegram        (long polling, works locally)");
    process.exit(1);
  }

  const url = base.replace(/\/+$/, "") + "/api/telegram/webhook";
  const res = await tg("setWebhook", {
    url,
    secret_token: SECRET,
    allowed_updates: ["message"],
    drop_pending_updates: true,
  });

  console.log(res.ok ? "webhook set: " + url : "failed: " + res.description);
  await applyProfile();
}

async function profileOnly() {
  await describe();
  await applyProfile();
}

async function clearWebhook() {
  const res = await tg("deleteWebhook", { drop_pending_updates: true });
  console.log(res.ok ? "webhook cleared" : "failed: " + res.description);
}

/**
 * Long polling.
 *
 * Updates are pushed into the local webhook route with the same secret header
 * Telegram would send, so the handler cannot tell the difference and there is
 * no second implementation to keep in sync.
 */
async function poll() {
  await describe();

  const info = await tg("getWebhookInfo");
  if (info.result?.url) {
    console.log("clearing the registered webhook so polling can receive updates");
    await tg("deleteWebhook", { drop_pending_updates: false });
  }

  await applyProfile();

  const target = APP.replace(/\/+$/, "") + "/api/telegram/webhook";
  console.log("polling -> " + target);
  console.log("open https://t.me/" + (E.NEXT_PUBLIC_TELEGRAM_BOT || "VeilPadBot") + " and send /start");
  console.log("");

  let offset = 0;
  let consecutiveErrors = 0;

  for (;;) {
    try {
      const res = await fetch(API + "getUpdates?timeout=30&offset=" + offset, {
        signal: AbortSignal.timeout(40_000),
      });
      const json = await res.json();

      if (!json.ok) {
        console.warn("getUpdates:", json.description);
        await sleep(3_000);
        continue;
      }

      consecutiveErrors = 0;

      for (const update of json.result) {
        offset = update.update_id + 1;
        const text = update.message?.text ?? "(no text)";
        const who = update.message?.from?.username || update.message?.from?.first_name || "?";
        console.log("  " + who + ": " + text.slice(0, 60));

        try {
          const delivered = await fetch(target, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-telegram-bot-api-secret-token": SECRET,
            },
            body: JSON.stringify(update),
          });
          if (!delivered.ok) {
            console.warn("    app returned " + delivered.status + ", is npm run dev up?");
          }
        } catch (err) {
          console.warn("    could not reach the app: " + String(err).slice(0, 80));
        }
      }
    } catch (err) {
      consecutiveErrors += 1;
      // Back off so a network blip does not turn into a hot loop.
      const wait = Math.min(30_000, 2_000 * consecutiveErrors);
      console.warn("poll error, retrying in " + wait / 1000 + "s: " + String(err).slice(0, 80));
      await sleep(wait);
    }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const mode = process.argv[2] || "poll";
const run = { poll, webhook: setWebhook, status, clear: clearWebhook, profile: profileOnly }[mode];

if (!run) {
  console.error("Unknown mode: " + mode + ". Use poll, webhook, profile, status or clear.");
  process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
