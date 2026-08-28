"use client";

import Link from "next/link";
import { Avatar, Badge, Progress } from "./ui";
import { shortAddr, timeAgo } from "@/lib/format";
import { PriceText } from "./price-chart";

export interface TokenSummary {
  address: string;
  name: string;
  symbol: string;
  image?: string;
  description?: string;
  creator?: string;
  graduated?: boolean;
  progressPct?: number;
  reserveCoti?: string;
  spotPriceCoti?: number | null;
  kind?: string;
  createdAt?: number;
  /** VEILPAD's own token, as marked by the server. Never set by a launch. */
  official?: boolean;
}

export function TokenCard({ t }: { t: TokenSummary }) {
  return (
    <Link href={"/coti/" + t.address} className="card card-hover flex flex-col p-4">
      <div className="flex items-start gap-3">
        <Avatar src={t.image} seed={t.symbol || t.address} size={44} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[15px] font-semibold">{t.symbol}</span>
            {t.official && <Badge tone="amber">Official</Badge>}
            {t.graduated ? (
              <Badge tone="mint">Graduated</Badge>
            ) : t.official ? null : (
              <Badge tone="veil">Curve</Badge>
            )}
            {t.kind === "private" && <Badge tone="cy">Encrypted</Badge>}
          </div>
          <div className="truncate text-[12px] text-white/45">{t.name}</div>
        </div>
        {t.createdAt ? (
          <span className="mono shrink-0 text-[10px] text-white/25">{timeAgo(t.createdAt)}</span>
        ) : null}
      </div>

      {t.description && (
        <p className="mt-2.5 line-clamp-2 text-[12px] leading-relaxed text-white/40">{t.description}</p>
      )}

      <div className="mt-3.5">
        {t.graduated ? (
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-white/35">VeilSwap pair</span>
            <span className="mono text-mint-400">live</span>
          </div>
        ) : (
          <Progress pct={t.progressPct ?? 0} label="to graduation" />
        )}
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-white/[0.06] pt-2.5">
        <span className="mono text-[10px] text-white/25">{shortAddr(t.address, 4)}</span>
        <span className="mono text-[11px] text-white/55">
          {t.spotPriceCoti ? (
            <>
              <PriceText value={t.spotPriceCoti} /> COTI
            </>
          ) : (
            (t.reserveCoti || "0") + " COTI in"
          )}
        </span>
      </div>
    </Link>
  );
}
