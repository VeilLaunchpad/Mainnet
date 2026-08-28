"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Address } from "viem";
import { formatUnits } from "viem";
import { useAccount, useWriteContract } from "wagmi";
import { Section, Stat, Badge, Empty, Skeleton } from "@/components/ui";
import { Spinner } from "@/components/busy";
import { useResult } from "@/components/result-modal";
import { useNetwork, useNetworkClient } from "@/components/network-provider";
import { ConnectButton } from "@/components/connect-button";
import { veilLockerAbi, erc20Abi } from "@/lib/abis";
import { isDeployed } from "@/lib/addresses";
import { explorerAddress } from "@/lib/chain";
import { shortAddr } from "@/lib/format";

/**
 * Locked allocations, and claiming one back.
 *
 * A creator can send their own dev-buy into VeilLocker instead of their wallet,
 * which is the credible version of "I am not dumping on you": the amount and the
 * unlock date are in plain storage, so a buyer can check them, and there is no
 * owner and no early-release path to undo it.
 *
 * This page is the other half of that promise - the day it unlocks, the creator
 * needs somewhere to press claim. One transaction, no approval: the locker
 * already holds the tokens, so there is nothing to authorise first.
 */

interface Lock {
  id: number;
  token: Address;
  beneficiary: Address;
  amount: bigint;
  unlockAt: number;
  claimed: boolean;
  symbol: string;
  decimals: number;
  name: string;
}

export default function LockPage() {
  const { net, addresses } = useNetwork();
  const { address } = useAccount();
  const publicClient = useNetworkClient();
  const { writeContractAsync } = useWriteContract();
  const { report, show } = useResult();

  const [locks, setLocks] = useState<Lock[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const locker = addresses.locker;
  const ready = isDeployed(locker);

  const load = useCallback(async () => {
    if (!publicClient || !ready || !address) {
      setLocks(address ? [] : null);
      return;
    }

    const ids = (await publicClient
      .readContract({
        address: locker,
        abi: veilLockerAbi,
        functionName: "locksForBeneficiary",
        args: [address],
      })
      .catch(() => [])) as readonly bigint[];

    const out: Lock[] = [];
    for (const id of ids) {
      const l = (await publicClient
        .readContract({ address: locker, abi: veilLockerAbi, functionName: "lockAt", args: [id] })
        .catch(() => null)) as readonly [Address, Address, bigint, bigint, boolean] | null;
      if (!l) continue;

      const [token, beneficiary, amount, unlockAt, claimed] = l;

      // A locked token may be a PrivateERC20, whose metadata still reads fine
      // even though its balances do not.
      const [symbol, decimals, name] = await Promise.all([
        publicClient.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }).catch(() => "?"),
        publicClient.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }).catch(() => 18),
        publicClient.readContract({ address: token, abi: erc20Abi, functionName: "name" }).catch(() => "Unknown"),
      ]);

      out.push({
        id: Number(id),
        token,
        beneficiary,
        amount,
        unlockAt: Number(unlockAt),
        claimed,
        symbol: String(symbol),
        decimals: Number(decimals),
        name: String(name),
      });
    }

    out.sort((a, b) => Number(a.claimed) - Number(b.claimed) || a.unlockAt - b.unlockAt);
    setLocks(out);
  }, [publicClient, ready, locker, address]);

  useEffect(() => {
    load().catch(() => setLocks([]));
  }, [load]);

  async function claim(l: Lock) {
    if (!address) return show({ ok: false, title: "Connect a wallet first." });

    setBusy(l.id);
    try {
      await report(
        { success: "Claimed", failure: "The claim did not go through" },
        async () => {
          // One transaction. The locker is already holding the tokens, so
          // there is no approval to sign first.
          const hash = await writeContractAsync({
            address: locker,
            abi: veilLockerAbi,
            functionName: "claim",
            args: [BigInt(l.id)],
            gas: 1_500_000n,
          });
          await publicClient?.waitForTransactionReceipt({ hash });
          return { hash };
        },
      );
      await load();
    } finally {
      setBusy(null);
    }
  }

  if (!ready) {
    return (
      <Section className="py-10" kicker="Lock" title="Locked allocations">
        <Empty
          title="Not deployed on this network yet"
          body="VeilLocker has no address configured here. Switch networks, or check the contracts page."
        />
      </Section>
    );
  }

  const claimable = (locks ?? []).filter((l) => !l.claimed && l.unlockAt * 1000 <= Date.now());
  const waiting = (locks ?? []).filter((l) => !l.claimed && l.unlockAt * 1000 > Date.now());

  return (
    <Section
      className="py-10"
      kicker="Lock"
      title="Locked allocations"
      sub="A creator can lock their own allocation instead of taking it to their wallet. The amount and the unlock date are public, there is no early release, and this is where it is claimed once the date passes."
      right={<ConnectButton />}
    >
      {!address ? (
        <Empty
          title="Connect to see your locks"
          body="Locks are held against an address. Connect the wallet that created the token and anything locked for you appears here."
        />
      ) : locks === null ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Skeleton className="h-32 rounded-2xl" />
          <Skeleton className="h-32 rounded-2xl" />
        </div>
      ) : (
        <>
          <div className="mb-6 grid gap-3 sm:grid-cols-3">
            <Stat label="Claimable now" value={String(claimable.length)} sub="Unlock date has passed" />
            <Stat label="Still locked" value={String(waiting.length)} sub="Waiting on the clock" />
            <Stat
              label="Locker"
              value={shortAddr(locker, 5)}
              sub="No owner, no early release"
            />
          </div>

          {locks.length === 0 ? (
            <Empty
              title="Nothing locked for you"
              body="When you launch a token you can send the dev-buy here instead of to your wallet. It is the version of a vesting promise that a buyer can actually check."
              action={{ href: "/launch", label: "Launch a token" }}
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {locks.map((l) => (
                <LockCard
                  key={l.id}
                  lock={l}
                  net={net}
                  busy={busy === l.id}
                  onClaim={() => claim(l)}
                />
              ))}
            </div>
          )}
        </>
      )}

      <p className="mt-8 max-w-3xl text-[12.5px] leading-relaxed text-white/40">
        The locker has no owner and no way to change an unlock date once set, because a lock the
        deployer could undo would not be a lock.{" "}
        <Link href="/veil-contracts" className="text-cy-300 hover:underline">
          Read it on the explorer
        </Link>{" "}
        rather than taking that on trust.
      </p>
    </Section>
  );
}

