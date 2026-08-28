import { NextRequest } from "next/server";
import { db, rows, now } from "@/lib/db";
import { isAddress } from "@/lib/format";

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
