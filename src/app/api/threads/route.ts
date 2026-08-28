import { NextRequest } from "next/server";
import { db, rows } from "@/lib/db";
import { getAgent } from "@/lib/agent-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const agentSlug = req.nextUrl.searchParams.get("agent");
  const owner = req.nextUrl.searchParams.get("owner");
  if (!agentSlug) return Response.json({ threads: [] });
  const a = getAgent(agentSlug);
  if (!a) return Response.json({ threads: [] });

  const list = owner
    ? rows(
        db()
          .prepare("SELECT id, title, created_at, updated_at FROM threads WHERE agent_id = ? AND lower(owner) = lower(?) ORDER BY updated_at DESC LIMIT 30")
          .all(a.id, owner),
      )
    : rows(
        db()
          .prepare("SELECT id, title, created_at, updated_at FROM threads WHERE agent_id = ? ORDER BY updated_at DESC LIMIT 30")
          .all(a.id),
      );
  return Response.json({ threads: list });
}
