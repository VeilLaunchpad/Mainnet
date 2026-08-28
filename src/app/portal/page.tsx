"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount, useBalance, useWriteContract } from "wagmi";
import { parseEther, type Address } from "viem";
import { Contract } from "@coti-io/coti-ethers";
import { Section, Badge, Avatar, Skeleton } from "@/components/ui";
import { Spinner } from "@/components/busy";
import { useResult, readable } from "@/components/result-modal";
import { veilPortalAbi, erc20Abi, privateErc20Abi } from "@/lib/abis";
import { isDeployed } from "@/lib/addresses";
import { useNetwork, useNetworkClient } from "@/components/network-provider";
import { useCotiSession } from "@/lib/coti-client";
import { fmtNum, fmtUnits, parseUnits, shortAddr, isAddress } from "@/lib/format";
import { explorerTx, explorerAddress } from "@/lib/chain";

const NATIVE = "0x0000000000000000000000000000000000000000";

interface Pair {
  underlying: string;
  twin: string;
  name: string;
  symbol: string;
  twinSymbol: string;
  decimals: number;
  locked: string;
  native: boolean;
}

interface Candidate {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  native: boolean;
  /** Testnet stand-ins carry an open faucet so the portal is usable. */
  faucet?: boolean;
}

interface PortalData {
  deployed: boolean;
  portal: string;
  pairs: Pair[];
  candidates: Candidate[];
}

/**
 * The portal.
 *
 * Public on the left, private on the right, one crossing in the middle. Wrapping
 * locks the public token in escrow and mints its private twin one to one;
 * unwrapping burns the twin and releases the escrow.
 *
 * Escrow figures are shown openly because a shielded pool nobody can audit for
 * full backing is asking for trust it has not earned. What becomes private is
 * how much any address holds, and everything that happens while the value stays
 * on the private side.
 */
