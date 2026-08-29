"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Address } from "viem";
import { Badge } from "@/components/ui";
import { fmtUnits, shortAddr, timeAgo } from "@/lib/format";

/**
 * The pieces every NFT page shares.
 *
 * The art shown on a card is always the public preview, never the private
 * metadata. That is not a shortcut - it is the design. A marketplace with
 * nothing on its cards is not a marketplace, so each collection carries a
 * public face; what a buyer unlocks after purchase is the sealed half, and it
 * is only ever decrypted in the holder's own browser.
 */

export const NATIVE = "0x0000000000000000000000000000000000000000" as Address;

export interface Collection {
  address: Address;
  kind: "drop" | "editions";
  creator: Address;
  name: string;
  symbol: string;
  previewURI: string;
  createdAt: number;
  official: boolean;
  maxSupply: string;
  minted: string;
  mintPrice: string;
  payToken: Address;
  editionCount?: number;
  paired?: { poolId: number; rewardToken: Address; apyBps: number; rewardPerYear: string };
}

/** The COTI mark, so a native price is not just a bare number. */
export function priceLabel(price: string, payToken: Address, symbol = "COTI"): string {
  if (price === "0") return "Free";
  return fmtUnits(price, 18, 4) + " " + (payToken === NATIVE ? "COTI" : symbol);
}

export function OfficialMark() {
  return (
    <span
      title="Deployed and marked official by VEILPAD"
      className="inline-flex size-4 items-center justify-center rounded-full bg-gradient-to-br from-veil-400 to-cy-400 text-[9px] font-black text-black"
    >
      ✓
    </span>
  );
}

/** A mined address is part of the identity here, so it is shown, not hidden. */
export function VanityTag({ address }: { address: string }) {
  const mined = address.toLowerCase().endsWith("8888");
  if (!mined) return null;
  return (
    <span className="mono text-[10px] text-veil-300/70" title="Address mined with CREATE2">
      …{address.slice(-4)}
    </span>
  );
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|svg)$/i;

/** ipfs:// is not a scheme a browser can fetch; a gateway is. */
function httpish(uri: string): string {
  return uri.startsWith("ipfs://")
    ? (process.env.NEXT_PUBLIC_PINATA_GATEWAY || "https://ipfs.io/ipfs/") + uri.slice(7)
    : uri;
}

export function PreviewArt({ uri, name, className = "" }: { uri: string; name: string; className?: string }) {
  // A preview URI is usually metadata rather than an image - that is what the
  // Studio pins, and what the official collection points at. So a URI that is
  // not obviously an image gets resolved once, and `image` is read out of it.
  // Anything that fails falls back to a generated mark, because a broken image
  // icon in a grid is worse than a plain one.
  const direct = uri ? httpish(uri) : "";
  const [resolved, setResolved] = useState<string | null>(
    direct && IMAGE_EXT.test(direct) ? direct : null,
  );

  useEffect(() => {
    if (!direct || IMAGE_EXT.test(direct)) return;
    let alive = true;
    fetch(direct, { headers: { accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((m: { image?: string } | null) => {
        if (alive && m?.image) setResolved(httpish(m.image));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [direct]);

  if (resolved) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={resolved} alt={name} className={"size-full object-cover " + className} loading="lazy" />;
  }

  const seed = name.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const hue = seed % 360;
  return (
    <div
      className={"flex size-full items-center justify-center " + className}
      style={{
        background: `linear-gradient(135deg, hsl(${hue} 60% 22%), hsl(${(hue + 60) % 360} 55% 12%))`,
      }}
    >
      <span className="mono text-2xl font-black text-white/25">{name.slice(0, 2).toUpperCase()}</span>
    </div>
  );
}

export function CollectionCard({ c }: { c: Collection }) {
  const supply = c.kind === "drop" ? c.maxSupply : null;
  const pct =
    supply && supply !== "0" ? (Number(c.minted) / Number(supply)) * 100 : null;

  return (
    <Link
      href={"/nft/collection/" + c.address}
      className="card group overflow-hidden transition hover:border-white/20"
    >
      <div className="relative aspect-square overflow-hidden">
        <PreviewArt uri={c.previewURI} name={c.name} className="transition duration-500 group-hover:scale-105" />
        <div className="absolute left-2 top-2 flex gap-1">
          {c.official && (
            <span className="inline-flex items-center gap-1 rounded-md border border-veil-400/30 bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-veil-300 backdrop-blur">
              <OfficialMark /> Official
            </span>
          )}
          {c.paired && c.paired.apyBps > 0 && (
            <span className="rounded-md border border-mint-400/30 bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-mint-400 backdrop-blur">
              {(c.paired.apyBps / 100).toFixed(0)}% APY
            </span>
          )}
        </div>
      </div>

      <div className="p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="truncate text-[14px] font-semibold">{c.name}</div>
          <VanityTag address={c.address} />
        </div>
        <div className="mt-1 flex items-center gap-1.5">
          <Badge tone={c.kind === "drop" ? "veil" : "cy"}>
            {c.kind === "drop" ? "Drop" : "Open"}
          </Badge>
          {c.paired ? <Badge tone="mint">Paired</Badge> : <Badge tone="muted">Solo</Badge>}
        </div>

        <div className="mono mt-2 flex items-center justify-between text-[11px] text-white/40">
          <span>{priceLabel(c.mintPrice, c.payToken, c.symbol)}</span>
          <span>
            {c.kind === "drop"
              ? Number(c.minted).toLocaleString() +
                (supply && supply !== "0" ? " / " + Number(supply).toLocaleString() : "")
              : (c.editionCount ?? 0) + " editions"}
          </span>
        </div>

        {pct !== null && (
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.07]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-veil-500 to-cy-400"
              style={{ width: Math.min(100, pct) + "%" }}
            />
          </div>
        )}

        <div className="mt-2 text-[10px] text-white/25">
          by {shortAddr(c.creator)} · {timeAgo(c.createdAt)}
        </div>
      </div>
    </Link>
  );
}
