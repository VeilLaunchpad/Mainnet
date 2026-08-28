import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { threadMessages } from "@/lib/agent-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Rehydrate a conversation. Tool messages are folded into the assistant turn
 * they belong to so the UI can replay the agent's steps exactly as they
 * happened rather than showing raw JSON blobs.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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

  const merged = out.filter((m, i) => {
    if (m.role !== "assistant" || m.content || m.tools.length) return true;
    return i === out.length - 1;
  });

  return Response.json({ threadId: id, messages: merged });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  db().prepare("DELETE FROM messages WHERE thread_id = ?").run(id);
  db().prepare("DELETE FROM threads WHERE id = ?").run(id);
  return Response.json({ ok: true });
}
