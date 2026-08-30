import { NextRequest } from "next/server";
import { bucketConfig, bucketConfigured } from "@/lib/bucket";
import { backupNow, listBackups } from "@/lib/backup";
import { dataDir } from "@/lib/db";
import { safeEqual, webhookSecret } from "@/lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Whether the off-site copy is actually happening.
 *
 * A backup you have never looked at is a backup you do not have, so this makes
 * the state visible: where the database lives, which snapshots exist, and how
 * old the newest one is. Nothing here reveals a credential, only what the
 * bucket holds.
 */
export async function GET() {
  const cfg = bucketConfig();

  if (!bucketConfigured()) {
    return Response.json({
      configured: false,
      dataDir: dataDir(),
      reason: "No S3 credentials, so the database exists only on this disk.",
    });
  }

  const snapshots = await listBackups();
  const newest = snapshots[0];

  return Response.json({
    configured: true,
    bucket: cfg?.bucket,
    endpoint: cfg?.endpoint,
    dataDir: dataDir(),
    count: snapshots.length,
    newest: newest
      ? {
          key: newest.key,
          sizeKb: Math.round(newest.size / 1024),
          modified: newest.modified,
          ageMinutes: Math.round((Date.now() - Date.parse(newest.modified)) / 60_000),
        }
      : null,
    snapshots: snapshots.slice(0, 10),
  });
}

/**
 * Take one now.
 *
 * Guarded by the same secret the Telegram webhook uses, because a snapshot
 * costs a write and an open endpoint would let anyone spend the bucket.
 */
export async function POST(req: NextRequest) {
  const presented = req.headers.get("x-devoxpad-secret") ?? "";
  if (!safeEqual(presented, webhookSecret())) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const out = await backupNow();
  return Response.json(out, { status: out.ok ? 200 : 500 });
}
