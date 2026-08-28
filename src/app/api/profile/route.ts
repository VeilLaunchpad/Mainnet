import { NextRequest } from "next/server";
import { db, rows, now } from "@/lib/db";
import { slugify, isAddress } from "@/lib/format";

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
