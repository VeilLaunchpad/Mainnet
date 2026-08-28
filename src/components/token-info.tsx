"use client";

import Link from "next/link";
import { Badge } from "./ui";
import { PriceText } from "./price-chart";
import { shortAddr, fmtNum, fmtPriceUsd, timeAgo } from "@/lib/format";
import { explorerAddress } from "@/lib/chain";
import { useNetwork } from "./network-provider";

interface TokenPayload {
  token: {
    address: string;
    name: string;
    symbol: string;
    decimals: number;
    creator: string;
    kind: string;
    isPrivate: boolean;
    curve: string;
    createdAt: number;
    txHash: string;
    creatorProfile: { username: string } | null;
  };
  curve: {
    reserveCoti: string;
    sold: string;
    graduated: boolean;
    progressPct: number;
    targetCoti: string;
    spotPriceCoti: number | null;
    spotPriceUsd: number | null;
  } | null;
  pool: {
    address: string;
    venue: string;
    feeBps: number;
    reserveToken: string;
    reserveCoti: string;
    lpSupply: string;
    priceCoti: number;
    priceUsd: number | null;
  } | null;
  market: { cotiUsd: number; cotiChange24h: number } | null;
  trades: { side: string; coti_in: string; venue: string; trader: string }[];
  stats: { tradeCount: number; knownTraders: number };
}

/**
 * Token info panel.
 *
 * Everything here is derived from chain state or from events, and the panel is
 * explicit about the one number it genuinely cannot show: total supply on a
 * private token is sealed, so market cap is computed from what the launchpad
 * actually issued rather than from an aggregate nobody can read.
 */
export function TokenInfo({ token: data }: { token: TokenPayload }) {
  const t = data.token;
  const c = data.curve;
  const p = data.pool;

  const price = p?.priceCoti ?? c?.spotPriceCoti ?? null;
  const priceUsd = p?.priceUsd ?? c?.spotPriceUsd ?? null;

  const volume = data.trades.reduce((sum, tr) => sum + (Number(String(tr.coti_in).replace(/,/g, "")) || 0), 0);
  const buys = data.trades.filter((tr) => tr.side === "buy").length;
  const sells = data.trades.filter((tr) => tr.side === "sell").length;

  const issued = (() => {
    const sold = Number(String(c?.sold ?? "0").replace(/,/g, "")) || 0;
    const pooled = Number(String(p?.reserveToken ?? "0").replace(/,/g, "")) || 0;
    return sold + pooled;
  })();
  const mcap = price && issued ? price * issued : null;

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-semibold">Token info</h2>
        {t.isPrivate ? <Badge tone="cy">encrypted</Badge> : <Badge tone="muted">public</Badge>}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <Cell label="Price" mono>
          <PriceText value={price} /> <span className="text-white/40">COTI</span>
        </Cell>
        <Cell label="Price USD" mono>
          {fmtPriceUsd(priceUsd)}
        </Cell>
        <Cell label="Market cap" mono>
          {mcap ? fmtNum(mcap, 2) + " COTI" : "-"}
        </Cell>
        <Cell label="Issued supply" mono>
          {issued ? fmtNum(issued, 0) : "-"}
        </Cell>
      </div>

      <dl className="mt-3 divide-y divide-white/[0.05] border-t border-white/[0.05]">
        <Row k="Venue" v={p ? "VeilSwap, " + p.feeBps / 100 + "% fee" : "Bonding curve"} />
        {p ? (
          <>
            <Row k="Pool liquidity" v={p.reserveCoti + " COTI"} />
            <Row k="In the pair" v={p.reserveToken + " " + t.symbol} />
            <Row k="LP shares" v={p.lpSupply + " (locked in the curve)"} />
          </>
        ) : c ? (
          <>
            <Row k="Raised" v={c.reserveCoti + " / " + c.targetCoti + " COTI"} />
            <Row k="Sold on curve" v={c.sold + " " + t.symbol} />
            <Row k="To graduation" v={c.progressPct.toFixed(2) + "%"} />
          </>
        ) : null}
        <Row k="Fills" v={String(data.stats.tradeCount)} />
        <Row k="Buy / sell" v={buys + " / " + sells} />
        <Row k="Volume" v={fmtNum(volume, 4) + " COTI"} />
        <Row k="Traders" v={String(data.stats.knownTraders)} />
        <Row k="Decimals" v={String(t.decimals)} />
        <Row
          k="Total supply"
          v={t.isPrivate ? "sealed by design" : "public"}
          hint={
            t.isPrivate
              ? "A PrivateERC20 reports zero on purpose. Market cap above uses supply the launchpad issued, which is readable."
              : undefined
          }
        />
        <Row k="Launched" v={t.createdAt ? timeAgo(t.createdAt) + " ago" : "-"} />
      </dl>

      <div className="mt-3 space-y-1.5 border-t border-white/[0.05] pt-3">
        <LinkRow label="Token" address={t.address} />
        {t.curve && <LinkRow label="Curve" address={t.curve} />}
        {p?.address && <LinkRow label="Pair" address={p.address} />}
        {t.creator && (
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-white/35">Creator</span>
            <Link
              href={"/profile/" + (t.creatorProfile?.username ?? t.creator)}
              className="mono text-white/60 transition hover:text-veil-300"
            >
              {t.creatorProfile ? "@" + t.creatorProfile.username : shortAddr(t.creator, 5)}
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

function Cell({
  label,
  children,
  mono,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-2">
      <div className="text-[10px] uppercase tracking-wider text-white/30">{label}</div>
      <div className={"mt-0.5 text-[13px] font-semibold " + (mono ? "mono" : "")}>{children}</div>
    </div>
  );
}

function Row({ k, v, hint }: { k: string; v: string; hint?: string }) {
  return (
    <div className="py-2">
      <div className="flex items-baseline justify-between gap-3 text-[11px]">
        <dt className="shrink-0 text-white/35">{k}</dt>
        <dd className="mono min-w-0 truncate text-right text-white/70">{v}</dd>
      </div>
      {hint && <p className="mt-0.5 text-[10px] leading-relaxed text-white/25">{hint}</p>}
    </div>
  );
}

function LinkRow({ label, address }: { label: string; address: string }) {
  const { net } = useNetwork();
  return (
    <div className="flex items-center justify-between text-[11px]">
      <span className="text-white/35">{label}</span>
      <a
        href={explorerAddress(address, net)}
        target="_blank"
        rel="noreferrer"
        className="mono text-white/60 transition hover:text-cy-300"
      >
        {shortAddr(address, 5)}
      </a>
    </div>
  );
}
