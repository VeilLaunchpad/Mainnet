"use client";

import { useEffect, useState } from "react";
import { useAccount, useBalance, useWriteContract } from "wagmi";
import { formatUnits, parseEther, type Address } from "viem";
import { devoxCurveAbi, devoxSwapRouterAbi, erc20Abi } from "@/lib/abis";
import { confirmTx } from "@/lib/confirm-tx";
import { isDeployed, SWAP_FEE_BPS } from "@/lib/addresses";
import { useNetwork, useNetworkClient } from "./network-provider";
import { explorerTx, explorerAddress } from "@/lib/chain";
import { fmtNum, fmtUnits, parseUnits, shortAddr } from "@/lib/format";
import { Badge } from "./ui";
import { ensureAllowance } from "@/lib/allowance";
import { useTokenBalance, percentOf } from "@/lib/use-token-balance";
import { useCotiSession } from "@/lib/coti-client";

/**
 * One panel, two venues.
 *
 * Before graduation a token trades against its bonding curve; after, against
 * its DevoxSwap pair. The mechanics differ - the curve mints and burns, the pair
 * swaps against reserves - but the user is doing the same thing, so the UI
 * stays put and only the plumbing underneath changes.
 *
 * Quotes always come from the contract that will fill the trade, never from a
 * formula recomputed here, so the preview cannot drift from the fill.
 */
