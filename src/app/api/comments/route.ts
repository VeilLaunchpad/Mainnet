import { NextRequest } from "next/server";
import { verifyMessage } from "viem";
import { db, rows, now } from "@/lib/db";
import { isAddress } from "@/lib/format";
import { commentDigest } from "@/lib/comment-digest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Token comments.
 *
 * Two kinds live in one thread. A public comment is stored here in plaintext
 * and signed by its author's wallet, so nobody can post as someone else. A
 * private one is sent as an end-to-end encrypted message through COTI
 * PrivateMessaging: this endpoint records only that it happened and its
 * transaction hash, never the body, because the body is ciphertext that only
 * the two parties can open.
 */

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") || "";
  const limit = Math.min(200, Number(req.nextUrl.searchParams.get("limit") || 100));
  if (!isAddress(token)) return Response.json({ error: "token required" }, { status: 400 });

  const list = rows<Record<string, unknown>>(
    db()
      .prepare(
        "SELECT id, author, body, reply_to, private, tx_hash, created_at FROM comments WHERE lower(token) = lower(?) ORDER BY id DESC LIMIT ?",
      )
      .all(token, limit),
  );

  const handles = rows<{ username: string; address: string; avatar: string }>(
    db().prepare("SELECT username, address, avatar FROM profiles").all(),
  );
  const byAddr = new Map(handles.map((h) => [h.address.toLowerCase(), h]));

  return Response.json({
    token,
    count: list.length,
    comments: list.map((c) => ({
      id: c.id,
      author: c.author,
      profile: byAddr.get(String(c.author).toLowerCase()) ?? null,
      body: c.private ? "" : c.body,
      replyTo: c.reply_to,
      private: !!c.private,
      txHash: c.tx_hash,
      createdAt: c.created_at,
    })),
  });
}

export async function POST(req: NextRequest) {
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const token = String(b.token || "");
  const author = String(b.author || "");
  const isPrivate = !!b.private;
  const body = String(b.body || "").slice(0, 1000);
  const nonce = Number(b.nonce || 0);

  if (!isAddress(token)) return Response.json({ error: "invalid token" }, { status: 400 });
  if (!isAddress(author)) return Response.json({ error: "connect a wallet first" }, { status: 400 });

  if (isPrivate) {
    // The body never reaches us; the chain holds the ciphertext.
    const txHash = String(b.txHash || "");
    if (!txHash.startsWith("0x")) {
      return Response.json({ error: "private comments need their transaction hash" }, { status: 400 });
    }
    db()
      .prepare(
        "INSERT INTO comments (token, author, body, reply_to, private, tx_hash, signature, created_at) VALUES (?, ?, '', ?, 1, ?, '', ?)",
      )
      .run(token, author, Number(b.replyTo) || 0, txHash, now());
    return Response.json({ ok: true, private: true });
  }

  if (!body.trim()) return Response.json({ error: "empty comment" }, { status: 400 });

  // A signature is what makes authorship mean anything. Without it, anyone
  // could post under anyone's address.
  const signature = String(b.signature || "");
  if (!signature.startsWith("0x")) {
    return Response.json({ error: "signature required" }, { status: 400 });
  }

  let valid = false;
  try {
    valid = await verifyMessage({
      address: author as `0x${string}`,
      message: commentDigest(token, body, nonce),
      signature: signature as `0x${string}`,
    });
  } catch {
    valid = false;
  }

  if (!valid) return Response.json({ error: "signature does not match author" }, { status: 401 });

  db()
    .prepare(
      "INSERT INTO comments (token, author, body, reply_to, private, tx_hash, signature, created_at) VALUES (?, ?, ?, ?, 0, '', ?, ?)",
    )
    .run(token, author, body, Number(b.replyTo) || 0, signature, now());

  return Response.json({ ok: true, private: false });
}
