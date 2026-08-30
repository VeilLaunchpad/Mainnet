"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Avatar, Badge, Progress, Skeleton, Stat } from "@/components/ui";
import { TradePanel } from "@/components/trade-panel";
import { AgentChat } from "@/components/agent-chat";
import { PriceChart, PriceText } from "@/components/price-chart";
import { TokenComments } from "@/components/token-comments";
import { TokenInfo } from "@/components/token-info";
import { shortAddr, fmtNum, fmtPriceUsd, timeAgo } from "@/lib/format";
import { explorerAddress, explorerTx } from "@/lib/chain";
import { useNetwork } from "@/components/network-provider";

interface TokenPayload {
  token: {
    address: string; name: string; symbol: string; decimals: number; description: string;
    image: string; banner: string; creator: string; kind: string; isPrivate: boolean;
    curve: string; feeTier: number; createdAt: number; txHash: string;
    creatorProfile: { username: string; display_name: string; avatar: string } | null;
    links: Record<string, string>;
  };
  curve: {
    reserveCoti: string; sold: string; graduated: boolean; progressPct: number;
    targetCoti: string; spotPriceCoti: number | null; spotPriceUsd: number | null;
  } | null;
  pool: {
    address: string; venue: string; feeBps: number;
    reserveToken: string; reserveCoti: string; lpSupply: string;
    priceCoti: number; priceUsd: number | null;
  } | null;
  market: { cotiUsd: number; cotiChange24h: number } | null;
  trades: {
    venue: string; side: string; coti_in: string; token_out: string;
    trader: string; tx_hash: string; created_at: number; source: string;
  }[];
  stats: { tradeCount: number; knownTraders: number };
}

