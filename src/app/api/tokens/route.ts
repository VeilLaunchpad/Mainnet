import { NextRequest } from "next/server";
import type { Address } from "viem";
import { db, rows, now } from "@/lib/db";
import { readCurve, readPool, findPair } from "@/lib/rpc";
import { isDeployed, DEFAULT_FEE_TIER } from "@/lib/addresses";
import { networkFrom } from "@/lib/network";
import { isAddress, fmtUnits } from "@/lib/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface TokenRow {
  address: string; name: string; symbol: string; decimals: number;
  description: string; image: string; creator: string; kind: string;
  curve: string; pool: string; fee_tier: number; graduated: number;
  agent_id: string; created_at: number; official: number;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const limit = Math.min(100, Number(sp.get("limit") || 30));
  const sort = sp.get("sort") || "new";
  const q = sp.get("q");
  const creator = sp.get("creator");
  const net = networkFrom(req);

  /**
   * Launches are per network and must never mix. The column has always been
   * written; nothing read it, so every list showed both chains at once and a
   * testnet token looked tradable on mainnet.
   *
   * Rows indexed before the column existed defaulted to 'testnet', which is
   * where they in fact came from, so the plain comparison is correct for them.
   */
  const where: string[] = ["network = ?"];
  const args: unknown[] = [net];
  if (q) {
    where.push("(lower(name) LIKE ? OR lower(symbol) LIKE ? OR lower(address) LIKE ?)");
    const like = "%" + q.toLowerCase() + "%";
    args.push(like, like, like);
  }
  if (creator) {
    where.push("lower(creator) = lower(?)");
    args.push(creator);
  }
  if (sort === "graduated") where.push("graduated = 1");

  const sql =
    "SELECT * FROM tokens" +
    (where.length ? " WHERE " + where.join(" AND ") : "") +
    // The protocol token sits above the launches rather than among them. It has
    // no curve and no age worth ranking, and burying it under whatever launched
    // most recently is how someone ends up finding a copy first.
    " ORDER BY official DESC, created_at DESC LIMIT ?";
  args.push(limit);

  const list = rows<TokenRow>(db().prepare(sql).all(...(args as never[])));

  /**
   * Graduation is a one-way door, so once it is observed it is written down.
   *
   * The list computed it live - a token with a pool is graduated - while every
   * count read the stored column, which for anything that never went through
   * the curve was still zero. So the launchpad showed a graduated token and the
   * dashboard said none had graduated. Persisting the observation makes the two
   * agree, and it is cheap: it happens once per token, ever.
   */
  const promote = db().prepare("UPDATE tokens SET graduated = 1 WHERE address = ? AND graduated = 0");

  const enriched = await Promise.all(
    list.map(async (t) => {
      const curve = isDeployed(t.curve) ? await readCurve(t.curve as Address, net) : null;
      const pool =
        curve?.pool && isDeployed(curve.pool)
          ? curve.pool
          : isDeployed(t.pool)
            ? t.pool
            : (await findPair(t.address as Address, net)) || "";

      /**
       * A token with a pool but no curve has a price the curve cannot tell us.
       * DEVOXPAD is the case that matters: it was never sold on a curve, so
       * without this its card shows a live market and no price next to it.
       */
      const poolState =
        !curve && isDeployed(pool)
          ? await readPool(pool as Address, t.address as Address, net).catch(() => null)
          : null;

      const hasGraduated = !!t.graduated || !!curve?.graduated || isDeployed(pool);
      if (hasGraduated && !t.graduated) promote.run(t.address);

      return {
        address: t.address,
        name: t.name,
        symbol: t.symbol,
        decimals: t.decimals,
        description: t.description,
        image: t.image,
        creator: t.creator,
        kind: t.kind,
        curve: t.curve,
        pool,
        feeTier: t.fee_tier || DEFAULT_FEE_TIER,
        graduated: hasGraduated,
        progressPct: curve?.progress ?? 0,
        reserveCoti: curve
          ? fmtUnits(curve.reserve, 18, 4)
          : poolState
            ? fmtUnits(poolState.reserveCoti, 18, 4)
            : "0",
        spotPriceCoti: curve ? Number(curve.spotPrice) / 1e18 : (poolState?.price ?? null),
        agentId: t.agent_id,
        createdAt: t.created_at,
        official: !!t.official,
      };
    }),
  );

  if (sort === "progress") {
    enriched.sort((a, b) => {
      if (a.official !== b.official) return a.official ? -1 : 1;
      return b.progressPct - a.progressPct;
    });
  }
  return Response.json({ tokens: enriched, network: net });
}

/** Index a launch after the on-chain transaction confirms. */
export async function POST(req: NextRequest) {
  const b = (await req.json().catch(() => ({}))) as Record<string, string | number | boolean>;
  const address = String(b.address || "");
  if (!isAddress(address)) return Response.json({ error: "invalid token address" }, { status: 400 });

  /**
   * This endpoint is open, because indexing a launch has to work the moment the
   * transaction confirms and there is no session to authenticate. That is fine
   * for a launch and not fine for the protocol token: without this guard anyone
   * could post its address and rewrite the name and description shown under an
   * "Official" badge, which is the exact impersonation the badge exists to
   * prevent. Only the boot seed writes that row.
   */
  const existing = db()
    .prepare("SELECT official FROM tokens WHERE lower(address) = lower(?)")
    .get(address) as { official?: number } | undefined;

  if (existing?.official) {
    return Response.json({ error: "that token is not indexed from here" }, { status: 403 });
  }

  db()
    .prepare(
      `INSERT INTO tokens (address, network, name, symbol, decimals, description, image, banner, creator, kind, curve, pool, fee_tier, graduated, agent_id, links, tx_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(address) DO UPDATE SET
         name = excluded.name, symbol = excluded.symbol, description = excluded.description,
         image = excluded.image, curve = excluded.curve, pool = excluded.pool,
         graduated = excluded.graduated, agent_id = excluded.agent_id`,
    )
    .run(
      address,
      // Stamped from the request, so a launch made while the switcher says
      // testnet is filed under testnet even on a mainnet-default deployment.
      networkFrom(req),
      String(b.name || "Unnamed"),
      String(b.symbol || "???").toUpperCase(),
      Number(b.decimals ?? 18),
      String(b.description || ""),
      String(b.image || ""),
      String(b.banner || ""),
      String(b.creator || ""),
      String(b.kind || "private"),
      String(b.curve || ""),
      String(b.pool || ""),
      Number(b.feeTier || DEFAULT_FEE_TIER),
      b.graduated ? 1 : 0,
      String(b.agentId || ""),
      JSON.stringify(b.links || {}),
      String(b.txHash || ""),
      now(),
    );

  return Response.json({ ok: true, url: "/coti/" + address });
}
