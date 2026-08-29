import type { NextRequest } from "next/server";
import { networkFrom } from "@/lib/network";
import { listings } from "@/lib/nft";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Marketplace listings. Stale ones carry a reason rather than vanishing. */
export async function GET(req: NextRequest) {
  const net = networkFrom(req);
  const liveOnly = req.nextUrl.searchParams.get("live") === "1";
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 60) || 60, 200);

  try {
    const all = await listings(net, limit);
    return Response.json({ network: net, listings: liveOnly ? all.filter((l) => l.live) : all });
  } catch (e) {
    return Response.json({ network: net, listings: [], error: String(e) }, { status: 200 });
  }
}
