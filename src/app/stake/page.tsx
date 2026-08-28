"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Address } from "viem";
import { formatUnits, parseUnits } from "viem";
import { useAccount, useBalance, useWriteContract } from "wagmi";
import { Section, Stat, Badge, Progress, Empty, Skeleton } from "@/components/ui";
import { Spinner } from "@/components/busy";
import { useResult } from "@/components/result-modal";
import { useNetwork, useNetworkClient } from "@/components/network-provider";
import { ConnectButton } from "@/components/connect-button";
import { veilStakingAbi, veilTreasuryAbi, erc20Abi } from "@/lib/abis";
import { isDeployed } from "@/lib/addresses";
import { ensureAllowance } from "@/lib/allowance";
import { explorerAddress } from "@/lib/chain";
import { shortAddr } from "@/lib/format";

/**
 * Staking, and what it actually promises.
 *
 * Every pool pays a fixed percentage rather than a share of a fixed emission,
 * which is the difference between "10% APY" meaning what it says and meaning
 * "10% until someone larger arrives". That distinction is worth stating on the
 * page rather than leaving in the contract, so the cards say it.
 *
 * The cap is shown next to it for the same reason. A fixed rate on unbounded
 * deposits could not be honoured, so each pool has a ceiling, and a person
 * deciding whether to stake should be able to see how close it is.
 */

const NATIVE = "0x0000000000000000000000000000000000000000" as Address;

interface PoolCard {
  pid: number;
  stakeToken: Address;
  apyBps: number;
  active: boolean;
  totalStaked: bigint;
  cap: bigint;
  minStake: bigint;
  maxPerUser: bigint;
  privateToken: boolean;
  rewardsAvailable: bigint;
  symbol: string;
  decimals: number;
  native: boolean;
}

interface MyStake {
  amount: bigint;
  owed: bigint;
  pending: bigint;
  since: number;
}

