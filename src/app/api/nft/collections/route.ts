import type { NextRequest } from "next/server";
import { networkFrom } from "@/lib/network";
import { collections } from "@/lib/nft";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Every collection from both factories, official ones first, then newest. */
export async function GET(req: NextRequest) {
  const net = networkFrom(req);
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 60) || 60, 200);

  try {
    const list = await collections(net, limit);
    list.sort((a, b) => Number(b.official) - Number(a.official) || b.createdAt - a.createdAt);
    return Response.json({ network: net, collections: list });
  } catch (e) {
    return Response.json({ network: net, collections: [], error: String(e) }, { status: 200 });
  }
}
