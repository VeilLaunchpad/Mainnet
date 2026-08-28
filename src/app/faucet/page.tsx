"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { Section, Stat, Badge, Skeleton } from "@/components/ui";
import { Spinner } from "@/components/busy";
import { useResult } from "@/components/result-modal";
import { explorerTx, explorerAddress } from "@/lib/chain";
import { useNetwork } from "@/components/network-provider";
import { fmtNum, shortAddr, timeAgo } from "@/lib/format";

interface FaucetInfo {
  configured: boolean;
  amount: string;
  cooldownHours: number;
  treasury: string | null;
  balance: string;
  remaining: number;
  open: boolean;
  reason: string | null;
  claimedTotal: number;
  you: { eligible: boolean; reason: string | null; nextAt: number | null; lastTx: string | null } | null;
  recent: { address: string; amount: string; txHash: string; at: number }[];
}

/**
 * The faucet, and an honest account of what is behind it.
 *
 * A faucet is somebody else's wallet paying for your test, so the page shows
 * the balance, what is left and where it came from rather than presenting an
 * infinite tap. When it runs dry it says so and points at COTI's own faucet
 * instead of failing silently.
 */
export default function FaucetPage() {
  const { net, chain } = useNetwork();
  const { address, isConnected } = useAccount();
  const result = useResult();

  const [info, setInfo] = useState<FaucetInfo | null>(null);
  const [claiming, setClaiming] = useState(false);

  const load = useCallback(() => {
    fetch("/api/faucet" + (address ? "?address=" + address : ""))
      .then((r) => r.json())
      .then(setInfo)
      .catch(() => setInfo(null));
  }, [address]);

  useEffect(() => {
    load();
    const t = setInterval(load, 20_000);
    return () => clearInterval(t);
  }, [load]);

  async function claim() {
    if (!address) return;
    setClaiming(true);
    try {
      const res = await fetch("/api/faucet", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address }),
      });
      const j = (await res.json()) as {
        ok: boolean;
        txHash?: string;
        amount?: string;
        reason?: string;
      };

      result.show(
        j.ok
          ? {
              ok: true,
              title: j.amount + " COTI sent",
              detail: "It lands in a few seconds. Go and launch something.",
              txHash: j.txHash,
            }
          : {
              ok: false,
              title: "The faucet could not send",
              detail: j.reason,
              onRetry: claim,
            },
      );
      load();
    } finally {
      setClaiming(false);
    }
  }

  const canClaim = isConnected && info?.open && info?.you?.eligible !== false && !claiming;

  return (
    <div className="py-10">
      <div className="mx-auto max-w-[1400px] px-4 text-center sm:px-6">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          Testnet <span className="text-grad">Faucet</span>
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-[15px] text-white/55">
          Enough COTI to launch a token, trade it and message someone about it. No Discord, no forms.
        </p>
      </div>

      <Section className="mt-9">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_360px]">
          {/* ---------------- claim ---------------- */}
          <div className="card p-6">
            {!info ? (
              <Skeleton className="h-56" />
            ) : !info.configured ? (
              <Closed reason={info.reason} />
            ) : (
              <>
                <div className="flex items-baseline gap-2">
                  <span className="text-5xl font-bold tracking-tight text-grad">{info.amount}</span>
                  <span className="text-lg font-semibold text-white/55">COTI</span>
                </div>
                <p className="mt-1.5 text-[13px] text-white/45">
                  per claim, once every {info.cooldownHours} hours per address
                </p>

                <div className="mt-5 rounded-xl border border-white/10 bg-white/[0.02] p-4">
                  <div className="text-[12px] font-semibold text-white/70">
                    What {info.amount} COTI actually buys you
                  </div>
                  <ul className="mt-2 space-y-1.5 text-[12px] text-white/50">
                    <Cost label="Launch a token" value="0.01 COTI fee" />
                    <Cost label="A dev buy worth making" value="~0.05 COTI" />
                    <Cost label="A few trades on the curve" value="~0.05 COTI" />
                    <Cost label="Gas for around twenty transactions" value="~0.004 COTI" />
                  </ul>
                  <p className="mt-2.5 border-t border-white/[0.06] pt-2 text-[11px] leading-relaxed text-white/30">
                    So one claim is roughly two full sessions. The privacy bridge is out of reach on
                    purpose: its fee floor is 10 COTI, which no faucet this size can cover.
                  </p>
                </div>

                {info.you && !info.you.eligible && (
                  <p className="mt-4 rounded-xl border border-amber-400/25 bg-amber-400/[0.06] px-3.5 py-2.5 text-[12px] text-amber-200/85">
                    {info.you.reason}
                    {info.you.lastTx && (
                      <>
                        {" "}
                        <a
                          href={explorerTx(info.you.lastTx, net)}
                          target="_blank"
                          rel="noreferrer"
                          className="underline hover:text-white"
                        >
                          See the last one
                        </a>
                      </>
                    )}
                  </p>
                )}

                {!info.open && <p className="mt-4 text-[12px] text-amber-200/85">{info.reason}</p>}

                <button
                  onClick={claim}
                  disabled={!canClaim}
                  className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-veil-500 to-cy-500 py-3.5 text-[14px] font-semibold text-white transition hover:brightness-110 disabled:opacity-40"
                >
                  {claiming && <Spinner size={15} />}
                  {!isConnected
                    ? "Connect a wallet"
                    : claiming
                      ? "Sending"
                      : info.you && !info.you.eligible
                        ? "Already claimed"
                        : "Send me " + info.amount + " COTI"}
                </button>

                <p className="mt-3 text-center text-[11px] text-white/30">
                  Sent from the VEILPAD treasury on {chain.name}. Testnet COTI has no value.
                </p>
              </>
            )}
          </div>

          {/* ---------------- status ---------------- */}
          <div className="space-y-3">
            <div className="card p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-[13px] font-semibold">Faucet status</h2>
                {info && (
                  <Badge tone={info.open ? "mint" : "amber"}>{info.open ? "open" : "dry"}</Badge>
                )}
              </div>

              {!info ? (
                <Skeleton className="mt-3 h-24" />
              ) : (
                <>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <Stat
                      label="Treasury"
                      value={fmtNum(info.balance, 3) + " COTI"}
                      sub="what is left to give"
                    />
                    <Stat
                      label="Claims left"
                      value={info.remaining}
                      sub={"at " + info.amount + " each"}
                    />
                  </div>

                  <dl className="mt-3 space-y-1.5 text-[11px]">
                    <Row k="Given out" v={info.claimedTotal + " claims"} />
                    <Row k="Cooldown" v={info.cooldownHours + "h per address"} />
                  </dl>

                  {info.treasury && (
                    <a
                      href={explorerAddress(info.treasury, net)}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-3 flex items-center justify-between rounded-lg border border-white/[0.08] px-2.5 py-2 text-[11px] transition hover:border-cy-400/40"
                    >
                      <span className="text-white/35">Treasury wallet</span>
                      <span className="mono text-cy-300">{shortAddr(info.treasury, 6)}</span>
                    </a>
                  )}
                </>
              )}
            </div>

            <div className="card p-4">
              <h3 className="text-[13px] font-semibold">Recent claims</h3>
              {!info ? (
                <Skeleton className="mt-3 h-24" />
              ) : info.recent.length === 0 ? (
                <p className="py-8 text-center text-[12px] text-white/30">Nobody yet. Be first.</p>
              ) : (
                <div className="mt-2 divide-y divide-white/[0.05]">
                  {info.recent.map((c) => (
                    <a
                      key={c.txHash}
                      href={explorerTx(c.txHash, net)}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-between py-2 text-[11px] transition hover:text-white"
                    >
                      <span className="mono text-white/55">{shortAddr(c.address, 5)}</span>
                      <span className="text-white/35">
                        {c.amount} COTI · {timeAgo(c.at)}
                      </span>
                    </a>
                  ))}
                </div>
              )}
            </div>

            <div className="card p-4">
              <h3 className="text-[13px] font-semibold">If this runs dry</h3>
              <p className="mt-1.5 text-[12px] leading-relaxed text-white/45">
                COTI runs its own faucet through their Discord, which does not have a treasury cap.
                This one exists so you can try VEILPAD without leaving the tab first.
              </p>
              <Link
                href="/launch"
                className="mt-2.5 inline-block text-[12px] text-cy-300 hover:underline"
              >
                Already funded? Launch something
              </Link>
            </div>
          </div>
        </div>
      </Section>
    </div>
  );
}

function Cost({ label, value }: { label: string; value: string }) {
  return (
    <li className="flex items-baseline justify-between gap-3">
      <span>{label}</span>
      <span className="mono shrink-0 text-white/35">{value}</span>
    </li>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-white/35">{k}</dt>
      <dd className="mono text-white/60">{v}</dd>
    </div>
  );
}

function Closed({ reason }: { reason: string | null }) {
  return (
    <div className="py-12 text-center">
      <h3 className="text-[15px] font-semibold">The faucet is not running here</h3>
      <p className="mx-auto mt-2 max-w-sm text-[13px] leading-relaxed text-white/45">
        {reason ?? "No treasury key is configured on this deployment."}
      </p>
    </div>
  );
}
