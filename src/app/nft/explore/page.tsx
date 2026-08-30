"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { formatEther } from "viem";
import { Section, Stat, Badge, Empty, Skeleton } from "@/components/ui";
import { useNetwork } from "@/components/network-provider";
import { shortAddr } from "@/lib/format";
import { CollectionCard, PreviewArt, OfficialMark, type Collection } from "@/components/nft/shared";

/**
 * Explore, two ways.
 *
 * A marketplace answers two different questions and they want different shapes.
 * "What exists here?" is a question about collections, and the answer is a grid
 * of them. "What can I buy right now, and for how much?" is a question about
 * listings, and the answer is a specific token at a specific price - the
 * collection is only context.
 *
 * So this page is one surface with two modes rather than two pages that share a
 * header. The mode lives in the URL hash-free state on purpose: switching is
 * cheap and nobody deep-links to a filter.
 *
 * Dead listings are shown rather than hidden, with the reason. A marketplace
 * that quietly drops them looks smaller than it is and teaches nobody why a
 * listing stopped being fillable.
 */

interface Listing {
  id: number;
  collection: string;
  tokenId: string;
  seller: string;
  price: string;
  live: boolean;
  reason: string;
  collectionName?: string;
  collectionSymbol?: string;
  previewURI?: string;
  official?: boolean;
}

type Mode = "listings" | "collections";
type Sort = "price-asc" | "price-desc" | "newest";

