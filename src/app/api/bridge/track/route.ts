import { NextRequest } from "next/server";
import { db, rows, now } from "@/lib/db";
import { isAddress } from "@/lib/format";
import { networkFrom } from "@/lib/network";
import { chainByNetwork, ethChainFor, type CotiNetworkName } from "@/lib/chain";
import { trackingBase, trackingPageSize, crossChain } from "@/lib/coti-bridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Bridge history.
 *
 * Privacy-bridge crossings settle in a single transaction on COTI, so there is
 * nothing to wait for: the receipt is the confirmation and it is recorded here
 * directly. Cross-chain transfers are the slow kind, and those are read back
 * from COTI's own tracking service rather than guessed at from balances, which
 * is both more accurate and honest about whose record it is.
 */

function ensureTable() {
  db().exec(`
    CREATE TABLE IF NOT EXISTS bridges (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      address    TEXT NOT NULL,
      direction  TEXT NOT NULL,
      asset      TEXT NOT NULL,
      amount     TEXT NOT NULL DEFAULT '0',
      from_chain INTEGER NOT NULL DEFAULT 0,
      to_chain   INTEGER NOT NULL DEFAULT 0,
      venue      TEXT NOT NULL DEFAULT '',
      status     TEXT NOT NULL DEFAULT 'done',
      tx_hash    TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_bridges_addr ON bridges(address, id DESC);
  `);
}

export async function POST(req: NextRequest) {
  ensureTable();
  const b = (await req.json().catch(() => ({}))) as Record<string, string | number>;

  const address = String(b.address || "");
  if (!isAddress(address)) return Response.json({ error: "address required" }, { status: 400 });

  db()
    .prepare(
      `INSERT INTO bridges (address, direction, asset, amount, from_chain, to_chain, venue, status, tx_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      address,
      String(b.direction || "into_privacy"),
      String(b.asset || "COTI"),
      String(b.amount || "0"),
      Number(b.fromChainId) || 0,
      Number(b.toChainId) || 0,
      String(b.venue || "COTI Privacy Bridge"),
      String(b.status || "done"),
      String(b.txHash || ""),
      now(),
    );

  return Response.json({ ok: true });
}

interface BridgeRow {
  id: number;
  direction: string;
  asset: string;
  amount: string;
  venue: string;
  status: string;
  tx_hash: string;
  created_at: number;
}

/**
 * COTI's tracking service paginates in whole transfers, and each transfer
 * occupies four rows, so it rejects any page size that is not a multiple of
 * four. It also answers for a wallet with no history, which is what makes it
 * safe to call unconditionally.
 */
async function officialTransfers(address: string, net: CotiNetworkName) {
  if (crossChain(net).assets.length === 0) return { supported: false, items: [] as unknown[] };

  const url =
    `${trackingBase(net)}/tracking/get-all-transactions` +
    `?wallet_address=${address}&page=1&page_size=${trackingPageSize(8)}`;

  try {
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return { supported: true, items: [], error: `tracking returned ${res.status}` };
    const j = (await res.json()) as { items?: unknown[] };
    return { supported: true, items: j.items ?? [] };
  } catch {
    // The bridge working does not depend on its tracker being reachable.
    return { supported: true, items: [], error: "tracking service unreachable" };
  }
}

export async function GET(req: NextRequest) {
  ensureTable();
  const net = networkFrom(req);

  const address = req.nextUrl.searchParams.get("address") || "";
  if (!isAddress(address)) return Response.json({ error: "address required" }, { status: 400 });

  const cotiId = chainByNetwork[net].id;
  const ethId = ethChainFor(net).id;

  const local = rows<BridgeRow>(
    db()
      .prepare(
        "SELECT * FROM bridges WHERE lower(address) = lower(?) AND (from_chain IN (?, ?) OR to_chain IN (?, ?)) ORDER BY id DESC LIMIT 20",
      )
      .all(address, cotiId, ethId, cotiId, ethId),
  );

  const official = await officialTransfers(address, net);

  return Response.json({
    address,
    network: net,
    transfers: local.map((r) => ({
      id: r.id,
      direction: r.direction,
      asset: r.asset,
      amount: r.amount,
      venue: r.venue,
      status: r.status,
      txHash: r.tx_hash || null,
      at: r.created_at,
    })),
    /** COTI's own view of any cross-chain transfer this wallet has made. */
    crossChain: official,
  });
}