export default function StakePage() {
  const { net, addresses } = useNetwork();
  const { address } = useAccount();
  const publicClient = useNetworkClient();
  const { writeContractAsync } = useWriteContract();
  const { report, show } = useResult();

  const [pools, setPools] = useState<PoolCard[] | null>(null);
  const [mine, setMine] = useState<Record<number, MyStake>>({});
  const [reserve, setReserve] = useState<bigint | null>(null);
  const [paidOut, setPaidOut] = useState<bigint | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const staking = addresses.veilStaking;
  const treasury = addresses.veilTreasury;
  const ready = isDeployed(staking) && isDeployed(treasury);

  /** One pass over every pool, plus the caller's position in each. */
  const load = useCallback(async () => {
    if (!publicClient || !ready) {
      setPools([]);
      return;
    }

    const count = Number(
      await publicClient.readContract({
        address: staking,
        abi: veilStakingAbi,
        functionName: "poolCount",
      }),
    );

    const cards: PoolCard[] = [];
    for (let pid = 0; pid < count; pid++) {
      const v = (await publicClient.readContract({
        address: staking,
        abi: veilStakingAbi,
        functionName: "poolView",
        args: [BigInt(pid)],
      })) as readonly [Address, number, boolean, bigint, bigint, bigint, bigint, boolean, bigint];

      const [stakeToken, apyBps, active, totalStaked, cap, minStake, maxPerUser, privateToken, rewardsAvailable] =
        v;
      const native = stakeToken === NATIVE;

      let symbol = "COTI";
      let decimals = 18;
      if (!native) {
        const [s, d] = await Promise.all([
          publicClient
            .readContract({ address: stakeToken, abi: erc20Abi, functionName: "symbol" })
            .catch(() => "?"),
          publicClient
            .readContract({ address: stakeToken, abi: erc20Abi, functionName: "decimals" })
            .catch(() => 18),
        ]);
        symbol = String(s);
        decimals = Number(d);
      }

      cards.push({
        pid, stakeToken, apyBps: Number(apyBps), active, totalStaked, cap, minStake,
        maxPerUser, privateToken, rewardsAvailable, symbol, decimals, native,
      });
    }
    setPools(cards);

    const [bal, paid] = await Promise.all([
      publicClient.readContract({ address: treasury, abi: veilTreasuryAbi, functionName: "balance" }).catch(() => 0n),
      publicClient.readContract({ address: treasury, abi: veilTreasuryAbi, functionName: "paidOut" }).catch(() => 0n),
    ]);
    setReserve(bal as bigint);
    setPaidOut(paid as bigint);

    if (!address) {
      setMine({});
      return;
    }

    const positions: Record<number, MyStake> = {};
    for (const c of cards) {
      const [s, pending] = await Promise.all([
        publicClient.readContract({
          address: staking, abi: veilStakingAbi, functionName: "stakeOf",
          args: [BigInt(c.pid), address],
        }).catch(() => null),
        publicClient.readContract({
          address: staking, abi: veilStakingAbi, functionName: "pendingReward",
          args: [BigInt(c.pid), address],
        }).catch(() => 0n),
      ]);
      const st = s as { amount: bigint; owed: bigint; since: bigint } | null;
      positions[c.pid] = {
        amount: st?.amount ?? 0n,
        owed: st?.owed ?? 0n,
        pending: (pending as bigint) ?? 0n,
        since: Number(st?.since ?? 0n),
      };
    }
    setMine(positions);
  }, [publicClient, ready, staking, treasury, address]);

  useEffect(() => {
    load().catch(() => setPools([]));
  }, [load]);

  /**
   * Rewards accrue every second, so a figure that only moved on reload would
   * look frozen. Re-reading on a timer keeps it honest without pretending to
   * animate a number the chain has not produced yet.
   */
  useEffect(() => {
    if (!address || !ready) return;
    const t = setInterval(() => {
      load().catch(() => undefined);
    }, 20_000);
    return () => clearInterval(t);
  }, [address, ready, load]);

  const totalStakedByMe = useMemo(
    () => Object.values(mine).reduce((a, m) => a + (m.amount > 0n ? 1 : 0), 0),
    [mine],
  );

  if (!ready) {
    return (
      <Section className="py-10" kicker="Staking" title="Stake, and earn VEILPAD">
        <Empty
          title="Not deployed on this network yet"
          body={
            "VeilStaking has no address configured for " +
            (net === "mainnet" ? "VEILPAD Mainnet" : "VEILPAD Testnet") +
            ". Switch networks, or check the contracts page for what is live."
          }
        />
      </Section>
    );
  }

  return (
    <Section
      className="py-10"
      kicker="Staking"
      title="Stake, and earn VEILPAD"
      sub="Each pool pays a fixed percentage. Somebody else depositing does not lower your rate, which is why every pool has a cap: a fixed rate on unlimited deposits could not be honoured."
      right={<ConnectButton />}
    >
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Stat
          label="Reward reserve"
          value={reserve === null ? "…" : fmt(reserve, 18, 0) + " VEIL"}
          sub="What the treasury can still pay"
        />
        <Stat
          label="Paid out so far"
          value={paidOut === null ? "…" : fmt(paidOut, 18, 4) + " VEIL"}
          sub="Lifetime rewards claimed"
        />
        <Stat
          label="Your positions"
          value={address ? String(totalStakedByMe) : "—"}
          sub={address ? "Pools you are staked in" : "Connect to see yours"}
        />
      </div>

      {pools === null ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-64 rounded-2xl" />
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      ) : pools.length === 0 ? (
        <Empty title="No pools yet" body="Nothing has been opened for staking on this network." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {pools.map((p) => (
            <PoolPanel
              key={p.pid}
              pool={p}
              position={mine[p.pid]}
              net={net}
              busy={busy}
              setBusy={setBusy}
              onDone={load}
              address={address}
              staking={staking}
              writeContractAsync={writeContractAsync}
              publicClient={publicClient}
              report={report}
              show={show}
            />
          ))}
        </div>
      )}

      <p className="mt-8 max-w-3xl text-[12.5px] leading-relaxed text-white/40">
        Rewards are paid in VEILPAD from{" "}
        <a
          href={explorerAddress(treasury, net)}
          target="_blank"
          rel="noreferrer"
          className="text-cy-300 hover:underline"
        >
          the treasury
        </a>
        , never from anyone&apos;s deposit, so a reserve that runs low can delay a reward but can
        never touch a principal. If the reserve is short, what you earned stays owed and is claimable
        once it is topped up. There is also an emergency exit that returns your principal without
        touching the treasury at all.{" "}
        <Link href="/veil-contracts" className="text-cy-300 hover:underline">
          Every address is here
        </Link>
        .
      </p>
    </Section>
  );
}

