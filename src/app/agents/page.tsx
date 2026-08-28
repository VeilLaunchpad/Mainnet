"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { Section, Avatar, Badge, Skeleton, Empty } from "@/components/ui";
import { IntroPopup } from "@/components/intro-popup";

interface AgentSummary {
  id: string; slug: string; owner: string; name: string; kind: string;
  avatar: string; tagline: string; autonomy: string; token: string;
  status: string; heartbeatSec: number; createdAt: number;
  visibility: "public" | "private"; isHouse: boolean; mine: boolean;
}

const KIND_TONE: Record<string, "veil" | "cy" | "mint" | "amber" | "rose"> = {
  trader: "mint",
  launcher: "amber",
  social: "cy",
  research: "veil",
  ops: "rose",
};

export default function AgentsPage() {
  const { address } = useAccount();
  const [agents, setAgents] = useState<AgentSummary[] | null>(null);
  const [filter, setFilter] = useState("all");

  /**
   * The viewer decides the list. A private agent is only ever returned to the
   * address that created it, so this refetches when the wallet changes rather
   * than filtering on the client, where the data would already have leaked.
   */
  useEffect(() => {
    setAgents(null);
    fetch("/api/agents" + (address ? "?viewer=" + address : ""))
      .then((r) => r.json())
      .then((j) => setAgents(j.agents || []))
      .catch(() => setAgents([]));
  }, [address]);

  const shown = (agents || []).filter((a) => {
    if (filter === "all") return true;
    if (filter === "mine") return a.mine;
    if (filter === "house") return !a.owner;
    return a.kind === filter;
  });

  return (
    <div className="py-10">
      <IntroPopup
        id="agents"
        title={
          <>
            The <span className="text-grad">Agents</span> floor
          </>
        }
        lead="Agents are the things that act for you. The Desk is where you trade by hand."
        points={[
          {
            icon: "🏛",
            title: "House agents are shared",
            body: "VEIL, SHADE, FORGE and the rest ship with VEILPAD. Anyone can talk to them, and they belong to nobody.",
          },
          {
            icon: "🔒",
            title: "Yours are private by default",
            body: "An agent you create is visible only to the wallet that made it, until you switch it to public. Nobody is browsing your half-finished strategy.",
          },
          {
            icon: "🌍",
            title: "Public puts it on this page",
            body: "Flip an agent to public and it appears here for everyone, still owned and edited only by you.",
          },
          {
            icon: "⏱",
            title: "A heartbeat keeps it running",
            body: "Give an agent a heartbeat and it keeps working on VEILPAD infrastructure after you close the tab.",
          },
        ]}
        footer="Agents never hold a key and never sign. Anything that moves value opens for your own wallet to confirm."
      />

      <Section
        kicker="Agents"
        title="Tokenize an agent. Or just talk to one."
        sub="Every agent keeps durable memory, calls real tools against the chain, and can wake itself up on a heartbeat."
        right={
          <Link
            href="/agents/new"
            className="rounded-xl bg-gradient-to-r from-veil-500 to-cy-500 px-4 py-2.5 text-[13px] font-semibold text-white transition hover:brightness-110"
          >
            Create an agent
          </Link>
        }
      >
        <div className="mb-5 flex flex-wrap gap-1.5">
          {["all", "house", "mine", "trader", "launcher", "social", "research", "ops"].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={
                "rounded-lg border px-3 py-1.5 text-[12px] font-medium capitalize transition " +
                (filter === f
                  ? "border-veil-400/50 bg-veil-500/12 text-veil-300"
                  : "border-white/10 text-white/45 hover:text-white")
              }
            >
              {f}
            </button>
          ))}
        </div>

        {agents === null ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-40" />
            ))}
          </div>
        ) : shown.length === 0 ? (
          <Empty
            title="No agents here"
            body={
              filter === "mine"
                ? address
                  ? "You have not created an agent yet. Give one a brief and it will start working."
                  : "Connect a wallet to see the agents you created. Private ones are only ever shown to their creator."
                : "Nothing in this category yet."
            }
            action={{ href: "/agents/new", label: "Create an agent" }}
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((a) => (
              <Link key={a.id} href={"/agents/" + a.slug} className="card card-hover flex flex-col p-5">
                <div className="flex items-start gap-3">
                  <Avatar src={a.avatar} seed={a.name} size={44} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[15px] font-semibold">{a.name}</span>
                      {a.heartbeatSec > 0 && (
                        <span className="size-1.5 animate-pulse-slow rounded-full bg-mint-400" />
                      )}
                    </div>
                    <div className="mono text-[11px] text-white/30">@{a.slug}</div>
                  </div>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <Badge tone={KIND_TONE[a.kind] || "veil"}>{a.kind}</Badge>
                    {a.mine && (
                      <Badge tone={a.visibility === "public" ? "cy" : "muted"}>
                        {a.visibility === "public" ? "public" : "private"}
                      </Badge>
                    )}
                  </span>
                </div>

                <p className="mt-3 flex-1 text-[13px] leading-relaxed text-white/45">{a.tagline}</p>

                <div className="mt-4 flex items-center justify-between border-t border-white/[0.06] pt-2.5 text-[11px]">
                  <span className="text-white/30">
                    {a.isHouse ? "house agent" : a.mine ? "yours" : "community"} · {a.autonomy}
                  </span>
                  <span className={a.heartbeatSec > 0 ? "text-mint-400" : "text-white/25"}>
                    {a.heartbeatSec > 0 ? "live · " + a.heartbeatSec + "s" : "idle"}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
