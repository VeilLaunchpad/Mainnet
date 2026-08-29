"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Section, Stat, Badge, Empty, Skeleton } from "@/components/ui";
import { useNetwork } from "@/components/network-provider";
import { explorerAddress, OFFICIAL_MAINNET_TOKEN } from "@/lib/chain";

/**
 * Every order-book pair on COTI, presented as VEILPAD's own explore surface.
 *
 * The numbers are read from COTI's public order-book indexes (Carbon's API,
 * internally - see lib/carbon.ts). That is a data source, not a brand: the page
 * carries no third-party badge, and its Trade button goes to VeilSwap rather
 * than sending the reader somewhere else.
 *
 * An order book is not an AMM, and the difference is the whole reason this page
 * exists. On a constant-product pair, liquidity is a pool and a price always
 * exists. Here liquidity is the sum of the orders people have posted, so a pair
 * with no strategies has no price at all - not a broken listing, just nobody
 * quoting yet.
 *
 * VEIL is highlighted when it appears, because the first question anyone asks
 * here is whether the protocol token is tradable and where.
 */

interface Pair {
  key: string;
  token0: string;
  token1: string;
  symbol0: string;
  symbol1: string;
  trades: number;
  trades24h: number;
  strategies: number;
  liquidityUsd: number;
  lastPrice: number | null;
  fromChain?: boolean;
  tokenDepth?: string;
  nativeDepth?: string;
}

interface Payload {
  network: string;
  available: boolean;
  reason?: string;
  venue?: string;
  site?: string;
  totalTrades?: number | null;
  pairs: Pair[];
}


