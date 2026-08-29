import type { NextRequest } from "next/server";
import { networkFrom } from "@/lib/network";
import { pools } from "@/lib/nft";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** NFT staking pools, with the APY each launcher set when they paired. */
export async function GET(req: NextRequest) {
  const net = networkFrom(req);
  try {
    return Response.json({ network: net, pools: await pools(net) });
  } catch (e) {
    return Response.json({ network: net, pools: [], error: String(e) }, { status: 200 });
  }
}
