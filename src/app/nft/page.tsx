"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Section, Stat, Empty, Skeleton, Badge } from "@/components/ui";
import { useNetwork } from "@/components/network-provider";
import { CollectionCard, type Collection } from "@/components/nft/shared";

/**
 * The marketplace front page.
 *
 * Sorted official first, then newest, which is the same order the API returns.
 * The headline is the thing that is actually different here: on every other
 * chain "reveal after mint" is a promise somebody can break, and on COTI the
 * metadata is a ciphertext sealed to the holder's key. Saying so once, plainly,
 * at the top is worth more than a badge on every card.
 */

interface Listing {
  id: number;
  collection: string;
  tokenId: string;
  price: string;
  live: boolean;
}

export default function NFTHome() {
  const { net } = useNetwork();
  const [collections, setCollections] = useState<Collection[] | null>(null);
  const [listings, setListings] = useState<Listing[]>([]);
  const [filter, setFilter] = useState<"all" | "drop" | "editions" | "paired">("all");

  useEffect(() => {
    let alive = true;
    setCollections(null);
    Promise.all([
      fetch("/api/nft/collections?limit=120").then((r) => r.json()),
      fetch("/api/nft/listings?live=1&limit=60").then((r) => r.json()),
    ])
      .then(([c, l]) => {
        if (!alive) return;
        setCollections(c.collections ?? []);
        setListings(l.listings ?? []);
      })
      .catch(() => alive && setCollections([]));
    return () => {
      alive = false;
    };
  }, [net]);

  const shown = useMemo(() => {
    if (!collections) return null;
    if (filter === "all") return collections;
    if (filter === "paired") return collections.filter((c) => c.paired);
    return collections.filter((c) => c.kind === filter);
  }, [collections, filter]);

  const official = collections?.find((c) => c.official);
  const totalMinted = collections?.reduce((a, c) => a + Number(c.minted || 0), 0) ?? 0;
  const pairedCount = collections?.filter((c) => c.paired).length ?? 0;

  return (
    <>
      <Section
        kicker={"NFT · " + net}
        title="Own the key, not just the token"
        sub="Every collection here carries two halves: a public preview any marketplace can render, and private metadata sealed to whoever holds the token. Not hidden behind a server flag — encrypted, and re-sealed to each new owner on transfer. Powered by COTI."
        right={
          <Link
            href="/nft/studio"
            className="rounded-xl bg-gradient-to-r from-devox-500 to-cy-500 px-4 py-2 text-[13px] font-semibold text-white transition hover:brightness-110"
          >
            Open the Studio
          </Link>
        }
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Collections" value={collections ? collections.length : "—"} />
          <Stat label="Minted" value={collections ? totalMinted.toLocaleString() : "—"} />
          <Stat label="Paired with a token" value={collections ? pairedCount : "—"} sub="earning APY" />
          <Stat label="Live listings" value={listings.length} />
        </div>
      </Section>

      {official && (
        <Section className="mt-10" kicker="Official" title="DEVOXPAD Genesis">
          <Link
            href={"/nft/collection/" + official.address}
            className="card flex flex-col gap-5 p-5 transition hover:border-white/20 sm:flex-row sm:items-center"
          >
            <div className="size-28 shrink-0 overflow-hidden rounded-xl border border-white/10">
              <div className="flex size-full items-center justify-center bg-gradient-to-br from-devox-600/40 to-cy-500/20">
                <span className="mono text-2xl font-black text-white/50">VG</span>
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-lg font-bold">{official.name}</span>
                <Badge tone="devox">Official</Badge>
                {official.paired && official.paired.apyBps > 0 && (
                  <Badge tone="mint">{(official.paired.apyBps / 100).toFixed(0)}% APY</Badge>
                )}
              </div>
              <p className="mt-1.5 max-w-2xl text-[13px] text-white/45">
                10,000 free to mint, ten per wallet, paired with $DEVOX so a staked Genesis earns
                yield. The address was mined to end in 8888, like every DEVOXPAD launch.
              </p>
              <div className="mono mt-2.5 flex flex-wrap gap-4 text-[11px] text-white/35">
                <span>{Number(official.minted).toLocaleString()} minted</span>
                <span>{Number(official.maxSupply).toLocaleString()} supply</span>
                <span>Free mint</span>
                <span className="text-devox-300/70">…{official.address.slice(-4)}</span>
              </div>
            </div>
            <div className="shrink-0 rounded-xl bg-white/[0.06] px-4 py-2 text-[13px] font-semibold">
              Mint →
            </div>
          </Link>
        </Section>
      )}

      <Section
        className="mt-10"
        title="Collections"
        right={
          <div className="flex gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-1">
            {(
              [
                ["all", "All"],
                ["drop", "Drops"],
                ["editions", "Open"],
                ["paired", "Paired"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setFilter(k)}
                className={
                  "rounded-lg px-3 py-1 text-[12px] font-medium transition " +
                  (filter === k ? "bg-white/10 text-white" : "text-white/45 hover:text-white/75")
                }
              >
                {label}
              </button>
            ))}
          </div>
        }
      >
        {shown === null ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="aspect-[3/4]" />
            ))}
          </div>
        ) : shown.length === 0 ? (
          <Empty
            title={filter === "all" ? "No collections yet" : "Nothing matches that filter"}
            body={
              filter === "all"
                ? "Be the first. The Studio deploys a collection at an address you mine yourself."
                : "Try another filter, or launch one of your own."
            }
            action={{ href: "/nft/studio", label: "Open the Studio" }}
          />
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {shown.map((c) => (
              <CollectionCard key={c.address} c={c} />
            ))}
          </div>
        )}
      </Section>
    </>
  );
}
