import { NextRequest } from "next/server";
import type { Address } from "viem";
import { db, row } from "@/lib/db";
import { candlesFor, TIMEFRAMES, type Timeframe } from "@/lib/candles";
import { cotiQuote } from "@/lib/market";
import { isAddress } from "@/lib/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** OHLCV for a token, built from its on-chain fills. */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const token = sp.get("token") || "";
  const tf = (sp.get("tf") || "5m") as Timeframe;

  if (!isAddress(token)) {
    return Response.json({ error: "token address required" }, { status: 400 });
  }
  if (!(tf in TIMEFRAMES)) {
    return Response.json(
      { error: "unknown timeframe", supported: Object.keys(TIMEFRAMES) },
      { status: 400 },
    );
  }

  const t = row<{ curve: string; pool: string; decimals: number }>(
    db()
      .prepare("SELECT curve, pool, decimals FROM tokens WHERE lower(address) = lower(?)")
      .get(token),
  );

  const [data, coti] = await Promise.all([
    candlesFor(token as Address, t?.curve, t?.pool, t?.decimals ?? 18, tf),
    cotiQuote(),
  ]);

  return Response.json({
    ...data,
    cotiUsd: coti?.price ?? null,
    spotUsd: data.spotCoti && coti ? data.spotCoti * coti.price : null,
    marketCapUsd: data.marketCapCoti && coti ? data.marketCapCoti * coti.price : null,
  });
}
