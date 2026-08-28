"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Section, Badge, Skeleton } from "@/components/ui";
import { explorerAddress } from "@/lib/chain";
import { useNetwork } from "@/components/network-provider";

/**
 * Every VEILPAD contract, with a way to go and read it.
 *
 * This used to be a cramped list in the dashboard sidebar showing "not set"
 * beside half its rows, which told a visitor nothing except that something was
 * missing. Contracts are the part of this app that anybody can verify without
 * trusting us, so they get their own page, their real names, what each one
 * does, and a link straight to the explorer.
 */

interface ContractInfo {
  address: string;
  deployed: boolean;
}

interface StatusPayload {
  contracts: Record<string, ContractInfo>;
}

/**
 * What each contract is for, in the order someone would meet them. Anything
 * without an entry here still renders, it just has no description yet, which
 * is better than hiding a deployed contract because a table was not updated.
 */
const CATALOGUE: Record<string, { name: string; role: string; group: string }> = {
  veilFactory: {
    name: "VeilPadFactory",
    role: "Deploys every launch: the token, its bonding curve, and the vanity address ending in 8888.",
    group: "Launchpad",
  },
  veilCurve: {
    name: "VeilCurve",
    role: "The bonding curve a token trades on until it graduates.",
    group: "Launchpad",
  },
  locker: {
    name: "VeilLocker",
    role: "Timelocks a creator's own tokens. No owner, no early release.",
    group: "Launchpad",
  },
  swapFactory: {
    name: "VeilSwapFactory",
    role: "Creates the pair a token graduates into.",
    group: "Trading",
  },
  swapRouter: {
    name: "VeilSwapRouter",
    role: "Routes swaps. Reserves are tracked internally because a private balance cannot be read.",
    group: "Trading",
  },
  wcoti: {
    name: "WrappedCOTI",
    role: "Wrapped COTI, so the native coin can be paired like any token.",
    group: "Trading",
  },
  portal: {
    name: "VeilPortal",
    role: "Wraps a public token into its encrypted twin, and back again.",
    group: "Privacy",
  },
  privateMessaging: {
    name: "PrivateMessaging",
    role: "COTI's own contract. Message bodies are ciphertext; routing is public.",
    group: "Privacy",
  },
  accountOnboard: {
    name: "AccountOnboard",
    role: "COTI's own contract. Registers the key that makes your encrypted balances readable to you.",
    group: "Privacy",
  },
  agentRegistry: {
    name: "AgentRegistry",
    role: "On-chain record of tokenized agents.",
    group: "Agents",
  },
  profileRegistry: {
    name: "ProfileRegistry",
    role: "Claims a handle to an address.",
    group: "Agents",
  },
};

const GROUP_ORDER = ["Launchpad", "Trading", "Privacy", "Agents", "Other"];

export default function ContractsPage() {
  const { net, chain } = useNetwork();
  const [data, setData] = useState<StatusPayload | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/stats")
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData(null));
  }, []);

  // Only what is actually on chain. A row reading "not set" is an internal
  // note, not information a visitor can use.
  const live = Object.entries(data?.contracts ?? {}).filter(([, v]) => v.deployed);

  const grouped = GROUP_ORDER.map((group) => ({
    group,
    items: live.filter(([key]) => (CATALOGUE[key]?.group ?? "Other") === group),
  })).filter((g) => g.items.length > 0);

  async function copy(address: string) {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(address);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      /* clipboard blocked; the explorer link still works */
    }
  }

  return (
    <div className="py-10">
      <div className="mx-auto max-w-[1400px] px-4 text-center sm:px-6">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          VEILPAD <span className="text-grad">Contracts</span>
        </h1>
        <p className="mx-auto mt-3 max-w-2xl text-[15px] text-white/55">
          Everything this app is wired to on {chain.name}. Open any of them on CotiScan and
          read the source yourself.
        </p>
      </div>

      <Section className="mt-9">
        {!data ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-40" />
            ))}
          </div>
        ) : live.length === 0 ? (
          <div className="card px-6 py-16 text-center">
            <h3 className="text-[15px] font-semibold">Nothing is configured on this network</h3>
            <p className="mt-1.5 text-[13px] text-white/45">
              No contract addresses are set for {chain.name}.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {grouped.map(({ group, items }) => (
              <div key={group}>
                <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-veil-400">
                  {group}
                </h2>

                <div className="grid gap-2 lg:grid-cols-2">
                  {items.map(([key, v]) => {
                    const meta = CATALOGUE[key];
                    return (
                      <div key={key} className="card p-4">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-[14px] font-semibold">{meta?.name ?? key}</div>
                            <div className="mono text-[10px] text-white/30">{key}</div>
                          </div>
                          <Badge tone="mint">live</Badge>
                        </div>

                        {meta?.role && (
                          <p className="mt-2 text-[12px] leading-relaxed text-white/45">{meta.role}</p>
                        )}

                        <div className="mono mt-3 flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.02] px-2.5 py-2">
                          <span className="min-w-0 flex-1 truncate text-[11px] text-white/60">
                            {v.address}
                          </span>
                          <button
                            onClick={() => copy(v.address)}
                            className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-white/40 transition hover:bg-white/10 hover:text-white"
                          >
                            {copied === v.address ? "copied" : "copy"}
                          </button>
                        </div>

                        <a
                          href={explorerAddress(v.address, net)}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-2 flex items-center justify-center gap-1.5 rounded-lg border border-white/10 py-2 text-[12px] font-semibold text-white/70 transition hover:border-cy-400/45 hover:text-cy-300"
                        >
                          View on CotiScan
                          <span className="text-[10px]">↗</span>
                        </a>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="card mt-4 p-5">
          <h3 className="text-[13px] font-semibold">Why this page exists</h3>
          <p className="mt-1.5 max-w-3xl text-[12px] leading-relaxed text-white/45">
            A privacy app asks for more trust than most, so the parts that can be checked should be
            easy to check. Every contract here is verified on CotiScan with its source, which means
            you can read what it does rather than take our description of it.
          </p>
          <div className="mt-3 flex flex-wrap gap-3 text-[12px]">
            <Link href="/docs/overview" className="text-cy-300 hover:underline">
              How it fits together
            </Link>
            <Link href="/status" className="text-cy-300 hover:underline">
              Live network status
            </Link>
          </div>
        </div>
      </Section>
    </div>
  );
}