export default function PortalPage() {
  const { net, addresses } = useNetwork();
  const { address } = useAccount();
  const publicClient = useNetworkClient();
  const { writeContractAsync } = useWriteContract();
  const { data: native } = useBalance({ address, query: { enabled: !!address } });
  const coti = useCotiSession(address);

  const [data, setData] = useState<PortalData | null>(null);
  const [direction, setDirection] = useState<"in" | "out">("in");
  const [selected, setSelected] = useState<string>(NATIVE);
  const [amount, setAmount] = useState("");
  const [custom, setCustom] = useState("");
  const [publicBalances, setPublicBalances] = useState<Record<string, string>>({});
  const [privateBalances, setPrivateBalances] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [tx, setTx] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [balancesLoading, setBalancesLoading] = useState(false);
  const result = useResult();

  const load = useCallback(() => {
    fetch("/api/portal")
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData(null));
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  const candidates = useMemo(() => {
    const list = [...(data?.candidates ?? [])];
    if (custom && isAddress(custom) && !list.some((c) => c.address.toLowerCase() === custom.toLowerCase())) {
      list.push({
        address: custom,
        name: "Custom token",
        symbol: shortAddr(custom, 4),
        decimals: 18,
        native: false,
      });
    }
    return list;
  }, [data?.candidates, custom]);

  const active =
    candidates.find((c) => c.address.toLowerCase() === selected.toLowerCase()) ?? candidates[0] ?? null;
  const pair = data?.pairs.find((p) => p.underlying.toLowerCase() === selected.toLowerCase()) ?? null;

  // Public balances are readable by anyone, so they load without a signature.
  useEffect(() => {
    if (!address || !publicClient || !candidates.length) return;
    setBalancesLoading(true);
    let alive = true;
    (async () => {
      const out: Record<string, string> = {};
      for (const c of candidates) {
        try {
          if (c.native) {
            out[c.address] = native ? fmtNum(Number(native.formatted), 4) : "0";
          } else {
            const bal = (await publicClient.readContract({
              address: c.address as Address,
              abi: erc20Abi,
              functionName: "balanceOf",
              args: [address],
            })) as bigint;
            out[c.address] = fmtUnits(bal, c.decimals, 4);
          }
        } catch {
          out[c.address] = "0";
        }
      }
      if (alive) {
        setPublicBalances(out);
        setBalancesLoading(false);
      }
    })();
    return () => {
      alive = false;
      setBalancesLoading(false);
    };
  }, [address, publicClient, candidates, native]);

  /**
   * Private balances need the AES key, which only exists in this browser after
   * the user unlocks. Until then the right-hand column is genuinely unreadable,
   * and the interface says so instead of showing a zero.
   */
  const revealPrivate = useCallback(async () => {
    if (!address || !data?.pairs.length) return;
    setErr(null);
    try {
      const session = coti.session || (await coti.unlock());
      if (!session) throw new Error(coti.error || "Could not unlock your COTI key.");

      const out: Record<string, string> = {};
      for (const p of data.pairs) {
        try {
          const c = new Contract(p.twin, privateErc20Abi as never, session.signer);
          const ct = await c["balanceOf(address)"](address);
          const clear = await session.signer.decryptValue256(ct);
          out[p.twin] = fmtUnits(BigInt(clear.toString()), p.decimals, 4);
        } catch {
          out[p.twin] = "?";
        }
      }
      setPrivateBalances(out);
    } catch (e) {
      setErr(String((e as Error).message || e).slice(0, 200));
    }
  }, [address, data?.pairs, coti]);

  async function cross() {
    if (!address) return setErr("Connect a wallet first.");
    if (!active) return setErr("Pick a token.");
    if (!amount || Number(amount) <= 0) return setErr("Enter an amount.");
    if (!isDeployed(addresses.portal)) return setErr("The portal is not deployed on this network.");

    setBusy(true);
    setErr(null);
    setTx(null);

    try {
      const decimals = active.decimals;
      const wei = active.native ? parseEther(amount) : parseUnits(amount, decimals);
      let hash: `0x${string}`;

      if (direction === "in") {
        if (active.native) {
          setStep("Portalling in…");
          hash = await writeContractAsync({
            address: addresses.portal,
            abi: veilPortalAbi,
            functionName: "wrapNative",
            value: wei,
            gas: 14_000_000n,
          });
        } else {
          await approve(active.address as Address, addresses.portal, wei);
          setStep("Portalling in…");
          hash = await writeContractAsync({
            address: addresses.portal,
            abi: veilPortalAbi,
            functionName: "wrap",
            args: [active.address as Address, wei],
            gas: 14_000_000n,
          });
        }
      } else {
        if (!pair) throw new Error("No twin exists for this token yet.");
        await approve(pair.twin as Address, addresses.portal, wei);
        setStep("Portalling out…");
        hash = active.native
          ? await writeContractAsync({
              address: addresses.portal,
              abi: veilPortalAbi,
              functionName: "unwrapNative",
              args: [wei],
              gas: 16_000_000n,
            })
          : await writeContractAsync({
              address: addresses.portal,
              abi: veilPortalAbi,
              functionName: "unwrap",
              args: [active.address as Address, wei],
              gas: 16_000_000n,
            });
      }

      setTx(hash);
      setStep("Confirming…");
      await publicClient?.waitForTransactionReceipt({ hash });
      setAmount("");
      load();
      if (Object.keys(privateBalances).length) void revealPrivate();

      result.show({
        ok: true,
        title: direction === "in" ? "Now private" : "Back in the open",
        detail:
          direction === "in"
            ? "Your balance is ciphertext on chain now. Only your key can read it."
            : "The twin was burned and the original released to your wallet.",
        txHash: hash,
      });
    } catch (e) {
      setErr(null);
      result.show({
        ok: false,
        title: "The crossing did not go through",
        detail: readable(e),
        onRetry: cross,
      });
    } finally {
      setBusy(false);
      setStep("");
    }
  }

  /**
   * Only ask for an approval the chain actually needs.
   *
   * Signing a reset and then an approval on every crossing meant three wallet
   * prompts for one action. Reading the allowance first drops both whenever it
   * already covers the amount. The reset is kept for the single case that
   * requires it: PrivateERC20 rejects a non-zero to non-zero change, so a
   * partial allowance must be cleared before it can be raised.
   */
  async function approve(token: Address, spender: Address, value: bigint) {
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
      setStep("Clearing the old allowance…");
      await writeContractAsync({
        address: token,
        abi: erc20Abi,
        functionName: "approve",
        args: [spender, 0n],
        gas: 6_000_000n,
      }).catch(() => undefined);
    }

    setStep("Approving once…");
    const hash = await writeContractAsync({
      address: token,
      abi: erc20Abi,
      functionName: "approve",
      args: [spender, value],
      gas: 6_000_000n,
    });
    await publicClient?.waitForTransactionReceipt({ hash });
  }

  const unlocked = Object.keys(privateBalances).length > 0;

  return (
    <div className="py-10">
      <div className="mx-auto max-w-[1400px] px-4 text-center sm:px-6">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          Portal into <span className="text-grad">Privacy</span>
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-[15px] text-white/50">
          Use the portal to make tokens private. Portal back anytime.
        </p>
        <p className="mx-auto mt-2 max-w-xl text-[12px] leading-relaxed text-white/30">
          The same set COTI carries on mainnet: COTI, wETH, wBTC, USDT, USDC.e, wADA and gCOTI, plus
          any ERC-20 you paste. A twin is created the first time someone crosses with it.
        </p>
      </div>

      <Section className="mt-10">
        <div className="grid items-start gap-4 lg:grid-cols-[1fr_auto_1fr]">
          <PublicColumn
            candidates={candidates}
            balances={publicBalances}
            selected={selected}
            onSelect={(a) => {
              setSelected(a);
              setDirection("in");
            }}
            custom={custom}
            setCustom={setCustom}
            loading={data === null}
            balancesLoading={balancesLoading}
          />

          <Crossing
            direction={direction}
            setDirection={setDirection}
            busy={busy}
            symbol={active?.symbol ?? ""}
            twinSymbol={pair?.twinSymbol ?? "p" + (active?.symbol ?? "")}
            amount={amount}
            setAmount={setAmount}
            onCross={cross}
            step={step}
            balance={
              direction === "in"
                ? publicBalances[active?.address ?? ""]
                : pair
                  ? privateBalances[pair.twin]
                  : undefined
            }
            hasTwin={!!pair}
          />

          <PrivateColumn
            pairs={data?.pairs ?? null}
            balances={privateBalances}
            unlocked={unlocked}
            unlocking={coti.status === "onboarding"}
            onUnlock={revealPrivate}
            selected={selected}
            onSelect={(underlying) => {
              setSelected(underlying);
              setDirection("out");
            }}
          />
        </div>

        {err && (
          <p className="mx-auto mt-4 max-w-2xl rounded-xl border border-rose-400/25 bg-rose-400/[0.06] px-3.5 py-2.5 text-center text-[12px] leading-relaxed text-rose-300">
            {err}
          </p>
        )}
        {tx && (
          <a
            href={explorerTx(tx, net)}
            target="_blank"
            rel="noreferrer"
            className="mono mx-auto mt-3 block max-w-2xl truncate text-center text-[11px] text-cy-300 hover:underline"
          >
            {tx} ↗
          </a>
        )}

        <Explainer portal={data?.portal} pairs={data?.pairs ?? []} />
      </Section>
    </div>
  );
}

