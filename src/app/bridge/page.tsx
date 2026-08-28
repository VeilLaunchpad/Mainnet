"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { formatUnits, parseUnits, type Address } from "viem";
import {
  useAccount,
  useBalance,
  useChainId,
  useSendTransaction,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import { Section, Stat, Badge, Skeleton } from "@/components/ui";
import { SelectMenu, type SelectOption } from "@/components/select-menu";
import { erc20Abi } from "@/lib/abis";
import { cotiPrivacyBridgeErc20Abi, cotiPrivacyBridgeNativeAbi } from "@/lib/coti-bridge";
import { explorerAddress, explorerTx, ethExplorerTx } from "@/lib/chain";
import { fmtNum } from "@/lib/format";
import { useResult } from "@/components/result-modal";
import type { wagmiConfig } from "@/lib/wagmi";
import { useNetwork, useNetworkClient } from "@/components/network-provider";

/** wagmi narrows chainId to the chains the config actually knows. */
type SupportedChainId = (typeof wagmiConfig)["chains"][number]["id"];

/**
 * The bridge, as a bridge form.
 *
 * Source network, destination network, token, amount. Both of COTI's bridges
 * live behind that one form because both are, underneath, something a wallet
 * can simply do: the privacy bridge is a contract call, and the cross-chain
 * bridge is a transfer to a recipient COTI's relayer watches. Neither needs
 * another website.
 *
 * The privacy layer is modelled as its own network rather than hidden behind a
 * toggle, because that is what it is: a place value can sit where nobody but
 * the holder can read the balance.
 */

/* ------------------------------------------------------------------ */

type NetId = "ethereum" | "coti" | "coti-private";

const NETS: { id: NetId; name: string; sub: string; icon: React.ReactNode }[] = [
  { id: "ethereum", name: "Ethereum", sub: "the public chain", icon: <EthIcon /> },
  { id: "coti", name: "COTI", sub: "public balances on COTI", icon: <CotiIcon /> },
  { id: "coti-private", name: "COTI Private", sub: "encrypted balances", icon: <PrivateIcon /> },
];

type RouteKind = "privacy-deposit" | "privacy-withdraw" | "cross-in" | "cross-out";

const ROUTES: Record<string, RouteKind> = {
  "coti>coti-private": "privacy-deposit",
  "coti-private>coti": "privacy-withdraw",
  "ethereum>coti": "cross-in",
  "coti>ethereum": "cross-out",
};

const routeKind = (from: NetId | null, to: NetId | null): RouteKind | null =>
  from && to ? (ROUTES[`${from}>${to}`] ?? null) : null;

/* ------------------------------------------------------------------ */

interface AssetStatus {
  key: string;
  symbol: string;
  name: string;
  decimals: number;
  bridge: Address;
  token: Address | null;
  privateToken: Address;
  native: boolean;
  blurb: string;
  open: boolean;
  minDeposit: string;
  liability: string;
  liquidity: string | null;
  note: string | null;
}

interface CrossAsset {
  key: string;
  symbol: string;
  decimals: number;
  ethToken: Address;
  ethRecipient: Address;
  cotiToken: Address | null;
  cotiRecipient: Address;
}

interface AssetsPayload {
  network: string;
  privacy: { available: boolean; assets: AssetStatus[]; reason: string | null };
  crossChain: {
    available: boolean;
    ethChainId: number;
    ethName: string;
    cotiChainId: number;
    assets: CrossAsset[];
    reason: string | null;
  };
}

interface Quote {
  ok: boolean;
  message?: string;
  amount: string;
  receives: string;
  fee: string;
  feeFromAmount: boolean;
  value: string;
  amountWei: string;
  oracle: { cotiTimestamp: string; tokenTimestamp: string };
}

export default function BridgePage() {
  const { net } = useNetwork();
  const { address, isConnected } = useAccount();
  const publicClient = useNetworkClient();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const { sendTransactionAsync } = useSendTransaction();
  const result = useResult();

  const [data, setData] = useState<AssetsPayload | null>(null);
  const [from, setFrom] = useState<NetId | null>("coti");
  const [to, setTo] = useState<NetId | null>(null);
  const [tokenKey, setTokenKey] = useState<string | null>(null);
  const [amount, setAmount] = useState("");

  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [tx, setTx] = useState<{ hash: string; onEth: boolean } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/bridge/assets")
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData(null));
  }, []);

  const kind = routeKind(from, to);
  const isPrivacy = kind === "privacy-deposit" || kind === "privacy-withdraw";
  const isCross = kind === "cross-in" || kind === "cross-out";
  const direction = kind === "privacy-withdraw" ? "withdraw" : "deposit";
  const crossOpen = data?.crossChain.available ?? false;

  /* ---- options ---- */

  const sourceOptions: SelectOption[] = NETS.map((n) => ({
    value: n.id,
    label: n.id === "ethereum" && data ? data.crossChain.ethName : n.name,
    sub: n.sub,
    icon: n.icon,
  }));

  /**
   * Destinations are listed even when they cannot be used, carrying the reason
   * with them. A route that silently vanishes reads as a bug; one that says
   * why it is closed reads as a boundary.
   */
  const destOptions: SelectOption[] = useMemo(() => {
    if (!from || !data) return [];
    return NETS.filter((n) => n.id !== from).map((n) => {
      const label = n.id === "ethereum" ? data.crossChain.ethName : n.name;
      const k = routeKind(from, n.id);
      if (!k)
        return {
          value: n.id,
          label,
          icon: n.icon,
          disabled: true,
          disabledNote:
            from === "ethereum"
              ? "Reach the private layer by way of COTI"
              : "Not a route COTI operates",
        };
      if ((k === "cross-in" || k === "cross-out") && !crossOpen)
        return {
          value: n.id,
          label,
          icon: n.icon,
          disabled: true,
          disabledNote: data.crossChain.reason ?? "Closed",
        };
      return { value: n.id, label, sub: n.sub, icon: n.icon };
    });
  }, [from, data, crossOpen]);

  const tokenOptions: SelectOption[] = useMemo(() => {
    if (!kind || !data) return [];
    if (isCross) return data.crossChain.assets.map((a) => ({ value: a.key, label: a.symbol }));
    return data.privacy.assets.map((a) => ({
      value: a.key,
      label: a.symbol,
      sub: a.name,
      disabled: !a.open,
      disabledNote: a.note ?? "Closed",
    }));
  }, [kind, data, isCross]);

  const asset = useMemo(
    () => data?.privacy.assets.find((a) => a.key === tokenKey) ?? null,
    [data, tokenKey],
  );
  const cross = useMemo(
    () => data?.crossChain.assets.find((a) => a.key === tokenKey) ?? null,
    [data, tokenKey],
  );

  const decimals = isCross ? (cross?.decimals ?? 18) : (asset?.decimals ?? 18);
  const symbol = isCross ? (cross?.symbol ?? "") : (asset?.symbol ?? "");
  const chosen = isCross ? !!cross : !!asset;

  /** Which chain the wallet has to be on, and where the transfer goes. */
  const signChainId = (
    !data ? null : kind === "cross-in" ? data.crossChain.ethChainId : data.crossChain.cotiChainId
  ) as SupportedChainId | null;
  const crossToken = kind === "cross-in" ? (cross?.ethToken ?? null) : (cross?.cotiToken ?? null);
  const crossRecipient =
    kind === "cross-in" ? (cross?.ethRecipient ?? null) : (cross?.cotiRecipient ?? null);

  /* ---- resetting ---- */

  function pickFrom(v: string) {
    setFrom(v as NetId);
    setTo(null);
    setTokenKey(null);
    setAmount("");
    setQuote(null);
    setErr(null);
  }
  function pickTo(v: string) {
    setTo(v as NetId);
    setTokenKey(null);
    setAmount("");
    setQuote(null);
    setErr(null);
  }
  function flip() {
    if (!from || !to) return;
    const nf = to;
    const nt = from;
    setFrom(nf);
    setTo(routeKind(nf, nt) ? nt : null);
    setAmount("");
    setQuote(null);
    setErr(null);
  }

  /* ---- balances ---- */

  const nativeHere = useBalance({ address, query: { enabled: !!address } });
  const [tokenBal, setTokenBal] = useState<bigint | null>(null);

  useEffect(() => {
    if (!address || !asset || asset.native || !publicClient || !isPrivacy) return setTokenBal(null);
    let dead = false;
    publicClient
      .readContract({
        address: asset.token as Address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address],
      })
      .then((v) => !dead && setTokenBal(v as bigint))
      .catch(() => !dead && setTokenBal(null));
    return () => {
      dead = true;
    };
  }, [address, asset, publicClient, isPrivacy, tx]);

  /**
   * Cross-chain balances are read on whichever chain the transfer will be
   * signed on, which is often not the chain the wallet is currently sitting on.
   */
  const crossBal = useBalance({
    address,
    chainId: signChainId ?? undefined,
    token: (crossToken ?? undefined) as Address | undefined,
    query: { enabled: !!address && isCross && !!signChainId },
  });

  const balance = useMemo(() => {
    if (isCross) return crossBal.data?.value ?? null;
    if (!asset || direction === "withdraw") return null;
    return asset.native ? (nativeHere.data?.value ?? null) : tokenBal;
  }, [isCross, crossBal.data, asset, direction, nativeHere.data, tokenBal]);

  /* ---- quoting (privacy only: cross-chain has no on-chain quote) ---- */

  const fetchQuote = useCallback(
    async (amt: string): Promise<Quote | null> => {
      if (!asset || !isPrivacy || !amt || Number(amt) <= 0) return null;
      const res = await fetch("/api/bridge/quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ asset: asset.key, direction, amount: amt }),
      });
      return (await res.json()) as Quote;
    },
    [asset, direction, isPrivacy],
  );

  useEffect(() => {
    let dead = false;
    if (!amount || Number(amount) <= 0 || !isPrivacy) return setQuote(null);
    setQuoting(true);
    const t = setTimeout(() => {
      fetchQuote(amount)
        .then((q) => !dead && setQuote(q))
        .catch(() => !dead && setQuote(null))
        .finally(() => !dead && setQuoting(false));
    }, 320);
    return () => {
      dead = true;
      clearTimeout(t);
    };
  }, [amount, fetchQuote, isPrivacy]);

  /* ---- writing ---- */

  /**
   * Approve only when the chain actually needs it.
   *
   * The old flow signed a reset to zero and then an approval every single
   * time, so a bridge cost three wallet prompts. Reading the allowance first
   * removes both when it is already sufficient, which makes the common case a
   * single signature. The reset survives only for the one case that needs it:
   * PrivateERC20 rejects a non-zero to non-zero change, so a partial existing
   * allowance has to be cleared before it can be raised.
   */
  async function ensureAllowance(token: Address, spender: Address, value: bigint) {
    let current = 0n;
    try {
      current = (await publicClient?.readContract({
        address: token,
        abi: erc20Abi,
        functionName: "allowance",
        args: [address as Address, spender],
      })) as bigint;
    } catch {
      current = 0n;
    }

    if (current >= value) return;

    if (current > 0n) {
      setStep("Clearing the old allowance");
      await writeContractAsync({
        address: token,
        abi: erc20Abi,
        functionName: "approve",
        args: [spender, 0n],
        gas: 6_000_000n,
      }).catch(() => undefined);
    }

    setStep("Approving once");
    const hash = await writeContractAsync({
      address: token,
      abi: erc20Abi,
      functionName: "approve",
      args: [spender, value],
      gas: 6_000_000n,
    });
    await publicClient?.waitForTransactionReceipt({ hash });
  }

  function record(hash: string, dir: string, amt: string, venue: string) {
    if (!address) return;
    fetch("/api/bridge/track", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address, asset: symbol, amount: amt, direction: dir, txHash: hash, venue }),
    }).catch(() => undefined);
  }

  async function runPrivacy(): Promise<string | null> {
    if (!asset || !address) return null;
    // The contract compares oracle stamps for equality, so a quote that has
    // been sitting on screen is probably already void.
    setStep("Refreshing the quote");
    const q = await fetchQuote(amount);
    if (!q?.ok) throw new Error(q?.message || "Could not price this transfer.");
    setQuote(q);

    const amountWei = BigInt(q.amountWei);
    const value = BigInt(q.value);
    const cotiTs = BigInt(q.oracle.cotiTimestamp);
    const tokenTs = BigInt(q.oracle.tokenTimestamp);

    if (direction === "deposit" && !asset.native)
      await ensureAllowance(asset.token as Address, asset.bridge, amountWei);
    if (direction === "withdraw") await ensureAllowance(asset.privateToken, asset.bridge, amountWei);

    setStep("Bridging");
    const hash = asset.native
      ? await writeContractAsync({
          address: asset.bridge,
          abi: cotiPrivacyBridgeNativeAbi,
          functionName: direction === "deposit" ? "deposit" : "withdraw",
          args: direction === "deposit" ? [cotiTs, tokenTs] : [amountWei, cotiTs, tokenTs],
          value,
          gas: 14_000_000n,
        })
      : await writeContractAsync({
          address: asset.bridge,
          abi: cotiPrivacyBridgeErc20Abi,
          functionName: direction === "deposit" ? "deposit" : "withdraw",
          args: [amountWei, cotiTs, tokenTs],
          value,
          gas: 14_000_000n,
        });

    setTx({ hash, onEth: false });
    setStep("Confirming");
    await publicClient?.waitForTransactionReceipt({ hash });
    record(hash, direction === "deposit" ? "into_privacy" : "out_of_privacy", q.amount, "COTI Privacy Bridge");
    return hash;
  }

  /**
   * A crossing is a transfer, nothing more. The relayer credits the sending
   * address on the far chain, which is why no destination is asked for and why
   * sending from an exchange would deliver to an address nobody controls.
   */
  async function runCross(): Promise<string | null> {
    if (!cross || !address || !signChainId || !crossRecipient) return null;

    if (chainId !== signChainId) {
      setStep("Switching network");
      await switchChainAsync({ chainId: signChainId });
    }

    const wei = parseUnits(amount, cross.decimals);
    setStep("Sending");

    const hash = crossToken
      ? await writeContractAsync({
          chainId: signChainId,
          address: crossToken,
          abi: erc20Abi,
          functionName: "transfer",
          args: [crossRecipient, wei],
        })
      : await sendTransactionAsync({ chainId: signChainId, to: crossRecipient, value: wei });

    setTx({ hash, onEth: kind === "cross-in" });
    record(hash, kind === "cross-in" ? "to_coti" : "to_ethereum", amount, "COTI Bridge");
    setStep("");
    return hash;
  }

  async function go() {
    setBusy(true);
    setErr(null);
    setTx(null);
    try {
      const hash = isPrivacy ? await runPrivacy() : isCross ? await runCross() : null;
      setAmount("");
      result.show({
        ok: true,
        title: isPrivacy
          ? direction === "deposit"
            ? "Now private"
            : "Back in the open"
          : "Sent to the bridge",
        detail: isCross
          ? "COTI's relayer credits the far chain, usually within a few minutes. It will appear in your history."
          : undefined,
        txHash: hash ?? undefined,
        onEth: isCross && kind === "cross-in",
      });
    } catch (e) {
      const detail = readable(String((e as Error).message || e));
      setErr(null);
      result.show({
        ok: false,
        title: "The bridge did not go through",
        detail,
        onRetry: go,
      });
    } finally {
      setBusy(false);
      setStep("");
    }
  }

  const amountNum = Number(amount || 0);
  const overBalance = balance !== null && amountNum > Number(formatUnits(balance, decimals));
  const priced = isCross || !!quote?.ok;
  const canRun = isConnected && chosen && amountNum > 0 && !overBalance && !busy && priced;

  return (
    <div className="py-10">
      <div className="mx-auto max-w-[1400px] px-4 text-center sm:px-6">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          The <span className="text-grad">Bridge</span>
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-[15px] text-white/50">
          COTI&apos;s own bridges, run from here. You sign once, in this tab.
        </p>
      </div>

      <Section className="mt-9">
        {!data ? (
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_340px]">
            <Skeleton className="h-[560px]" />
            <Skeleton className="h-[560px]" />
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="card p-5 sm:p-6">
              <SelectMenu
                label="Source Network"
                value={from}
                options={sourceOptions}
                onChange={pickFrom}
                searchable
                searchPlaceholder="Search networks…"
              />

              <div className="relative my-1 flex justify-center">
                <button
                  type="button"
                  onClick={flip}
                  disabled={!from || !to}
                  title="Swap direction"
                  className="rounded-lg border border-white/10 bg-[#0e1018] p-1.5 text-white/40 transition hover:border-veil-400/40 hover:text-veil-300 disabled:opacity-30"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <path
                      d="M5 2v12m0 0L2.5 11.5M5 14l2.5-2.5M11 14V2m0 0L8.5 4.5M11 2l2.5 2.5"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </div>

              <SelectMenu
                label="Destination Network"
                value={to}
                options={destOptions}
                placeholder="Select Network"
                onChange={pickTo}
                disabled={!from}
              />

              <div className="mt-4">
                <SelectMenu
                  label="Token"
                  value={tokenKey}
                  options={tokenOptions}
                  placeholder="Select Token"
                  onChange={(v) => {
                    setTokenKey(v);
                    setAmount("");
                    setQuote(null);
                    setErr(null);
                  }}
                  searchable={tokenOptions.length > 5}
                  searchPlaceholder="Search tokens…"
                  disabled={!kind}
                />
              </div>

              <div className="mt-4">
                <div className="mb-1.5 flex items-center justify-between">
                  <label className="text-[11px] font-medium text-white/40">Amount</label>
                  {balance !== null ? (
                    <button
                      onClick={() => setAmount(formatUnits(balance, decimals))}
                      className="text-[11px] text-cy-300 hover:underline"
                    >
                      balance {fmtNum(formatUnits(balance, decimals), 6)} {symbol}
                    </button>
                  ) : direction === "withdraw" && isPrivacy && asset ? (
                    <span className="text-[11px] text-white/30">balance is encrypted</span>
                  ) : null}
                </div>

                <div
                  className={
                    "flex items-center gap-2 rounded-xl border px-3.5 py-3 transition " +
                    (chosen
                      ? "border-white/10 bg-white/[0.03] focus-within:border-veil-400/50"
                      : "border-white/[0.06] bg-white/[0.02] opacity-50")
                  }
                >
                  <input
                    value={amount}
                    disabled={!chosen}
                    onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                    placeholder="0.00"
                    inputMode="decimal"
                    className="mono min-w-0 flex-1 bg-transparent text-[20px] outline-none placeholder:text-white/20"
                  />
                  {chosen && (
                    <span className="shrink-0 text-[13px] font-semibold text-white/45">{symbol}</span>
                  )}
                </div>

                {overBalance && (
                  <p className="mt-2 text-[12px] text-rose-300">
                    That is more than this wallet holds on that chain.
                  </p>
                )}
              </div>

              {kind && <RouteNote kind={kind} data={data} />}

              {isPrivacy && amountNum > 0 && (
                <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.02] p-3.5">
                  {quoting && !quote ? (
                    <Skeleton className="h-14" />
                  ) : quote?.ok ? (
                    <div className="space-y-1.5">
                      <Line label="You receive" value={`${fmtNum(quote.receives, 6)} ${symbol}`} strong />
                      <Line
                        label={quote.feeFromAmount ? "Fee (taken from amount)" : "Fee"}
                        value={`${fmtNum(quote.fee, 4)} COTI`}
                      />
                      <p className="pt-1 text-[11px] leading-relaxed text-white/30">
                        Priced against COTI&apos;s oracle and bound to that quote, so it is refreshed
                        the moment before you sign.
                      </p>
                    </div>
                  ) : (
                    <p className="text-[12px] leading-relaxed text-amber-300/80">
                      {quote?.message || "Could not price this amount."}
                    </p>
                  )}
                </div>
              )}

              <button
                onClick={go}
                disabled={!canRun}
                className="mt-4 w-full rounded-xl bg-gradient-to-r from-veil-500 to-cy-500 py-3.5 text-[14px] font-semibold text-white transition hover:brightness-110 disabled:opacity-40"
              >
                {!isConnected
                  ? "Connect a wallet"
                  : busy
                    ? step || "Working"
                    : !to
                      ? "Select a destination"
                      : !chosen
                        ? "Select a token"
                        : amountNum <= 0
                          ? "Enter an amount"
                          : isCross && signChainId !== null && chainId !== signChainId
                            ? "Switch network and bridge"
                            : "Bridge Tokens"}
              </button>

              {err && <p className="mt-3 text-[12px] leading-relaxed text-rose-300">{err}</p>}

              {tx && (
                <div className="mt-3 rounded-lg border border-mint-400/25 bg-mint-400/[0.05] px-3 py-2.5">
                  <a
                    href={tx.onEth ? ethExplorerTx(tx.hash, net) : explorerTx(tx.hash, net)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[12px] font-semibold text-mint-400 hover:underline"
                  >
                    Sent. View the transaction
                  </a>
                  {isCross && (
                    <p className="mt-1 text-[11px] leading-relaxed text-white/40">
                      COTI&apos;s relayer credits the far chain, usually within a few minutes. It
                      will appear in your dashboard history.
                    </p>
                  )}
                </div>
              )}

              <p className="mt-3 text-center text-[11px] text-white/25">
                Review every detail before confirming.
              </p>
            </div>

            <div className="space-y-3">
              {asset && isPrivacy ? <AssetFacts asset={asset} /> : <RouteHelp data={data} />}
              <WhyThisWorks />
            </div>
          </div>
        )}
      </Section>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function RouteNote({ kind, data }: { kind: RouteKind; data: AssetsPayload }) {
  if (kind === "privacy-deposit")
    return (
      <Note tone="veil">
        Your token is locked in COTI&apos;s bridge and an encrypted twin is minted to you. Only your
        key can read the balance after that.
      </Note>
    );
  if (kind === "privacy-withdraw")
    return (
      <Note tone="cy">
        The encrypted twin is burned and the original token is released back to you as a public
        balance.
      </Note>
    );
  if (!data.crossChain.available) return <Note tone="amber">{data.crossChain.reason}</Note>;
  return (
    <Note tone="cy">
      Sent to the address COTI&apos;s relayer watches, which credits the same address on the far
      chain. Send from a wallet you hold, never from an exchange.
    </Note>
  );
}

