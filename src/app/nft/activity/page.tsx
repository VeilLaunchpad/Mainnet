"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatEther } from "viem";
import { Section, Badge, Empty, Skeleton } from "@/components/ui";
import { useNetwork } from "@/components/network-provider";
import { explorerTx } from "@/lib/chain";
import { shortAddr } from "@/lib/format";

/**
 * Everything that happened, straight from chain logs.
 *
 * There is no database behind this page, which is the point: a feed built from
 * events cannot show a sale that never settled or a launch that reverted.
 */

interface Activity {
  kind: "launch" | "list" | "sale" | "stake";
  block: number;
  hash: string;
  collection?: string;
  tokenId?: string;
  who?: string;
  price?: string;
  label: string;
}

const TONE = {
  launch: "veil",
  list: "cy",
  sale: "mint",
  stake: "amber",
} as const;

export default function ActivityPage() {
  const { net } = useNetwork();
  const [rows, setRows] = useState<Activity[] | null>(null);
  const [filter, setFilter] = useState<"all" | Activity["kind"]>("all");

  useEffect(() => {
    let alive = true;
    setRows(null);
    fetch("/api/nft/activity?limit=200")
      .then((r) => r.json())
      .then((d) => alive && setRows(d.activity ?? []))
      .catch(() => alive && setRows([]));
    return () => {
      alive = false;
    };
  }, [net]);

  const shown = rows?.filter((r) => filter === "all" || r.kind === filter) ?? null;

  return (
    <Section
      kicker="Activity"
      title="Every launch, listing, sale and stake"
      right={
        <div className="flex gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-1">
          {(
            [
              ["all", "All"],
              ["launch", "Launches"],
              ["list", "Listings"],
              ["sale", "Sales"],
              ["stake", "Stakes"],
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
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <Empty
          title="Nothing yet"
          body="Launches, listings, sales and stakes all land here as they happen on chain."
          action={{ href: "/nft/studio", label: "Launch something" }}
        />
      ) : (
        <div className="card divide-y divide-white/[0.06]">
          {shown.map((r, i) => (
            <div key={r.hash + i} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <Badge tone={TONE[r.kind]}>{r.kind}</Badge>

              <span className="text-[13px]">
                {r.collection ? (
                  <Link href={"/nft/collection/" + r.collection} className="hover:text-veil-200">
                    {r.label}
                  </Link>
                ) : (
                  r.label
                )}
              </span>

              {r.price && r.price !== "0" && (
                <span className="mono text-[12px] text-white/55">
                  {Number(formatEther(BigInt(r.price))).toLocaleString(undefined, {
                    maximumFractionDigits: 4,
                  })}{" "}
                  COTI
                </span>
              )}

              {r.who && <span className="mono text-[11px] text-white/30">{shortAddr(r.who)}</span>}

              <a
                href={explorerTx(r.hash, net)}
                target="_blank"
                rel="noreferrer"
                className="mono ml-auto text-[11px] text-white/25 transition hover:text-white/60"
              >
                #{r.block} ↗
              </a>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}
