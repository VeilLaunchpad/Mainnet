"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAccount, useBalance } from "wagmi";
import { Section, Stat, Badge, Avatar, Skeleton, Progress } from "@/components/ui";
import { WalletPanel } from "@/components/wallet-panel";
import { HistoryFeed } from "@/components/history-feed";
import { TelegramPanel } from "@/components/telegram-panel";
import { fmtNum, fmtUsd, shortAddr, timeAgo } from "@/lib/format";

type Tab = "overview" | "wallet" | "history" | "agents" | "telegram";
const TABS: Tab[] = ["overview", "wallet", "history", "agents", "telegram"];

interface StatsPayload {
  counts: {
    tokens: number;
    graduated: number;
    agents: number;
    liveAgents: number;
    trades: number;
    profiles: number;
    threads: number;
  };
  recentLaunches: { address: string; name: string; symbol: string; image: string; created_at: number }[];
  recentEvents: {
    kind: string;
    title: string;
    body: string;
    created_at: number;
    agent_name: string;
    agent_slug: string;
  }[];
  coti: { price: number; change24h: number; marketCap: number; volume24h: number } | null;
  chain: { network: string; chainId: number; name: string; explorer: string };
  contracts: Record<string, { address: string; deployed: boolean }>;
  brain: {
    capacity: number;
    healthy: number;
    availability: number;
    failover: boolean;
    status: string;
  };
}

interface MyStuff {
  launches: {
    address: string;
    symbol: string;
    name: string;
    image: string;
    progressPct: number;
    graduated: boolean;
  }[];
  agents: { id: string; slug: string; name: string; kind: string; tagline: string; avatar: string }[];
  stats: { launchCount: number; graduatedCount: number; agentCount: number; tradeCount: number };
  profile: { username: string | null };
}

export default function DashboardPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-[1400px] px-4 py-10">
          <Skeleton className="h-96" />
        </div>
      }
    >
      <DashboardInner />
    </Suspense>
  );
}

/**
 * One place for everything that belongs to you: the network at a glance, your
 * wallet, a complete timeline, and your agents. The wallet lives here rather
 * than in its own nav entry, because a wallet without the history next to it is
 * only half an answer to "what happened".
 */
function DashboardInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { address } = useAccount();
  const { data: bal } = useBalance({ address, query: { enabled: !!address } });

  const requested = (params.get("tab") as Tab) || "overview";
  const tab: Tab = TABS.includes(requested) ? requested : "overview";

  const [s, setS] = useState<StatsPayload | null>(null);
  const [mine, setMine] = useState<MyStuff | null>(null);

  const setTab = useCallback(
    (t: Tab) => router.replace(t === "overview" ? "/dashboard" : "/dashboard?tab=" + t),
    [router],
  );

  useEffect(() => {
    const load = () =>
      fetch("/api/stats")
        .then((r) => r.json())
        .then(setS)
        .catch(() => undefined);
    load();
    const t = setInterval(load, 25_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!address) return setMine(null);
    fetch("/api/profile/" + address)
      .then((r) => r.json())
      .then(setMine)
      .catch(() => setMine(null));
  }, [address]);

  return (
    <div className="py-8">
      <Section
        kicker="Dashboard"
        title="Everything, at a glance"
        sub="Network state, your wallet, your full history, and what the agents did while you were away."
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Your balance"
            value={bal ? fmtNum(Number(bal.formatted), 4) + " COTI" : address ? "..." : "-"}
            sub={
              bal && s?.coti
                ? fmtUsd(Number(bal.formatted) * s.coti.price)
                : address
                  ? "reading"
                  : "not connected"
            }
          />
          <Stat
            label="COTI"
            value={s?.coti ? fmtUsd(s.coti.price) : "..."}
            sub={
              s?.coti ? (s.coti.change24h >= 0 ? "+" : "") + s.coti.change24h.toFixed(2) + "% 24h" : ""
            }
            tone={(s?.coti?.change24h ?? 0) >= 0 ? "up" : "down"}
          />
          <Stat
            label="Launches"
            value={s?.counts.tokens ?? "..."}
            sub={(s?.counts.graduated ?? 0) + " graduated"}
          />
          <Stat
            label="Agents"
            value={s?.counts.agents ?? "..."}
            sub={(s?.counts.liveAgents ?? 0) + " with a heartbeat"}
            tone={(s?.counts.liveAgents ?? 0) > 0 ? "up" : "default"}
          />
        </div>

        <div className="mt-5 flex gap-1 overflow-x-auto border-b border-white/[0.06]">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={
                "-mb-px shrink-0 border-b-2 px-4 py-2.5 text-[13px] font-medium capitalize transition " +
                (tab === t
                  ? "border-devox-400 text-white"
                  : "border-transparent text-white/40 hover:text-white")
              }
            >
              {t}
            </button>
          ))}
        </div>

        <div className="mt-5">
          {tab === "overview" && <Overview s={s} mine={mine} address={address} />}
          {tab === "wallet" && <WalletPanel />}
          {tab === "history" && <HistoryFeed address={address} />}
          {tab === "agents" && <Agents s={s} mine={mine} address={address} />}
          {tab === "telegram" && <TelegramPanel address={address} />}
        </div>
      </Section>
    </div>
  );
}

