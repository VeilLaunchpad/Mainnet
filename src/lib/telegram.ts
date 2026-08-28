import { db, rows, row, now } from "./db";
import { randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import { DEFAULT_NETWORK, isNetworkName, type CotiNetworkName } from "./chain";

/**
 * Telegram bridge.
 *
 * A Telegram chat is not a wallet, so the bot never holds keys and never signs.
 * What it does is carry the same agent, the same reads, and the same proposals
 * to a place people already are: linking a chat to an address lets the bot
 * answer about that address, and every action it prepares is handed back to the
 * web app to be signed there.
 *
 * That boundary is the whole design. A bot that could sign would be a custodial
 * wallet in a chat window, which is exactly the thing nobody should build.
 */

const API = "https://api.telegram.org/bot";

export function botToken(): string | null {
  return process.env.TELEGRAM_BOT_TOKEN || null;
}

export function botConfigured(): boolean {
  return !!botToken();
}

/** The secret the webhook must present, derived from the token. */
export function webhookSecret(): string {
  const token = botToken() ?? "veilpad";
  return createHmac("sha256", token).update("veilpad-webhook").digest("hex").slice(0, 32);
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

const NL = "\n";
const PARA = NL + NL;

export async function callTelegram<T = unknown>(
  method: string,
  payload: Record<string, unknown>,
): Promise<T | null> {
  const token = botToken();
  if (!token) return null;

  try {
    const res = await fetch(API + token + "/" + method, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = (await res.json()) as { ok: boolean; result?: T; description?: string };
    if (!json.ok) {
      lastError = json.description ?? "unknown";
      console.warn("telegram " + method + " failed: " + lastError);
      return null;
    }
    lastError = "";
    return json.result ?? null;
  } catch {
    lastError = "network";
    return null;
  }
}

/** Why the most recent call failed, so a caller can react rather than guess. */
let lastError = "";
export const telegramLastError = () => lastError;

/* ── building messages that cannot break the parser ─────────────────────── */

/**
 * Telegram parses the whole message or none of it.
 *
 * In HTML mode a stray `<` or `&` anywhere makes the API reject the entire
 * send with "can't parse entities", so the user gets silence rather than a
 * slightly wrong message. Token names, agent taglines and history lines are
 * all user-supplied, so none of them can be trusted into a template by hand.
 */
export function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

class Raw {
  readonly value: string;
  constructor(value: string) {
    this.value = value;
  }
}

/** Marks a fragment as already-safe markup. Never pass user input to this. */
export function raw(value: string): Raw {
  return new Raw(value);
}

/**
 * A tagged template that escapes everything interpolated into it.
 *
 * Markup lives in the literal parts and data lives in the holes, so the safe
 * thing is the default and being unsafe takes deliberate effort.
 */
export function h(parts: TemplateStringsArray, ...values: unknown[]): string {
  return parts.reduce((out, part, i) => {
    if (i === 0) return part;
    const v = values[i - 1];
    return out + (v instanceof Raw ? v.value : esc(v)) + part;
  }, "");
}

/** Telegram hard-caps a message at 4096 characters. */
const MAX_LEN = 4096;

/**
 * Splits long text on paragraph, then line, then character boundaries.
 *
 * Cutting mid-tag would leave an unbalanced `<b>` and fail the parse, so the
 * split prefers blank lines, where no tag can still be open.
 */
export function chunkMessage(text: string, limit = MAX_LEN): string[] {
  if (text.length <= limit) return [text];

  const out: string[] = [];
  let buf = "";
  const flush = () => {
    if (buf.trim()) out.push(buf.trim());
    buf = "";
  };

  for (const para of text.split(PARA)) {
    if ((buf + PARA + para).length <= limit) {
      buf = buf ? buf + PARA + para : para;
      continue;
    }
    flush();
    if (para.length <= limit) {
      buf = para;
      continue;
    }
    for (const line of para.split(NL)) {
      if ((buf + NL + line).length <= limit) {
        buf = buf ? buf + NL + line : line;
        continue;
      }
      flush();
      let rest = line;
      while (rest.length > limit) {
        out.push(rest.slice(0, limit));
        rest = rest.slice(limit);
      }
      buf = rest;
    }
  }

  flush();
  return out.length ? out : [text.slice(0, limit)];
}

/**
 * Sends a message, and keeps sending it even when the markup is wrong.
 *
 * A dropped message is the worst outcome: someone typed something and got
 * nothing back, with the reason buried in a server log. So a parse failure
 * retries as plain text, which is less pretty and infinitely better than
 * silence.
 */
export async function sendMessage(
  chatId: number | string,
  text: string,
  extra: Record<string, unknown> = {},
): Promise<unknown> {
  let last: unknown = null;

  /**
   * Extras go on the final chunk only.
   *
   * A long answer is split across several messages, and a keyboard repeated on
   * every one of them would give the reader the same two buttons three times
   * over with no way to tell which set is live. Buttons belong under the end of
   * what was said.
   */
  const parts = chunkMessage(text);

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const tail = i === parts.length - 1 ? extra : {};

    last = await callTelegram("sendMessage", {
      chat_id: chatId,
      text: part,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      ...tail,
    });

    if (last === null && /parse|tag|entit/i.test(telegramLastError())) {
      last = await callTelegram("sendMessage", {
        chat_id: chatId,
        text: stripTags(part),
        link_preview_options: { is_disabled: true },
        ...tail,
      });
    }
  }

  return last;
}

/**
 * The two buttons that switch network, as an inline keyboard.
 *
 * The chat's current network is marked rather than hidden, so the pair always
 * reads as a choice with a state instead of a single action whose meaning
 * depends on what you last did.
 */
export function networkKeyboard(current: CotiNetworkName) {
  const mark = (n: CotiNetworkName, text: string) => (n === current ? "✅ " : "") + text;

  return {
    inline_keyboard: [
      [
        { text: mark("mainnet", "🟢 Mainnet"), callback_data: "net:mainnet" },
        { text: mark("testnet", "🟡 Testnet"), callback_data: "net:testnet" },
      ],
    ],
  };
}

/** Stops the spinner on a tapped button. Telegram leaves it spinning otherwise. */
export async function answerCallback(id: string, text?: string) {
  await callTelegram("answerCallbackQuery", {
    callback_query_id: id,
    ...(text ? { text, show_alert: false } : {}),
  });
}

/** Turns markup back into readable text for the plain-text fallback. */
function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/* ── linking ────────────────────────────────────────────────────────────── */

export interface TelegramLink {
  chat_id: string;
  address: string;
  username: string;
  first_name: string;
  linked_at: number;
  agent: string;
}

export function ensureTables() {
  db().exec(`
    CREATE TABLE IF NOT EXISTS telegram_links (
      chat_id    TEXT PRIMARY KEY,
      address    TEXT NOT NULL,
      username   TEXT NOT NULL DEFAULT '',
      first_name TEXT NOT NULL DEFAULT '',
      agent      TEXT NOT NULL DEFAULT 'veil',
      linked_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tg_address ON telegram_links(address);

    CREATE TABLE IF NOT EXISTS telegram_prefs (
      chat_id    TEXT PRIMARY KEY,
      network    TEXT NOT NULL DEFAULT 'mainnet',
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS telegram_codes (
      code       TEXT PRIMARY KEY,
      chat_id    TEXT NOT NULL,
      username   TEXT NOT NULL DEFAULT '',
      first_name TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      used_at    INTEGER NOT NULL DEFAULT 0
    );
  `);
}

/** A short code the user pastes into the web app to prove they own the chat. */
export function issueLinkCode(chatId: string, username: string, firstName: string): string {
  ensureTables();
  const code = randomBytes(4).toString("hex").toUpperCase();
  db()
    .prepare(
      "INSERT INTO telegram_codes (code, chat_id, username, first_name, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run(code, chatId, username, firstName, now());
  return code;
}

const CODE_TTL_MS = 15 * 60_000;

export function redeemLinkCode(code: string, address: string): TelegramLink | null {
  ensureTables();

  const pending = row<{
    code: string;
    chat_id: string;
    username: string;
    first_name: string;
    created_at: number;
    used_at: number;
  }>(db().prepare("SELECT * FROM telegram_codes WHERE code = ?").get(code.trim().toUpperCase()));

  if (!pending || pending.used_at > 0) return null;
  // A code that never expires is a code someone can screenshot and reuse.
  if (now() - pending.created_at > CODE_TTL_MS) return null;

  db().prepare("UPDATE telegram_codes SET used_at = ? WHERE code = ?").run(now(), pending.code);

  db()
    .prepare(
      `INSERT INTO telegram_links (chat_id, address, username, first_name, agent, linked_at)
       VALUES (?, ?, ?, ?, 'veil', ?)
       ON CONFLICT(chat_id) DO UPDATE SET address = excluded.address, linked_at = excluded.linked_at`,
    )
    .run(pending.chat_id, address, pending.username, pending.first_name, now());

  return linkForChat(pending.chat_id);
}

export function linkForChat(chatId: string): TelegramLink | null {
  ensureTables();
  return row<TelegramLink>(
    db().prepare("SELECT * FROM telegram_links WHERE chat_id = ?").get(String(chatId)),
  );
}

export function linksForAddress(address: string): TelegramLink[] {
  ensureTables();
  return rows<TelegramLink>(
    db().prepare("SELECT * FROM telegram_links WHERE lower(address) = lower(?)").all(address),
  );
}

export function unlinkChat(chatId: string) {
  ensureTables();
  db().prepare("DELETE FROM telegram_links WHERE chat_id = ?").run(String(chatId));
}

/**
 * Which network this chat is looking at.
 *
 * Kept apart from `telegram_links` on purpose: someone can ask for /launches
 * without ever linking a wallet, and they should still be able to say which
 * chain they mean. Defaults to whatever the deployment defaults to.
 */
export function chatNetwork(chatId: string): CotiNetworkName {
  ensureTables();
  const r = row<{ network: string }>(
    db().prepare("SELECT network FROM telegram_prefs WHERE chat_id = ?").get(String(chatId)),
  );
  return isNetworkName(r?.network) ? r.network : DEFAULT_NETWORK;
}

export function setChatNetwork(chatId: string, net: CotiNetworkName) {
  ensureTables();
  db()
    .prepare(
      `INSERT INTO telegram_prefs (chat_id, network, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(chat_id) DO UPDATE SET network = excluded.network, updated_at = excluded.updated_at`,
    )
    .run(String(chatId), net, Date.now());
}

export function setChatAgent(chatId: string, agent: string) {
  ensureTables();
  db().prepare("UPDATE telegram_links SET agent = ? WHERE chat_id = ?").run(agent, String(chatId));
}

/* ── activity, so the dashboard sees what happened in the chat ───────────── */

export function recordChatActivity(
  chatId: string,
  address: string,
  kind: string,
  title: string,
  detail: string,
) {
  ensureTables();
  db().exec(`
    CREATE TABLE IF NOT EXISTS telegram_activity (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id    TEXT NOT NULL,
      address    TEXT NOT NULL,
      kind       TEXT NOT NULL,
      title      TEXT NOT NULL DEFAULT '',
      detail     TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tg_act ON telegram_activity(address, id DESC);
  `);

  db()
    .prepare(
      "INSERT INTO telegram_activity (chat_id, address, kind, title, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(String(chatId), address, kind, title, detail, now());
}

export function chatActivity(address: string, limit = 50) {
  ensureTables();
  try {
    return rows<{
      kind: string;
      title: string;
      detail: string;
      created_at: number;
      chat_id: string;
    }>(
      db()
        .prepare(
          "SELECT kind, title, detail, created_at, chat_id FROM telegram_activity WHERE lower(address) = lower(?) ORDER BY id DESC LIMIT ?",
        )
        .all(address, limit),
    );
  } catch {
    return [];
  }
}

/* ── the bot's public identity ──────────────────────────────────────────── */

/**
 * What Telegram shows before anyone types a word.
 *
 * The short description is the bio on the bot's profile card. The description
 * is what fills an empty chat above the Start button, so it is the first thing
 * a new user reads and the only chance to say what this is and what it will
 * never do. Telegram rejects anything over its limits, so they are checked
 * here rather than discovered as a silent failure at deploy time.
 */
export const BOT_PROFILE = {
  /** Max 64 characters. */
  name: "VEILPAD",

  /** The bio on the profile card. Max 120 characters. */
  shortDescription:
    "🕶️ Agentic privacy superapp on COTI. Launch, trade, bridge and chat with encrypted balances.",

  /** Fills an empty chat, above the Start button. Max 512 characters. */
  description: [
    "🕶️ VEILPAD is an agentic privacy superapp on COTI.",
    "",
    "🚀 Launch tokens, 💱 trade them, 🌉 bridge in and out of privacy, and 🤖 talk to agents that read the chain for you.",
    "",
    "🔐 I never hold a key and never sign. Anything that moves value is prepared here and confirmed in your own wallet.",
    "",
    "Tap Start to begin.",
  ].join("\n"),

  /** Each description is capped at 256 characters. */
  commands: [
    { command: "start", description: "🕶️ What VEILPAD is" },
    { command: "link", description: "🔗 Connect a wallet to this chat" },
    { command: "me", description: "👤 Which wallet this chat speaks for" },
    { command: "balance", description: "💰 Your COTI balance" },
    { command: "launches", description: "🚀 What is live on the launchpad" },
    { command: "token", description: "🔎 Price, curve and venue for a token" },
    { command: "bridge", description: "🌉 What the bridge can carry right now" },
    { command: "history", description: "📜 Your recent activity" },
    { command: "agent", description: "🤖 Switch agent" },
    { command: "switch", description: "🔄 Switch network, with buttons" },
    { command: "network", description: "⛓ Which network you are on" },
    { command: "help", description: "❓ Every command" },
    { command: "unlink", description: "🚪 Disconnect this chat" },
  ],
} as const;

const PROFILE_LIMITS = { name: 64, shortDescription: 120, description: 512 } as const;

/** Fails loudly rather than letting Telegram silently reject an overlong field. */
export function checkBotProfile(): string[] {
  const problems: string[] = [];
  for (const [key, max] of Object.entries(PROFILE_LIMITS)) {
    const value = BOT_PROFILE[key as keyof typeof PROFILE_LIMITS];
    // Telegram counts UTF-16 code units, which is what String.length gives.
    if (value.length > max) {
      problems.push(`${key} is ${value.length} characters, over the ${max} limit`);
    }
  }
  for (const c of BOT_PROFILE.commands) {
    if (!/^[a-z0-9_]{1,32}$/.test(c.command)) problems.push(`bad command name: ${c.command}`);
    if (c.description.length > 256) problems.push(`${c.command} description too long`);
  }
  return problems;
}

/**
 * Pushes the name, bio, about text and command list to Telegram.
 *
 * Safe to run repeatedly: every call is a full overwrite, so this is how the
 * bot's identity gets deployed rather than set by hand in BotFather.
 */
export async function applyBotProfile(force = false): Promise<{
  ok: boolean;
  applied: string[];
  problems: string[];
  skipped?: boolean;
}> {
  const problems = checkBotProfile();
  if (problems.length) return { ok: false, applied: [], problems };

  /**
   * Ask Telegram what it already has, and write only what differs.
   *
   * A local fingerprint was not enough: when one field failed on a rate limit
   * the fingerprint was never stored, so the next boot resent everything and
   * hit the same limit again, forever. Comparing against the live values
   * settles it, because a bot whose profile is already correct needs no writes
   * at all and therefore cannot be rate limited.
   */
  const current = force
    ? {}
    : {
        name: (await callTelegram<{ name: string }>("getMyName", {}))?.name,
        short: (await callTelegram<{ short_description: string }>("getMyShortDescription", {}))
          ?.short_description,
        about: (await callTelegram<{ description: string }>("getMyDescription", {}))?.description,
        commands: (await callTelegram<{ command: string; description: string }[]>(
          "getMyCommands",
          {},
        )) as { command: string; description: string }[] | null,
      };

  const sameCommands =
    Array.isArray(current.commands) &&
    JSON.stringify(current.commands) === JSON.stringify(BOT_PROFILE.commands.map((c) => ({ ...c })));

  if (
    !force &&
    current.name === BOT_PROFILE.name &&
    current.short === BOT_PROFILE.shortDescription &&
    current.about === BOT_PROFILE.description &&
    sameCommands
  ) {
    return { ok: true, applied: [], problems: [], skipped: true };
  }

  const applied: string[] = [];
  const step = async (method: string, payload: Record<string, unknown>, label: string) => {
    const res = await callTelegram(method, payload);
    if (res !== null) applied.push(label);
    else problems.push(`${label}: ${telegramLastError()}`);
  };

  if (force || current.name !== BOT_PROFILE.name) {
    await step("setMyName", { name: BOT_PROFILE.name }, "name");
  }
  if (force || current.short !== BOT_PROFILE.shortDescription) {
    await step("setMyShortDescription", { short_description: BOT_PROFILE.shortDescription }, "bio");
  }
  if (force || current.about !== BOT_PROFILE.description) {
    await step("setMyDescription", { description: BOT_PROFILE.description }, "about");
  }
  if (force || !sameCommands) {
    await step("setMyCommands", { commands: BOT_PROFILE.commands }, "commands");
  }

  return { ok: problems.length === 0, applied, problems };
}