export function TradePanel({
  token,
  curve,
  symbol,
  decimals,
  graduated,
  poolAddress,
  onTraded,
}: {
  token: string;
  curve: string;
  symbol: string;
  decimals: number;
  graduated: boolean;
  poolAddress?: string | null;
  onTraded?: () => void;
}) {
  const { net, addresses } = useNetwork();
  const { address } = useAccount();
  const publicClient = useNetworkClient();
  const coti = useCotiSession(address);

  const { writeContractAsync } = useWriteContract();
  const { data: native } = useBalance({ address, query: { enabled: !!address } });

  const [side, setSide] = useState<"buy" | "sell">("buy");

  // The sell side is where a wrong amount costs gas, so it is the side that
  // most needed a balance next to the field. This is the panel the failed sell
  // was signed from.
  const sellBal = useTokenBalance(
    side === "sell" ? (token as Address) : undefined,
    address,
    publicClient,
    coti,
  );
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<string | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [tx, setTx] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const onPair = graduated && isDeployed(poolAddress || "") && isDeployed(addresses.swapRouter);
  const onCurve = !graduated && isDeployed(curve);
  const tradable = onPair || onCurve;
  const venue = onPair ? "DevoxSwap" : "Bonding curve";

  useEffect(() => {
    setQuote(null);
    if (!tradable || !amount || Number(amount) <= 0 || !publicClient) return;

    let alive = true;
    setQuoting(true);
    const timer = setTimeout(async () => {
      try {
        const amountIn = side === "buy" ? parseEther(amount) : parseUnits(amount, decimals);
        const out = onPair
          ? ((await publicClient.readContract({
              address: addresses.swapRouter,
              abi: devoxSwapRouterAbi,
              functionName: side === "buy" ? "quoteBuyWithCoti" : "quoteSellForCoti",
              args: [token as Address, amountIn],
            })) as bigint)
          : ((await publicClient.readContract({
              address: curve as Address,
              abi: devoxCurveAbi,
              functionName: side === "buy" ? "quoteBuy" : "quoteSell",
              args: [amountIn],
            })) as bigint);

        if (alive) setQuote(fmtUnits(out, side === "buy" ? decimals : 18, 6));
      } catch {
        if (alive) setQuote(null);
      } finally {
        if (alive) setQuoting(false);
      }
    }, 320);

    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [amount, side, curve, token, decimals, onPair, tradable, publicClient]);

  /**
   * COTI's PrivateERC20 refuses to overwrite a non-zero allowance with another
   * non-zero value - a deliberate mitigation for the ERC-20 approve race. So
   * clear it first; the reset is a no-op when the allowance is already zero.
   */
  /**
   * Approves only when the allowance falls short, so a second sell of the same
   * token needs one confirmation rather than three.
   */
  async function approveSpender(spender: Address, value: bigint) {
    if (!address) return;
    await ensureAllowance({
      publicClient,
      writeContractAsync,
      owner: address,
      token: token as Address,
      spender,
      amount: value,
      onStep: setStep,
    });
  }

  async function submit() {
    if (!address) return setErr("Connect a wallet first.");
    if (!amount || Number(amount) <= 0) return setErr("Enter an amount.");

    setBusy(true);
    setErr(null);
    setTx(null);

    try {
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 900);
      let hash: `0x${string}`;

      if (onPair) {
        if (side === "buy") {
          setStep("Swapping…");
          hash = await writeContractAsync({
            address: addresses.swapRouter,
            abi: devoxSwapRouterAbi,
            functionName: "swapExactCotiForTokens",
            args: [token as Address, 0n, address, deadline],
            value: parseEther(amount),
            gas: 16_000_000n,
          });
        } else {
          const amountIn = parseUnits(amount, decimals);

        if (sellBal.raw !== null && amountIn > sellBal.raw) {
          throw new Error(
            "You are selling more than you hold - " +
              fmtUnits(sellBal.raw, decimals, 6) + " " + symbol + " available.",
          );
        }
          await approveSpender(addresses.swapRouter, amountIn);
          setStep("Swapping…");
          hash = await writeContractAsync({
            address: addresses.swapRouter,
            abi: devoxSwapRouterAbi,
            functionName: "swapExactTokensForCoti",
            args: [token as Address, amountIn, 0n, address, deadline],
            gas: 16_000_000n,
          });
        }
      } else if (side === "buy") {
        setStep("Buying…");
        hash = await writeContractAsync({
          address: curve as Address,
          abi: devoxCurveAbi,
          functionName: "buy",
          args: [0n],
          value: parseEther(amount),
          gas: 12_000_000n,
        });
      } else {
        const amountIn = parseUnits(amount, decimals);

        // The curve sell is the exact path that reverted with the gas spent.
        if (sellBal.raw !== null && amountIn > sellBal.raw) {
          throw new Error(
            "You are selling more than you hold - " +
              fmtUnits(sellBal.raw, decimals, 6) + " " + symbol + " available.",
          );
        }

        await approveSpender(curve as Address, amountIn);
        setStep("Selling…");
        hash = await writeContractAsync({
          address: curve as Address,
          abi: devoxCurveAbi,
          functionName: "sell",
          args: [amountIn, 0n],
          gas: 14_000_000n,
        });
      }

      setTx(hash);
      setStep("Confirming…");
      await confirmTx(publicClient, hash);
      sellBal.refresh();

      await fetch("/api/trades", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token,
          trader: address,
          side,
          cotiIn: side === "buy" ? amount : quote || "0",
          tokenOut: side === "buy" ? quote || "0" : amount,
          txHash: hash,
          venue: onPair ? "devoxswap" : "curve",
        }),
      }).catch(() => undefined);

      setAmount("");
      onTraded?.();
    } catch (e) {
      setErr(String((e as Error).message || e).slice(0, 220));
    } finally {
      setBusy(false);
      setStep("");
    }
  }

  if (!tradable) {
    return (
      <div className="card p-4">
        <h3 className="text-[15px] font-semibold">Trade</h3>
        <p className="mt-2 text-[13px] leading-relaxed text-white/45">
          {graduated
            ? "This token has graduated but its pair is not readable on this network yet."
            : "This token has no DEVOXPAD bonding curve, so there is nothing to quote against here. It may have been deployed outside the launchpad."}
        </p>
      </div>
    );
  }

  return (
    <div className="card p-4">
      <div className="mb-2.5 flex items-center justify-between">
        <h3 className="text-[15px] font-semibold">Trade</h3>
        {onPair ? <Badge tone="mint">{venue} · 0.3%</Badge> : <Badge tone="devox">{venue}</Badge>}
      </div>

      <div className="flex rounded-xl border border-white/10 bg-white/[0.03] p-1">
        {(["buy", "sell"] as const).map((s) => (
          <button
            key={s}
            onClick={() => {
              setSide(s);
              setAmount("");
              setErr(null);
            }}
            className={
              "flex-1 rounded-lg py-2 text-[13px] font-semibold transition " +
              (side === s
                ? s === "buy"
                  ? "bg-mint-400/15 text-mint-400"
                  : "bg-rose-400/15 text-rose-400"
                : "text-white/45 hover:text-white")
            }
          >
            {s === "buy" ? "Buy" : "Sell"}
          </button>
        ))}
      </div>

      <div className="mt-3">
        <div className="flex items-center justify-between text-[11px] text-white/35">
          <span>You pay</span>
          <span>
            {side === "buy"
              ? native
                ? "balance " + fmtNum(Number(native.formatted), 3) + " COTI"
                : ""
              : !address
                ? "connect to see your balance"
                : sellBal.loading
                  ? "reading balance…"
                  : sellBal.sealed
                    ? "balance encrypted"
                    : sellBal.raw !== null
                      ? "balance " + fmtUnits(sellBal.raw, decimals, 6) + " " + symbol
                      : ""}
          </span>
        </div>

        {/* Percentages off the integer balance, so Max is the balance to the
            wei and not a rounded figure the contract then rejects. */}
        {(() => {
          const payRaw = side === "buy" ? (native ? native.value : null) : sellBal.raw;
          const payDecimals = side === "buy" ? 18 : decimals;
          const ready = payRaw !== null && payRaw > 0n;

          const apply = (pct: number) => {
            if (payRaw === null) return;
            let take = percentOf(payRaw, pct);
            if (side === "buy" && pct >= 100) {
              const headroom = parseEther("0.05");
              take = take > headroom ? take - headroom : 0n;
            }
            setAmount(formatUnits(take, payDecimals));
          };

          if (side === "sell" && sellBal.sealed) {
            return (
              <button
                onClick={() => void sellBal.reveal()}
                disabled={sellBal.revealing}
                className="mt-1.5 rounded-lg border border-cy-400/30 bg-cy-400/10 px-2.5 py-1 text-[10px] font-semibold text-cy-300 transition hover:bg-cy-400/20 disabled:opacity-50"
              >
                {sellBal.revealing ? "Decrypting…" : "Reveal balance"}
              </button>
            );
          }

          return (
            <div className="mt-1.5 flex items-center gap-1.5">
              {[25, 50, 75, 100].map((pct) => (
                <button
                  key={pct}
                  onClick={() => apply(pct)}
                  disabled={!ready}
                  className="rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] font-semibold text-white/60 transition hover:border-devox-400/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                >
                  {pct === 100 ? "Max" : pct + "%"}
                </button>
              ))}
            </div>
          );
        })()}
        <div className="mt-1 flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 focus-within:border-devox-400/50">
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            placeholder="0.0"
            inputMode="decimal"
            className="mono min-w-0 flex-1 bg-transparent text-lg outline-none placeholder:text-white/20"
          />
          <span className="shrink-0 text-[13px] font-semibold text-white/50">
            {side === "buy" ? "COTI" : symbol}
          </span>
        </div>
      </div>

      <div className="mt-2.5 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
        <div className="flex items-center justify-between text-[11px] text-white/35">
          <span>You receive</span>
          {quoting && <span className="text-cy-300">quoting…</span>}
        </div>
        <div className="mono mt-0.5 text-lg font-semibold">
          {quote ?? "-"}{" "}
          <span className="text-[13px] font-normal text-white/45">
            {side === "buy" ? symbol : "COTI"}
          </span>
        </div>
      </div>

      {side === "buy" && (
        <div className="mt-2 flex gap-1.5">
          {["0.1", "0.5", "1", "2"].map((v) => (
            <button
              key={v}
              onClick={() => setAmount(v)}
              className="flex-1 rounded-lg border border-white/10 py-1.5 text-[11px] text-white/50 transition hover:border-devox-400/40 hover:text-white"
            >
              {v}
            </button>
          ))}
        </div>
      )}

      <button
        onClick={submit}
        disabled={busy || !amount}
        className={
          "mt-3 w-full rounded-xl py-3 text-[14px] font-semibold text-white transition hover:brightness-110 disabled:opacity-40 " +
          (side === "buy"
            ? "bg-gradient-to-r from-mint-400 to-cy-500"
            : "bg-gradient-to-r from-rose-400 to-devox-500")
        }
      >
        {busy ? step || "Confirming…" : side === "buy" ? "Buy " + symbol : "Sell " + symbol}
      </button>

      {err && <div className="mt-2 text-[11px] leading-relaxed text-rose-300">{err}</div>}
      {tx && (
        <a
          href={explorerTx(tx, net)}
          target="_blank"
          rel="noreferrer"
          className="mono mt-2 block truncate text-center text-[11px] text-cy-300 hover:underline"
        >
          {tx.slice(0, 18)}… ↗
        </a>
      )}

      {onPair && poolAddress && (
        <a
          href={explorerAddress(poolAddress, net)}
          target="_blank"
          rel="noreferrer"
          className="mono mt-2 block truncate text-center text-[10px] text-white/25 transition hover:text-cy-300"
        >
          pair {shortAddr(poolAddress, 6)} ↗
        </a>
      )}

      <p className="mt-3 text-[10px] leading-relaxed text-white/25">
        {side === "sell" ? "Selling takes two signatures: an approval, then the trade. " : ""}
        Balances on this token are encrypted by COTI garbled circuits. Your fill is a public event;
        the size of what you still hold is not.
        {onPair ? " Fee " + SWAP_FEE_BPS / 100 + "% goes to liquidity providers." : ""}
      </p>
    </div>
  );
}
