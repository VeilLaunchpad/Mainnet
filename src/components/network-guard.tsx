"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useAccount, useChainId, useSwitchChain } from "wagmi";
import { ethChainFor, type CotiChain } from "@/lib/chain";
import { useNetwork } from "./network-provider";
import { Badge } from "./ui";
import { Spinner, useBusy } from "./busy";

/**
 * What to do when a connected wallet is on the wrong chain.
 *
 * Every write would revert and the error a wallet shows for that is
 * unreadable, so this is modal by default. It is not a trap though: someone
 * who only wants to read the launchpad can put it away, and a small bar stays
 * behind so the offer is one click from returning.
 *
 * Two different jobs get two different buttons, because they are not the same
 * request. Switching moves this session onto COTI. Importing writes the
 * network into the extension so it is there tomorrow, in any tab, whether or
 * not they switch now.
 */

const DISMISS_KEY = "veil.network.dismissed";

interface Eip1193 {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}

const chainParams = (chain: CotiChain) => ({
  chainId: "0x" + chain.id.toString(16),
  chainName: chain.name,
  nativeCurrency: chain.nativeCurrency,
  rpcUrls: [...chain.rpcUrls.default.http],
  blockExplorerUrls: [chain.blockExplorers.default.url],
});

export function NetworkGuard() {
  const { net, chain } = useNetwork();
  const ethChain = ethChainFor(net);
  const { isConnected, connector } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const { run } = useBusy();

  const [mounted, setMounted] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [imported, setImported] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      setDismissed(sessionStorage.getItem(DISMISS_KEY) === "1");
    } catch {
      /* private mode */
    }
  }, []);

  /**
   * The bridge is the one place where being on Ethereum is correct rather
   * than a mistake: its outbound leg is signed there. Blocking it would make
   * the crossing impossible from inside VEILPAD, which is the whole point.
   */
  const pathname = usePathname();
  const ethIsFine = pathname?.startsWith("/bridge") && chainId === ethChain.id;

  const wrong = mounted && isConnected && chainId !== chain.id && !ethIsFine;

  // Getting onto the right chain retires the reminder entirely.
  useEffect(() => {
    if (!wrong && dismissed) {
      setDismissed(false);
      try {
        sessionStorage.removeItem(DISMISS_KEY);
      } catch {
        /* private mode */
      }
    }
  }, [wrong, dismissed]);

  /**
   * Prefer the connector's own provider. With several wallets installed
   * `window.ethereum` is whichever one won the race, which may not be the one
   * the user actually connected with.
   */
  const provider = useCallback(async (): Promise<Eip1193> => {
    const fromConnector = (await connector?.getProvider?.()) as Eip1193 | undefined;
    const injected = (globalThis as { ethereum?: Eip1193 }).ethereum;
    const p = fromConnector ?? injected;
    if (!p?.request) throw new Error("No injected wallet found.");
    return p;
  }, [connector]);

  /** Save the network in the extension, without demanding a switch. */
  const importNetwork = useCallback(async () => {
    setErr(null);
    try {
      await run("Adding COTI to your wallet", async () => {
        const p = await provider();
        await p.request({ method: "wallet_addEthereumChain", params: [chainParams(chain)] });
      });
      setImported(true);
    } catch (e) {
      setErr(message(e));
    }
  }, [provider, run, chain]);

  /**
   * `wallet_switchEthereumChain` answers 4902 when the wallet has never heard
   * of the chain, so add it and let that same call do the switching.
   */
  const addAndSwitch = useCallback(async () => {
    setErr(null);
    try {
      await run("Switching to " + chain.name, async () => {
        const p = await provider();
        const hexId = "0x" + chain.id.toString(16);
        try {
          await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
        } catch (switchError) {
          const code = (switchError as { code?: number })?.code;
          // 4001 is the user declining. That is an answer, not a cue to add.
          if (code === 4001) throw switchError;
          if (code !== 4902 && code !== -32603) throw switchError;
          await p.request({ method: "wallet_addEthereumChain", params: [chainParams(chain)] });
        }
      });
    } catch (e) {
      // Some wallets ignore raw requests but honour wagmi's own path.
      try {
        switchChain({ chainId: chain.id });
      } catch {
        setErr(message(e));
      }
    }
  }, [provider, run, switchChain, chain]);

  function later() {
    setDismissed(true);
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* private mode */
    }
  }

  if (!wrong) return null;

  if (dismissed) {
    return (
      <button
        onClick={() => setDismissed(false)}
        className="fixed bottom-4 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-2.5 rounded-full border border-amber-400/30 bg-ink-900/95 px-4 py-2.5 text-[12px] shadow-2xl backdrop-blur transition hover:border-amber-400/60"
      >
        <span className="size-2 shrink-0 animate-pulse rounded-full bg-amber-400" />
        <span className="text-white/70">
          Wallet is on chain {chainId}, not {chain.name}
        </span>
        <span className="font-semibold text-amber-300">Fix</span>
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="animate-rise w-full max-w-md overflow-hidden rounded-2xl border border-amber-400/25 bg-ink-900 shadow-2xl">
        <div className="flex items-center gap-3 border-b border-white/[0.07] px-5 py-4">
          <span className="flex size-9 items-center justify-center rounded-full bg-amber-400/15 text-amber-400">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M9 1.6 16.6 15H1.4L9 1.6Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
              <path d="M9 6.6v3.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              <circle cx="9" cy="12.6" r="0.9" fill="currentColor" />
            </svg>
          </span>
          <div>
            <h2 className="text-[15px] font-semibold">Wrong network</h2>
            <p className="text-[12px] text-white/45">
              Your wallet is on chain {chainId}. VEILPAD runs on {chain.name}.
            </p>
          </div>
        </div>

        <div className="px-5 py-4">
          <p className="text-[13px] leading-relaxed text-white/55">
            Nothing here can read your balances or send a transaction from another chain. Switching
            takes one click, and the network is added with our RPC if your wallet has never seen
            COTI before.
          </p>

          <dl className="mt-4 divide-y divide-white/[0.05] rounded-xl border border-white/[0.08]">
            <Row k="Network" v={chain.name} />
            <Row k="Chain ID" v={String(chain.id)} />
            <Row k="Currency" v={chain.nativeCurrency.symbol} />
            <Row k="RPC" v={chain.rpcUrls.default.http[0]} />
            <Row k="Explorer" v={chain.blockExplorers.default.url} />
          </dl>

          <button
            onClick={addAndSwitch}
            className="mt-4 w-full rounded-xl bg-gradient-to-r from-veil-500 to-cy-500 py-3 text-[14px] font-semibold text-white transition hover:brightness-110"
          >
            Add and switch to {chain.name}
          </button>

          <button
            onClick={importNetwork}
            className={
              "mt-2 flex w-full items-center justify-center gap-2 rounded-xl border py-2.5 text-[13px] font-medium transition " +
              (imported
                ? "border-mint-400/35 bg-mint-400/[0.07] text-mint-400"
                : "border-white/12 text-white/65 hover:border-white/25 hover:text-white")
            }
          >
            {imported ? <CheckIcon /> : <ImportIcon />}
            {imported ? "Saved in your wallet" : "Import to wallet extension"}
          </button>

          <p className="mt-1.5 text-center text-[11px] leading-relaxed text-white/30">
            Importing saves the RPC in your extension so COTI is there next time, even if you do not
            switch now.
          </p>

          {err && <p className="mt-2 text-[11px] leading-relaxed text-rose-300">{err}</p>}

          <button
            onClick={later}
            className="mt-3 w-full rounded-xl py-2 text-[12px] text-white/40 transition hover:text-white/70"
          >
            I&apos;ll do this later
          </button>

          <div className="mt-2 flex items-center justify-center gap-2">
            <Badge tone="muted">{chain.testnet ? "testnet" : "mainnet"}</Badge>
            <span className="text-[10px] text-white/25">
              {chain.testnet
                ? "No mainnet funds are involved on this deployment"
                : "Real funds. Check the chain ID above before switching"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Wallet errors are objects with a code and a long nested message. The two
 * that matter are worth saying plainly.
 */
function message(e: unknown): string {
  const code = (e as { code?: number })?.code;
  if (code === 4001) return "You declined the request in your wallet.";
  if (code === -32002) return "Your wallet already has a request open. Finish that one first.";
  return String((e as Error)?.message || e).slice(0, 180);
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-3.5 py-2">
      <dt className="shrink-0 text-[11px] text-white/35">{k}</dt>
      <dd className="mono min-w-0 truncate text-right text-[11px] text-white/70">{v}</dd>
    </div>
  );
}

function ImportIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path d="M8 2v8m0 0L5 7m3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2.5 11v1.5a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path d="m3.5 8.5 3 3 6-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export { Spinner };
