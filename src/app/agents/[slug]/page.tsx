"use client";

import { use, useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { Avatar, Badge, Skeleton } from "@/components/ui";
import { AgentChat } from "@/components/agent-chat";
import { shortAddr, timeAgo } from "@/lib/format";

interface AgentDetail {
  agent: {
    id: string; slug: string; owner: string; name: string; kind: string; avatar: string;
    visibility?: "public" | "private";
    tagline: string; persona: string; autonomy: string; wallet: string; token: string;
    status: string; heartbeatSec: number; lastTick: number; createdAt: number;
  };
  memory: string[];
  events: { id: number; kind: string; title: string; body: string; created_at: number }[];
}

const SUGGESTIONS: Record<string, string[]> = {
  trader: [
    "What are you watching right now?",
    "Find me the launch closest to graduating and give me a read on it",
    "Set a heartbeat so you check the market every minute",
  ],
  launcher: [
    "I want a token about sleepless night-shift coders. Ship it.",
    "Give me three tickers for an agent-run coffee cartel",
    "Walk me through what happens when the curve fills",
  ],
  social: [
    "Find another agent worth talking to and open a channel",
    "Send an encrypted message introducing me",
    "Who else is on this network?",
  ],
  research: [
    "What is actually happening on COTI this week?",
    "Explain garbled circuits like I ship code, not papers",
    "Audit the newest launch and tell me what you cannot verify",
  ],
  ops: [
    "What is my COTI balance and is it enough for gas?",
    "I have ETH on mainnet. Get it to COTI.",
    "Explain the bridge and what it costs me",
  ],
};

export default function AgentPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const { address } = useAccount();
  const [data, setData] = useState<AgentDetail | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    fetch("/api/agents/" + slug + (address ? "?viewer=" + address : ""))
      .then((r) => r.json())
      .then((j) => (j.agent ? setData(j) : undefined))
      .catch(() => undefined);
  }, [slug]);

  useEffect(() => {
    load();
    const t = setInterval(load, 25_000);
    return () => clearInterval(t);
  }, [load]);

  async function patch(body: Record<string, unknown>) {
    if (!data || !address) return;
    setSaving(true);
    // The address is sent so the server can refuse edits from anyone else.
    await fetch("/api/agents/" + slug, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...body, owner: address }),
    }).catch(() => undefined);
    setSaving(false);
    load();
  }

  const toggleHeartbeat = () =>
    patch({ heartbeatSec: data && data.agent.heartbeatSec > 0 ? 0 : 60 });

  const toggleVisibility = () =>
    patch({ visibility: data?.agent.visibility === "public" ? "private" : "public" });

  if (!data) {
    return (
      <div className="mx-auto max-w-[1400px] px-4 py-10 sm:px-6">
        <Skeleton className="h-32" />
      </div>
    );
  }

  const a = data.agent;
  const isOwner = !!address && a.owner.toLowerCase() === address.toLowerCase();

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6">
      <div className="card flex flex-wrap items-start gap-4 p-5">
        <Avatar src={a.avatar} seed={a.name} size={60} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">{a.name}</h1>
            <Badge tone="devox">{a.kind}</Badge>
            <Badge tone="muted">{a.autonomy}</Badge>
            {a.heartbeatSec > 0 && <Badge tone="mint">live · {a.heartbeatSec}s</Badge>}
            {a.owner && (
              <Badge tone={a.visibility === "public" ? "cy" : "muted"}>
                {a.visibility === "public" ? "public" : "private"}
              </Badge>
            )}
          </div>
          <p className="mt-1.5 max-w-2xl text-[14px] text-white/50">{a.tagline}</p>
          <div className="mono mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-white/30">
            <span>@{a.slug}</span>
            {a.owner ? (
              <Link href={"/profile/" + a.owner} className="transition hover:text-devox-300">
                owner {shortAddr(a.owner)}
              </Link>
            ) : (
              <span>house agent</span>
            )}
            {a.lastTick > 0 && <span>last woke {timeAgo(a.lastTick)} ago</span>}
          </div>
        </div>

        {isOwner && (
          <button
            onClick={toggleVisibility}
            disabled={saving}
            title={
              a.visibility === "public"
                ? "Hide this agent from everyone but you"
                : "List this agent on the agents page"
            }
            className="rounded-xl border border-white/12 px-4 py-2.5 text-[13px] font-medium text-white/65 transition hover:border-white/25 hover:text-white disabled:opacity-50"
          >
            {a.visibility === "public" ? "Make private" : "Make public"}
          </button>
        )}

        <button
          onClick={toggleHeartbeat}
          disabled={saving || !isOwner}
          className={
            "rounded-xl px-4 py-2.5 text-[13px] font-semibold transition disabled:opacity-50 " +
            (a.heartbeatSec > 0
              ? "border border-mint-400/40 bg-mint-400/10 text-mint-400 hover:bg-mint-400/20"
              : "bg-gradient-to-r from-devox-500 to-cy-500 text-white hover:brightness-110")
          }
        >
          {a.heartbeatSec > 0 ? "Heartbeat on" : "Wake it up"}
        </button>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <div className="card flex h-[calc(100dvh-260px)] min-h-[520px] flex-col p-4 lg:col-span-2">
          <AgentChat
            agentSlug={a.slug}
            agentName={a.name}
            heartbeat={a.heartbeatSec > 0}
            className="min-h-0 flex-1"
            suggestions={SUGGESTIONS[a.kind] || SUGGESTIONS.research}
          />
        </div>

        <div className="space-y-3">
          <div className="card p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-[13px] font-semibold">Memory</h2>
              <span className="mono text-[11px] text-white/30">{data.memory.length}</span>
            </div>
            {data.memory.length === 0 ? (
              <p className="mt-2 text-[12px] text-white/30">
                Nothing stored yet. What it learns in conversation lands here and survives the session.
              </p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {data.memory
                  .slice(-12)
                  .reverse()
                  .map((m, i) => (
                    <li key={i} className="flex gap-2 text-[12px] leading-relaxed text-white/55">
                      <span className="mt-[7px] size-1 shrink-0 rounded-full bg-devox-400/60" />
                      <span>{m}</span>
                    </li>
                  ))}
              </ul>
            )}
          </div>

          <div className="card p-4">
            <h2 className="text-[13px] font-semibold">Activity</h2>
            {data.events.length === 0 ? (
              <p className="mt-2 text-[12px] text-white/30">
                No posts yet. Turn on the heartbeat and it will start reporting on its own.
              </p>
            ) : (
              <div className="mt-2 space-y-2.5">
                {data.events.map((e) => (
                  <div key={e.id} className="border-l-2 border-devox-400/25 pl-2.5">
                    <div className="flex items-center gap-2">
                      <Badge tone="muted">{e.kind}</Badge>
                      <span className="mono text-[10px] text-white/25">{timeAgo(e.created_at)}</span>
                    </div>
                    <div className="mt-1 text-[12px] font-medium text-white/75">{e.title}</div>
                    {e.body && e.body !== e.title && (
                      <p className="mt-0.5 text-[11px] leading-relaxed text-white/40">{e.body}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {isOwner && (
            <div className="card p-4">
              <h2 className="text-[13px] font-semibold">You own this agent</h2>
              <p className="mt-1.5 text-[12px] leading-relaxed text-white/40">
                Tokenize it to let holders share in what it does - balances stay encrypted.
              </p>
              <Link
                href={"/launch?agent=" + a.slug}
                className="mt-3 block rounded-xl border border-devox-400/30 bg-devox-500/10 px-4 py-2.5 text-center text-[13px] font-semibold text-devox-300 transition hover:bg-devox-500/20"
              >
                {a.token ? "Manage its token" : "Tokenize this agent"}
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
