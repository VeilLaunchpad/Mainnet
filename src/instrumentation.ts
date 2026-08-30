import type { AgentRow } from "./lib/agent-runtime";

/**
 * Everything that has to happen once, when the server comes up.
 *
 * On a laptop these jobs were done by hand: a terminal running the Telegram
 * poller, and a browser tab left open so agent heartbeats kept firing. Neither
 * survives a deploy, so both move into the server itself here. Next calls
 * `register()` once per server process, which is exactly the hook for it.
 *
 * Both jobs are best effort. A deployment that cannot reach Telegram, or has
 * no model pool configured, still has to serve the site.
 */

export async function register() {
  // This module is also loaded for the edge runtime, where none of this can
  // run. Doing the work twice would double every heartbeat.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { dataDir } = await import("./lib/db");
  const { appUrl } = await import("./lib/app-url");

  console.log("[devoxpad] booting");
  console.log("[devoxpad] public url : " + appUrl());
  console.log("[devoxpad] data dir   : " + dataDir());

  // Before anything opens the database. A restore has to land on disk while
  // there is still no connection holding the old file.
  await restoreFromBucket();

  await seedAndBackfill();

  await startTelegram();
  startHeartbeats();
  startBackups();
}

/* ------------------------------------------------------------------ */

/**
 * Point Telegram at this deployment.
 *
 * Long polling needed a process babysitting it; a webhook needs nothing once
 * registered, which is what makes the bot survive restarts and cost no extra
 * service. Registration is idempotent, so running it on every boot is how the
 * bot follows the app to a new domain without anyone remembering to re-point
 * it.
 */
async function startTelegram() {
  const { botConfigured, webhookSecret, callTelegram, applyBotProfile, telegramLastError } =
    await import("./lib/telegram");
  const { appUrl, isPubliclyReachable } = await import("./lib/app-url");

  if (!botConfigured()) {
    console.log("[devoxpad] telegram  : no token, skipping");
    return;
  }

  if (!isPubliclyReachable()) {
    // Telegram cannot call back into a laptop, so a local run keeps using
    // `npm run telegram` rather than pretending a webhook was set.
    console.log("[devoxpad] telegram  : not publicly reachable, webhook skipped");
    return;
  }

  const url = appUrl() + "/api/telegram/webhook";

  const ok = await callTelegram("setWebhook", {
    url,
    secret_token: webhookSecret(),
    // Button taps arrive as their own update type. Without naming it here
    // Telegram simply never delivers them, and every inline keyboard in the
    // bot would spin and do nothing.
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: true,
  });

  if (ok === null) {
    console.warn("[devoxpad] telegram  : webhook failed, " + telegramLastError());
    return;
  }

  console.log("[devoxpad] telegram  : webhook -> " + url);

  // Name, bio, about and the command list live in the repo, so a deploy is
  // what publishes them. Failing here must not stop the bot working.
  const profile = await applyBotProfile().catch(() => null);
  if (profile?.skipped) console.log("[devoxpad] telegram  : profile unchanged");
  else if (profile?.ok) console.log("[devoxpad] telegram  : profile " + profile.applied.join(", "));
  else if (profile) console.warn("[devoxpad] telegram  : profile " + profile.problems.join("; "));
}

/* ------------------------------------------------------------------ */

/** How often to look for agents that are due. Not how often any agent runs. */
const SWEEP_MS = 30_000;

/**
 * Give the process a moment to finish starting before the first sweep, so a
 * cold boot serves requests rather than a model call.
 */
const FIRST_SWEEP_MS = 20_000;

/**
 * Run the agents that asked to be woken.
 *
 * The old heartbeat came from a `setInterval` in the browser, which meant an
 * agent only "ran continuously" while somebody had the tab open. Moving the
 * sweep into the server is what makes the promise on the agents page true:
 * each agent keeps its own interval, and this only decides who is due.
 */
function startHeartbeats() {
  let running = false;

  const sweep = async () => {
    // A slow sweep must not overlap itself, or one stuck agent turns into a
    // pile of concurrent model calls.
    if (running) return;
    running = true;

    try {
      const { db, rows } = await import("./lib/db");
      const { heartbeatTick } = await import("./lib/agent-runtime");
      const { brainAvailable } = await import("./lib/llm");

      if (!brainAvailable()) return;

      const due = rows<AgentRow>(
        db()
          .prepare(
            `SELECT * FROM agents
              WHERE heartbeat_sec > 0
                AND (? - last_tick) >= (heartbeat_sec * 1000)
              ORDER BY last_tick ASC
              LIMIT 3`,
          )
          .all(Date.now()),
      );

      for (const agent of due) {
        try {
          const out = await heartbeatTick(agent);
          if (out.spoke) console.log("[devoxpad] heartbeat: " + agent.slug + " spoke");
        } catch (err) {
          console.warn("[devoxpad] heartbeat: " + agent.slug + " failed, " + String(err).slice(0, 140));
        }
      }
    } catch (err) {
      console.warn("[devoxpad] heartbeat sweep failed: " + String(err).slice(0, 160));
    } finally {
      running = false;
    }
  };

  setTimeout(() => {
    void sweep();
    setInterval(() => void sweep(), SWEEP_MS);
  }, FIRST_SWEEP_MS);

  console.log("[devoxpad] agents    : heartbeat sweep every " + SWEEP_MS / 1000 + "s");
}

