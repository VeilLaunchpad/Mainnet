import { NextRequest } from "next/server";
import type { Address } from "viem";
import { db, rows, row } from "@/lib/db";
import { readToken, readCurve, readPool, findPair, readTradeHistory } from "@/lib/rpc";
import { isDeployed, DEFAULT_FEE_TIER } from "@/lib/addresses";
import { cotiQuote } from "@/lib/market";
import { isAddress, fmtUnits } from "@/lib/format";
import { networkFrom } from "@/lib/network";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Everything the /coti/{ca} page needs, in one round trip. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  if (!isAddress(address)) return Response.json({ error: "invalid address" }, { status: 400 });

  // This route read the chain with no network at all, so on testnet every
  // figure on a token page came from mainnet.
  const net = networkFrom(req);

  const t = row<Record<string, any>>(
    db().prepare("SELECT * FROM tokens WHERE lower(address) = lower(?) AND network = ?").get(address, net),
  );
  const onchain = await readToken(address as Address, net);
  if (!t && !onchain) return Response.json({ error: "token not found" }, { status: 404 });

  const curve = t && isDeployed(t.curve) ? await readCurve(t.curve as Address, net) : null;
  // The curve records its pair on graduation; fall back to asking the DEX, so a
  // pair created any other way still shows up.
  const poolAddr = curve?.pool || t?.pool || (await findPair(address as Address, net)) || "";
  const pool = isDeployed(poolAddr)
    ? await readPool(poolAddr as Address, address as Address, net)
    : null;
  const coti = await cotiQuote();
  const decimals = t?.decimals ?? onchain?.decimals ?? 18;
  const priceCoti = curve ? Number(curve.spotPrice) / 1e18 : (pool?.price ?? null);


  // The chain is the record. Anything the local index knows that the chain does
  // not (a fill from a venue we cannot read) is merged in behind it, keyed by
  // transaction hash so nothing is double-counted.
  const onChain = await readTradeHistory(address as Address, t?.curve, poolAddr, net);
  const seen = new Set(onChain.map((x) => x.txHash.toLowerCase()));

  const local = rows<Record<string, any>>(
    db()
      .prepare("SELECT side, coti_in, token_out, price, trader, tx_hash, created_at FROM trades WHERE lower(token) = lower(?) ORDER BY id DESC LIMIT 50")
      .all(address),
  ).filter((r) => !r.tx_hash || !seen.has(String(r.tx_hash).toLowerCase()));

  const trades = [
    ...onChain.map((x) => ({
      venue: x.venue,
      side: x.side,
      trader: x.trader,
      coti_in: fmtUnits(x.cotiAmount, 18, 6),
      token_out: fmtUnits(x.tokenAmount, decimals, 4),
      price: x.price,
      tx_hash: x.txHash,
      created_at: x.time,
      source: "chain",
    })),
    ...local.map((r) => ({
      venue: "curve",
      side: r.side,
      trader: r.trader,
      coti_in: r.coti_in,
      token_out: r.token_out,
      price: r.price,
      tx_hash: r.tx_hash,
      created_at: r.created_at,
      source: "index",
    })),
  ]
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, 60);

  const traders = new Set(trades.map((x) => String(x.trader).toLowerCase()).filter(Boolean));

  const creatorProfile = t?.creator
    ? row<{ username: string; display_name: string; avatar: string }>(
        db()
          .prepare("SELECT username, display_name, avatar FROM profiles WHERE lower(address) = lower(?)")
          .get(String(t.creator)),
      )
    : null;

  return Response.json({
    token: {
      address,
      name: t?.name || onchain?.name || "Unknown",
      symbol: t?.symbol || onchain?.symbol || "???",
      decimals,
      description: t?.description || "",
      image: t?.image || "",
      banner: t?.banner || "",
      creator: t?.creator || "",
      creatorProfile,
      kind: t?.kind || (onchain?.isPrivate ? "private" : "public"),
      isPrivate: onchain?.isPrivate ?? t?.kind === "private",
      curve: t?.curve || "",
      feeTier: t?.fee_tier || DEFAULT_FEE_TIER,
      agentId: t?.agent_id || "",
      links: (() => {
        try {
          return JSON.parse(t?.links || "{}");
        } catch {
          return {};
        }
      })(),
      createdAt: t?.created_at || 0,
      txHash: t?.tx_hash || "",
    },
    curve: curve
      ? {
          address: t?.curve,
          reserveCoti: fmtUnits(curve.reserve, 18, 6),
          reserveWei: curve.reserve.toString(),
          sold: fmtUnits(curve.sold, decimals, 4),
          graduated: curve.graduated,
          progressPct: curve.progress,
          targetCoti: fmtUnits(curve.graduationTarget, 18, 2),
          spotPriceCoti: priceCoti,
          spotPriceUsd: priceCoti && coti ? priceCoti * coti.price : null,
        }
      : null,
    pool: pool
      ? {
          address: pool.pair,
          venue: "DevoxSwap",
          feeBps: pool.feeBps,
          reserveToken: fmtUnits(pool.reserveToken, decimals, 4),
          reserveCoti: fmtUnits(pool.reserveCoti, 18, 6),
          lpSupply: fmtUnits(pool.totalSupply, 18, 4),
          token0: pool.token0,
          token1: pool.token1,
          priceCoti: pool.price,
          priceUsd: coti ? pool.price * coti.price : null,
        }
      : null,
    market: coti ? { cotiUsd: coti.price, cotiChange24h: coti.change24h } : null,
    trades,
    stats: { tradeCount: trades.length, knownTraders: traders.size },
  });
}
