import { NextRequest } from "next/server";
import type { Address } from "viem";
import { db, rows, row } from "@/lib/db";
import { nativeBalance, readCurve } from "@/lib/rpc";
import { isDeployed } from "@/lib/addresses";
import { networkFrom } from "@/lib/network";
import { isAddress, fmtUnits } from "@/lib/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Resolves /profile/{username} - also accepts a raw 0x address. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ username: string }> }) {
  const net = networkFrom(req);
  const { username } = await params;
  const handle = decodeURIComponent(username).replace(/^@/, "").toLowerCase();

  const p = row<Record<string, any>>(
    db().prepare("SELECT * FROM profiles WHERE lower(username) = ? OR lower(address) = ?").get(handle, handle),
  );

  const address = p?.address || (isAddress(handle) ? handle : null);
  if (!address) return Response.json({ error: "profile not found" }, { status: 404 });

  const launches = rows<Record<string, any>>(
    db()
      .prepare(
        "SELECT address, name, symbol, image, curve, pool, graduated, created_at FROM tokens WHERE lower(creator) = lower(?) AND network = ? ORDER BY created_at DESC",
      )
      .all(address, net),
  );

  const withProgress = await Promise.all(
    launches.map(async (t) => {
      const c = isDeployed(t.curve) ? await readCurve(t.curve as Address, net) : null;
      return { ...t, progressPct: c?.progress ?? 0, graduated: !!t.graduated || !!c?.graduated };
    }),
  );

  const agents = rows(
    db()
      .prepare("SELECT id, slug, name, kind, tagline, avatar, autonomy, status, token FROM agents WHERE lower(owner) = lower(?) ORDER BY created_at DESC")
      .all(address),
  );

  const trades = rows(
    db()
      .prepare(
        "SELECT token, side, coti_in, token_out, tx_hash, created_at FROM trades WHERE lower(trader) = lower(?) AND token IN (SELECT address FROM tokens WHERE network = ?) ORDER BY id DESC LIMIT 30",
      )
      .all(address, net),
  );

  const watchlist = rows(
    db().prepare("SELECT token, created_at FROM watchlist WHERE lower(address) = lower(?)").all(address),
  );

  let balance = "0";
  try {
    balance = fmtUnits(await nativeBalance(address as Address, net), 18, 4);
  } catch {
    balance = "-";
  }

  return Response.json({
    profile: p
      ? {
          username: p.username,
          address: p.address,
          displayName: p.display_name,
          bio: p.bio,
          avatar: p.avatar,
          banner: p.banner,
          isAgent: !!p.is_agent,
          links: (() => {
            try {
              return JSON.parse(p.links || "{}");
            } catch {
              return {};
            }
          })(),
          createdAt: p.created_at,
        }
      : { username: null, address, displayName: "", bio: "", avatar: "", banner: "", isAgent: false, links: {}, createdAt: 0 },
    balanceCoti: balance,
    launches: withProgress,
    agents,
    trades,
    watchlist,
    stats: {
      launchCount: withProgress.length,
      graduatedCount: withProgress.filter((t) => t.graduated).length,
      agentCount: agents.length,
      tradeCount: trades.length,
    },
  });
}
