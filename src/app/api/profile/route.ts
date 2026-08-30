import { NextRequest } from "next/server";
import { db, rows, now } from "@/lib/db";
import { verifyMessage } from "viem";
import { slugify, isAddress } from "@/lib/format";
import { claimMessage, CLAIM_WINDOW_MS } from "@/lib/profile-claim";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address");
  if (address) {
    const p = db()
      .prepare("SELECT * FROM profiles WHERE lower(address) = lower(?)")
      .get(address) as Record<string, unknown> | undefined;
    return Response.json({ profile: p ? { ...p } : null });
  }
  const list = rows(
    db().prepare("SELECT username, address, display_name, avatar, is_agent FROM profiles ORDER BY created_at DESC LIMIT 60").all(),
  );
  return Response.json({ profiles: list });
}

/** Claim or update a handle. One handle per address; /profile/{username} resolves it. */
export async function POST(req: NextRequest) {
  const b = (await req.json().catch(() => ({}))) as Record<string, any>;
  const address = String(b.address || "");
  if (!isAddress(address)) return Response.json({ error: "connect a wallet first" }, { status: 400 });

  const username = slugify(String(b.username || ""));
  if (username.length < 3) {
    return Response.json({ error: "username must be at least 3 characters" }, { status: 400 });
  }

  /**
   * Prove the wallet is the caller's.
   *
   * This route used to trust `address` straight from the body, which meant
   * anyone could POST somebody else's address and overwrite their handle,
   * display name, bio, avatar and links. The address is public information, so
   * there was nothing to guess.
   */
  const signature = String(b.signature || "");
  const issuedAt = Number(b.issuedAt || 0);

  if (!signature || !issuedAt) {
    return Response.json(
      { error: "sign the claim with your wallet first" },
      { status: 401 },
    );
  }
  if (Math.abs(Date.now() - issuedAt) > CLAIM_WINDOW_MS) {
    return Response.json({ error: "that signature has expired, try again" }, { status: 401 });
  }

  let signerOk = false;
  try {
    signerOk = await verifyMessage({
      address: address as `0x${string}`,
      message: claimMessage(address, username, issuedAt),
      signature: signature as `0x${string}`,
    });
  } catch {
    signerOk = false;
  }
  if (!signerOk) {
    return Response.json({ error: "that signature does not match the address" }, { status: 401 });
  }

  const taken = db()
    .prepare("SELECT address FROM profiles WHERE username = ?")
    .get(username) as { address: string } | undefined;
  if (taken && taken.address.toLowerCase() !== address.toLowerCase()) {
    return Response.json({ error: "username already taken" }, { status: 409 });
  }

  const existing = db()
    .prepare("SELECT username FROM profiles WHERE lower(address) = lower(?)")
    .get(address) as { username: string } | undefined;

  if (existing) {
    db()
      .prepare(
        "UPDATE profiles SET username = ?, display_name = ?, bio = ?, avatar = ?, banner = ?, links = ?, updated_at = ? WHERE lower(address) = lower(?)",
      )
      .run(
        username,
        String(b.displayName || ""),
        String(b.bio || ""),
        String(b.avatar || ""),
        String(b.banner || ""),
        JSON.stringify(b.links || {}),
        now(),
        address,
      );
  } else {
    db()
      .prepare(
        "INSERT INTO profiles (username, address, display_name, bio, avatar, banner, links, is_agent, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        username,
        address,
        String(b.displayName || ""),
        String(b.bio || ""),
        String(b.avatar || ""),
        String(b.banner || ""),
        JSON.stringify(b.links || {}),
        b.isAgent ? 1 : 0,
        now(),
        now(),
      );
  }

  return Response.json({ ok: true, username, url: "/profile/" + username });
}
