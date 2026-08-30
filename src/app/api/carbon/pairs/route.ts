import { networkFrom } from "@/lib/network";
import { devoxCarbonPosition, CARBON_NATIVE } from "@/lib/carbon";
import { addressesFor, isDeployed } from "@/lib/addresses";
import { publicClient } from "@/lib/rpc";
import { devoxSwapFactoryAbi, devoxSwapPairAbi } from "@/lib/abis";
import type { Address } from "viem";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Carbon DeFi's COTI pairs, joined into one table.
 *
 * Carbon is an order book rather than an AMM, so "liquidity" here is the sum of
 * what people have actually placed rather than a pool balance, and a pair with
 * no strategies has no price at all. That is why a token can be listed and still
 * show nothing: nobody has posted an order for it yet.
 *
 * Four endpoints are needed because no single one carries the whole row, and
 * they are joined on a sorted, lowercased token pair. All four are
 * unparameterised, so they fetch in parallel.
 *
 * One endpoint is deliberately not used. `/analytics/tvl/pairs` is the obvious
 * choice by name and it is broken twice over: it 500s on most pairs, and where
 * it answers it reports figures several times larger than the protocol holds.
 * `coingecko/tickers` carries the same number and is correct.
 */

const BASE = "https://api.carbondefi.xyz/v1/coti";

/** Sorted and lowercased, so both sides of a pair land on the same key. */
function pairKey(a: string, b: string): string {
  return [a.toLowerCase(), b.toLowerCase()].sort().join("_");
}

interface Ticker {
  ticker_id?: string;
  base_currency?: string;
  target_currency?: string;
  base_symbol?: string;
  quote_symbol?: string;
  liquidity_in_usd?: number;
  last_price?: number;
}

interface TrendingPair {
  token0?: string;
  token1?: string;
  symbol0?: string;
  symbol1?: string;
  pairTrades?: number;
  pairTrades_24h?: number;
}

interface StrategyRow {
  base?: string;
  quote?: string;
}

