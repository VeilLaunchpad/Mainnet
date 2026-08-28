"use client";

import { useEffect, useRef, useState } from "react";
import { useAccount, useSwitchChain } from "wagmi";
import { useNetwork } from "./network-provider";
import {
  NETWORKS,
  NETWORK_BLURB,
  NETWORK_HOST,
  NETWORK_LABEL,
  chainByNetwork,
  type CotiNetworkName,
} from "@/lib/chain";
import { Spinner } from "./busy";

/**
 * Switching between VEILPAD Mainnet and VEILPAD Testnet.
 *
 * The app half of the switch is instant: context changes, contracts change,
 * every page re-reads. The wallet half is a request, because only the wallet
 * can decide to move chains, and it may refuse or ask first.
 *
 * Those two are deliberately not tied together. If the wallet switch fails the
 * app still moves, and the connect button goes on to show the mismatch and
 * offer the switch again - which is better than silently staying on a network
 * the person just told us to leave.
 */
export function NetworkSwitch() {
  const { net, setNet, pinned } = useNetwork();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<CotiNetworkName | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const { isConnected } = useAccount();
  const { switchChainAsync } = useSwitchChain();

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function choose(next: CotiNetworkName) {
    if (next === net) return setOpen(false);
    setBusy(next);

    /**
     * On a host that names a network, switching is a change of address rather
     * than a change of cookie. Setting a preference here would leave the URL
     * saying one thing and the page doing another, so it goes to the other host
     * and carries the current path across.
     */
    if (pinned) {
      const path = window.location.pathname + window.location.search;
      window.location.href = NETWORK_HOST[next] + path;
      return;
    }

    setNet(next);

    if (isConnected) {
      // A wallet that has never seen COTI will be asked to add it. Refusing is
      // a normal answer, so the failure is swallowed rather than surfaced as an
      // error the person did not cause.
      await switchChainAsync({ chainId: chainByNetwork[next].id }).catch(() => undefined);
    }

    /**
     * Then reload, rather than re-rendering in place.
     *
     * The network reaches the server as a cookie, and roughly twenty pages
     * fetch their own data directly rather than through a shared cache. Moving
     * the context alone would leave every one of those holding the previous
     * chain's launches, balances and quotes until something happened to
     * refetch them - and a stale balance next to a fresh network label is the
     * kind of wrong that gets someone to sign a transaction they did not mean.
     *
     * A reload makes the whole page, server and client, agree in one step.
     */
    window.location.reload();
  }

  const live = net === "mainnet";

  return (
    <div ref={box} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={NETWORK_LABEL[net]}
        className="flex items-center gap-1.5 rounded-lg border border-white/10 px-2 py-1.5 text-[11px] font-semibold transition hover:border-white/20 hover:bg-white/[0.05]"
      >
        <span
          className={
            "size-1.5 shrink-0 rounded-full " +
            (live ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.9)]" : "bg-amber-400")
          }
        />
        <span className={live ? "text-white/80" : "text-amber-200/90"}>
          {live ? "Mainnet" : "Testnet"}
        </span>
        <svg width="8" height="8" viewBox="0 0 10 10" fill="none" className="text-white/35">
          <path d="m2 4 3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <div
          role="listbox"
          className="animate-rise absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-xl border border-white/12 bg-ink-900 shadow-2xl shadow-black/70"
        >
          {NETWORKS.map((n) => {
            const selected = n === net;
            return (
              <button
                key={n}
                role="option"
                aria-selected={selected}
                onClick={() => choose(n)}
                disabled={busy !== null}
                className={
                  "flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition disabled:opacity-60 " +
                  (selected ? "bg-white/[0.06]" : "hover:bg-white/[0.04]")
                }
              >
                <span
                  className={
                    "mt-1 size-1.5 shrink-0 rounded-full " +
                    (n === "mainnet" ? "bg-emerald-400" : "bg-amber-400")
                  }
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-[12.5px] font-semibold">{NETWORK_LABEL[n]}</span>
                  <span className="block text-[11px] leading-relaxed text-white/45">
                    {NETWORK_BLURB[n]}
                  </span>
                </span>
                {busy === n ? (
                  <Spinner size={12} />
                ) : selected ? (
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="mt-1 text-veil-300">
                    <path d="m2.5 6.5 2.5 2.5 4.5-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : null}
              </button>
            );
          })}
          <p className="border-t border-white/[0.06] px-3 py-2 text-[10.5px] leading-relaxed text-white/35">
            Each network has its own contracts, launches and balances. Nothing
            crosses between them.
            {pinned && " This address is pinned, so switching moves you to the other one."}
          </p>
        </div>
      )}
    </div>
  );
}
