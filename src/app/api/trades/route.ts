import { NextRequest } from "next/server";
import { db, rows, now } from "@/lib/db";
import { isAddress } from "@/lib/format";
import { publicClient } from "@/lib/rpc";
import type { CotiNetworkName } from "@/lib/chain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  const limit = Math.min(200, Number(req.nextUrl.searchParams.get("limit") || 50));
  const list = token
    ? rows(
        db()
          .prepare("SELECT * FROM trades WHERE lower(token) = lower(?) ORDER BY id DESC LIMIT ?")
          .all(token, limit),
      )
    : rows(db().prepare("SELECT * FROM trades ORDER BY id DESC LIMIT ?").all(limit));
  return Response.json({ trades: list });
}

/**
 * Record a fill. Note what is *not* stored: on a private token the amounts a
 * trader chooses to publish here are the only public trace - the on-chain
 * balances stay ciphertext either way.
 */
export async function POST(req: NextRequest) {
  const b = (await req.json().catch(() => ({}))) as Record<string, string | number | boolean>;
  const token = String(b.token || "");
  if (!isAddress(token)) return Response.json({ error: "invalid token" }, { status: 400 });

  /**
   * A trade is recorded only if the chain agrees it happened.
   *
   * This route used to insert whatever it was handed. A reverted sell was
   * therefore written into the token's history as a completed fill, which is
   * how a failed transaction came to sit in the trade list looking exactly
   * like a real one - and nothing stopped anyone POSTing invented volume
   * either. The receipt settles both: it must exist, it must have succeeded,
   * and it must have been sent by the address claiming the trade.
   */
  const txHash = String(b.txHash || "");
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    return Response.json({ error: "a trade needs its transaction hash" }, { status: 400 });
  }

  const already = db()
    .prepare("SELECT id FROM trades WHERE lower(tx_hash) = lower(?)")
    .get(txHash) as { id: number } | undefined;
  if (already) return Response.json({ ok: true, deduped: true });

  const net = (req.nextUrl.searchParams.get("network") || undefined) as CotiNetworkName | undefined;
  const trader = String(b.trader || "");
  try {
    const receipt = await publicClient(net).getTransactionReceipt({
      hash: txHash as `0x${string}`,
    });
    if (receipt.status !== "success") {
      return Response.json({ error: "that transaction reverted" }, { status: 400 });
    }
    if (isAddress(trader) && receipt.from.toLowerCase() !== trader.toLowerCase()) {
      return Response.json({ error: "that transaction was not sent by this address" }, { status: 400 });
    }
  } catch {
    // An unmined or unknown hash is not a trade. Being unable to check is a
    // reason to refuse, not a reason to trust the caller.
    return Response.json({ error: "that transaction could not be verified" }, { status: 400 });
  }

  db()
    .prepare(
      "INSERT INTO trades (token, trader, side, coti_in, token_out, price, tx_hash, private, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      token,
      String(b.trader || ""),
      String(b.side || "buy"),
      String(b.cotiIn || "0"),
      String(b.tokenOut || "0"),
      Number(b.price || 0),
      String(b.txHash || ""),
      b.private === false ? 0 : 1,
      now(),
    );

  return Response.json({ ok: true });
}
