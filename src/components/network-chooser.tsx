"use client";

import { useState } from "react";
import { useAccount, useSwitchChain } from "wagmi";
import { Portal, useLockScroll } from "./portal";
import { useNetwork } from "./network-provider";
import { Spinner } from "./busy";
import {
  NETWORKS,
  NETWORK_BLURB,
  NETWORK_HOST,
  NETWORK_LABEL,
  chainByNetwork,
  type CotiNetworkName,
} from "@/lib/chain";

/**
 * The first question, asked once.
 *
 * Somebody arriving at the apex has not said which chain they mean, and the two
 * are not interchangeable: one settles for real value and one does not. Picking
 * silently would be the wrong kind of convenient, so this asks - and then never
 * asks again, because the answer is remembered.
 *
 * It does not appear on a per-network host. There the hostname already answered,
 * and asking again would suggest the URL was a suggestion rather than a promise.
 */
export function NetworkChooser() {
  const { needsChoice, pinned, choose } = useNetwork();
  const [busy, setBusy] = useState<CotiNetworkName | null>(null);

  const open = needsChoice && !pinned;
  useLockScroll(open);

  const { isConnected } = useAccount();
  const { switchChainAsync } = useSwitchChain();

  if (!open) return null;

  async function pick(net: CotiNetworkName) {
    setBusy(net);
    choose(net);

    if (isConnected) {
      // Refusing is a normal answer. The app has already moved, and the
      // mismatch banner will offer the wallet switch again.
      await switchChainAsync({ chainId: chainByNetwork[net].id }).catch(() => undefined);
    }
    setBusy(null);
  }

  return (
    <Portal>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Choose a network"
        className="fixed inset-0 z-[96] grid place-items-center overflow-y-auto bg-ink-950/80 p-4 backdrop-blur-md"
      >
        <div className="animate-rise my-auto w-full max-w-lg overflow-hidden rounded-2xl border border-white/12 bg-ink-900 shadow-2xl shadow-black/70">
          <div className="border-b border-white/[0.07] px-5 py-4">
            <h2 className="text-[16px] font-semibold">Which VEILPAD?</h2>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-white/45">
              The same app runs on both COTI networks. They share nothing: separate
              contracts, separate launches, separate balances.
            </p>
          </div>

          <div className="space-y-2 p-3">
            {NETWORKS.map((n) => {
              const chain = chainByNetwork[n];
              const live = n === "mainnet";
              return (
                <button
                  key={n}
                  onClick={() => pick(n)}
                  disabled={busy !== null}
                  className={
                    "flex w-full items-start gap-3 rounded-xl border px-4 py-3.5 text-left transition disabled:opacity-60 " +
                    (live
                      ? "border-emerald-400/25 bg-emerald-400/[0.04] hover:border-emerald-400/50"
                      : "border-white/[0.08] hover:border-amber-400/40 hover:bg-white/[0.03]")
                  }
                >
                  <span
                    className={
                      "mt-1.5 size-2 shrink-0 rounded-full " +
                      (live ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]" : "bg-amber-400")
                    }
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="text-[14.5px] font-semibold">{NETWORK_LABEL[n]}</span>
                      {live && (
                        <span className="rounded-md bg-emerald-400/15 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider text-emerald-300">
                          real funds
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block text-[12px] leading-relaxed text-white/45">
                      {NETWORK_BLURB[n]}
                    </span>
                    <span className="mono mt-1 block text-[10.5px] text-white/25">
                      chain {chain.id} · {NETWORK_HOST[n].replace("https://", "")}
                    </span>
                  </span>
                  {busy === n ? (
                    <Spinner size={14} />
                  ) : (
                    <span className="mt-1 text-[13px] text-white/25">→</span>
                  )}
                </button>
              );
            })}
          </div>

          <p className="border-t border-white/[0.06] px-5 py-3 text-[11px] leading-relaxed text-white/35">
            Remembered from here on, and changeable any time from the switch in the header.
            Those two addresses are pinned to one network each, so a link to either
            means the same thing for whoever opens it.
          </p>
        </div>
      </div>
    </Portal>
  );
}
