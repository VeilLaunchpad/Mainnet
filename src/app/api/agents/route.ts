import { NextRequest } from "next/server";
import { db, rows, now } from "@/lib/db";
import { slugify } from "@/lib/format";
import { AGENT_KINDS, listAgents } from "@/lib/agent-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `viewer` is who is asking, and it decides what comes back.
 *
 * A private agent belongs to the address that made it, so it is only ever in
 * this list for that address. `mine=1` narrows further to agents the viewer
 * created, which is what the "your agents" surfaces want.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const viewer = q.get("viewer") || q.get("owner") || undefined;
  const mine = q.get("mine") === "1";
  const kind = q.get("kind");

  let list = listAgents(viewer || undefined, mine);
  if (kind) list = list.filter((a) => a.kind === kind);

  return Response.json({
    viewer: viewer ?? null,
    agents: list.map((a) => ({
      id: a.id,
      slug: a.slug,
      owner: a.owner,
      name: a.name,
      kind: a.kind,
      avatar: a.avatar,
      tagline: a.tagline,
      autonomy: a.autonomy,
      visibility: a.owner ? a.visibility : "public",
      /** House agents have no owner, so nobody can flip their visibility. */
      isHouse: !a.owner,
      mine: !!viewer && !!a.owner && a.owner.toLowerCase() === viewer.toLowerCase(),
      token: a.token,
      status: a.status,
      heartbeatSec: a.heartbeat_sec,
      createdAt: a.created_at,
    })),
  });
}

export async function POST(req: NextRequest) {
  const b = (await req.json().catch(() => ({}))) as Record<string, string>;
  const name = (b.name || "").trim();
  if (!name) return Response.json({ error: "name required" }, { status: 400 });

  const kind = (AGENT_KINDS as readonly string[]).includes(b.kind) ? b.kind : "research";
  let slug = slugify(b.slug || name);
  if (!slug) slug = "agent-" + Math.random().toString(36).slice(2, 8);

  const clash = db().prepare("SELECT id FROM agents WHERE slug = ?").get(slug);
  if (clash) slug = slug + "-" + Math.random().toString(36).slice(2, 5);

  const id = "ag_" + Math.random().toString(36).slice(2, 12);
  const autonomy = ["advisory", "approval", "auto"].includes(b.autonomy) ? b.autonomy : "approval";
  // Private unless the creator says otherwise. Defaulting the other way would
  // publish someone's work because they did not find a setting.
  const visibility = b.visibility === "public" ? "public" : "private";

  db()
    .prepare(
      `INSERT INTO agents (id, slug, owner, name, kind, avatar, tagline, persona, autonomy, visibility, wallet, token, config, memory, status, heartbeat_sec, last_tick, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id, slug, b.owner || "", name, kind, b.avatar || "", b.tagline || "", b.persona || "",
      autonomy, visibility, b.wallet || "", b.token || "", JSON.stringify(b.config || {}), "[]",
      "idle", 0, 0, now(), now(),
    );

  return Response.json({ ok: true, id, slug, visibility, url: "/agents/" + slug });
}
