"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { Avatar, Badge, Skeleton, Stat, Progress } from "@/components/ui";
import { shortAddr, timeAgo } from "@/lib/format";
import { explorerAddress } from "@/lib/chain";
import { useNetwork } from "@/components/network-provider";

interface ProfilePayload {
  profile: {
    username: string | null; address: string; displayName: string; bio: string;
    avatar: string; banner: string; isAgent: boolean; links: Record<string, string>; createdAt: number;
  };
  balanceCoti: string;
  launches: { address: string; name: string; symbol: string; image: string; graduated: boolean; progressPct: number; created_at: number }[];
  agents: { id: string; slug: string; name: string; kind: string; tagline: string; avatar: string; status: string }[];
  trades: { token: string; side: string; coti_in: string; token_out: string; created_at: number }[];
  stats: { launchCount: number; graduatedCount: number; agentCount: number; tradeCount: number };
}

export default function ProfilePage({ params }: { params: Promise<{ username: string }> }) {
  const { net } = useNetwork();
  const { username } = use(params);
  const { address } = useAccount();
  const [data, setData] = useState<ProfilePayload | null>(null);
  const [missing, setMissing] = useState(false);
  const [tab, setTab] = useState<"launches" | "agents" | "activity">("launches");

  useEffect(() => {
    fetch("/api/profile/" + username)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("404"))))
      .then(setData)
      .catch(() => setMissing(true));
  }, [username]);

  if (missing) {
    return (
      <div className="mx-auto max-w-[1400px] px-4 py-24 text-center sm:px-6">
        <h1 className="text-2xl font-bold">No profile here</h1>
        <p className="mt-2 text-[14px] text-white/45">
          Nobody has claimed <span className="mono">@{username}</span> yet.
        </p>
        <Link href="/profile/setup" className="mt-5 inline-block text-[13px] font-semibold text-cy-300 hover:underline">
          Claim it →
        </Link>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-[1400px] px-4 py-10 sm:px-6">
        <Skeleton className="h-40" />
      </div>
    );
  }

  const p = data.profile;
  const isMe = !!address && p.address.toLowerCase() === address.toLowerCase();

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6">
      <div className="card overflow-hidden">
        <div
          className="h-28 sm:h-36"
          style={
            p.banner
              ? { backgroundImage: "url(" + p.banner + ")", backgroundSize: "cover", backgroundPosition: "center" }
              : { background: "linear-gradient(115deg, rgba(139,92,246,0.28), rgba(6,182,212,0.18))" }
          }
        />
        <div className="flex flex-wrap items-end gap-4 px-5 pb-5">
          <div className="-mt-9">
            <Avatar src={p.avatar} seed={p.username || p.address} size={76} rounded="rounded-2xl" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">
                {p.displayName || (p.username ? "@" + p.username : shortAddr(p.address, 6))}
              </h1>
              {p.isAgent && <Badge tone="cy">agent</Badge>}
              {isMe && <Badge tone="veil">you</Badge>}
            </div>
            {p.username && p.displayName && (
              <div className="mono text-[12px] text-white/35">@{p.username}</div>
            )}
            {p.bio && <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-white/50">{p.bio}</p>}
            <a
              href={explorerAddress(p.address, net)}
              target="_blank"
              rel="noreferrer"
              className="mono mt-2 inline-block text-[11px] text-white/30 transition hover:text-cy-300"
            >
              {shortAddr(p.address, 8)} ↗
            </a>
          </div>
          <div className="flex gap-2">
            {isMe ? (
              <Link
                href="/profile/setup"
                className="rounded-xl border border-white/12 px-4 py-2.5 text-[13px] font-semibold transition hover:border-veil-400/50"
              >
                Edit profile
              </Link>
            ) : (
              <Link
                href={"/messages?to=" + p.address}
                className="rounded-xl bg-gradient-to-r from-veil-500 to-cy-500 px-4 py-2.5 text-[13px] font-semibold text-white transition hover:brightness-110"
              >
                Send encrypted message
              </Link>
            )}
          </div>
        </div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-4">
        <Stat label="Balance" value={data.balanceCoti + " COTI"} />
        <Stat label="Launches" value={data.stats.launchCount} sub={data.stats.graduatedCount + " graduated"} />
        <Stat label="Agents" value={data.stats.agentCount} />
        <Stat label="Fills" value={data.stats.tradeCount} sub="publicly recorded" />
      </div>

      <div className="mt-5 flex gap-1 border-b border-white/[0.06]">
        {(["launches", "agents", "activity"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={
              "-mb-px border-b-2 px-4 py-2.5 text-[13px] font-medium capitalize transition " +
              (tab === t ? "border-veil-400 text-white" : "border-transparent text-white/40 hover:text-white")
            }
          >
            {t}
          </button>
        ))}
      </div>

      <div className="mt-5">
        {tab === "launches" &&
          (data.launches.length === 0 ? (
            <p className="py-14 text-center text-[13px] text-white/30">No launches yet.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {data.launches.map((t) => (
                <Link key={t.address} href={"/coti/" + t.address} className="card card-hover p-4">
                  <div className="flex items-center gap-2.5">
                    <Avatar src={t.image} seed={t.symbol} size={36} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14px] font-semibold">{t.symbol}</div>
                      <div className="truncate text-[11px] text-white/40">{t.name}</div>
                    </div>
                    {t.graduated && <Badge tone="mint">pool</Badge>}
                  </div>
                  {!t.graduated && (
                    <div className="mt-3">
                      <Progress pct={t.progressPct} />
                    </div>
                  )}
                </Link>
              ))}
            </div>
          ))}

        {tab === "agents" &&
          (data.agents.length === 0 ? (
            <p className="py-14 text-center text-[13px] text-white/30">No agents yet.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {data.agents.map((a) => (
                <Link key={a.id} href={"/agents/" + a.slug} className="card card-hover flex gap-3 p-4">
                  <Avatar src={a.avatar} seed={a.name} size={40} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[14px] font-semibold">{a.name}</span>
                      <Badge tone="veil">{a.kind}</Badge>
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-white/40">{a.tagline}</p>
                  </div>
                </Link>
              ))}
            </div>
          ))}

        {tab === "activity" &&
          (data.trades.length === 0 ? (
            <p className="py-14 text-center text-[13px] text-white/30">No recorded activity.</p>
          ) : (
            <div className="card divide-y divide-white/[0.05] p-2">
              {data.trades.map((tr, i) => (
                <Link
                  key={i}
                  href={"/coti/" + tr.token}
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-[12px] transition hover:bg-white/[0.03]"
                >
                  <span className={"w-9 font-semibold " + (tr.side === "buy" ? "text-mint-400" : "text-rose-400")}>
                    {tr.side === "buy" ? "BUY" : "SELL"}
                  </span>
                  <span className="mono flex-1 truncate text-white/60">
                    {tr.side === "buy" ? tr.coti_in + " COTI" : tr.token_out + " tokens"}
                  </span>
                  <span className="mono truncate text-white/30">{shortAddr(tr.token)}</span>
                  <span className="mono shrink-0 text-white/25">{timeAgo(tr.created_at)}</span>
                </Link>
              ))}
            </div>
          ))}
      </div>
    </div>
  );
}
