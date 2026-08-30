"use client";

import { useEffect, useMemo, useState } from "react";
import { useConnect, type Connector } from "wagmi";
import { Spinner } from "./busy";
import { Portal, useLockScroll } from "./portal";

/**
 * Choosing which wallet to connect with.
 *
 * wagmi discovers installed wallets through EIP-6963, where each extension
 * announces itself with a name and an icon instead of fighting over
 * `window.ethereum`. That is why this lists what someone actually has rather
 * than assuming MetaMask: with three wallets installed, the old single button
 * connected to whichever one won the race, which is not a choice anybody made.
 *
 * When nothing is installed the same panel becomes an explanation and a short
 * list of wallets that work with COTI, because "Connect wallet" doing nothing
 * is the worst possible answer.
 */

/** Wallets that work on any EVM chain, so they work on COTI. */
const SUGGESTED = [
  {
    name: "MetaMask",
    url: "https://metamask.io/download",
    blurb: "The one most guides assume. Browser extension and mobile.",
  },
  {
    name: "Rabby",
    url: "https://rabby.io",
    blurb: "Built for many chains at once, and shows what a transaction will do before you sign.",
  },
  {
    name: "Coinbase Wallet",
    url: "https://www.coinbase.com/wallet/downloads",
    blurb: "Extension and mobile, with a straightforward setup.",
  },
];

export function WalletPicker({ onClose }: { onClose: () => void }) {
  const { connect, connectors, isPending, error } = useConnect();
  const [pendingId, setPendingId] = useState<string | null>(null);

  useLockScroll(true);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  /**
   * `injected` is wagmi's generic fallback and duplicates whichever announced
   * wallet the browser happens to expose, so it is dropped whenever a real
   * announcement exists. Otherwise the same extension appears twice, once with
   * its own name and once as "Injected".
   */
  const wallets = useMemo(() => {
    const announced = connectors.filter((c) => c.type === "injected" && c.id !== "injected");
    if (announced.length > 0) return announced;
    return connectors.filter((c) => c.id === "injected");
  }, [connectors]);

  const hasWallet = wallets.length > 0;

  async function pick(connector: Connector) {
    setPendingId(connector.uid);
    try {
      await connect({ connector });
      onClose();
    } finally {
      setPendingId(null);
    }
  }

  return (
    <Portal>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Choose a wallet"
        onClick={onClose}
        className="fixed inset-0 z-[95] grid place-items-center overflow-y-auto bg-ink-950/75 p-4 backdrop-blur-md"
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="animate-rise my-auto w-full max-w-md overflow-hidden rounded-2xl border border-white/12 bg-ink-900 shadow-2xl shadow-black/70"
        >
          <div className="flex items-start justify-between border-b border-white/[0.07] px-5 py-4">
            <div>
              <h2 className="text-[15px] font-semibold">
                {hasWallet ? "Choose a wallet" : "You will need an EVM wallet"}
              </h2>
              <p className="mt-0.5 text-[12px] text-white/45">
                {hasWallet
                  ? "These are the wallets installed in this browser."
                  : "COTI is an EVM chain, so any Ethereum wallet works here."}
              </p>
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              className="rounded-md p-1 text-white/35 transition hover:bg-white/10 hover:text-white"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="m4 4 8 8m0-8-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          <div className="space-y-1.5 p-3">
            {hasWallet
              ? wallets.map((c) => (
                  <button
                    key={c.uid}
                    onClick={() => pick(c)}
                    disabled={isPending}
                    className="flex w-full items-center gap-3 rounded-xl border border-white/[0.07] px-3.5 py-3 text-left transition hover:border-devox-400/45 hover:bg-white/[0.04] disabled:opacity-50"
                  >
                    <WalletIcon icon={c.icon} name={c.name} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-semibold">{c.name}</span>
                      <span className="block text-[11px] text-white/35">Installed</span>
                    </span>
                    {pendingId === c.uid ? (
                      <Spinner size={15} />
                    ) : (
                      <span className="text-[12px] text-white/25">→</span>
                    )}
                  </button>
                ))
              : SUGGESTED.map((w) => (
                  <a
                    key={w.name}
                    href={w.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-start gap-3 rounded-xl border border-white/[0.07] px-3.5 py-3 transition hover:border-cy-400/45 hover:bg-white/[0.04]"
                  >
                    <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-[13px] font-bold text-white/60">
                      {w.name[0]}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px] font-semibold">{w.name}</span>
                      <span className="block text-[11px] leading-relaxed text-white/40">{w.blurb}</span>
                    </span>
                    <span className="mt-1 shrink-0 text-[12px] text-cy-300">Get it ↗</span>
                  </a>
                ))}
          </div>

          {error && (
            <p className="px-5 pb-3 text-[12px] leading-relaxed text-rose-300">
              {/^User rejected|denied/i.test(error.message)
                ? "You closed the wallet before approving."
                : error.message.slice(0, 180)}
            </p>
          )}

          <p className="border-t border-white/[0.06] px-5 py-3 text-[11px] leading-relaxed text-white/30">
            {hasWallet
              ? "DEVOXPAD never sees your key. It asks your wallet to sign, and your wallet decides."
              : "Install one, refresh this page, and it will appear here. Then the faucet can fund it."}
          </p>
        </div>
      </div>
    </Portal>
  );
}

/** EIP-6963 ships a data URI icon per wallet; the initial is the fallback. */
function WalletIcon({ icon, name }: { icon?: string; name: string }) {
  if (icon) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={icon} alt="" className="size-8 shrink-0 rounded-lg object-contain" />;
  }
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-devox-500/20 text-[13px] font-bold text-devox-300">
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}
