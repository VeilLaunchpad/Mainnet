import { NextRequest } from "next/server";
import {
  getAgent,
  ensureThread,
  appendMessage,
  runAgentTurn,
  threadTitleFrom,
} from "@/lib/agent-runtime";
import { db, now } from "@/lib/db";
import { brainAvailable } from "@/lib/llm";
import type { ToolContext } from "@/lib/agent-tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The agentic chat endpoint.
 *
 * Streams Server-Sent Events so the client sees the agent reason, call tools
 * and surface signable actions in real time. The transcript is persisted
 * server-side, so a reload resumes the same relationship rather than starting
 * a new one.
 */
export async function POST(req: NextRequest) {
  if (!brainAvailable()) {
    return Response.json(
      { error: "No LLM configured. Set LLM_POOL in .env.local." },
      { status: 503 },
    );
  }

  let body: {
    agent?: string;
    threadId?: string;
    message?: string;
    address?: string;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const agent = getAgent(body.agent || "concierge");
  if (!agent) return Response.json({ error: "agent not found" }, { status: 404 });

  const text = (body.message || "").trim();
  if (!text) return Response.json({ error: "empty message" }, { status: 400 });

  const owner = body.address || agent.owner || "";
  const threadId = ensureThread(agent.id, body.threadId, owner);

  const existing = db()
    .prepare("SELECT COUNT(*) AS c FROM messages WHERE thread_id = ?")
    .get(threadId) as { c: number };
  if (!existing || existing.c === 0) {
    db()
      .prepare("UPDATE threads SET title = ?, updated_at = ? WHERE id = ?")
      .run(threadTitleFrom(text), now(), threadId);
  }

  appendMessage(threadId, { role: "user", content: text });

  const ctx: ToolContext = {
    user: (body.address as `0x${string}`) || null,
    agentId: agent.id,
    threadId,
    autonomy: agent.autonomy,
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) => {
        controller.enqueue(encoder.encode("data: " + JSON.stringify(event) + "\n\n"));
      };

      send({ type: "thread", threadId });

      try {
        for await (const ev of runAgentTurn({ agent, threadId, ctx })) {
          send(ev);
        }
      } catch (err) {
        send({ type: "error", error: String(err).slice(0, 300) });
      } finally {
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
