import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";

/**
 * Off-chain index. The chain is the source of truth for balances, messages and
 * ownership; this DB only holds what a chain can't cheaply serve: human
 * profiles, launch metadata, agent brains, chat transcripts and cached candles.
 *
 * Uses node:sqlite (built into Node 22+) so there is no native build step.
 */

/**
 * Where the database file lives.
 *
 * A container filesystem is wiped on every deploy, so writing into the image
 * would silently reset every profile, launch and agent memory each time the
 * app ships. Railway sets `RAILWAY_VOLUME_MOUNT_PATH` when a volume is
 * attached, so preferring it means the durable path is picked up with no
 * configuration at all, and the local checkout still falls back to ./data.
 */
const DATA_DIR =
  process.env.VEILPAD_DATA_DIR ||
  (process.env.RAILWAY_VOLUME_MOUNT_PATH
    ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, "veilpad")
    : path.join(process.cwd(), "data"));

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

/** Useful in logs: a deployment writing to the wrong place is hard to spot. */
export const dataDir = () => DATA_DIR;

let _db: DatabaseSync | null = null;

export function db(): DatabaseSync {
  if (_db) return _db;
  const conn = new DatabaseSync(path.join(DATA_DIR, "veilpad.db"));
  conn.exec("PRAGMA journal_mode = WAL");
  conn.exec("PRAGMA foreign_keys = ON");
  // Without this, a second connection that finds the file busy throws
  // SQLITE_BUSY immediately instead of waiting. One writer plus one reader is
  // normal here, so a short wait is the correct behaviour rather than a crash.
  conn.exec("PRAGMA busy_timeout = 5000");
  migrate(conn);
  _db = conn;
  return conn;
}