async function get<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(BASE + path, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const net = networkFrom(req);

  /**
   * Carbon is deployed on COTI mainnet only. Returning an empty list on testnet
   * with a reason is better than showing mainnet order books next to testnet
   * balances, which is the mistake this whole app has been unpicking.
   */
  if (net !== "mainnet") {
    return Response.json({
      network: net,
      available: false,
      reason: "Carbon DeFi is deployed on COTI mainnet only. Switch networks to see its pairs.",
      pairs: [],
    });
  }

  const [tickers, trending, strategies, tokens] = await Promise.all([
    get<Ticker[]>("/coingecko/tickers"),
    get<{ totalTradeCount?: number; pairCount?: TrendingPair[] }>("/analytics/trending"),
    get<{ strategies?: StrategyRow[] }>("/strategies"),
    get<{ address: string; symbol: string; decimals: number }[]>("/tokens"),
  ]);

  if (!tickers && !trending) {
    return Response.json(
      {
        network: net,
        available: false,
        reason: "Carbon's API did not answer. The pairs are still on chain; this table is not.",
        pairs: [],
      },
      { status: 503 },
    );
  }

  const symbolOf = new Map<string, string>();
  for (const t of tokens ?? []) symbolOf.set(t.address.toLowerCase(), t.symbol);

  const rows = new Map<
    string,
    {
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
      /** True when the row came from the chain because the API had not indexed it. */
      fromChain?: boolean;
      /** The protocol token's own row, pinned to the top of the table. */
      official?: boolean;
      /** Which venue the depth came from, when it is not the order book. */
      venue?: string;
      /** Depth in token wei, when read from the chain rather than priced in USD. */
      tokenDepth?: string;
      nativeDepth?: string;
    }
  >();

  const touch = (a: string, b: string, s0?: string, s1?: string) => {
    const key = pairKey(a, b);
    const existing = rows.get(key);
    if (existing) return existing;
    const row = {
      key,
      token0: a,
      token1: b,
      symbol0: s0 || symbolOf.get(a.toLowerCase()) || "?",
      symbol1: s1 || symbolOf.get(b.toLowerCase()) || "?",
      trades: 0,
      trades24h: 0,
      strategies: 0,
      liquidityUsd: 0,
      lastPrice: null as number | null,
      fromChain: false,
      official: false,
      venue: undefined as string | undefined,
      tokenDepth: undefined as string | undefined,
      nativeDepth: undefined as string | undefined,
    };
    rows.set(key, row);
    return row;
  };

  for (const p of trending?.pairCount ?? []) {
    if (!p.token0 || !p.token1) continue;
    const r = touch(p.token0, p.token1, p.symbol0, p.symbol1);
    r.trades = p.pairTrades ?? 0;
    r.trades24h = p.pairTrades_24h ?? 0;
  }

  for (const t of tickers ?? []) {
    const a = t.base_currency, b = t.target_currency;
    if (!a || !b) continue;
    const r = touch(a, b, t.base_symbol, t.quote_symbol);
    // A pair can appear on both sides; keep the larger figure rather than the last.
    r.liquidityUsd = Math.max(r.liquidityUsd, t.liquidity_in_usd ?? 0);
    if (t.last_price != null) r.lastPrice = t.last_price;
  }

  for (const s of strategies?.strategies ?? []) {
    if (!s.base || !s.quote) continue;
    touch(s.base, s.quote).strategies += 1;
  }

  /**
   * Carbon's indexer lags a new strategy by minutes, and during that window it
   * would report our own pair as absent while the position is demonstrably
   * live on chain. So the protocol token's pair is read from the contract and
   * merged over whatever the API said - the chain is the authority for the one
   * pair we can check directly.
   */
  const devox = addressesFor(net).devoxToken;
  const position = await devoxCarbonPosition(net);
  if (position) {
    const r = touch(devox, CARBON_NATIVE, "DEVOX", "COTI");
    r.strategies = Math.max(r.strategies, position.strategies);
    // No USD figure until the indexer catches up. The depth is real and is
    // reported in COTI below rather than invented in dollars here.
    r.tokenDepth = position.tokenLiquidity.toString();
    r.nativeDepth = position.nativeLiquidity.toString();
    const ask = position.sides.find((x) => x.holdsToken);
    if (ask) r.lastPrice = ask.priceLow;
    r.fromChain = true;
  }

  /**
   * DEVOX's market is the DevoxSwap pool, not the order book.
   *
   * Nobody has posted an order-book strategy for it, so without this the
   * protocol token would be missing from its own explore page while being
   * perfectly tradable one click away. The row is built from the pool's real
   * reserves - it is a market, just a different kind of one - and the depth
   * columns say COTI rather than dollars because that is what was measured.
   */
  const addr = addressesFor(net);
  if (isDeployed(addr.swapFactory) && isDeployed(devox) && isDeployed(addr.wcoti)) {
    try {
      const pair = (await publicClient(net).readContract({
        address: addr.swapFactory,
        abi: devoxSwapFactoryAbi,
        functionName: "getPair",
        args: [devox, addr.wcoti],
      })) as Address;

      if (isDeployed(pair)) {
        const [r0, r1] = (await publicClient(net).readContract({
          address: pair,
          abi: devoxSwapPairAbi,
          functionName: "getReserves",
        })) as [bigint, bigint];

        const token0 = (await publicClient(net).readContract({
          address: pair,
          abi: devoxSwapPairAbi,
          functionName: "token0",
        })) as Address;

        const devoxIsToken0 = token0.toLowerCase() === devox.toLowerCase();
        const devoxDepth = devoxIsToken0 ? r0 : r1;
        const cotiDepth = devoxIsToken0 ? r1 : r0;

        const row = touch(devox, CARBON_NATIVE, "DEVOX", "COTI");
        row.fromChain = true;
        row.official = true;
        row.venue = "DevoxSwap";
        row.tokenDepth = devoxDepth.toString();
        row.nativeDepth = cotiDepth.toString();
        if (devoxDepth > 0n) {
          row.lastPrice = Number(cotiDepth) / Number(devoxDepth);
        }
      }
    } catch {
      // A missing pool is a fact about the chain, not an error worth failing
      // the whole table over.
    }
  }

  const pairs = [...rows.values()].sort((x, y) => {
    // The protocol token sits at the top of its own page, always.
    if (!!x.official !== !!y.official) return x.official ? -1 : 1;
    if (!!x.fromChain !== !!y.fromChain) return x.fromChain ? -1 : 1;
    return y.liquidityUsd - x.liquidityUsd || y.trades - x.trades;
  });

  return Response.json({
    network: net,
    available: true,
    venue: "Carbon DeFi",
    controller: "0x59f21012B2E9BA67ce6a7605E74F945D0D4C84EA",
    site: "https://coti.carbondefi.xyz",
    totalTrades: trending?.totalTradeCount ?? null,
    pairs,
  });
}