function PublicColumn({
  candidates,
  balances,
  selected,
  onSelect,
  custom,
  setCustom,
  loading,
  balancesLoading,
}: {
  candidates: Candidate[];
  balances: Record<string, string>;
  selected: string;
  onSelect: (a: string) => void;
  custom: string;
  setCustom: (v: string) => void;
  loading: boolean;
  balancesLoading: boolean;
}) {
  const [query, setQuery] = useState("");
  const shown = candidates.filter(
    (c) =>
      !query ||
      c.symbol.toLowerCase().includes(query.toLowerCase()) ||
      c.name.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="card p-4">
      <div className="flex items-center gap-2.5">
        <span className="flex size-8 items-center justify-center rounded-full bg-cy-500/20 text-cy-300">
          <GlobeIcon />
        </span>
        <h2 className="text-[17px] font-semibold">Public Tokens</h2>
        {(loading || balancesLoading) && (
          <span className="ml-auto flex items-center gap-1.5 text-[11px] text-white/35">
            <Spinner size={13} />
            {loading ? "loading" : "balances"}
          </span>
        )}
      </div>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Find token"
        className="mt-3 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5 text-[13px] outline-none transition placeholder:text-white/25 focus:border-cy-400/50"
      />

      <div className="mt-2 max-h-[340px] space-y-1.5 overflow-y-auto pr-1">
        {shown.map((c) => (
          <button
            key={c.address}
            onClick={() => onSelect(c.address)}
            className={
              "flex w-full items-center gap-2.5 rounded-xl border p-2.5 text-left transition " +
              (selected.toLowerCase() === c.address.toLowerCase()
                ? "border-cy-400/45 bg-cy-500/[0.08]"
                : "border-white/[0.07] hover:border-white/20")
            }
          >
            <Avatar seed={c.symbol} size={30} rounded="rounded-full" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-semibold">{c.symbol}</div>
              <div className="truncate text-[10px] text-white/35">{c.name}</div>
            </div>
            <span className="mono shrink-0 text-[12px] text-white/60">
              {balances[c.address] ?? "0.00"}
            </span>
          </button>
        ))}

        {shown.length === 0 &&
          (loading ? (
            <div className="flex flex-col items-center gap-2.5 py-8 text-[12px] text-white/35">
              <Spinner />
              Loading the public token list
            </div>
          ) : (
            <p className="py-6 text-center text-[12px] text-white/30">
              {query ? "Nothing matches that." : "No public tokens yet."}
            </p>
          ))}
      </div>

      <input
        value={custom}
        onChange={(e) => setCustom(e.target.value.trim())}
        placeholder="Or paste any ERC-20 address"
        className="mono mt-2 w-full rounded-xl border border-dashed border-white/10 bg-transparent px-3 py-2 text-[11px] outline-none transition placeholder:text-white/20 focus:border-cy-400/40"
      />
      <p className="mt-1.5 text-[10px] leading-relaxed text-white/25">
        Any ERC-20 can be portalled. The twin is created on first use, so nothing has to be listed by
        an admin first, and its decimals are copied from the source rather than assumed.
      </p>
    </div>
  );
}