function migrate(c: DatabaseSync) {
  c.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      username     TEXT PRIMARY KEY,
      address      TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL DEFAULT '',
      bio          TEXT NOT NULL DEFAULT '',
      avatar       TEXT NOT NULL DEFAULT '',
      banner       TEXT NOT NULL DEFAULT '',
      links        TEXT NOT NULL DEFAULT '{}',
      is_agent     INTEGER NOT NULL DEFAULT 0,
      created_at   INTEGER NOT NULL,
      updated_at   INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tokens (
      address       TEXT PRIMARY KEY,
      network       TEXT NOT NULL DEFAULT 'testnet',
      name          TEXT NOT NULL,
      symbol        TEXT NOT NULL,
      decimals      INTEGER NOT NULL DEFAULT 6,
      description   TEXT NOT NULL DEFAULT '',
      image         TEXT NOT NULL DEFAULT '',
      banner        TEXT NOT NULL DEFAULT '',
      creator       TEXT NOT NULL,
      kind          TEXT NOT NULL DEFAULT 'private',
      curve         TEXT NOT NULL DEFAULT '',
      pool          TEXT NOT NULL DEFAULT '',
      fee_tier      INTEGER NOT NULL DEFAULT 10000,
      graduated     INTEGER NOT NULL DEFAULT 0,
      agent_id      TEXT NOT NULL DEFAULT '',
      links         TEXT NOT NULL DEFAULT '{}',
      tx_hash       TEXT NOT NULL DEFAULT '',
      created_at    INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tokens_created ON tokens(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_tokens_creator ON tokens(creator);

    CREATE TABLE IF NOT EXISTS trades (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      token      TEXT NOT NULL,
      trader     TEXT NOT NULL,
      side       TEXT NOT NULL,
      coti_in    TEXT NOT NULL DEFAULT '0',
      token_out  TEXT NOT NULL DEFAULT '0',
      price      REAL NOT NULL DEFAULT 0,
      tx_hash    TEXT NOT NULL DEFAULT '',
      private    INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_trades_token ON trades(token, created_at DESC);

    CREATE TABLE IF NOT EXISTS agents (
      id            TEXT PRIMARY KEY,
      slug          TEXT NOT NULL UNIQUE,
      owner         TEXT NOT NULL,
      name          TEXT NOT NULL,
      kind          TEXT NOT NULL DEFAULT 'trader',
      avatar        TEXT NOT NULL DEFAULT '',
      tagline       TEXT NOT NULL DEFAULT '',
      persona       TEXT NOT NULL DEFAULT '',
      autonomy      TEXT NOT NULL DEFAULT 'advisory',
      visibility    TEXT NOT NULL DEFAULT 'private',
      wallet        TEXT NOT NULL DEFAULT '',
      token         TEXT NOT NULL DEFAULT '',
      config        TEXT NOT NULL DEFAULT '{}',
      memory        TEXT NOT NULL DEFAULT '[]',
      status        TEXT NOT NULL DEFAULT 'idle',
      heartbeat_sec INTEGER NOT NULL DEFAULT 0,
      last_tick     INTEGER NOT NULL DEFAULT 0,
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS threads (
      id         TEXT PRIMARY KEY,
      agent_id   TEXT NOT NULL,
      owner      TEXT NOT NULL DEFAULT '',
      title      TEXT NOT NULL DEFAULT 'New session',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_threads_agent ON threads(agent_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS messages (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id  TEXT NOT NULL,
      role       TEXT NOT NULL,
      content    TEXT NOT NULL DEFAULT '',
      tool_calls TEXT NOT NULL DEFAULT '',
      tool_call_id TEXT NOT NULL DEFAULT '',
      name       TEXT NOT NULL DEFAULT '',
      meta       TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id, id);

    CREATE TABLE IF NOT EXISTS agent_events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id   TEXT NOT NULL,
      kind       TEXT NOT NULL,
      title      TEXT NOT NULL DEFAULT '',
      body       TEXT NOT NULL DEFAULT '',
      tx_hash    TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_events_agent ON agent_events(agent_id, id DESC);

    CREATE TABLE IF NOT EXISTS watchlist (
      address    TEXT NOT NULL,
      token      TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (address, token)
    );

    CREATE TABLE IF NOT EXISTS comments (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      token      TEXT NOT NULL,
      author     TEXT NOT NULL,
      body       TEXT NOT NULL DEFAULT '',
      reply_to   INTEGER NOT NULL DEFAULT 0,
      private    INTEGER NOT NULL DEFAULT 0,
      tx_hash    TEXT NOT NULL DEFAULT '',
      signature  TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_comments_token ON comments(token, id DESC);

    CREATE TABLE IF NOT EXISTS bridges (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      address     TEXT NOT NULL,
      direction   TEXT NOT NULL,
      asset       TEXT NOT NULL,
      amount      TEXT NOT NULL DEFAULT '0',
      from_chain  INTEGER NOT NULL DEFAULT 0,
      to_chain    INTEGER NOT NULL DEFAULT 0,
      venue       TEXT NOT NULL DEFAULT '',
      status      TEXT NOT NULL DEFAULT 'initiated',
      tx_hash     TEXT NOT NULL DEFAULT '',
      created_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_bridges_addr ON bridges(address, id DESC);

    CREATE TABLE IF NOT EXISTS kv (
      k          TEXT PRIMARY KEY,
      v          TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  addColumns(c);
}

/**
 * Columns added after a table already existed somewhere.
 *
 * `CREATE TABLE IF NOT EXISTS` never touches a table that is already there, so
 * a new column would only reach fresh installs. SQLite has no
 * `ADD COLUMN IF NOT EXISTS`, so the column list is read first and the ALTER
 * is skipped when the column is present. That makes startup idempotent.
 */
function addColumns(c: DatabaseSync) {
  const additions: [string, string, string][] = [
    // Agents default to private: someone's half-built trading agent should not
    // appear in a public directory because they never found a setting.
    ["agents", "visibility", "TEXT NOT NULL DEFAULT 'private'"],

    /**
     * Marks a token as VEILPAD's own rather than something the launchpad made.
     *
     * A launchpad is exactly the place a fake protocol token gets listed and
     * mistaken for the real one, so the distinction has to live in the index
     * and be rendered, not left to whoever is reading the address carefully.
     * Zero for every launch; only the deployment's own token is ever set.
     */
    ["tokens", "official", "INTEGER NOT NULL DEFAULT 0"],
  ];

  for (const [table, column, decl] of additions) {
    try {
      const existing = (c.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
        (r) => r.name,
      );
      if (existing.length && !existing.includes(column)) {
        c.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
      }
    } catch {
      // A table that does not exist yet will get the column from its CREATE.
    }
  }
}

export const now = () => Date.now();

export function kvGet<T>(key: string, fallback: T): T {
  const row = db().prepare("SELECT v FROM kv WHERE k = ?").get(key) as { v: string } | undefined;
  if (!row) return fallback;
  try {
    return JSON.parse(row.v) as T;
  } catch {
    return fallback;
  }
}

export function kvSet(key: string, value: unknown) {
  db()
    .prepare("INSERT INTO kv (k, v, updated_at) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at")
    .run(key, JSON.stringify(value), now());
}

/** node:sqlite returns null-prototype rows; normalise so React/JSON behave. */
export function rows<T = Record<string, unknown>>(r: unknown[]): T[] {
  return r.map((x) => ({ ...(x as object) })) as T[];
}

export function row<T = Record<string, unknown>>(r: unknown): T | null {
  return r ? ({ ...(r as object) } as T) : null;
}