export default function ExplorePage() {
  const { net } = useNetwork();
  const [data, setData] = useState<Payload | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    setData(null);
    fetch("/api/carbon/pairs")
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData({ network: net, available: false, reason: "Could not reach the API.", pairs: [] }));
  }, [net]);

  const isVeil = (p: Pair) =>
    [p.token0, p.token1].some((t) => t.toLowerCase() === OFFICIAL_MAINNET_TOKEN.toLowerCase());

  const filtered = (data?.pairs ?? []).filter((p) =>
    !q ? true : (p.symbol0 + "/" + p.symbol1).toLowerCase().includes(q.toLowerCase()),
  );

  const totalLiquidity = (data?.pairs ?? []).reduce((a, p) => a + p.liquidityUsd, 0);
  const veilPair = (data?.pairs ?? []).find(isVeil);

  return (
    <Section
      className="py-10"
      kicker="Explore"
      title="Every pair on COTI"
      sub="Order-book depth from across the chain, alongside VeilSwap. Every pair here is tradable on VeilSwap — if there is no pool for a token, the swap fills against these orders instead. Liquidity here is the sum of what people have posted rather than a pool, so a pair with no strategies simply has nobody quoting it yet."
      right={
        <Link
          href="/swap"
          className="rounded-xl border border-white/12 px-4 py-2.5 text-[13px] font-medium text-white/65 transition hover:border-white/25 hover:text-white"
        >
          Open Swap
        </Link>
      }
    >
      {data && !data.available ? (
        <Empty title="Not available here" body={data.reason ?? "Order-book pairs are not indexed on this network."} />
      ) : (
        <>
          <div className="mb-6 grid gap-3 sm:grid-cols-3">
            <Stat
              label="Pairs"
              value={data ? String(data.pairs.length) : "…"}
              sub="Quoted on chain"
            />
            <Stat
              label="Total liquidity"
              value={data ? "$" + Math.round(totalLiquidity).toLocaleString("en-US") : "…"}
              sub="Across every order"
            />
            <Stat
              label="Trades all time"
              value={data?.totalTrades ? data.totalTrades.toLocaleString("en-US") : "…"}
              sub="Since the venue opened"
            />
          </div>

          {data && !veilPair && (
            <div className="mb-5 flex items-start gap-3 rounded-xl border border-white/[0.09] bg-white/[0.02] px-4 py-3">
              <span className="mt-0.5 shrink-0 text-[15px]">ℹ️</span>
              <p className="text-[12.5px] leading-relaxed text-white/55">
                <b className="text-white/80">VEIL has no order-book quote yet.</b> An order book
                holds no pool: a pair exists only once somebody posts an order for it, which is why
                its chart reads &ldquo;price data not available&rdquo; rather than showing zero.
                VEIL trades today on{" "}
                <Link href="/swap" className="text-cy-300 hover:underline">
                  VeilSwap
                </Link>
                , where there is a real pair with real depth.
              </p>
            </div>
          )}

          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter by pair, e.g. COTI/USDCe…"
            className="mb-4 w-full max-w-md rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2 text-[13px] outline-none transition placeholder:text-white/25 focus:border-veil-400/50"
          />

          {!data ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-14 rounded-xl" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <Empty title="Nothing matches that" body="Try a different ticker, or clear the filter." />
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-white/[0.08]">
              <table className="w-full min-w-[720px] text-[13px]">
                <thead>
                  <tr className="border-b border-white/[0.07] text-left text-[11px] uppercase tracking-wider text-white/35">
                    <th className="px-4 py-3 font-medium">Pair</th>
                    <th className="px-4 py-3 text-right font-medium">Trades</th>
                    <th className="px-4 py-3 text-right font-medium">24h</th>
                    <th className="px-4 py-3 text-right font-medium">Strategies</th>
                    <th className="px-4 py-3 text-right font-medium">Liquidity</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p) => (
                    <tr
                      key={p.key}
                      className={
                        "border-b border-white/[0.04] transition last:border-0 hover:bg-white/[0.02] " +
                        (isVeil(p) ? "bg-amber-400/[0.05]" : "")
                      }
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">
                            {p.symbol0}/{p.symbol1}
                          </span>
                          {isVeil(p) && <Badge tone="amber">Official</Badge>}
                          {p.fromChain && <Badge tone="cy">live on chain</Badge>}
                          {p.strategies === 0 && <Badge tone="muted">no orders</Badge>}
                        </div>
                        <a
                          href={explorerAddress(p.token0, "mainnet")}
                          target="_blank"
                          rel="noreferrer"
                          className="mono text-[10.5px] text-white/25 hover:text-cy-300"
                        >
                          {p.token0.slice(0, 10)}…
                        </a>
                      </td>
                      <td className="mono px-4 py-3 text-right text-white/70">
                        {p.trades.toLocaleString("en-US")}
                      </td>
                      <td className="mono px-4 py-3 text-right text-white/70">
                        {p.trades24h > 0 ? p.trades24h.toLocaleString("en-US") : "—"}
                      </td>
                      <td className="mono px-4 py-3 text-right text-white/70">{p.strategies}</td>
                      <td className="mono px-4 py-3 text-right">
                        {p.liquidityUsd > 0 ? (
                          <span className="text-white/85">
                            ${p.liquidityUsd.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                          </span>
                        ) : p.nativeDepth ? (
                          // Read from the chain before the order book has priced it, so
                          // the depth is stated in COTI rather than guessed in USD.
                          <span className="text-white/70">
                            {(Number(p.nativeDepth) / 1e18).toLocaleString("en-US", {
                              maximumFractionDigits: 0,
                            })}{" "}
                            COTI
                          </span>
                        ) : (
                          <span className="text-white/25">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {/* Trading happens here, on VeilSwap, not on someone
                            else's site. The pair is carried through so the
                            swap opens on the same market the row describes. */}
                        <Link
                          href={`/swap?base=${p.token0}&quote=${p.token1}`}
                          className="rounded-lg border border-white/12 px-3 py-1.5 text-[12px] font-medium text-white/70 transition hover:border-cy-400/45 hover:text-white"
                        >
                          Trade
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="mt-6 max-w-3xl text-[12px] leading-relaxed text-white/40">
            Trade counts and liquidity are read from COTI&apos;s public order-book indexes.
            Liquidity uses the CoinGecko ticker feed rather than the TVL endpoint, which returns
            errors on most pairs and inflated numbers on the rest.
          </p>
        </>
      )}
    </Section>
  );
}
