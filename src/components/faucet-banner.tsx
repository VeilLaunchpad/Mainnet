"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { Spinner } from "./busy";
import { useResult } from "./result-modal";

/**
 * The line under the header that gets someone funded.
 *
 * COTI's own faucet lives behind a Discord server, and asking a visitor to join
 * one before they can press a single button loses most of them. This claims in
 * place: connected wallet, one click, a transaction hash back.
 *
 * It disappears for good once an address has claimed, because a banner that
 * keeps asking after you have already said yes is just noise. Dismissal is kept
 * in this browser, so clearing site data brings it back.
 */

const DISMISS_KEY = "veil.faucet.dismissed.v1";

interface FaucetInfo {
  configured: boolean;
  amount: string;
  open: boolean;
  remaining: number;
  reason: string | null;
  you: { eligible: boolean; reason: string | null } | null;
}

export function FaucetBanner() {
  const { address, isConnected } = useAccount();
  const result = useResult();

  const [info, setInfo] = useState<FaucetInfo | null>(null);
  const [dismissed, setDismissed] = useState(true);
  const [claiming, setClaiming] = useState(false);

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(DISMISS_KEY) === "1");
    } catch {
      setDismissed(false);
    }
  }, []);

  const load = useCallback(() => {
    fetch("/api/faucet" + (address ? "?address=" + address : ""))
      .then((r) => r.json())
      .then(setInfo)
      .catch(() => setInfo(null));
  }, [address]);

  useEffect(() => {
    load();
  }, [load]);

  function close() {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* private mode: it stays closed for this visit only */
    }
  }

  async function claim() {
    if (!address) return;
    setClaiming(true);
    try {
      const res = await fetch("/api/faucet", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address }),
      });
      const j = (await res.json()) as { ok: boolean; txHash?: string; amount?: string; reason?: string };

      if (j.ok) {
        result.show({
          ok: true,
          title: j.amount + " COTI is on the way",
          detail: "Testnet COTI, sent from the VEILPAD treasury. It lands in a few seconds.",
          txHash: j.txHash,
        });
        // The offer is spent, so the banner has nothing left to say.
        close();
      } else {
        result.show({
          ok: false,
          title: "The faucet could not send",
          detail: j.reason,
          onRetry: claim,
        });
      }
      load();
    } catch (e) {
      result.show({
        ok: false,
        title: "The faucet could not send",
        detail: String((e as Error).message || e).slice(0, 180),
        onRetry: claim,
      });
    } finally {
      setClaiming(false);
    }
  }

  // Nothing to offer, or already taken: stay out of the way entirely.
  if (dismissed || !info?.configured) return null;
  if (info.you && !info.you.eligible) return null;

  return (
    <div className="relative border-b border-veil-400/20 bg-gradient-to-r from-veil-500/[0.14] via-cy-500/[0.08] to-transparent">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 pr-10 sm:px-6 sm:pr-12">
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-veil-500/25 text-[11px]">
          🚰
        </span>

        <p className="min-w-0 flex-1 text-[12.5px] leading-snug text-white/75">
          <span className="font-semibold text-white">VEILPAD runs on COTI testnet.</span>{" "}
          {info.open ? (
            <>
              Grab {info.amount} testnet COTI and launch something. No Discord, no forms.
            </>
          ) : (
            <>{info.reason}</>
          )}
        </p>

        {info.open && (
          <div className="flex shrink-0 items-center gap-2">
            {isConnected ? (
              <button
                onClick={claim}
                disabled={claiming}
                className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-veil-500 to-cy-500 px-3.5 py-1.5 text-[12px] font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
              >
                {claiming && <Spinner size={12} />}
                {claiming ? "Sending" : "Get " + info.amount + " COTI"}
              </button>
            ) : (
              <span className="text-[11px] text-white/45">Connect a wallet to claim</span>
            )}
            <Link
              href="/faucet"
              className="hidden text-[11px] font-medium text-cy-300 hover:underline sm:inline"
            >
              Faucet status
            </Link>
          </div>
        )}
      </div>

      <button
        onClick={close}
        aria-label="Dismiss"
        className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-white/35 transition hover:bg-white/10 hover:text-white sm:right-5"
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
          <path d="m4 4 8 8m0-8-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