export default function TokenPage({ params }: { params: Promise<{ ca: string }> }) {
  const { net } = useNetwork();
  const { ca } = use(params);
  const [data, setData] = useState<TokenPayload | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Polls so curve progress and pool reserves stay current without a refresh;
  // `reload` is also handed to the trade panel so a fill updates immediately.
  const reload = useCallback(
    () =>
      fetch("/api/tokens/" + ca)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("404"))))
        .then(setData)
        .catch(() => setNotFound(true)),
    [ca],
  );

  useEffect(() => {
    reload();
    const t = setInterval(reload, 20_000);
    return () => clearInterval(t);
  }, [reload]);

  if (notFound) {
    return (
      <div className="mx-auto max-w-[1400px] px-4 py-24 text-center sm:px-6">
        <h1 className="text-2xl font-bold">Token not found</h1>
        <p className="mt-2 text-[14px] text-white/45">
          Nothing at <span className="mono">{shortAddr(ca, 8)}</span> on this network.
        </p>
        <Link href="/launchpad" className="mt-5 inline-block text-[13px] font-semibold text-cy-300 hover:underline">
          Back to the launchpad →
        </Link>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-[1400px] space-y-3 px-4 py-10 sm:px-6">
        <Skeleton className="h-28" />
        <div className="grid gap-3 lg:grid-cols-3">
          <Skeleton className="h-96 lg:col-span-2" />
          <Skeleton className="h-96" />
        </div>
      </div>
    );
  }

  const t = data.token;
  const c = data.curve;
  // Once a pair exists it is the venue that sets the price, not the frozen curve.
  const priceCoti = data.pool?.priceCoti ?? c?.spotPriceCoti ?? null;
  const priceUsd = data.pool?.priceUsd ?? c?.spotPriceUsd ?? null;

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6">
      <div className="card overflow-hidden">
        {t.banner && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={t.banner} alt="" className="h-28 w-full object-cover sm:h-36" />
        )}
        <div className="flex flex-wrap items-start gap-4 p-5">
          <Avatar src={t.image} seed={t.symbol} size={64} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">{t.symbol}</h1>
              <span className="text-[15px] text-white/45">{t.name}</span>
              {t.isPrivate && <Badge tone="cy">Encrypted balances</Badge>}
              {data.pool ? <Badge tone="mint">Graduated</Badge> : <Badge tone="devox">On curve</Badge>}

              {/*
                A pooled token trades on the DEX rather than the curve, so the
                page should offer the route that actually fills. The panel below
                can trade it too; this is for someone who came to look at the
                chart and decided to buy.
              */}
              {data.pool && (
                <Link
                  href={"/swap?token=" + t.address}
                  className="ml-auto rounded-xl bg-gradient-to-r from-devox-500 to-cy-500 px-4 py-2 text-[13px] font-semibold text-white transition hover:brightness-110"
                >
                  Trade on DevoxSwap
                </Link>
              )}
            </div>
            {t.description && (
              <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-white/50">{t.description}</p>
            )}
            <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-white/35">
              <a
                href={explorerAddress(t.address, net)}
                target="_blank"
                rel="noreferrer"
                className="mono transition hover:text-cy-300"
              >
                {shortAddr(t.address, 6)} ↗
              </a>
              {t.creator && (
                <span>
                  by{" "}
                  <Link
                    href={t.creatorProfile ? "/profile/" + t.creatorProfile.username : "/profile/" + t.creator}
                    className="text-white/55 transition hover:text-devox-300"
                  >
                    {t.creatorProfile ? "@" + t.creatorProfile.username : shortAddr(t.creator)}
                  </Link>
                </span>
              )}
              {t.createdAt > 0 && <span>launched {timeAgo(t.createdAt)} ago</span>}
            </div>
          </div>

          <div className="text-right">
            <div className="text-[11px] uppercase tracking-wider text-white/30">Price</div>
            <div className="mono text-2xl font-semibold">
              <PriceText value={priceCoti} />
              <span className="ml-1 text-[13px] font-normal text-white/40">COTI</span>
            </div>
            {priceUsd ? (
              <div className="mono text-[12px] text-white/35">{fmtPriceUsd(priceUsd)}</div>
            ) : null}
            <div className="mt-0.5 text-[10px] text-white/25">
              {data.pool ? "DevoxSwap pair" : "bonding curve"}
            </div>
          </div>
        </div>

        {c && !c.graduated && (
          <div className="border-t border-white/[0.06] px-5 py-4">
            <Progress
              pct={c.progressPct}
              label={`${c.reserveCoti} / ${c.targetCoti} COTI raised - the whole reserve seeds a DevoxSwap pair on graduation`}
            />
          </div>
        )}
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          <div className="card p-4">
            <PriceChart token={t.address} symbol={t.symbol} refreshKey={refreshKey} />
          </div>

          <div className="grid gap-3 sm:grid-cols-4">
            {data.pool ? (
              <>
                <Stat label="Pool liquidity" value={data.pool.reserveCoti + " COTI"} sub="paired both sides" />
                <Stat label="In the pair" value={data.pool.reserveToken} sub={t.symbol} />
              </>
            ) : (
              <>
                <Stat label="Reserve" value={(c?.reserveCoti ?? "0") + " COTI"} sub="raised on the curve" />
                <Stat label="Sold" value={c?.sold ?? "-"} sub="from the curve" />
              </>
            )}
            <Stat label="Fills" value={data.stats.tradeCount} sub="recorded on DEVOXPAD" />
            <Stat
              label="Supply"
              value={t.isPrivate ? "sealed" : "public"}
              sub={t.isPrivate ? "aggregate withheld by design" : "standard ERC-20"}
            />
          </div>

          <div className="card p-4">
            <h2 className="mb-3 text-[15px] font-semibold">Recent fills</h2>
            {data.trades.length === 0 ? (
              <p className="py-6 text-center text-[13px] text-white/30">
                No fills recorded yet. Be the first.
              </p>
            ) : (
              <div className="space-y-1">
                {data.trades.slice(0, 20).map((tr, i) => (
                  <a
                    key={i}
                    href={tr.tx_hash ? explorerTx(tr.tx_hash, net) : undefined}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-[12px] transition hover:bg-white/[0.03]"
                  >
                    <span
                      className={
                        "w-9 shrink-0 font-semibold " +
                        (tr.side === "buy" ? "text-mint-400" : "text-rose-400")
                      }
                    >
                      {tr.side === "buy" ? "BUY" : "SELL"}
                    </span>
                    <span
                      className={
                        "hidden w-[68px] shrink-0 rounded px-1.5 py-0.5 text-center text-[9px] font-semibold uppercase tracking-wider sm:inline " +
                        (tr.venue === "devoxswap"
                          ? "bg-cy-500/12 text-cy-300"
                          : "bg-devox-500/12 text-devox-300")
                      }
                    >
                      {tr.venue === "devoxswap" ? "swap" : "curve"}
                    </span>
                    <span className="mono w-24 shrink-0 truncate text-white/45">
                      {shortAddr(tr.trader)}
                    </span>
                    <span className="mono flex-1 truncate text-white/65">
                      {tr.coti_in} COTI
                      <span className="text-white/25"> for </span>
                      {tr.token_out} {t.symbol}
                    </span>
                    <span className="mono shrink-0 text-white/25">
                      {tr.created_at ? timeAgo(tr.created_at) : "-"}
                    </span>
                  </a>
                ))}
              </div>
            )}
          </div>

          <TokenComments token={t.address} symbol={t.symbol} creator={t.creator} />
        </div>

        <div className="space-y-3">
          <TokenInfo token={data} />

          <TradePanel
            token={t.address}
            curve={t.curve}
            symbol={t.symbol}
            decimals={t.decimals}
            graduated={!!c?.graduated || !!data.pool}
            poolAddress={data.pool?.address}
            onTraded={() => {
              void reload();
              setRefreshKey((k) => k + 1);
            }}
          />

          <div className="card flex h-[520px] flex-col p-4">
            <div className="mb-2 flex items-center gap-2">
              <span className="size-2 rounded-full bg-mint-400 shadow-[0_0_8px] shadow-mint-400/70" />
              <h2 className="text-[15px] font-semibold">Ask SHADE about {t.symbol}</h2>
            </div>
            <p className="mb-2 text-[11px] leading-relaxed text-white/35">
              The private trading agent. It reads this token's curve, checks the market, and will
              hand you a signable position if it likes what it sees.
            </p>
            <AgentChat
              agentSlug="shade"
              agentName="SHADE"
              compact
              className="min-h-0 flex-1"
              suggestions={[
                "What do you make of " + t.symbol + "? Address " + t.address,
                "Quote me 1 COTI into " + t.symbol,
                "How far is this from graduating?",
              ]}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
