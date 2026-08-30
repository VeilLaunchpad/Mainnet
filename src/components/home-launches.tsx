"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Section, Skeleton, Empty } from "./ui";
import { TokenCard, type TokenSummary } from "./token-card";

export function HomeLaunches() {
  const [tokens, setTokens] = useState<TokenSummary[] | null>(null);

  useEffect(() => {
    fetch("/api/tokens?limit=6")
      .then((r) => r.json())
      .then((j) => setTokens(j.tokens || []))
      .catch(() => setTokens([]));
  }, []);

  return (
    <Section
      className="py-4"
      kicker="Launchpad"
      title="Fresh off the curve"
      sub="Every launch starts on a bonding curve and graduates into a DevoxSwap pair."
      right={
        <Link href="/launchpad" className="text-[13px] font-semibold text-white/50 transition hover:text-white">
          See all →
        </Link>
      }
    >
      {tokens === null ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-44" />
          ))}
        </div>
      ) : tokens.length === 0 ? (
        <Empty
          title="Nothing launched yet"
          body="Be the first. Describe an idea to FORGE and it will ship the token before the conversation ends."
          action={{ href: "/launch", label: "Launch the first token" }}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {tokens.map((t) => (
            <TokenCard key={t.address} t={t} />
          ))}
        </div>
      )}
    </Section>
  );
}
