import type { NextRequest } from "next/server";
import { parseAbiItem, type Address } from "viem";
import { networkFrom } from "@/lib/network";
import { publicClient } from "@/lib/rpc";
import { addressesFor, isDeployed } from "@/lib/addresses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The activity feed, read straight from chain logs.
 *
 * No indexer sits behind this: the marketplace and both factories emit what
 * happened, and the chain is the record. That keeps the feed honest - it cannot
 * show a sale that did not settle - at the cost of being bounded by whatever
 * block range the RPC will serve. When a range is refused the event simply does
 * not appear, which is why each source is fetched independently rather than in
 * one call that would fail as a unit.
 */

const EVENTS = {
  launched: parseAbiItem(
    "event Launched(address indexed collection, address indexed creator, string name, string symbol, uint256 maxSupply, uint256 mintPrice, address payToken)",
  ),
  launchedEditions: parseAbiItem(
    "event Launched(address indexed collection, address indexed creator, string name, string symbol)",
  ),
  listed: parseAbiItem(
    "event Listed(uint256 indexed id, address indexed collection, uint256 indexed tokenId, address seller, address payToken, uint256 price)",
  ),
  sold: parseAbiItem(
    "event Sold(uint256 indexed id, address indexed collection, uint256 indexed tokenId, address seller, address buyer, uint256 price, uint256 fee, uint256 royalty)",
  ),
  staked: parseAbiItem("event Staked(address indexed who, uint256 indexed pid, uint256 tokenId)"),
};

export interface Activity {
  kind: "launch" | "list" | "sale" | "stake";
  block: number;
  hash: string;
  collection?: string;
  tokenId?: string;
  who?: string;
  price?: string;
  label: string;
}

export async function GET(req: NextRequest) {
  const net = networkFrom(req);
  const a = addressesFor(net);
  const client = publicClient(net);
  const out: Activity[] = [];

  const range = { fromBlock: "earliest" as const, toBlock: "latest" as const };
  const grab = async <T>(run: () => Promise<T[]>): Promise<T[]> => run().catch(() => []);

  const [drops, editions, listed, sold, staked] = await Promise.all([
    isDeployed(a.nftFactory)
      ? grab(() => client.getLogs({ address: a.nftFactory, event: EVENTS.launched, ...range }))
      : [],
    isDeployed(a.nftEditionsFactory)
      ? grab(() =>
          client.getLogs({ address: a.nftEditionsFactory, event: EVENTS.launchedEditions, ...range }),
        )
      : [],
    isDeployed(a.nftMarket)
      ? grab(() => client.getLogs({ address: a.nftMarket, event: EVENTS.listed, ...range }))
      : [],
    isDeployed(a.nftMarket)
      ? grab(() => client.getLogs({ address: a.nftMarket, event: EVENTS.sold, ...range }))
      : [],
    isDeployed(a.nftStaking)
      ? grab(() => client.getLogs({ address: a.nftStaking, event: EVENTS.staked, ...range }))
      : [],
  ]);

  for (const l of [...drops, ...editions]) {
    const args = l.args as { collection?: Address; creator?: Address; name?: string };
    out.push({
      kind: "launch",
      block: Number(l.blockNumber ?? 0n),
      hash: l.transactionHash ?? "",
      collection: args.collection,
      who: args.creator,
      label: (args.name ?? "A collection") + " launched",
    });
  }

  for (const l of listed) {
    const args = l.args as { collection?: Address; tokenId?: bigint; seller?: Address; price?: bigint };
    out.push({
      kind: "list",
      block: Number(l.blockNumber ?? 0n),
      hash: l.transactionHash ?? "",
      collection: args.collection,
      tokenId: args.tokenId?.toString(),
      who: args.seller,
      price: args.price?.toString(),
      label: "#" + args.tokenId + " listed",
    });
  }

  for (const l of sold) {
    const args = l.args as {
      collection?: Address;
      tokenId?: bigint;
      buyer?: Address;
      price?: bigint;
    };
    out.push({
      kind: "sale",
      block: Number(l.blockNumber ?? 0n),
      hash: l.transactionHash ?? "",
      collection: args.collection,
      tokenId: args.tokenId?.toString(),
      who: args.buyer,
      price: args.price?.toString(),
      label: "#" + args.tokenId + " sold",
    });
  }

  // One Staked event per token, so several tokens in one transaction arrive as
  // several logs. They are collapsed by hash so the feed reads "3 staked"
  // rather than the same line three times.
  const byTx = new Map<string, { who?: Address; count: number; block: number }>();
  for (const l of staked) {
    const args = l.args as { who?: Address };
    const key = l.transactionHash ?? "";
    const hit = byTx.get(key);
    if (hit) hit.count += 1;
    else byTx.set(key, { who: args.who, count: 1, block: Number(l.blockNumber ?? 0n) });
  }
  for (const [hash, v] of byTx) {
    out.push({
      kind: "stake",
      block: v.block,
      hash,
      who: v.who,
      label: v.count + (v.count === 1 ? " token staked" : " tokens staked"),
    });
  }

  out.sort((x, y) => y.block - x.block);
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 80) || 80, 300);
  return Response.json({ network: net, activity: out.slice(0, limit) });
}
