import { NextRequest } from "next/server";
import { db, rows, now } from "@/lib/db";
import { getAgent, canView } from "@/lib/agent-runtime";

/**
 * Ownership here is a self-asserted address, not a signature, so this is a
 * boundary rather than a lock: it stops one person editing another's agent by
 * accident or by guessing a slug. Anything that actually moves value is still
 * signed by the wallet itself.
 */
function ownsIt(agentOwner: string, claimed: string | null): boolean {
  if (!agentOwner) return false; // house agents belong to nobody and are read-only
  return !!claimed && agentOwner.toLowerCase() === claimed.toLowerCase();
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const a = getAgent(slug);
  if (!a) return Response.json({ error: "not found" }, { status: 404 });

  // A private agent answers "not found" rather than "forbidden", so its
  // existence is not confirmed to someone who should not know about it.
  const viewer = req.nextUrl.searchParams.get("viewer");
  if (!canView(a, viewer ?? undefined)) {
    return Response.json({ error: "not found" }, { status: 404 });
  }

  let memory: string[] = [];
  try {
    memory = JSON.parse(a.memory || "[]");
  } catch {
    memory = [];
  }

  const events = rows(
    db()
      .prepare("SELECT id, kind, title, body, tx_hash, created_at FROM agent_events WHERE agent_id = ? ORDER BY id DESC LIMIT 30")
      .all(a.id),
  );
  const threads = rows(
    db()
      .prepare("SELECT id, title, updated_at FROM threads WHERE agent_id = ? ORDER BY updated_at DESC LIMIT 20")
      .all(a.id),
  );

  return Response.json({
    agent: {
      id: a.id, slug: a.slug, owner: a.owner, name: a.name, kind: a.kind,
      avatar: a.avatar, tagline: a.tagline, persona: a.persona, autonomy: a.autonomy,
      wallet: a.wallet, token: a.token, status: a.status,
      heartbeatSec: a.heartbeat_sec, lastTick: a.last_tick, createdAt: a.created_at,
    },
    memory,
    events,
    threads,
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const a = getAgent(slug);
  if (!a) return Response.json({ error: "not found" }, { status: 404 });

  const b = (await req.json().catch(() => ({}))) as Record<string, string | number>;

  if (!ownsIt(a.owner, b.owner ? String(b.owner) : null)) {
    return Response.json(
      { error: a.owner ? "only the creator can change this agent" : "house agents cannot be edited" },
      { status: 403 },
    );
  }

  const fields: Record<string, string> = {
    name: "name", tagline: "tagline", persona: "persona", avatar: "avatar",
    autonomy: "autonomy", token: "token", wallet: "wallet", status: "status",
  };

  // Only two values are meaningful, so anything else is treated as private.
  if (b.visibility !== undefined) {
    db()
      .prepare("UPDATE agents SET visibility = ? WHERE id = ?")
      .run(String(b.visibility) === "public" ? "public" : "private", a.id);
  }

  for (const [key, col] of Object.entries(fields)) {
    if (b[key] !== undefined) {
      db().prepare(`UPDATE agents SET ${col} = ? WHERE id = ?`).run(String(b[key]), a.id);
    }
  }
  if (b.heartbeatSec !== undefined) {
    const s = Number(b.heartbeatSec) || 0;
    db()
      .prepare("UPDATE agents SET heartbeat_sec = ?, status = ? WHERE id = ?")
      .run(s <= 0 ? 0 : Math.max(30, s), s > 0 ? "watching" : "idle", a.id);
  }
  db().prepare("UPDATE agents SET updated_at = ? WHERE id = ?").run(now(), a.id);

  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const a = getAgent(slug);
  if (!a) return Response.json({ error: "not found" }, { status: 404 });

  // Deleting is the least reversible thing here, so it gets the same check.
  const claimed = req.nextUrl.searchParams.get("owner");
  if (!ownsIt(a.owner, claimed)) {
    return Response.json(
      { error: a.owner ? "only the creator can delete this agent" : "house agents cannot be deleted" },
      { status: 403 },
    );
  }

  db().prepare("DELETE FROM agents WHERE id = ?").run(a.id);
  return Response.json({ ok: true });
}
