import { NextRequest } from "next/server";
import { getAgent, heartbeatTick } from "@/lib/agent-runtime";
import { brainAvailable } from "@/lib/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Heartbeat. The client pings this on the agent's own interval; the agent
 * looks around and either pushes something or stays quiet. This is what makes
 * the agent proactive rather than reactive.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const agent = getAgent(slug);
  if (!agent) return Response.json({ error: "not found" }, { status: 404 });
  if (!brainAvailable()) return Response.json({ spoke: false, text: "" });
  if (agent.heartbeat_sec <= 0) return Response.json({ spoke: false, text: "", reason: "heartbeat off" });

  const elapsed = Date.now() - agent.last_tick;
  if (elapsed < agent.heartbeat_sec * 1000) {
    return Response.json({
      spoke: false,
      text: "",
      reason: "too soon",
      nextInMs: agent.heartbeat_sec * 1000 - elapsed,
    });
  }

  const res = await heartbeatTick(agent);
  return Response.json({ ...res, agent: agent.slug, at: Date.now() });
}
