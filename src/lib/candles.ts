import type { Address } from "viem";
import { readTradeHistory, readCurve, readPool, findPair, type ChainTrade } from "./rpc";
import { isDeployed } from "./addresses";

/**
 * OHLCV from on-chain fills.
 *
 * There is no order book to read on a bonding curve or a small pair, so the
 * candles are built from realised trades: every `Traded` event on the curve and
 * every `Swap` on the pair, bucketed by time. That is the same thing pump.fun
 * style charts do, and it has the advantage of being verifiable - each candle
 * traces back to transactions anyone can look up.
 */

export const TIMEFRAMES = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1h": 3600,
  "4h": 14400,
  "1d": 86400,
} as const;

export type Timeframe = keyof typeof TIMEFRAMES;

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  buys: number;
  sells: number;
}

function toNumber(v: bigint, decimals: number): number {
  return Number(v) / 10 ** decimals;
}

/**
 * Buckets trades into candles and carries the last close across empty buckets,
 * so the line is continuous instead of collapsing to zero where nobody traded.
 */
export function buildCandles(
  trades: ChainTrade[],
  decimals: number,
  timeframe: Timeframe,
  spotPrice: number | null,
): Candle[] {
  const step = TIMEFRAMES[timeframe];
  if (!trades.length) return [];

  const priced = trades
    .filter((t) => t.time > 0 && t.tokenAmount > 0n && t.cotiAmount > 0n)
    .map((t) => ({
      time: Math.floor(t.time / 1000),
      price: toNumber(t.cotiAmount, 18) / toNumber(t.tokenAmount, decimals),
      volume: toNumber(t.cotiAmount, 18),
      side: t.side,
    }))
    .sort((a, b) => a.time - b.time);

  if (!priced.length) return [];

  const buckets = new Map<number, Candle>();
  for (const p of priced) {
    const slot = Math.floor(p.time / step) * step;
    const existing = buckets.get(slot);
    if (!existing) {
      buckets.set(slot, {
        time: slot,
        open: p.price,
        high: p.price,
        low: p.price,
        close: p.price,
        volume: p.volume,
        buys: p.side === "buy" ? 1 : 0,
        sells: p.side === "sell" ? 1 : 0,
      });
    } else {
      existing.high = Math.max(existing.high, p.price);
      existing.low = Math.min(existing.low, p.price);
      existing.close = p.price;
      existing.volume += p.volume;
      if (p.side === "buy") existing.buys += 1;
      else existing.sells += 1;
    }
  }

  const slots = [...buckets.keys()].sort((a, b) => a - b);
  const first = slots[0];
  const nowSlot = Math.floor(Date.now() / 1000 / step) * step;

  // Cap the fill so a token that traded once a month ago does not generate
  // tens of thousands of empty candles.
  const maxCandles = 400;
  const start = Math.max(first, nowSlot - step * (maxCandles - 1));

  const out: Candle[] = [];
  let last = buckets.get(first)!.open;

  for (let slot = start; slot <= nowSlot; slot += step) {
    const hit = buckets.get(slot);
    if (hit) {
      out.push(hit);
      last = hit.close;
    } else {
      out.push({
        time: slot,
        open: last,
        high: last,
        low: last,
        close: last,
        volume: 0,
        buys: 0,
        sells: 0,
      });
    }
  }

  // The live quote is more current than the last fill, so let it close the
  // final candle rather than showing a stale price.
  if (spotPrice && out.length) {
    const tail = out[out.length - 1];
    tail.close = spotPrice;
    tail.high = Math.max(tail.high, spotPrice);
    tail.low = Math.min(tail.low, spotPrice);
  }

  return out;
}

export interface CandleResponse {
  token: string;
  timeframe: Timeframe;
  decimals: number;
  venue: "curve" | "veilswap" | "none";
  candles: Candle[];
  spotCoti: number | null;
  change: { pct: number; abs: number } | null;
  stats: { trades: number; buys: number; sells: number; volumeCoti: number };
  /**
   * Supply issued through the launchpad, which is what a market cap can honestly
   * be computed from. The token's real aggregate supply is sealed by design, so
   * this counts what the curve minted plus the allocation seeded into the pair.
   */
  issuedSupply: number | null;
  marketCapCoti: number | null;
}

export async function candlesFor(
  token: Address,
  curve: string | undefined,
  poolHint: string | undefined,
  decimals: number,
  timeframe: Timeframe,
): Promise<CandleResponse> {
  const pool = isDeployed(poolHint || "") ? poolHint! : (await findPair(token)) || "";

  const [trades, curveState, poolState] = await Promise.all([
    readTradeHistory(token, curve, pool),
    isDeployed(curve || "") ? readCurve(curve as Address) : Promise.resolve(null),
    isDeployed(pool) ? readPool(pool as Address, token) : Promise.resolve(null),
  ]);

  const spotCoti = poolState
    ? poolState.price
    : curveState
      ? Number(curveState.spotPrice) / 1e18
      : null;

  const candles = buildCandles(trades, decimals, timeframe, spotCoti);

  const firstOpen = candles.length ? candles[0].open : 0;
  const lastClose = candles.length ? candles[candles.length - 1].close : 0;

  const sold = curveState ? toNumber(curveState.sold, decimals) : 0;
  const pooled = poolState ? toNumber(poolState.reserveToken, decimals) : 0;
  const issuedSupply = sold + pooled > 0 ? sold + pooled : null;

  return {
    token,
    timeframe,
    decimals,
    venue: poolState ? "veilswap" : curveState ? "curve" : "none",
    candles,
    spotCoti,
    change:
      firstOpen > 0
        ? { pct: ((lastClose - firstOpen) / firstOpen) * 100, abs: lastClose - firstOpen }
        : null,
    stats: {
      trades: trades.length,
      buys: trades.filter((t) => t.side === "buy").length,
      sells: trades.filter((t) => t.side === "sell").length,
      volumeCoti: trades.reduce((sum, t) => sum + toNumber(t.cotiAmount, 18), 0),
    },
    issuedSupply,
    marketCapCoti: issuedSupply && spotCoti ? issuedSupply * spotCoti : null,
  };
}