function LockCard({
  lock: l,
  net,
  busy,
  onClaim,
}: {
  lock: Lock;
  net: "mainnet" | "testnet";
  busy: boolean;
  onClaim: () => void;
}) {
  const unlocked = l.unlockAt * 1000 <= Date.now();
  const when = new Date(l.unlockAt * 1000);

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-[15px] font-semibold">{l.symbol}</span>
            {l.claimed ? (
              <Badge tone="muted">Claimed</Badge>
            ) : unlocked ? (
              <Badge tone="mint">Unlocked</Badge>
            ) : (
              <Badge tone="amber">Locked</Badge>
            )}
          </div>
          <a
            href={explorerAddress(l.token, net)}
            target="_blank"
            rel="noreferrer"
            className="mono text-[11px] text-white/35 hover:text-cy-300"
          >
            {shortAddr(l.token, 5)} ↗
          </a>
        </div>
        <span className="mono shrink-0 text-[10px] text-white/25">#{l.id}</span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <div>
          <div className="text-[10.5px] uppercase tracking-wider text-white/35">Amount</div>
          <div className="mono text-[15px] font-semibold">
            {Number(formatUnits(l.amount, l.decimals)).toLocaleString("en-US", {
              maximumFractionDigits: 4,
            })}
          </div>
        </div>
        <div>
          <div className="text-[10.5px] uppercase tracking-wider text-white/35">
            {unlocked ? "Unlocked" : "Unlocks"}
          </div>
          <div className="text-[12.5px] font-medium">
            {when.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
          </div>
        </div>
      </div>

      {!l.claimed && (
        <button
          onClick={onClaim}
          disabled={busy || !unlocked}
          className={
            "mt-3.5 flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-[13.5px] font-semibold transition disabled:opacity-45 " +
            (unlocked
              ? "bg-gradient-to-r from-veil-500 to-cy-500 text-white hover:brightness-110"
              : "border border-white/10 text-white/40")
          }
        >
          {busy && <Spinner size={14} />}
          {unlocked ? "Claim" : "Locked until " + when.toLocaleDateString("en-GB")}
        </button>
      )}
    </div>
  );
}