/* ------------------------------------------------------------------ */

/**
 * Pull the index back out of the bucket when the disk is empty.
 *
 * A container without a volume starts blank on every deploy, and even a volume
 * can be replaced. This makes that recoverable instead of final. It refuses to
 * touch a database that already exists, so a redeploy with an intact volume is
 * a no-op.
 */
async function restoreFromBucket() {
  const { bucketConfigured } = await import("./lib/bucket");
  const { isManagedDeployment } = await import("./lib/app-url");

  if (!bucketConfigured()) {
    console.log("[devoxpad] bucket    : not configured");
    return;
  }

  // A laptop sharing the same .env must not pull production's database down,
  // nor later push its own copy back up.
  if (!isManagedDeployment()) {
    console.log("[devoxpad] bucket    : local run, leaving the shared snapshots alone");
    return;
  }

  try {
    const { restoreIfEmpty } = await import("./lib/backup");
    const out = await restoreIfEmpty();
    if (out.restored) {
      console.log(
        "[devoxpad] bucket    : restored " + out.key + " (" + Math.round(out.bytes / 1024) + "KB)",
      );
    } else {
      console.log("[devoxpad] bucket    : " + out.reason);
    }
  } catch (err) {
    console.warn("[devoxpad] bucket    : restore failed, " + String(err).slice(0, 160));
  }
}

/** Often enough that little is lost, rarely enough to be invisible in cost. */
const BACKUP_MS = 15 * 60_000;

/** The first one is early, so a deploy is protected without waiting a cycle. */
const FIRST_BACKUP_MS = 2 * 60_000;

function startBackups() {
  let running = false;

  const run = async () => {
    if (running) return;
    running = true;
    try {
      const { bucketConfigured } = await import("./lib/bucket");
      const { isManagedDeployment } = await import("./lib/app-url");
      if (!bucketConfigured() || !isManagedDeployment()) return;

      const { backupNow } = await import("./lib/backup");
      const out = await backupNow();
      if (out.ok) {
        console.log("[devoxpad] backup    : " + out.key + " (" + Math.round((out.bytes ?? 0) / 1024) + "KB)");
      } else {
        console.warn("[devoxpad] backup    : " + out.reason);
      }
    } catch (err) {
      console.warn("[devoxpad] backup    : " + String(err).slice(0, 160));
    } finally {
      running = false;
    }
  };

  setTimeout(() => {
    void run();
    setInterval(() => void run(), BACKUP_MS);
  }, FIRST_BACKUP_MS);

  console.log(
    process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID
      ? "[devoxpad] backup    : every " + BACKUP_MS / 60_000 + " minutes to the bucket"
      : "[devoxpad] backup    : off, this is not the managed deployment",
  );
}

/* ------------------------------------------------------------------ */

/**
 * Make an empty deployment usable.
 *
 * Seeding used to happen in the root layout, which Next renders at build time,
 * so the house agents were written into the builder container and thrown away
 * with it. The runtime volume then came up with no agents at all. Doing it here
 * means it runs in the process that owns the real database.
 *
 * The launch index is rebuilt the same way, from the factory's own events,
 * because a cache that cannot be reconstructed is really a second source of
 * truth waiting to disagree with the chain.
 */
async function seedAndBackfill() {
  try {
    const { seedHouseAgents } = await import("./lib/seed");
    const seeded = seedHouseAgents();
    console.log(
      "[devoxpad] agents    : " + seeded.created + " seeded, " + seeded.existing + " already there",
    );
  } catch (err) {
    console.warn("[devoxpad] agents    : seed failed, " + String(err).slice(0, 140));
  }

  try {
    // The protocol token comes from no factory, so nothing would index it.
    // It is seeded before the backfill so it exists even on an empty database.
    const { seedOfficialTokens } = await import("./lib/official-token");
    const official = await seedOfficialTokens();
    console.log(
      "[devoxpad] token     : official pinned on " +
        (official.seeded.join(", ") || "no network") +
        (official.skipped.length ? " (not deployed on " + official.skipped.join(", ") + ")" : ""),
    );

    const { indexIsEmpty, backfillLaunches } = await import("./lib/backfill");
    const { NETWORKS } = await import("./lib/chain");

    // Each network keeps its own index, so each is rebuilt on its own terms.
    // A populated mainnet is no reason to leave testnet empty, and a network
    // with no factory deployed simply reports that and is skipped.
    for (const net of NETWORKS) {
      if (!indexIsEmpty(net)) {
        console.log("[devoxpad] launches  : " + net + " already populated");
        continue;
      }

      const out = await backfillLaunches(net);
      if (out.ok) {
        console.log(
          "[devoxpad] launches  : " + net + " rebuilt from chain, " +
            out.inserted + " of " + out.found + " events",
        );
      } else {
        console.warn("[devoxpad] launches  : " + net + " skipped, " + out.reason);
      }
    }
  } catch (err) {
    console.warn("[devoxpad] launches  : backfill failed, " + String(err).slice(0, 160));
  }
}
