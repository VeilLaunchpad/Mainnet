import { NextRequest } from "next/server";
import type { Address } from "viem";
import { db, rows } from "@/lib/db";
import { readTradeHistory, readPortalHistory, publicClient } from "@/lib/rpc";
import { erc20Abi } from "@/lib/abis";
import { isDeployed } from "@/lib/addresses";
import { fmtUnits, isAddress } from "@/lib/format";
import { cotiQuote } from "@/lib/market";
import { chatActivity } from "@/lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type HistoryKind =
  | "launch"
  | "buy"
  | "sell"
  | "portal_in"
  | "portal_out"
  | "bridge"
  | "comment"
  | "agent"
  | "profile"
  | "telegram";

export interface HistoryEntry {
  kind: HistoryKind;
  /** "chain" when read from events, "index" when only this app saw it. */
  source: "chain" | "index";
  title: string;
  detail: string;
  venue: string;
  token?: string;
  symbol?: string;
  amountCoti?: string;
  txHash?: string;
  href?: string;
  at: number;
}

/**
 * One timeline for everything an address has done.
 *
 * Trades and portal crossings are read from chain events, so they show up
 * whether they went through this app, a script, or an agent acting on its own.
 * Launches, comments, agents, handles and bridge hand-offs come from the local
 * index, because no chain event records them in a form worth reconstructing.
 *
 * What is deliberately absent: private transfer amounts. They are ciphertext,
 * and no timeline can honestly display what no indexer can read.
 */
