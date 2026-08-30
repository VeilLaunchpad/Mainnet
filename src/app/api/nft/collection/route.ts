import type { NextRequest } from "next/server";
import { networkFrom } from "@/lib/network";
import { collection } from "@/lib/nft";
import { isAddress } from "@/lib/format";
import type { Address } from "viem";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const net = networkFrom(req);
  const address = req.nextUrl.searchParams.get("address") ?? "";
  if (!isAddress(address)) return Response.json({ error: "bad address" }, { status: 400 });

  const c = await collection(address as Address, net).catch(() => null);
  if (!c) {
    return Response.json(
      { error: "not a DEVOXPAD collection on " + net },
      { status: 404 },
    );
  }
  return Response.json({ network: net, collection: c });
}
