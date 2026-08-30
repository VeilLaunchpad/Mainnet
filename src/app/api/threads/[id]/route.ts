import { NextRequest } from "next/server";
import { db, row } from "@/lib/db";
import { threadMessages } from "@/lib/agent-runtime";

/**
 * Whether this request may touch this thread.
 *
 * A thread records the wallet that started it. Both handlers used to ignore
 * that column entirely, so any caller who had a thread id could read - or
 * delete - somebody else's private agent conversation.
 *
 * Two things guard it now: the id is an unguessable random one, and a thread
 * that recorded an owner only answers to that owner.
 *
 * Be clear about the limit. The address arrives from the client and is not
 * proved, so this stops enumeration and cross-linking from the UI, not a
 * determined attacker who already knows the victim's address AND their thread
 * id. Closing that properly needs a signed session, which is a larger change
 * than this route.
 */
function mayTouch(id: string, viewer: string): { ok: boolean; status: number } {
  const t = row(
    db().prepare("SELECT owner FROM threads WHERE id = ?").get(id),
  ) as { owner?: string } | undefined;

  if (!t) return { ok: false, status: 404 };
  const owner = (t.owner || "").toLowerCase();
  if (!owner) return { ok: true, status: 200 }; // pre-ownership threads stay readable
  return owner === viewer.toLowerCase() ? { ok: true, status: 200 } : { ok: false, status: 403 };
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Rehydrate a conversation. Tool messages are folded into the assistant turn
 * they belong to so the UI can replay the agent's steps exactly as they
 * happened rather than showing raw JSON blobs.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const gate = mayTouch(id, req.nextUrl.searchParams.get("viewer") ?? "");
  if (!gate.ok) {
    return Response.json(
      { error: gate.status === 404 ? "no such thread" : "this thread belongs to another wallet" },
      { status: gate.status },
    );
  }

  const stored = threadMessages(id, 200);

  const out: {
    role: string;
    content: string;
    tools: { name: string; ok: boolean; result: unknown }[];
    actions: Record<string, unknown>[];
    at: number;
  }[] = [];

  for (const m of stored) {
    if (m.role === "tool") {
      const last = out[out.length - 1];
      if (last && last.role === "assistant") {
        let parsed: Record<string, unknown> = {};
        try {
          parsed = JSON.parse(m.content || "{}");
        } catch {
          parsed = {};
        }
        last.tools.push({ name: m.name, ok: !!parsed.ok, result: parsed });
        if (parsed.action) last.actions.push(parsed.action as Record<string, unknown>);
      }
      continue;
    }
    if (m.role === "assistant" && !m.content) {
      out.push({ role: "assistant", content: "", tools: [], actions: [], at: m.created_at });
      continue;
    }
    out.push({ role: m.role, content: m.content, tools: [], actions: [], at: m.created_at });
  }

  /**
   * Put the steps back on the answer they belong to.
   *
   * Each tool-calling round is stored as its own contentless assistant row, and
   * the reply that follows is a separate row - so replaying them one for one
   * produced two turns: a bare step list, then the answer underneath it. That is
   * not how the turn happened, and it is why the steps reappeared above every
   * reply on a reload.
   *
   * A contentless assistant row carrying tools is therefore folded into the next
   * assistant row that actually said something, taking its tools and actions
   * with it.
   */
  const folded: typeof out = [];
  for (const m of out) {
    const prev = folded[folded.length - 1];
    if (
      m.role === "assistant" &&
      m.content &&
      prev &&
      prev.role === "assistant" &&
      !prev.content
    ) {
      folded[folded.length - 1] = {
        ...m,
        tools: [...prev.tools, ...m.tools],
        actions: [...prev.actions, ...m.actions],
        at: prev.at,
      };
      continue;
    }
    folded.push(m);
  }

  // Whatever is left with nothing to say and nothing to show is dropped, except
  // a trailing one - a turn that was still being written when the page closed.
  const merged = folded.filter((m, i) => {
    if (m.role !== "assistant" || m.content || m.tools.length || m.actions.length) return true;
    return i === folded.length - 1;
  });

  return Response.json({ threadId: id, messages: merged });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const gate = mayTouch(id, req.nextUrl.searchParams.get("viewer") ?? "");
  if (!gate.ok) {
    return Response.json(
      { error: gate.status === 404 ? "no such thread" : "this thread belongs to another wallet" },
      { status: gate.status },
    );
  }

  db().prepare("DELETE FROM messages WHERE thread_id = ?").run(id);
  db().prepare("DELETE FROM threads WHERE id = ?").run(id);
  return Response.json({ ok: true });
}