export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address") || "";
  const limit = Math.min(300, Number(req.nextUrl.searchParams.get("limit") || 120));
  const kindFilter = req.nextUrl.searchParams.get("kind");

  if (!isAddress(address)) {
    return Response.json({ error: "address required" }, { status: 400 });
  }

  const me = address.toLowerCase();
  const entries: HistoryEntry[] = [];

  const tokens = rows<{
    address: string;
    symbol: string;
    name: string;
    curve: string;
    pool: string;
    decimals: number;
    creator: string;
    kind: string;
    created_at: number;
    tx_hash: string;
  }>(db().prepare("SELECT * FROM tokens ORDER BY created_at DESC LIMIT 60").all());

  const symbolOf = new Map(tokens.map((t) => [t.address.toLowerCase(), t.symbol]));

  // ── launches ────────────────────────────────────────────────────────────
  for (const t of tokens) {
    if (t.creator.toLowerCase() !== me) continue;
    entries.push({
      kind: "launch",
      source: "index",
      title: "Launched " + t.symbol,
      detail: t.name + (t.kind === "private" ? ", encrypted balances" : ", public balances"),
      venue: "Launchpad",
      token: t.address,
      symbol: t.symbol,
      txHash: t.tx_hash,
      href: "/coti/" + t.address,
      at: t.created_at,
    });
  }

  // ── trades, from chain events ───────────────────────────────────────────
  const tradeReads = await Promise.all(
    tokens
      .filter((t) => isDeployed(t.curve) || isDeployed(t.pool))
      .slice(0, 25)
      .map(async (t) => ({
        token: t,
        fills: await readTradeHistory(t.address as Address, t.curve, t.pool).catch(() => []),
      })),
  );

  for (const { token, fills } of tradeReads) {
    for (const f of fills) {
      if (f.trader.toLowerCase() !== me) continue;
      const coti = fmtUnits(f.cotiAmount, 18, 6);
      const amount = fmtUnits(f.tokenAmount, token.decimals, 4);
      entries.push({
        kind: f.side === "buy" ? "buy" : "sell",
        source: "chain",
        title: (f.side === "buy" ? "Bought " : "Sold ") + token.symbol,
        detail:
          f.side === "buy"
            ? coti + " COTI for " + amount + " " + token.symbol
            : amount + " " + token.symbol + " for " + coti + " COTI",
        venue: f.venue === "devoxswap" ? "DevoxSwap" : "Bonding curve",
        token: token.address,
        symbol: token.symbol,
        amountCoti: coti,
        txHash: f.txHash,
        href: "/coti/" + token.address,
        at: f.time,
      });
    }
  }

  // ── portal crossings, from chain events ────────────────────────────────
  const crossings = await readPortalHistory(address as Address).catch(() => []);
  const wrappedSymbols = new Map<string, string>();
  for (const c of crossings) {
    const key = c.underlying.toLowerCase();
    if (wrappedSymbols.has(key)) continue;
    if (c.underlying === "0x0000000000000000000000000000000000000000") {
      wrappedSymbols.set(key, "COTI");
      continue;
    }
    const indexed = symbolOf.get(key);
    if (indexed) {
      wrappedSymbols.set(key, indexed);
      continue;
    }
    try {
      const sym = (await publicClient().readContract({
        address: c.underlying,
        abi: erc20Abi,
        functionName: "symbol",
      })) as string;
      wrappedSymbols.set(key, sym);
    } catch {
      wrappedSymbols.set(key, "token");
    }
  }

  for (const c of crossings) {
    const label = wrappedSymbols.get(c.underlying.toLowerCase()) ?? "token";
    const amount = fmtUnits(c.amount, 18, 6);
    entries.push({
      kind: c.direction === "in" ? "portal_in" : "portal_out",
      source: "chain",
      title: c.direction === "in" ? "Portalled into privacy" : "Portalled back out",
      detail:
        c.direction === "in"
          ? amount + " " + label + " locked, private twin minted"
          : amount + " " + label + " released, twin burned",
      venue: "Privacy portal",
      symbol: label,
      amountCoti: amount,
      txHash: c.txHash,
      href: "/portal",
      at: c.time,
    });
  }

  // ── bridge hand-offs ────────────────────────────────────────────────────
  const bridges = rows<Record<string, unknown>>(
    db()
      .prepare("SELECT * FROM bridges WHERE lower(address) = lower(?) ORDER BY id DESC LIMIT 50")
      .all(address),
  );
  /**
   * The same table carries two different journeys: a privacy crossing that
   * settles on COTI in one transaction, and a cross-chain transfer that
   * leaves the chain entirely. Labelling them alike made a shielding look
   * like it had left for Ethereum.
   */
  const BRIDGE_LEG: Record<string, string> = {
    into_privacy: "public to private",
    out_of_privacy: "private to public",
    to_ethereum: "COTI to Ethereum",
    to_coti: "Ethereum to COTI",
  };

  for (const b of bridges) {
    const leg = BRIDGE_LEG[String(b.direction)] ?? String(b.direction);
    const shielding = String(b.direction).endsWith("_privacy");
    entries.push({
      kind: "bridge",
      source: "index",
      title: (shielding ? "Bridge " : "Bridge out ") + String(b.asset),
      detail: String(b.amount) + " " + String(b.asset) + ", " + leg + ", " + String(b.status),
      venue: String(b.venue) || "COTI Bridge",
      amountCoti: String(b.amount),
      txHash: String(b.tx_hash || ""),
      href: "/bridge",
      at: Number(b.created_at) || 0,
    });
  }

  // ── the rest of the index ───────────────────────────────────────────────
  const comments = rows<Record<string, unknown>>(
    db()
      .prepare("SELECT token, body, private, tx_hash, created_at FROM comments WHERE lower(author) = lower(?) ORDER BY id DESC LIMIT 50")
      .all(address),
  );
  for (const c of comments) {
    const sym = symbolOf.get(String(c.token).toLowerCase()) ?? "a token";
    entries.push({
      kind: "comment",
      source: "index",
      title: c.private ? "Sent an encrypted note" : "Commented on " + sym,
      detail: c.private
        ? "Body is ciphertext, readable only by the creator"
        : String(c.body).slice(0, 120),
      venue: c.private ? "PrivateMessaging" : "Comments",
      token: String(c.token),
      symbol: sym,
      txHash: String(c.tx_hash || ""),
      href: "/coti/" + String(c.token),
      at: Number(c.created_at) || 0,
    });
  }

  const agents = rows<Record<string, unknown>>(
    db()
      .prepare("SELECT slug, name, kind, created_at FROM agents WHERE lower(owner) = lower(?) ORDER BY created_at DESC")
      .all(address),
  );
  for (const a of agents) {
    entries.push({
      kind: "agent",
      source: "index",
      title: "Created " + String(a.name),
      detail: "A " + String(a.kind) + " agent",
      venue: "Agents",
      href: "/agents/" + String(a.slug),
      at: Number(a.created_at) || 0,
    });
  }

  for (const a of chatActivity(address, 40)) {
    entries.push({
      kind: "telegram",
      source: "index",
      title: a.title,
      detail: a.detail,
      venue: "Telegram",
      href: "/dashboard?tab=telegram",
      at: a.created_at,
    });
  }

  const profile = rows<Record<string, unknown>>(
    db()
      .prepare("SELECT username, created_at FROM profiles WHERE lower(address) = lower(?)")
      .all(address),
  );
  for (const p of profile) {
    entries.push({
      kind: "profile",
      source: "index",
      title: "Claimed @" + String(p.username),
      detail: "Handle resolves at /profile/" + String(p.username),
      venue: "Profiles",
      href: "/profile/" + String(p.username),
      at: Number(p.created_at) || 0,
    });
  }

  const filtered = kindFilter ? entries.filter((e) => e.kind === kindFilter) : entries;
  filtered.sort((a, b) => b.at - a.at);

  const coti = await cotiQuote().catch(() => null);
  const volume = entries
    .filter((e) => e.kind === "buy" || e.kind === "sell")
    .reduce((sum, e) => sum + (Number(String(e.amountCoti ?? "0").replace(/,/g, "")) || 0), 0);

  return Response.json({
    address,
    count: filtered.length,
    entries: filtered.slice(0, limit),
    summary: {
      launches: entries.filter((e) => e.kind === "launch").length,
      buys: entries.filter((e) => e.kind === "buy").length,
      sells: entries.filter((e) => e.kind === "sell").length,
      crossings: entries.filter((e) => e.kind.startsWith("portal")).length,
      bridges: entries.filter((e) => e.kind === "bridge").length,
      comments: entries.filter((e) => e.kind === "comment").length,
      telegram: entries.filter((e) => e.kind === "telegram").length,
      agents: entries.filter((e) => e.kind === "agent").length,
      volumeCoti: volume,
      volumeUsd: coti ? volume * coti.price : null,
    },
    note: "Trades and portal crossings come from chain events. Private transfer amounts are ciphertext and cannot appear in any timeline.",
  });
}