export default function NFTExplorePage() {
  const { net } = useNetwork();
  const [mode, setMode] = useState<Mode>("listings");
  const [sort, setSort] = useState<Sort>("price-asc");
  const [q, setQ] = useState("");
  const [liveOnly, setLiveOnly] = useState(true);

  const [collections, setCollections] = useState<Collection[] | null>(null);
  const [listings, setListings] = useState<Listing[] | null>(null);

  useEffect(() => {
    let alive = true;
    setCollections(null);
    setListings(null);
    Promise.all([
      fetch("/api/nft/collections?limit=120").then((r) => r.json()),
      fetch("/api/nft/listings?limit=200").then((r) => r.json()),
    ])
      .then(([c, l]) => {
        if (!alive) return;
        setCollections(c.collections ?? []);
        setListings(l.listings ?? []);
      })
      .catch(() => {
        if (!alive) return;
        setCollections([]);
        setListings([]);
      });
    return () => {
      alive = false;
    };
  }, [net]);

  const shownListings = useMemo(() => {
    if (!listings) return null;
    let out = liveOnly ? listings.filter((l) => l.live) : listings;
    if (q) {
      const needle = q.toLowerCase();
      out = out.filter((l) =>
        ((l.collectionName ?? "") + " " + (l.collectionSymbol ?? "") + " #" + l.tokenId)
          .toLowerCase()
          .includes(needle),
      );
    }
    const price = (l: Listing) => Number(l.price || "0");
    return [...out].sort((a, b) =>
      sort === "price-asc"
        ? price(a) - price(b)
        : sort === "price-desc"
          ? price(b) - price(a)
          : b.id - a.id,
    );
  }, [listings, liveOnly, q, sort]);

  const shownCollections = useMemo(() => {
    if (!collections) return null;
    const out = q
      ? collections.filter((c) =>
          (c.name + " " + c.symbol).toLowerCase().includes(q.toLowerCase()),
        )
      : collections;
    return [...out].sort(
      (a, b) => Number(b.official) - Number(a.official) || b.createdAt - a.createdAt,
    );
  }, [collections, q]);

  const liveCount = listings?.filter((l) => l.live).length ?? 0;
  const floor = listings
    ?.filter((l) => l.live)
    .reduce<number | null>((min, l) => {
      const p = Number(formatEther(BigInt(l.price || "0")));
      return min === null || p < min ? p : min;
    }, null);

  return (
    <Section
      kicker="Explore"
      title="Everything on the market"
      sub="Browse by what is for sale right now, or by the collections themselves."
      right={
        <div className="flex gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-1">
          {(
            [
              ["listings", "Listings"],
              ["collections", "Collections"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setMode(k)}
              className={
                "rounded-lg px-3.5 py-1.5 text-[13px] font-medium transition " +
                (mode === k ? "bg-white/10 text-white" : "text-white/45 hover:text-white/80")
              }
            >
              {label}
            </button>
          ))}
        </div>
      }
    >
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Collections" value={collections ? collections.length : "—"} />
        <Stat label="Listed now" value={listings ? liveCount : "—"} />
        <Stat
          label="Floor"
          value={floor !== null && floor !== undefined ? floor.toLocaleString(undefined, { maximumFractionDigits: 4 }) : "—"}
          sub="COTI, cheapest live listing"
        />
        <Stat
          label="Official"
          value={collections ? collections.filter((c) => c.official).length : "—"}
          sub="marked by the marketplace"
        />
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={mode === "listings" ? "Search a collection or #id" : "Search collections"}
          className="w-64 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[13px] outline-none focus:border-devox-400/40"
        />

        {mode === "listings" && (
          <>
            <div className="flex gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-1">
              {(
                [
                  ["price-asc", "Cheapest"],
                  ["price-desc", "Highest"],
                  ["newest", "Newest"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setSort(k)}
                  className={
                    "rounded-lg px-3 py-1 text-[12px] font-medium transition " +
                    (sort === k ? "bg-white/10 text-white" : "text-white/45 hover:text-white/75")
                  }
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              onClick={() => setLiveOnly((v) => !v)}
              className={
                "rounded-xl border px-3 py-2 text-[12px] font-medium transition " +
                (liveOnly
                  ? "border-mint-400/30 bg-mint-400/10 text-mint-400"
                  : "border-white/10 text-white/45 hover:text-white/75")
              }
            >
              {liveOnly ? "Live only" : "Including dead"}
            </button>
          </>
        )}
      </div>

      {/* ── listings ─────────────────────────────────────────────────── */}
      {mode === "listings" &&
        (shownListings === null ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="aspect-[3/4]" />
            ))}
          </div>
        ) : shownListings.length === 0 ? (
          <Empty
            title={q ? "Nothing matches that" : "Nothing listed yet"}
            body={
              q
                ? "Try a different collection or token id."
                : "A listing appears the moment somebody puts a token up. Yours stays in your wallet until it sells."
            }
            action={{ href: "/nft", label: "Back to the marketplace" }}
          />
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {shownListings.map((l) => (
              <Link
                key={l.id}
                href={"/nft/collection/" + l.collection}
                className="card group overflow-hidden transition hover:border-white/20"
              >
                <div className="relative aspect-square overflow-hidden">
                  <PreviewArt
                    uri={l.previewURI ?? ""}
                    name={l.collectionName || l.collection}
                    className="transition duration-500 group-hover:scale-105"
                  />
                  <div className="absolute left-2 top-2 flex gap-1">
                    {l.official && (
                      <span className="inline-flex items-center gap-1 rounded-md border border-devox-400/30 bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-devox-300 backdrop-blur">
                        <OfficialMark /> Official
                      </span>
                    )}
                    {!l.live && (
                      <span className="rounded-md border border-white/15 bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white/50 backdrop-blur">
                        not fillable
                      </span>
                    )}
                  </div>
                </div>

                <div className="p-3">
                  <div className="truncate text-[13px] font-semibold">
                    {l.collectionName || shortAddr(l.collection)}{" "}
                    <span className="text-white/40">#{l.tokenId}</span>
                  </div>

                  <div className="mono mt-1.5 text-[15px] font-semibold text-devox-200">
                    {Number(formatEther(BigInt(l.price || "0"))).toLocaleString(undefined, {
                      maximumFractionDigits: 4,
                    })}{" "}
                    <span className="text-[12px] font-normal text-white/45">COTI</span>
                  </div>

                  <div className="mt-1.5 text-[10px] text-white/25">
                    {l.live ? "seller " + shortAddr(l.seller) : l.reason || "inactive"}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        ))}

      {/* ── collections ──────────────────────────────────────────────── */}
      {mode === "collections" &&
        (shownCollections === null ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="aspect-[3/4]" />
            ))}
          </div>
        ) : shownCollections.length === 0 ? (
          <Empty
            title={q ? "Nothing matches that" : "No collections yet"}
            body="The Studio deploys one at an address you mine yourself."
            action={{ href: "/nft/studio", label: "Open the Studio" }}
          />
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {shownCollections.map((c) => (
              <CollectionCard key={c.address} c={c} />
            ))}
          </div>
        ))}

      {mode === "listings" && shownListings && shownListings.length > 0 && (
        <p className="mt-6 max-w-3xl text-[12px] leading-relaxed text-white/35">
          A listing is approval-based: the token stays in the seller&apos;s wallet until it sells,
          which means a listing can stop being fillable if they move it. Those are shown with the
          reason rather than hidden, so the count here is honest about what it is.
        </p>
      )}
    </Section>
  );
}
