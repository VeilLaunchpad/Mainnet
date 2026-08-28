import { NextRequest } from "next/server";
import { cotiQuote, cotiCandles, coinQuotes } from "@/lib/market";

export const runtime = "nodejs";
export const revalidate = 30;

export async function GET(req: NextRequest) {
  const days = Number(req.nextUrl.searchParams.get("days") || 1);
  const [coti, candles, majors] = await Promise.all([
    cotiQuote(),
    cotiCandles(days),
    coinQuotes(["bitcoin", "ethereum", "coti"]),
  ]);
  return Response.json({ coti, candles, majors });
}