/* ── one pool ───────────────────────────────────────────────────────────── */

function PoolPanel({
  pool: p,
  position,
  net,
  busy,
  setBusy,
  onDone,
  address,
  staking,
  writeContractAsync,
  publicClient,
  report,
  show,
}: {
  pool: PoolCard;
  position?: MyStake;
  net: "mainnet" | "testnet";
  busy: string | null;
  setBusy: (v: string | null) => void;
  onDone: () => Promise<void>;
  address?: Address;
  staking: Address;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  writeContractAsync: (args: any) => Promise<`0x${string}`>;
  publicClient: ReturnType<typeof useNetworkClient>;
  report: ReturnType<typeof useResult>["report"];
  show: ReturnType<typeof useResult>["show"];
}) {
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<"stake" | "unstake">("stake");

  const { data: nativeBal } = useBalance({
    address,
    query: { enabled: !!address && p.native },
  });
  const [tokenBal, setTokenBal] = useState<bigint | null>(null);

  useEffect(() => {
    if (!address || p.native || p.privateToken || !publicClient) return;
    publicClient
      .readContract({ address: p.stakeToken, abi: erc20Abi, functionName: "balanceOf", args: [address] })
      .then((b) => setTokenBal(b as bigint))
      .catch(() => setTokenBal(null));
  }, [address, p.native, p.stakeToken, publicClient, position?.amount]);

  /**
   * A private token has no readable balance here, and that is the point of it.
   * Showing nothing is honest; showing the ciphertext handle would print a
   * 77-digit number where a balance belongs.
   */
  const walletBal = p.native ? (nativeBal?.value ?? null) : p.privateToken ? null : tokenBal;
  const staked = position?.amount ?? 0n;
  const pending = position?.pending ?? 0n;

  const capPct = p.cap > 0n ? Number((p.totalStaked * 10000n) / p.cap) / 100 : 0;
  const key = "pool-" + p.pid;
  const working = busy === key;

  /**
   * A native pool must leave enough behind to pay for the transaction itself.
   * "Max" that spends the entire balance produces a stake that cannot be
   * submitted, which reads as a bug rather than as arithmetic.
   */
  const GAS_BUFFER = parseUnits("0.05", 18);
  function setMax() {
    const source = mode === "stake" ? walletBal : staked;
    if (source === null) return;
    const usable =
      mode === "stake" && p.native ? (source > GAS_BUFFER ? source - GAS_BUFFER : 0n) : source;
    setAmount(formatUnits(usable, p.decimals));
  }

  async function submit() {
    if (!address) return show({ ok: false, title: "Connect a wallet first." });

    let wei: bigint;
    try {
      wei = parseUnits(amount.trim() || "0", p.decimals);
    } catch {
      return show({ ok: false, title: "That is not a number." });
    }
    if (wei <= 0n) return show({ ok: false, title: "Enter an amount." });

    if (mode === "stake") {
      if (wei < p.minStake) {
        return show({
          ok: false,
          title: "Below the minimum",
          detail: "This pool takes at least " + fmt(p.minStake, p.decimals, 4) + " " + p.symbol + ".",
        });
      }
      if (p.maxPerUser > 0n && staked + wei > p.maxPerUser) {
        return show({
          ok: false,
          title: "Above the per-wallet limit",
          detail:
            "One address may hold at most " +
            fmt(p.maxPerUser, p.decimals, 2) +
            " " +
            p.symbol +
            " here, so nobody can take the whole pool. You have room for " +
            fmt(p.maxPerUser - staked, p.decimals, 4) +
            ".",
        });
      }
      if (p.totalStaked + wei > p.cap) {
        return show({
          ok: false,
          title: "That would pass the cap",
          detail:
            "There is room for " +
            fmt(p.cap - p.totalStaked, p.decimals, 4) +
            " " +
            p.symbol +
            " left in this pool.",
        });
      }
    } else if (wei > staked) {
      return show({ ok: false, title: "You do not have that much staked." });
    }

    setBusy(key);
    try {
      await report(
        {
          success: mode === "stake" ? "Staked" : "Unstaked, and paid what you had earned",
          failure: mode === "stake" ? "The stake did not go through" : "The unstake did not go through",
        },
        async () => {
          if (mode === "stake") {
            if (!p.native) {
              await ensureAllowance({
                publicClient: publicClient ?? undefined,
                writeContractAsync,
                owner: address,
                token: p.stakeToken,
                spender: staking,
                amount: wei,
                // The pool cannot hold more than its cap, so approving that
                // much once covers every stake this wallet will ever make here
                // and every later one is a single confirmation.
                headroom: p.cap,
              });
            }
            const hash = await writeContractAsync({
              address: staking,
              abi: veilStakingAbi,
              functionName: "stake",
              args: [BigInt(p.pid), wei],
              value: p.native ? wei : 0n,
              gas: 1_500_000n,
            });
            await publicClient?.waitForTransactionReceipt({ hash });
            return { hash };
          }

          const hash = await writeContractAsync({
            address: staking,
            abi: veilStakingAbi,
            functionName: "unstake",
            args: [BigInt(p.pid), wei],
            gas: 1_500_000n,
          });
          await publicClient?.waitForTransactionReceipt({ hash });
          return { hash };
        },
      );
      setAmount("");
      await onDone();
    } finally {
      setBusy(null);
    }
  }

  async function claim() {
    if (!address) return;
    setBusy(key);
    try {
      await report({ success: "Reward claimed", failure: "The claim did not go through" }, async () => {
        const hash = await writeContractAsync({
          address: staking,
          abi: veilStakingAbi,
          functionName: "claim",
          args: [BigInt(p.pid)],
          gas: 1_000_000n,
        });
        await publicClient?.waitForTransactionReceipt({ hash });
        return { hash };
      });
      await onDone();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-[17px] font-bold">{p.symbol}</h3>
            {p.native && <Badge tone="muted">native</Badge>}
            {p.privateToken && <Badge tone="cy">Encrypted</Badge>}
            {!p.active && <Badge tone="amber">closed to new deposits</Badge>}
          </div>
          <p className="mt-0.5 text-[12px] text-white/45">
            {p.native ? (
              "The gas token itself."
            ) : (
              <a
                href={explorerAddress(p.stakeToken, net)}
                target="_blank"
                rel="noreferrer"
                className="mono hover:text-cy-300"
              >
                {shortAddr(p.stakeToken, 5)} ↗
              </a>
            )}
          </p>
        </div>
        <div className="text-right">
          <div className="text-[26px] font-bold leading-none text-mint-400">
            {(p.apyBps / 100).toFixed(p.apyBps % 100 === 0 ? 0 : 1)}%
          </div>
          <div className="text-[10.5px] uppercase tracking-wider text-white/35">fixed APY</div>
        </div>
      </div>

      <div className="mt-4">
        <Progress
          pct={capPct}
          label={
            fmt(p.totalStaked, p.decimals, 2) + " of " + fmt(p.cap, p.decimals, 0) + " " + p.symbol
          }
        />
      </div>

      {address && staked > 0n && (
        <div className="mt-4 grid grid-cols-2 gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
          <div>
            <div className="text-[10.5px] uppercase tracking-wider text-white/35">Your stake</div>
            <div className="mono text-[15px] font-semibold">
              {fmt(staked, p.decimals, 4)} {p.symbol}
            </div>
          </div>
          <div>
            <div className="text-[10.5px] uppercase tracking-wider text-white/35">Earned</div>
            <div className="mono text-[15px] font-semibold text-mint-400">
              {fmt(pending, 18, 6)} VEIL
            </div>
            {position && position.owed > 0n && pending > position.owed && (
              <div className="text-[10px] text-amber-300/80">
                {fmt(position.owed, 18, 4)} of it is waiting on the reserve
              </div>
            )}
          </div>
        </div>
      )}

      <div className="mt-4 flex gap-1 rounded-lg bg-white/[0.04] p-1">
        {(["stake", "unstake"] as const).map((m) => (
          <button
            key={m}
            onClick={() => {
              setMode(m);
              setAmount("");
            }}
            className={
              "flex-1 rounded-md py-1.5 text-[12.5px] font-semibold capitalize transition " +
              (mode === m ? "bg-white/[0.09] text-white" : "text-white/45 hover:text-white")
            }
          >
            {m}
          </button>
        ))}
      </div>

      <div className="mt-3">
        <div className="flex items-center justify-between text-[11px] text-white/40">
          <span>{mode === "stake" ? "In your wallet" : "Staked"}</span>
          <button onClick={setMax} className="font-semibold text-cy-300 hover:underline">
            {mode === "stake"
              ? walletBal === null
                ? p.privateToken
                  ? "encrypted"
                  : "—"
                : fmt(walletBal, p.decimals, 4)
              : fmt(staked, p.decimals, 4)}{" "}
            {walletBal === null && mode === "stake" ? "" : "max"}
          </button>
        </div>
        <div className="mt-1.5 flex gap-2">
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            placeholder="0.0"
            inputMode="decimal"
            className="mono min-w-0 flex-1 rounded-xl border border-white/10 bg-ink-950/60 px-3 py-2.5 text-[15px] outline-none transition focus:border-veil-400/50"
          />
          <button
            onClick={submit}
            disabled={working || (mode === "stake" && (!p.active || !address))}
            className="flex shrink-0 items-center gap-2 rounded-xl bg-gradient-to-r from-veil-500 to-cy-500 px-4 py-2.5 text-[13.5px] font-semibold transition hover:brightness-110 disabled:opacity-45"
          >
            {working && <Spinner size={14} />}
            {mode === "stake" ? "Stake" : "Unstake"}
          </button>
        </div>
      </div>

      {address && pending > 0n && (
        <button
          onClick={claim}
          disabled={working}
          className="mt-2.5 w-full rounded-xl border border-mint-400/30 bg-mint-400/[0.07] py-2 text-[13px] font-semibold text-mint-400 transition hover:bg-mint-400/[0.12] disabled:opacity-45"
        >
          Claim {fmt(pending, 18, 6)} VEIL
        </button>
      )}

      <p className="mt-3 text-[11px] leading-relaxed text-white/30">
        Minimum {fmt(p.minStake, p.decimals, 4)} {p.symbol}.{" "}
        {p.native
          ? "One confirmation to stake, one to unstake."
          : "One confirmation, after a single approval the first time you stake this token."}{" "}
        {p.privateToken
          ? "Your balance of this token is ciphertext, so nothing here can read it - type the amount yourself. "
          : ""}
        No deposit fee and no withdrawal fee: you get back exactly what you put in, plus what you
        earned. Unstake whenever you like, including when the pool is closed to new deposits.
      </p>
    </div>
  );
}

/** Trims a wei figure to something readable without lying about the magnitude. */
function fmt(v: bigint, decimals: number, places: number): string {
  const n = Number(formatUnits(v, decimals));
  if (n === 0) return "0";
  if (n > 0 && n < 10 ** -places) return "<" + (10 ** -places).toFixed(places);
  return n.toLocaleString("en-US", { maximumFractionDigits: places });
}
