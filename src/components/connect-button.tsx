"use client";

import { useAccount, useConnect, useDisconnect, useBalance, useChainId, useSwitchChain } from "wagmi";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { shortAddr, fmtNum } from "@/lib/format";
import { useNetwork } from "./network-provider";
import { WalletPicker } from "./wallet-picker";

export function ConnectButton() {
  const { chain } = useNetwork();
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const { data: bal } = useBalance({ address, query: { enabled: !!address, refetchInterval: 20_000 } });

  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [handle, setHandle] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  useEffect(() => {
    if (!address) return setHandle(null);
    fetch("/api/profile?address=" + address)
      .then((r) => r.json())
      .then((j) => setHandle(j?.profile?.username || null))
      .catch(() => setHandle(null));
  }, [address]);

  const wrongChain = isConnected && chainId !== chain.id;

  if (!isConnected) {
    // The picker decides which wallet, because with several installed there is
    // a real choice to make and picking one silently is not making it.
    return (
      <>
        <button
          onClick={() => setPicking(true)}
          disabled={isPending}
          className="rounded-xl bg-gradient-to-r from-devox-500 to-cy-500 px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
        >
          {isPending ? "Connecting…" : "Connect wallet"}
        </button>
        {picking && <WalletPicker onClose={() => setPicking(false)} />}
      </>
    );
  }

  if (wrongChain) {
    return (
      <button
        onClick={() => switchChain({ chainId: chain.id })}
        className="rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 py-2 text-sm font-semibold text-amber-300 transition hover:bg-amber-400/20"
      >
        Switch to {chain.name}
      </button>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm transition hover:border-devox-400/50"
      >
        <span className="size-2 rounded-full bg-mint-400 shadow-[0_0_8px] shadow-mint-400/70" />
        <span className="mono text-xs text-white/90">
          {handle ? "@" + handle : shortAddr(address)}
        </span>
        <span className="hidden text-xs text-white/45 sm:inline">
          {bal ? fmtNum(Number(bal.formatted), 3) + " COTI" : "-"}
        </span>
      </button>

      {open && (
        <div className="animate-rise absolute right-0 z-50 mt-2 w-60 overflow-hidden rounded-2xl border border-white/10 bg-ink-900/95 p-1.5 backdrop-blur-xl">
          <div className="border-b border-white/5 px-3 py-2.5">
            <div className="mono text-[11px] text-white/45">{shortAddr(address, 8)}</div>
            <div className="mt-0.5 text-sm font-semibold">
              {bal ? fmtNum(Number(bal.formatted), 4) : "0"} COTI
            </div>
          </div>
          <Link
            href={handle ? "/profile/" + handle : "/profile/setup"}
            onClick={() => setOpen(false)}
            className="block rounded-lg px-3 py-2 text-sm text-white/80 transition hover:bg-white/5"
          >
            {handle ? "My profile" : "Claim a handle"}
          </Link>
          <Link
            href="/dashboard?tab=wallet"
            onClick={() => setOpen(false)}
            className="block rounded-lg px-3 py-2 text-sm text-white/80 transition hover:bg-white/5"
          >
            Wallet
          </Link>
          <Link
            href="/dashboard"
            onClick={() => setOpen(false)}
            className="block rounded-lg px-3 py-2 text-sm text-white/80 transition hover:bg-white/5"
          >
            Dashboard
          </Link>
          <a
            href={chain.blockExplorers.default.url + "/address/" + address}
            target="_blank"
            rel="noreferrer"
            className="block rounded-lg px-3 py-2 text-sm text-white/80 transition hover:bg-white/5"
          >
            View on CotiScan ↗
          </a>
          <button
            onClick={() => {
              disconnect();
              setOpen(false);
            }}
            className="block w-full rounded-lg px-3 py-2 text-left text-sm text-rose-400 transition hover:bg-rose-400/10"
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
