"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Badge, Skeleton, Stat } from "./ui";
import { fmtNum, fmtUsd, timeAgo, shortAddr } from "@/lib/format";
import { explorerTx } from "@/lib/chain";
import { useNetwork } from "./network-provider";

type Kind =
  | "launch"
  | "buy"
  | "sell"
  | "portal_in"
  | "portal_out"
  | "bridge"
  | "comment"
  | "agent"
  | "profile"
  | "telegram";

interface Entry {
  kind: Kind;
  source: "chain" | "index";
  title: string;
  detail: string;
  venue: string;
  token?: string;
  symbol?: string;
  amountCoti?: string;
  txHash?: string;
  href?: string;
  at: number;
}

interface HistoryResponse {
  entries: Entry[];
  count: number;
  summary: {
    launches: number;
    buys: number;
    sells: number;
    crossings: number;
    bridges: number;
    comments: number;
    telegram: number;
    agents: number;
    volumeCoti: number;
    volumeUsd: number | null;
  };
}

const FILTERS: { key: Kind | "all"; label: string }[] = [
  { key: "all", label: "Everything" },
  { key: "buy", label: "Buys" },
  { key: "sell", label: "Sells" },
  { key: "portal_in", label: "Into privacy" },
  { key: "portal_out", label: "Back out" },
  { key: "bridge", label: "Bridge" },
  { key: "launch", label: "Launches" },
  { key: "comment", label: "Comments" },
  { key: "agent", label: "Agents" },
  { key: "telegram", label: "Telegram" },
];

const TONE: Record<Kind, "mint" | "rose" | "devox" | "cy" | "amber" | "muted"> = {
  buy: "mint",
  sell: "rose",
  launch: "amber",
  portal_in: "devox",
  portal_out: "cy",
  bridge: "cy",
  comment: "muted",
  agent: "devox",
  profile: "muted",
  telegram: "cy",
};

const LABEL: Record<Kind, string> = {
  buy: "buy",
  sell: "sell",
  launch: "launch",
  portal_in: "portal in",
  portal_out: "portal out",
  bridge: "bridge",
  comment: "comment",
  agent: "agent",
  profile: "handle",
  telegram: "telegram",
};

/**
 * Everything an address has done, in one timeline.
 *
 * Trades and portal crossings come from chain events, so they appear whether
 * they went through this app, a script, or an agent acting alone. The rest is
 * from the local index. Each row says which, because "we saw this" and "the
 * chain says this" are different claims and should not look identical.
 */
export function HistoryFeed({ address }: { address?: string }) {
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [filter, setFilter] = useState<Kind | "all">("all");
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    if (!address) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    fetch("/api/history?address=" + address + "&limit=200")
      .then((r) => r.json())
      .then((j) => setData(j.error ? null : j))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [address]);

  useEffect(() => {
    load();
    const t = setInterval(load, 45_000);
    return () => clearInterval(t);
  }, [load]);

  if (!address) {
    return (
      <div className="card flex flex-col items-center justify-center px-6 py-20 text-center">
        <h3 className="text-[15px] font-semibold">Connect a wallet</h3>
        <p className="mt-1.5 max-w-sm text-[13px] text-white/45">
          Your timeline is built from your own transactions, so there is nothing to show yet.
        </p>
      </div>
    );
  }

  const entries = data?.entries.filter((e) => filter === "all" || e.kind === filter) ?? [];
  const s = data?.summary;

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat
          label="Volume traded"
          value={s ? fmtNum(s.volumeCoti, 4) + " COTI" : "..."}
          sub={s?.volumeUsd ? fmtUsd(s.volumeUsd) : "across every venue"}
        />
        <Stat label="Buys / sells" value={s ? s.buys + " / " + s.sells : "..."} sub="from chain events" />
        <Stat label="Portal crossings" value={s ? s.crossings : "..."} sub="in and out of privacy" />
        <Stat label="Launches" value={s ? s.launches : "..."} sub={(s?.agents ?? 0) + " agents created"} />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={
              "rounded-lg border px-3 py-1.5 text-[12px] font-medium transition " +
              (filter === f.key
                ? "border-devox-400/50 bg-devox-500/12 text-devox-300"
                : "border-white/10 text-white/45 hover:text-white")
            }
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="card p-2">
        {loading && !data ? (
          <div className="space-y-2 p-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        ) : entries.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <p className="text-[13px] text-white/30">
              {filter === "all" ? "Nothing here yet." : "Nothing of that kind yet."}
            </p>
            {filter === "all" && (
              <Link
                href="/launchpad"
                className="mt-3 inline-block text-[12px] text-cy-300 hover:underline"
              >
                Find something to trade
              </Link>
            )}
          </div>
        ) : (
          <div className="divide-y divide-white/[0.05]">
            {entries.map((e, i) => (
              <Row key={i} e={e} />
            ))}
          </div>
        )}
      </div>

      <p className="text-[11px] leading-relaxed text-white/25">
        Private transfer amounts never appear here. They are ciphertext on chain, and no timeline can
        honestly show what no indexer can read.
      </p>
    </div>
  );
}

function Row({ e }: { e: Entry }) {
  const { net } = useNetwork();
  const body = (
    <>
      <span className="w-[86px] shrink-0">
        <Badge tone={TONE[e.kind]}>{LABEL[e.kind]}</Badge>
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-white/85">{e.title}</span>
        <span className="block truncate text-[11px] text-white/40">{e.detail}</span>
      </span>

      <span className="hidden shrink-0 text-right sm:block">
        <span className="block text-[11px] text-white/45">{e.venue}</span>
        <span className="mono block text-[10px] text-white/25">
          {e.source === "chain" ? "on chain" : "indexed"}
        </span>
      </span>

      <span className="mono w-14 shrink-0 text-right text-[11px] text-white/30">
        {e.at ? timeAgo(e.at) : "-"}
      </span>
    </>
  );

  const className =
    "flex items-center gap-3 rounded-lg px-3 py-2.5 transition hover:bg-white/[0.03]";

  if (e.txHash) {
    return (
      <a href={explorerTx(e.txHash, net)} target="_blank" rel="noreferrer" className={className}>
        {body}
      </a>
    );
  }
  if (e.href) {
    return (
      <Link href={e.href} className={className}>
        {body}
      </Link>
    );
  }
  return <div className={className}>{body}</div>;
}

export { shortAddr };
