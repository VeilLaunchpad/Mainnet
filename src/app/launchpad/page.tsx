"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Section, Skeleton, Empty, Badge } from "@/components/ui";
import { TokenCard, type TokenSummary } from "@/components/token-card";
import { useNetwork } from "@/components/network-provider";
import { OFFICIAL_MAINNET_TOKEN } from "@/lib/chain";

const SORTS = [
  { key: "new", label: "Newest" },
  { key: "progress", label: "Closest to graduation" },
  { key: "graduated", label: "Graduated" },
] as const;

export default function LaunchpadPage() {
  const { net } = useNetwork();
  const [tokens, setTokens] = useState<TokenSummary[] | null>(null);
  const [sort, setSort] = useState<string>("new");
  const [q, setQ] = useState("");

  useEffect(() => {
    setTokens(null);
    const t = setTimeout(() => {
      const url = "/api/tokens?limit=60&sort=" + sort + (q ? "&q=" + encodeURIComponent(q) : "");
      fetch(url)
        .then((r) => r.json())
        .then((j) => setTokens(j.tokens || []))
        .catch(() => setTokens([]));
    }, q ? 260 : 0);
    return () => clearTimeout(t);
  }, [sort, q, net]);

  return (
    <div className="py-10">
      <Section
        kicker="Launchpad"
        title="Private tokens, launched on a curve"
        sub="Buy on the bonding curve while it fills. On graduation the whole reserve seeds a DevoxSwap pair and the LP is locked."
        right={
          <Link
            href="/launch"
            className="rounded-xl bg-gradient-to-r from-devox-500 to-cy-500 px-4 py-2.5 text-[13px] font-semibold text-white transition hover:brightness-110"
          >
            Launch a token
          </Link>
        }
      >
        {net === "testnet" && (
          <div className="mb-5 flex items-start gap-3 rounded-xl border border-amber-400/25 bg-amber-400/[0.05] px-4 py-3">
            <span className="mt-0.5 shrink-0 text-[15px]">🟡</span>
            <p className="text-[12.5px] leading-relaxed text-amber-100/80">
              <b className="text-amber-200">DEVOXPAD official token launched on Mainnet.</b>{" "}
              The DEVOX pinned below is the testnet rehearsal of it - same contract, same 8888
              address shape, worth nothing. The real one is{" "}
              <a
                href={"https://mainnet.cotiscan.io/address/" + OFFICIAL_MAINNET_TOKEN}
                target="_blank"
                rel="noreferrer"
                className="mono text-cy-300 hover:underline"
              >
                {OFFICIAL_MAINNET_TOKEN.slice(0, 10)}…{OFFICIAL_MAINNET_TOKEN.slice(-6)}
              </a>{" "}
              on{" "}
              <a href="https://devoxpad-mainnet.vercel.app/launchpad" className="text-cy-300 hover:underline">
                DEVOXPAD Mainnet
              </a>
              .
            </p>
          </div>
        )}

        <div className="mb-5 flex flex-wrap items-center gap-2">
          <div className="flex rounded-xl border border-white/10 bg-white/[0.03] p-1">
            {SORTS.map((s) => (
              <button
                key={s.key}
                onClick={() => setSort(s.key)}
                className={
                  "rounded-lg px-3 py-1.5 text-[12px] font-medium transition " +
                  (sort === s.key ? "bg-white/[0.09] text-white" : "text-white/45 hover:text-white")
                }
              >
                {s.label}
              </button>
            ))}
          </div>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, ticker or address…"
            className="min-w-[220px] flex-1 rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2 text-[13px] outline-none transition placeholder:text-white/25 focus:border-devox-400/50"
          />
        </div>

        {tokens === null ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-44" />
            ))}
          </div>
        ) : tokens.length === 0 ? (
          <Empty
            title={q ? "Nothing matches that" : "No launches yet"}
            body={
              q
                ? "Try a different ticker, or clear the search."
                : "The curve is empty. Describe an idea to FORGE and it will ship a token before the conversation ends."
            }
            action={q ? undefined : { href: "/launch", label: "Launch the first token" }}
          />
        ) : (
          <>
            <div className="mb-3 flex items-center gap-2 text-[11px] text-white/30">
              <Badge tone="muted">{tokens.length} tokens</Badge>
              <span>updating live</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {tokens.map((t) => (
                <TokenCard key={t.address} t={t} />
              ))}
            </div>
          </>
        )}
      </Section>
    </div>
  );
}
