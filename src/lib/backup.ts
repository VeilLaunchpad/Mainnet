import fs from "node:fs";
import path from "node:path";
import { db, dataDir } from "./db";
import { bucketConfigured, putObject, getObject, listObjects, deleteObject } from "./bucket";

/**
 * Off-site snapshots of the index.
 *
 * A Railway volume keeps the database alive across deploys, but it is still one
 * disk in one region with no history: a bad migration, an accidental delete or
 * a lost volume takes everything with it. The bucket is the second copy, and
 * because it is object storage it also gives points in time to go back to.
 *
 * The chain is still the source of truth for balances, ownership and messages.
 * What is in here is the part a chain cannot cheaply serve, which is exactly
 * the part that cannot be rebuilt by resyncing.
 */

const PREFIX = "veilpad/backups/";

/** Keep a rolling window rather than growing forever. */
const KEEP = 20;

/**
 * A live SQLite file cannot simply be copied.
 *
 * With WAL enabled the file on disk is only part of the story, so a plain copy
 * can capture a torn state that will not open. `VACUUM INTO` asks SQLite to
 * write a consistent, already-compacted copy, which is both correct and
 * smaller than the original.
 */
function snapshotToTemp(): string | null {
  const tmp = path.join(dataDir(), `snapshot-${Date.now()}.db`);
  try {
    // The quotes matter: the path contains separators and may contain spaces.
    db().exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
    return tmp;
  } catch {
    return null;
  }
}

export interface BackupResult {
  ok: boolean;
  key?: string;
  bytes?: number;
  reason?: string;
}

export async function backupNow(): Promise<BackupResult> {
  if (!bucketConfigured()) return { ok: false, reason: "no bucket configured" };

  const tmp = snapshotToTemp();
  if (!tmp) return { ok: false, reason: "could not snapshot the database" };

  try {
    const body = fs.readFileSync(tmp);

    // Sorting is lexical on the far side, so the timestamp has to be one that
    // sorts chronologically as text.
    const key = PREFIX + new Date().toISOString().replace(/[:.]/g, "-") + ".db";
    const ok = await putObject(key, body, "application/vnd.sqlite3");
    if (!ok) return { ok: false, reason: "upload rejected" };

    await prune();
    return { ok: true, key, bytes: body.length };
  } catch (err) {
    return { ok: false, reason: String(err).slice(0, 160) };
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

async function prune() {
  const all = await listObjects(PREFIX, 200);
  // listObjects returns oldest first, so the head of the list is what expires.
  for (const obj of all.slice(0, Math.max(0, all.length - KEEP))) {
    await deleteObject(obj.key);
  }
}

/**
 * Bring the database back when the disk comes up empty.
 *
 * This runs only when there is nothing to lose: a container with no volume
 * attached, a fresh volume, or a volume that was replaced. If a database is
 * already present it is left completely alone, because silently overwriting
 * live data with an older copy would be far worse than starting empty.
 */
export async function restoreIfEmpty(): Promise<
  { restored: false; reason: string } | { restored: true; key: string; bytes: number }
> {
  if (!bucketConfigured()) return { restored: false, reason: "no bucket configured" };

  const target = path.join(dataDir(), "veilpad.db");
  if (fs.existsSync(target) && fs.statSync(target).size > 0) {
    return { restored: false, reason: "database already present" };
  }

  const all = await listObjects(PREFIX, 200);
  const newest = all[all.length - 1];
  if (!newest) return { restored: false, reason: "no snapshot in the bucket" };

  const body = await getObject(newest.key);
  if (!body || body.length === 0) return { restored: false, reason: "snapshot download failed" };

  // Written beside the target and renamed, so a half-downloaded file can never
  // be opened as the database.
  const staging = target + ".restoring";
  fs.writeFileSync(staging, body);
  fs.renameSync(staging, target);

  // Any WAL left from a previous life belongs to a different file now.
  for (const suffix of ["-wal", "-shm"]) {
    fs.rmSync(target + suffix, { force: true });
  }

  return { restored: true, key: newest.key, bytes: body.length };
}

export async function listBackups() {
  const all = await listObjects(PREFIX, 200);
  return all.reverse().map((o) => ({ key: o.key, size: o.size, modified: o.modified }));
}