function Note({ tone, children }: { tone: "veil" | "cy" | "amber"; children: React.ReactNode }) {
  const c = {
    veil: "border-veil-400/25 bg-veil-500/[0.07] text-veil-200/80",
    cy: "border-cy-400/25 bg-cy-500/[0.06] text-cy-200/80",
    amber: "border-amber-400/25 bg-amber-400/[0.06] text-amber-200/85",
  }[tone];
  return (
    <p className={"mt-3 rounded-xl border px-3.5 py-2.5 text-[12px] leading-relaxed " + c}>
      {children}
    </p>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[12px] text-white/40">{label}</span>
      <span
        className={
          "mono text-right " + (strong ? "text-[14px] font-semibold" : "text-[12px] text-white/70")
        }
      >
        {value}
      </span>
    </div>
  );
}

function AssetFacts({ asset }: { asset: AssetStatus }) {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[13px] font-semibold">{asset.name}</h3>
        <Badge tone={asset.open ? "mint" : "amber"}>{asset.open ? "open" : "closed"}</Badge>
      </div>
      <p className="mt-1.5 text-[12px] text-white/35">{asset.blurb}</p>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <Stat label="Escrowed" value={asset.liability} sub="backing the twins" />
        <Stat
          label="Can release"
          value={asset.liquidity ?? "-"}
          sub={asset.liquidity === "0" ? "nothing to release yet" : "held by the bridge"}
        />
      </div>

      <dl className="mt-3 space-y-1.5 text-[11px]">
        <Row k="Decimals" v={String(asset.decimals)} />
        <Row k="Minimum" v={`${asset.minDeposit} ${asset.symbol}`} />
      </dl>

      <div className="mt-3 space-y-1">
        <ContractLink label="Bridge" addr={asset.bridge} />
        {asset.token && <ContractLink label="Public token" addr={asset.token} />}
        <ContractLink label="Private twin" addr={asset.privateToken} />
      </div>
    </div>
  );
}