function Crossing({
  direction,
  setDirection,
  busy,
  symbol,
  twinSymbol,
  amount,
  setAmount,
  onCross,
  step,
  balance,
  hasTwin,
}: {
  direction: "in" | "out";
  setDirection: (d: "in" | "out") => void;
  busy: boolean;
  symbol: string;
  twinSymbol: string;
  amount: string;
  setAmount: (v: string) => void;
  onCross: () => void;
  step: string;
  balance?: string;
  hasTwin: boolean;
}) {
  const inbound = direction === "in";

  return (
    <div className="flex w-full flex-col items-center gap-4 lg:w-[320px]">
      <div className="relative flex size-[190px] items-center justify-center">
        <span className="absolute inset-0 rounded-full bg-gradient-to-br from-veil-500/40 via-transparent to-cy-500/40 blur-xl" />
        <span
          className={
            "absolute inset-0 rounded-full border-2 transition-colors duration-500 " +
            (inbound ? "border-veil-400/60" : "border-cy-400/60")
          }
        />
        <span className="absolute inset-[18px] rounded-full border border-white/10" />
        <span
          className={
            "absolute inset-[42px] animate-pulse-slow rounded-full blur-md transition-colors duration-500 " +
            (inbound ? "bg-veil-500/50" : "bg-cy-500/50")
          }
        />
        <span className="relative text-[13px] font-semibold tracking-wide text-white/85">
          {inbound ? symbol || "?" : twinSymbol}
        </span>
      </div>

      <div className="flex w-full rounded-xl border border-white/10 bg-white/[0.03] p-1">
        <button
          onClick={() => setDirection("in")}
          className={
            "flex-1 rounded-lg py-2 text-[12px] font-semibold transition " +
            (inbound ? "bg-veil-500/25 text-veil-200" : "text-white/45 hover:text-white")
          }
        >
          Into privacy
        </button>
        <button
          onClick={() => setDirection("out")}
          disabled={!hasTwin}
          className={
            "flex-1 rounded-lg py-2 text-[12px] font-semibold transition disabled:opacity-30 " +
            (!inbound ? "bg-cy-500/25 text-cy-200" : "text-white/45 hover:text-white")
          }
        >
          Back out
        </button>
      </div>

      <div className="w-full">
        <div className="flex items-center justify-between text-[11px] text-white/35">
          <span>{inbound ? "Wrap" : "Unwrap"}</span>
          {balance && (
            <button onClick={() => setAmount(balance.replace(/,/g, ""))} className="transition hover:text-white">
              balance {balance}
            </button>
          )}
        </div>
        <div className="mt-1 flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 focus-within:border-veil-400/50">
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            placeholder="0.0"
            inputMode="decimal"
            className="mono min-w-0 flex-1 bg-transparent text-lg outline-none placeholder:text-white/20"
          />
          <span className="shrink-0 text-[12px] font-semibold text-white/50">
            {inbound ? symbol : twinSymbol}
          </span>
        </div>
      </div>

      <button
        onClick={onCross}
        disabled={busy || !amount}
        className={
          "w-full rounded-xl py-3 text-[14px] font-semibold text-white transition hover:brightness-110 disabled:opacity-40 " +
          (inbound
            ? "bg-gradient-to-r from-veil-500 to-veil-600"
            : "bg-gradient-to-r from-cy-500 to-cy-400")
        }
      >
        {busy ? step || "Working…" : inbound ? "Portal in" : "Portal out"}
      </button>

      <p className="text-center text-[10px] leading-relaxed text-white/25">
        {inbound
          ? "Locks the public token in escrow and mints its private twin one to one."
          : "Burns the twin and releases the escrowed public token back to you."}
      </p>
    </div>
  );
}

