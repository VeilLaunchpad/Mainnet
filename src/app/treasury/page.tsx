"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Address } from "viem";
import { formatUnits } from "viem";
import { Section, Stat, Badge, Progress, Empty, Skeleton } from "@/components/ui";
import { useNetwork, useNetworkClient } from "@/components/network-provider";
import { devoxTreasuryAbi, devoxStakingAbi, devoxpadTokenAbi, erc20Abi } from "@/lib/abis";
import { isDeployed } from "@/lib/addresses";
import { explorerAddress, OFFICIAL_MAINNET_TOKEN } from "@/lib/chain";
import { shortAddr } from "@/lib/format";

/**
 * The DEVOX treasury, in public.
 *
 * Staking pays a fixed percentage, which is only a promise worth anything if the
 * reserve behind it can be checked. So this reads the chain rather than a stored
 * figure: what is left, what has been paid, what the pools could owe in a year,
 * and therefore how long the reserve lasts.
 *
 * The runway is the number that matters and the one a project would rather not
 * print. It is computed from the caps, which is the honest worst case: every
 * pool full, every staker holding for a year.
 */

const YEAR = 365 * 24 * 3600;

interface PoolLiability {
  pid: number;
  symbol: string;
  apyBps: number;
  cap: bigint;
  totalStaked: bigint;
  annual: number;
}

