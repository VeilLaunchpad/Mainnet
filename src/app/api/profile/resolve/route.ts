import { NextRequest } from "next/server";
import { db, row, rows } from "@/lib/db";
import { isAddress } from "@/lib/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Turning what someone typed into an address.
 *
 * People know each other by handle, not by twenty bytes of hex, so anywhere
 * VEILPAD asks for a recipient it should accept either. The rule is that a
 * handle must resolve to exactly one address before anything is sent: an
 * unresolved handle is refused rather than guessed at, because a message
 * encrypted to the wrong key is unreadable by everyone including the sender.
 */

interface ProfileRow {
  username: string;
  address: string;
  display_name: string | null;
  avatar: string | null;
  is_agent: number | null;
}

const shape = (p: ProfileRow) => ({
  username: p.username,
  address: p.address,
  displayName: p.display_name || "",
  avatar: p.avatar || "",
  isAgent: !!p.is_agent,
});

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") || "").trim().replace(/^@/, "");
  const limit = Math.min(8, Number(req.nextUrl.searchParams.get("limit")) || 6);

  if (!q) return Response.json({ resolved: null, suggestions: [] });

  // A raw address always wins. It needs no lookup and cannot be ambiguous.
  if (isAddress(q)) {
    const p = row<ProfileRow>(
      db()
        .prepare(
          "SELECT username, address, display_name, avatar, is_agent FROM profiles WHERE lower(address) = lower(?)",
        )
        .get(q),
    );
    // When the address has a profile, that record is the better answer: it
    // carries the handle and the canonical casing.
    return Response.json({
      resolved: p
        ? shape(p)
        : { address: q, username: "", displayName: "", avatar: "", isAgent: false },
      kind: "address",
      suggestions: [],
    });
  }

  const exact = row<ProfileRow>(
    db()
      .prepare(
        "SELECT username, address, display_name, avatar, is_agent FROM profiles WHERE lower(username) = lower(?)",
      )
      .get(q),
  );

  // Prefix matches drive the picker. The exact hit is excluded so it is not
  // offered twice, once as the answer and once as a suggestion.
  const suggestions = rows<ProfileRow>(
    db()
      .prepare(
        `SELECT username, address, display_name, avatar, is_agent
           FROM profiles
          WHERE lower(username) LIKE lower(?) AND lower(username) <> lower(?)
          ORDER BY length(username), username
          LIMIT ?`,
      )
      .all(q + "%", q, limit),
  );

  return Response.json({
    resolved: exact ? shape(exact) : null,
    kind: exact ? "handle" : "none",
    suggestions: suggestions.map(shape),
  });
}