function PrivateColumn({
  pairs,
  balances,
  unlocked,
  unlocking,
  onUnlock,
  selected,
  onSelect,
}: {
  pairs: Pair[] | null;
  balances: Record<string, string>;
  unlocked: boolean;
  unlocking: boolean;
  onUnlock: () => void;
  selected: string;
  onSelect: (underlying: string) => void;
}) {
  return (
    <div className="card relative overflow-hidden p-4">
      <div className="flex items-center gap-2.5">
        <span className="flex size-8 items-center justify-center rounded-full bg-veil-500/25 text-veil-300">
          <LockIcon />
        </span>
        <h2 className="text-[17px] font-semibold">Private Tokens</h2>
      </div>

      <div className={"mt-3 space-y-1.5 " + (unlocked ? "" : "select-none blur-[5px]")}>
        {pairs === null ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-[54px]" />)
        ) : pairs.length === 0 ? (
          <p className="py-10 text-center text-[12px] text-white/30">
            Nothing has crossed yet. Portal something in.
          </p>
        ) : (
          pairs.map((p) => (
            <button
              key={p.twin}
              onClick={() => onSelect(p.underlying)}
              className={
                "flex w-full items-center gap-2.5 rounded-xl border p-2.5 text-left transition " +
                (selected.toLowerCase() === p.underlying.toLowerCase()
                  ? "border-veil-400/45 bg-veil-500/[0.08]"
                  : "border-white/[0.07] hover:border-white/20")
              }
            >
              <span className="relative">
                <Avatar seed={p.symbol} size={30} rounded="rounded-full" />
                <span className="absolute -bottom-0.5 -right-0.5 flex size-3.5 items-center justify-center rounded-full bg-veil-500 text-[7px] text-white">
                  <LockIcon small />
                </span>
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold">{p.twinSymbol}</div>
                <div className="truncate text-[10px] text-white/35">
                  {p.locked} {p.symbol} in escrow
                </div>
              </div>
              <span className="mono shrink-0 text-[12px] text-white/60">
                {unlocked ? (balances[p.twin] ?? "...") : "••••"}
              </span>
            </button>
          ))
        )}
      </div>

      {!unlocked && (
        <div className="absolute inset-x-4 top-1/2 -translate-y-1/2">
          <div className="rounded-2xl border border-white/10 bg-ink-900/95 p-4 text-center backdrop-blur-sm">
            <div className="flex items-center justify-center gap-1.5 text-[12px] text-white/60">
              <LockIcon small />
              Balances private
            </div>
            <button
              onClick={onUnlock}
              disabled={unlocking}
              className="mt-2.5 inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-veil-500 to-veil-600 px-4 py-1.5 text-[12px] font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
            >
              <LockIcon small />
              {unlocking ? "Unlocking…" : "Unlock"}
            </button>
            <p className="mt-2 text-[10px] leading-relaxed text-white/30">
              Decryption happens in your browser with your AES key. The server never sees it.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function Explainer({ portal, pairs }: { portal?: string; pairs: Pair[] }) {
  const { net } = useNetwork();
  return (
    <div className="mt-8 grid gap-3 md:grid-cols-3">
      <div className="card p-5">
        <Badge tone="veil">One to one</Badge>
        <h3 className="mt-2.5 text-[15px] font-semibold">Fully backed, publicly</h3>
        <p className="mt-1.5 text-[13px] leading-relaxed text-white/50">
          Every twin is minted against a public token locked in escrow here. The escrow figure is
          readable by anyone, because a shielded pool nobody can audit for full backing is asking for
          trust it has not earned.
        </p>
        {pairs.length > 0 && (
          <dl className="mt-3 space-y-1">
            {pairs.map((p) => (
              <div key={p.twin} className="flex justify-between text-[11px]">
                <dt className="text-white/40">{p.twinSymbol}</dt>
                <dd className="mono text-white/70">
                  {p.locked} {p.symbol}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      <div className="card p-5">
        <Badge tone="cy">What changes</Badge>
        <h3 className="mt-2.5 text-[15px] font-semibold">What crossing actually buys you</h3>
        <ul className="mt-2 space-y-1.5 text-[13px] leading-relaxed text-white/50">
          <li className="flex gap-2">
            <span className="mt-[8px] size-1 shrink-0 rounded-full bg-mint-400/70" />
            <span>How much any address holds becomes unreadable without its key.</span>
          </li>
          <li className="flex gap-2">
            <span className="mt-[8px] size-1 shrink-0 rounded-full bg-mint-400/70" />
            <span>Transfer amounts on the private side are ciphertext.</span>
          </li>
          <li className="flex gap-2">
            <span className="mt-[8px] size-1 shrink-0 rounded-full bg-amber-400/70" />
            <span>The wrap and unwrap transactions themselves are public, amounts included.</span>
          </li>
        </ul>
      </div>

      <div className="card p-5">
        <Badge tone="muted">Contract</Badge>
        <h3 className="mt-2.5 text-[15px] font-semibold">No admin, no listing</h3>
        <p className="mt-1.5 text-[13px] leading-relaxed text-white/50">
          A twin is created the first time someone portals a token, and only the portal can ever mint
          it. There is no owner who can pause, mint or seize.
        </p>
        {portal && (
          <a
            href={explorerAddress(portal, net)}
            target="_blank"
            rel="noreferrer"
            className="mono mt-3 block truncate text-[11px] text-cy-300 hover:underline"
          >
            {shortAddr(portal, 8)} ↗
          </a>
        )}
      </div>
    </div>
  );
}

function GlobeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6.2" stroke="currentColor" strokeWidth="1.4" />
      <ellipse cx="8" cy="8" rx="2.6" ry="6.2" stroke="currentColor" strokeWidth="1.4" />
      <path d="M2 8h12" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function LockIcon({ small }: { small?: boolean }) {
  const s = small ? 10 : 15;
  return (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none">
      <rect x="3" y="7" width="10" height="7" rx="1.8" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5.4 7V5.2a2.6 2.6 0 0 1 5.2 0V7" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