export default function TreasuryPage() {
  const { net, addresses } = useNetwork();
  const publicClient = useNetworkClient();

  const [reserve, setReserve] = useState<bigint | null>(null);
  const [paidOut, setPaidOut] = useState<bigint | null>(null);
  const [supply, setSupply] = useState<bigint | null>(null);
  const [budget, setBudget] = useState<bigint | null>(null);
  const [pools, setPools] = useState<PoolLiability[] | null>(null);

  const treasury = addresses.devoxTreasury;
  const staking = addresses.devoxStaking;
  const token = addresses.devoxToken;
  const ready = isDeployed(treasury) && isDeployed(token);

  const load = useCallback(async () => {
    if (!publicClient || !ready) return;

    const [bal, paid, total] = await Promise.all([
      publicClient.readContract({ address: treasury, abi: devoxTreasuryAbi, functionName: "balance" }).catch(() => 0n),
      publicClient.readContract({ address: treasury, abi: devoxTreasuryAbi, functionName: "paidOut" }).catch(() => 0n),
      publicClient.readContract({ address: token, abi: devoxpadTokenAbi, functionName: "totalSupply" }).catch(() => 0n),
    ]);
    setReserve(bal as bigint);
    setPaidOut(paid as bigint);
    setSupply(total as bigint);

    if (!isDeployed(staking)) {
      setPools([]);
      return;
    }

    const count = Number(
      await publicClient
        .readContract({ address: staking, abi: devoxStakingAbi, functionName: "poolCount" })
        .catch(() => 0n),
    );

    const out: PoolLiability[] = [];
    for (let pid = 0; pid < count; pid++) {
      const v = (await publicClient
        .readContract({ address: staking, abi: devoxStakingAbi, functionName: "poolView", args: [BigInt(pid)] })
        .catch(() => null)) as
        | readonly [Address, number, boolean, bigint, bigint, bigint, bigint, boolean, bigint]
        | null;
      if (!v) continue;

      const [stakeToken, apyBps, , totalStaked, cap] = v;
      const native = /^0x0{40}$/.test(stakeToken);
      const symbol = native
        ? "COTI"
        : String(
            await publicClient
              .readContract({ address: stakeToken, abi: erc20Abi, functionName: "symbol" })
              .catch(() => "?"),
          );

      out.push({
        pid,
        symbol,
        apyBps: Number(apyBps),
        cap,
        totalStaked,
        annual: Number(formatUnits(cap, 18)) * (Number(apyBps) / 10000),
      });
    }
    setPools(out);
  }, [publicClient, ready, treasury, staking, token]);

  useEffect(() => {
    load().catch(() => setPools([]));
  }, [load]);

  if (!ready) {
    return (
      <Section className="py-10" kicker="Treasury" title="The DEVOX treasury">
        <Empty
          title="Not deployed on this network yet"
          body="No treasury is configured here. Switch networks, or check the contracts page for what is live."
        />
      </Section>
    );
  }

  const reserveN = reserve === null ? 0 : Number(formatUnits(reserve, 18));
  const liability = (pools ?? []).reduce((a, p) => a + p.annual, 0);
  const runway = liability > 0 ? reserveN / liability : Infinity;
  const supplyN = supply === null ? 0 : Number(formatUnits(supply, 18));
  const pctOfSupply = supplyN > 0 ? (reserveN / supplyN) * 100 : 0;

  const isCanonical = token.toLowerCase() === OFFICIAL_MAINNET_TOKEN.toLowerCase();

  return (
    <Section
      className="py-10"
      kicker="Treasury"
      title="The DEVOX treasury"
      sub="The reserve that pays staking. No staked principal is ever held here, so what you see is only what is available to pay rewards."
    >
      {!isCanonical && (
        <div className="mb-5 flex items-start gap-3 rounded-xl border border-amber-400/25 bg-amber-400/[0.05] px-4 py-3">
          <span className="mt-0.5 shrink-0 text-[15px]">🟡</span>
          <p className="text-[12.5px] leading-relaxed text-amber-100/80">
            <b className="text-amber-200">DEVOXPAD official token launched on Mainnet.</b> This is the
            testnet treasury, holding a token that is worth nothing.{" "}
            <a href="https://devoxpad-mainnet.vercel.app/treasury" className="text-cy-300 hover:underline">
              The real one is here
            </a>
            .
          </p>
        </div>
      )}

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Reserve"
          value={reserve === null ? "…" : fmt(reserveN, 0) + " DEVOX"}
          sub={pctOfSupply > 0 ? pctOfSupply.toFixed(0) + "% of total supply" : "of the fixed supply"}
        />
        <Stat
          label="Paid out"
          value={paidOut === null ? "…" : fmt(Number(formatUnits(paidOut, 18)), 6) + " DEVOX"}
          sub="Lifetime staking rewards"
        />
        <Stat
          label="Owed per year"
          value={pools === null ? "…" : fmt(liability, 0) + " DEVOX"}
          sub="If every pool were full"
        />
        <Stat
          label="Runway"
          value={pools === null ? "…" : runway === Infinity ? "—" : runway.toFixed(0) + " years"}
          sub="At the worst case above"
          tone={runway > 5 ? "up" : "down"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
          <h3 className="text-[15px] font-semibold">What it can owe</h3>
          <p className="mt-1 text-[12px] leading-relaxed text-white/45">
            A fixed APY on unlimited deposits would be an unlimited promise, so every pool is capped.
            The caps are what make the percentage keepable, and they are the whole of the liability.
          </p>

          {pools === null ? (
            <Skeleton className="mt-4 h-28 rounded-xl" />
          ) : pools.length === 0 ? (
            <p className="mt-4 text-[12.5px] text-white/40">No pools open on this network.</p>
          ) : (
            <div className="mt-4 space-y-3">
              {pools.map((p) => (
                <div key={p.pid} className="rounded-xl border border-white/[0.07] p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13.5px] font-semibold">{p.symbol}</span>
                    <span className="text-[12px] text-mint-400">{(p.apyBps / 100).toFixed(1)}% APY</span>
                  </div>
                  <div className="mt-2">
                    <Progress
                      pct={p.cap > 0n ? Number((p.totalStaked * 10000n) / p.cap) / 100 : 0}
                      label={
                        fmt(Number(formatUnits(p.totalStaked, 18)), 2) +
                        " of " +
                        fmt(Number(formatUnits(p.cap, 18)), 0) +
                        " staked"
                      }
                    />
                  </div>
                  <div className="mt-1.5 text-[11px] text-white/35">
                    up to {fmt(p.annual, 0)} DEVOX a year at the cap
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
          <h3 className="text-[15px] font-semibold">What it cannot do</h3>
          <ul className="mt-3 space-y-2.5 text-[12.5px] leading-relaxed text-white/55">
            <li className="flex gap-2.5">
              <span className="mt-0.5 text-mint-400">✓</span>
              <span>
                <b className="text-white/75">It never holds your stake.</b> Principal stays in the
                staking contract, so nothing here can be paid out as someone else&apos;s reward.
              </span>
            </li>
            <li className="flex gap-2.5">
              <span className="mt-0.5 text-mint-400">✓</span>
              <span>
                <b className="text-white/75">One spender, with a budget.</b> Only the staking
                contract may take from it, and only up to a limit set separately, so the staking
                owner cannot drain the reserve on their own.
              </span>
            </li>
            <li className="flex gap-2.5">
              <span className="mt-0.5 text-mint-400">✓</span>
              <span>
                <b className="text-white/75">It cannot mint more.</b> The supply was created once, in
                the constructor. There is no mint function to call.
              </span>
            </li>
            <li className="flex gap-2.5">
              <span className="mt-0.5 text-amber-400">!</span>
              <span>
                <b className="text-white/75">The owner can withdraw the reserve.</b> That power is
                real and worth stating. It reaches the reward reserve only, never a deposit, and an
                emergency exit returns your principal without touching the treasury at all.
              </span>
            </li>
          </ul>

          <dl className="mt-4 divide-y divide-white/[0.05] rounded-xl border border-white/[0.08]">
            <Row k="Treasury" v={shortAddr(treasury, 6)} href={explorerAddress(treasury, net)} />
            <Row k="DEVOX" v={shortAddr(token, 6)} href={explorerAddress(token, net)} />
            {isDeployed(staking) && (
              <Row k="Staking" v={shortAddr(staking, 6)} href={explorerAddress(staking, net)} />
            )}
          </dl>

          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href="/stake"
              className="rounded-xl bg-gradient-to-r from-devox-500 to-cy-500 px-4 py-2.5 text-[13px] font-semibold text-white transition hover:brightness-110"
            >
              Stake and earn DEVOX
            </Link>
            <Link
              href="/devox-contracts"
              className="rounded-xl border border-white/12 px-4 py-2.5 text-[13px] font-medium text-white/65 transition hover:border-white/25 hover:text-white"
            >
              Every address
            </Link>
          </div>
        </div>
      </div>

      <p className="mt-8 max-w-3xl text-[12.5px] leading-relaxed text-white/40">
        Every figure here is read from the chain when the page loads, not stored.{" "}
        <Badge tone="muted">no cached numbers</Badge>
      </p>
    </Section>
  );
}

function Row({ k, v, href }: { k: string; v: string; href: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-3.5 py-2.5">
      <dt className="shrink-0 text-[11.5px] text-white/35">{k}</dt>
      <dd>
        <a href={href} target="_blank" rel="noreferrer" className="mono text-[11.5px] text-white/70 hover:text-cy-300">
          {v} ↗
        </a>
      </dd>
    </div>
  );
}

function fmt(n: number, places: number): string {
  if (n === 0) return "0";
  if (n > 0 && n < 10 ** -places) return "<" + (10 ** -places).toFixed(places);
  return n.toLocaleString("en-US", { maximumFractionDigits: places });
}