function RouteHelp({ data }: { data: AssetsPayload }) {
  const eth = data.crossChain.ethName;
  return (
    <div className="card p-4">
      <h3 className="text-[13px] font-semibold">Where you can go</h3>
      <ul className="mt-2.5 space-y-2 text-[12px] leading-relaxed text-white/45">
        <li>
          <span className="mono text-white/70">COTI to COTI Private</span> shields a balance. Seven
          assets, all on chain, all signed here.
        </li>
        <li>
          <span className="mono text-white/70">COTI Private to COTI</span> brings it back out.
        </li>
        <li>
          <span className="mono text-white/70">{eth} to COTI</span> carries{" "}
          {data.crossChain.assets.map((a) => a.symbol).join(" and ") || "nothing on this network"}.
          VEILPAD switches your wallet and builds the transfer.
        </li>
      </ul>
    </div>
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

function ContractLink({ label, addr }: { label: string; addr: string }) {
  const { net } = useNetwork();
  return (
    <a
      href={explorerAddress(addr, net)}
      target="_blank"
      rel="noreferrer"
      className="flex items-center justify-between rounded-lg px-2 py-1.5 text-[11px] transition hover:bg-white/[0.04]"
    >
      <span className="text-white/35">{label}</span>
      <span className="mono text-cy-300">
        {addr.slice(0, 6)}…{addr.slice(-4)}
      </span>
    </a>
  );
}

function WhyThisWorks() {
  return (
    <div className="card p-4">
      <h3 className="text-[13px] font-semibold">Why this stays here</h3>
      <p className="mt-1.5 text-[12px] leading-relaxed text-white/45">
        The privacy bridges are verified contracts any wallet can call, and a crossing is a plain
        transfer to a published recipient. Neither needs a different website.
      </p>
      <Link href="/docs/bridge" className="mt-2.5 inline-block text-[12px] text-cy-300 hover:underline">
        How the bridge works
      </Link>
    </div>
  );
}

/** Reverts arrive as hex. The ones users will actually hit deserve words. */
function readable(raw: string): string {
  if (/OracleTimestampMismatch/i.test(raw))
    return "COTI's price oracle updated while you were signing, so the bridge rejected the old quote. Send it again and it will use the new one.";
  if (/InsufficientBridgeLiquidity/i.test(raw))
    return "The bridge does not hold enough of this token to release right now.";
  if (/DepositDisabled/i.test(raw)) return "COTI has deposits switched off for this asset.";
  if (/User rejected|denied transaction|User denied/i.test(raw)) return "You declined the signature.";
  if (/AmountTooSmall|AmountZero/i.test(raw)) return "That amount is below the bridge minimum.";
  if (/insufficient funds/i.test(raw))
    return "Not enough balance on that chain to cover the amount and its gas.";
  return raw.slice(0, 220);
}

/* ------------------------------------------------------------------ */

function EthIcon() {
  return (
    <span className="flex size-6 items-center justify-center rounded-full bg-[#627eea]/20">
      <svg width="11" height="11" viewBox="0 0 12 18" fill="none">
        <path d="M6 0 0 9l6 3.5L12 9 6 0Z" fill="#8aa0f0" />
        <path d="M6 13.6 0 10.1 6 18l6-7.9-6 3.5Z" fill="#627eea" />
      </svg>
    </span>
  );
}

function CotiIcon() {
  return (
    <span className="flex size-6 items-center justify-center rounded-full bg-cy-500/20">
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
        <path d="M2 5.5 8 2l6 3.5v5L8 14l-6-3.5v-5Z" stroke="#4bc8f0" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

function PrivateIcon() {
  return (
    <span className="flex size-6 items-center justify-center rounded-full bg-veil-500/20">
      <svg width="11" height="11" viewBox="0 0 14 16" fill="none">
        <rect x="1.5" y="6.5" width="11" height="8" rx="2" stroke="#a78bfa" strokeWidth="1.6" />
        <path d="M4.5 6.5V4.75a2.5 2.5 0 0 1 5 0V6.5" stroke="#a78bfa" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    </span>
  );
}
