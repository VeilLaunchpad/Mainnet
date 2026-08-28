import { NextRequest } from "next/server";
import { db, rows } from "@/lib/db";
import { getAgent } from "@/lib/agent-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const a = getAgent(slug);
  if (!a) return Response.json({ error: "not found" }, { status: 404 });
  const since = Number(req.nextUrl.searchParams.get("since") || 0);
  const events = rows(
    db()
      .prepare("SELECT id, kind, title, body, tx_hash, created_at FROM agent_events WHERE agent_id = ? AND id > ? ORDER BY id DESC LIMIT 50")
      .all(a.id, since),
  );
  return Response.json({ events });
}