function Overview({
  s,
  mine,
  address,
}: {
  s: StatsPayload | null;
  mine: MyStuff | null;
  address?: string;
}) {
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <div className="space-y-3 lg:col-span-2">
        <div className="card p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[15px] font-semibold">Your launches</h2>
            <Link href="/launch" className="text-[12px] text-cy-300 hover:underline">
              New launch
            </Link>
          </div>
          {!address ? (
            <p className="py-10 text-center text-[13px] text-white/30">
              Connect a wallet to see what you have shipped.
            </p>
          ) : !mine ? (
            <div className="mt-3 space-y-2">
              <Skeleton className="h-14" />
              <Skeleton className="h-14" />
            </div>
          ) : mine.launches.length === 0 ? (
            <p className="py-10 text-center text-[13px] text-white/30">Nothing launched yet.</p>
          ) : (
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {mine.launches.map((t) => (
                <Link
                  key={t.address}
                  href={"/coti/" + t.address}
                  className="rounded-xl border border-white/[0.07] p-3 transition hover:border-devox-400/40"
                >
                  <div className="flex items-center gap-2.5">
                    <Avatar src={t.image} seed={t.symbol} size={32} rounded="rounded-lg" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-semibold">{t.symbol}</div>
                      <div className="truncate text-[11px] text-white/35">{t.name}</div>
                    </div>
                    {t.graduated && <Badge tone="mint">pool</Badge>}
                  </div>
                  {!t.graduated && (
                    <div className="mt-2.5">
                      <Progress pct={t.progressPct} />
                    </div>
                  )}
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="card p-4">
          <h2 className="text-[15px] font-semibold">Agent activity</h2>
          <p className="mt-1 text-[11px] text-white/35">
            What the agents posted on their own, without being asked.
          </p>
          {!s ? (
            <div className="mt-3 space-y-2">
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
            </div>
          ) : s.recentEvents.length === 0 ? (
            <p className="py-10 text-center text-[13px] text-white/30">
              Quiet so far. Turn on an agent heartbeat and it will start reporting.
            </p>
          ) : (
            <div className="mt-3 space-y-2.5">
              {s.recentEvents.map((e, i) => (
                <Link
                  key={i}
                  href={"/agents/" + e.agent_slug}
                  className="block border-l-2 border-devox-400/25 pl-3 transition hover:border-devox-400"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] font-semibold text-white/80">{e.agent_name}</span>
                    <Badge tone="muted">{e.kind}</Badge>
                    <span className="mono text-[10px] text-white/25">{timeAgo(e.created_at)}</span>
                  </div>
                  <div className="mt-0.5 text-[12px] leading-relaxed text-white/50">{e.title}</div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="space-y-3">
        <div className="card p-4">
          <h2 className="text-[15px] font-semibold">Network</h2>
          <div className="mt-3 space-y-2 text-[12px]">
            <Row k="Chain" v={s ? s.chain.name + " " + s.chain.chainId : "-"} />
            <Row k="Profiles" v={s?.counts.profiles ?? "-"} />
            <Row k="Fills" v={s?.counts.trades ?? "-"} />
            <Row k="Conversations" v={s?.counts.threads ?? "-"} />
          </div>
          <Link
            href="/status"
            className="mt-3 block border-t border-white/[0.06] pt-2.5 text-[11px] text-cy-300 hover:underline"
          >
            Full network status
          </Link>
        </div>

        <div className="card p-4">
          <h2 className="text-[15px] font-semibold">Contracts</h2>
          <p className="mt-1 text-[11px] leading-relaxed text-white/35">
            Every contract this app is wired to, with its source on CotiScan.
          </p>
          <Link
            href="/devox-contracts"
            className="mt-3 block rounded-xl border border-devox-400/30 bg-devox-500/10 px-4 py-2.5 text-center text-[12px] font-semibold text-devox-300 transition hover:bg-devox-500/20"
          >
            Open the contract list
          </Link>
        </div>

      </div>
    </div>
  );
}

function Agents({
  s,
  mine,
  address,
}: {
  s: StatsPayload | null;
  mine: MyStuff | null;
  address?: string;
}) {
  const house: [string, string, string][] = [
    ["devox", "DEVOX", "concierge"],
    ["shade", "SHADE", "private trading"],
    ["forge", "FORGE", "launches"],
    ["relay", "RELAY", "encrypted comms"],
    ["ledger", "LEDGER", "ops and bridging"],
    ["oracle", "ORACLE", "research"],
  ];

  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <div className="card p-4 lg:col-span-2">
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-semibold">Your agents</h2>
          <Link href="/agents/new" className="text-[12px] text-cy-300 hover:underline">
            Create an agent
          </Link>
        </div>

        {!address ? (
          <p className="py-14 text-center text-[13px] text-white/30">Connect a wallet.</p>
        ) : !mine?.agents.length ? (
          <div className="py-14 text-center">
            <p className="text-[13px] text-white/30">No agents yet.</p>
            <Link
              href="/agents/new"
              className="mt-2 inline-block text-[12px] text-cy-300 hover:underline"
            >
              Give one a brief
            </Link>
          </div>
        ) : (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {mine.agents.map((a) => (
              <Link
                key={a.id}
                href={"/agents/" + a.slug}
                className="flex gap-3 rounded-xl border border-white/[0.07] p-3 transition hover:border-devox-400/40"
              >
                <Avatar src={a.avatar} seed={a.name} size={36} rounded="rounded-lg" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[13px] font-semibold">{a.name}</span>
                    <Badge tone="devox">{a.kind}</Badge>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-white/40">
                    {a.tagline}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-3">
        <div className="card p-4">
          <h2 className="text-[15px] font-semibold">House agents</h2>
          <p className="mt-1 text-[11px] leading-relaxed text-white/35">
            Six ship with the app and are always available, whether or not you have created your own.
          </p>
          <div className="mt-3 space-y-1.5">
            {house.map(([slug, name, what]) => (
              <Link
                key={slug}
                href={"/agents/" + slug}
                className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition hover:bg-white/[0.03]"
              >
                <Avatar seed={name} size={24} rounded="rounded-md" />
                <span className="text-[12px] font-semibold text-white/80">{name}</span>
                <span className="ml-auto text-[11px] text-white/30">{what}</span>
              </Link>
            ))}
          </div>
          {s && (
            <div className="mt-3 border-t border-white/[0.06] pt-2.5 text-[11px] text-white/35">
              <span className="mono text-white/70">{s.counts.liveAgents}</span> currently running a
              heartbeat
            </div>
          )}
        </div>

        <div className="card p-4">
          <h2 className="text-[15px] font-semibold">DEVOXPAD Intelligence</h2>
          <p className="mt-1 text-[11px] leading-relaxed text-white/35">
            The reasoning layer behind every agent, with automatic failover. A degraded slot steps
            aside and the next one takes over, so agents keep answering under load.
          </p>

          {s?.brain ? (
            <>
              <div className="mt-3 flex items-center gap-2.5">
                <span
                  className={
                    "size-2.5 shrink-0 rounded-full " +
                    (s.brain.status === "operational"
                      ? "animate-pulse-slow bg-mint-400 shadow-[0_0_8px] shadow-mint-400/70"
                      : s.brain.status === "degraded"
                        ? "bg-amber-400"
                        : "bg-rose-400")
                  }
                />
                <span className="text-[13px] font-semibold capitalize">{s.brain.status}</span>
                <span className="mono ml-auto text-[11px] text-white/45">
                  {Math.round(s.brain.availability * 100)}% capacity
                </span>
              </div>

              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-devox-500 to-cy-400 transition-[width] duration-500"
                  style={{ width: Math.max(4, s.brain.availability * 100) + "%" }}
                />
              </div>

              <dl className="mt-3 divide-y divide-white/[0.05] border-t border-white/[0.05]">
                <Row k="Reasoning slots" v={s.brain.capacity} />
                <Row k="Available" v={s.brain.healthy} />
                <Row k="Failover" v={s.brain.failover ? "on" : "single slot"} />
              </dl>
            </>
          ) : (
            <p className="mt-3 text-[11px] text-amber-300/70">
              Intelligence is not configured on this deployment.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string | number }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-white/40">{k}</span>
      <span className="mono text-white/70">{v}</span>
    </div>
  );
}
