"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Address } from "viem";
import { formatUnits } from "viem";
import { useAccount, useWriteContract } from "wagmi";
import { Section, Stat, Badge, Empty, Skeleton } from "@/components/ui";
import { Spinner } from "@/components/busy";
import { useResult } from "@/components/result-modal";
import { useNetwork, useNetworkClient } from "@/components/network-provider";
import { ConnectButton } from "@/components/connect-button";
import { devoxNFTStakingAbi, devoxNFTDropAbi } from "@/lib/nft-abis";
import { erc20Abi } from "@/lib/abis";
import { addressesFor, isDeployed } from "@/lib/addresses";
import { shortAddr } from "@/lib/format";

/**
 * NFT staking.
 *
 * Every pool here was funded by whoever launched the collection: the reward
 * budget moved into the staking contract before the pool opened, so the APY on
 * a card is paid from tokens that already exist rather than from an intention
 * to mint them. That is why each pool also shows its runway - the honest
 * question about a fixed-rate pool is not what it pays but how long it can.
 */

interface Pool {
  id: number;
  collection: Address;
  rewardToken: Address;
  rewardPerNftPerYear: string;
  apyBps: number;
  staked: string;
  budget: string;
  runwaySeconds: string;
}

const UNBOUNDED = 2n ** 255n;

export default function NFTStakePage() {
  const { net } = useNetwork();
  const client = useNetworkClient();
  const { address: me } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const result = useResult();
  const a = useMemo(() => addressesFor(net), [net]);

  const [pools, setPools] = useState<Pool[] | null>(null);
  const [names, setNames] = useState<Record<string, { name: string; symbol: string }>>({});
  const [mine, setMine] = useState<Record<number, { count: bigint; pending: bigint; ids: bigint[] }>>({});
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setPools(null);
    fetch("/api/nft/pools")
      .then((r) => r.json())
      .then((d) => alive && setPools(d.pools ?? []))
      .catch(() => alive && setPools([]));
    return () => {
      alive = false;
    };
  }, [net]);

  // Collection and reward-token names, so a card is not four hex strings.
  useEffect(() => {
    if (!pools || pools.length === 0 || !client) return;
    let alive = true;
    const addrs = [...new Set(pools.flatMap((p) => [p.collection, p.rewardToken]))];
    client
      .multicall({
        contracts: addrs.flatMap((ad) => [
          { address: ad, abi: erc20Abi, functionName: "name" as const },
          { address: ad, abi: erc20Abi, functionName: "symbol" as const },
        ]),
        allowFailure: true,
      })
      .then((res) => {
        if (!alive) return;
        const out: Record<string, { name: string; symbol: string }> = {};
        addrs.forEach((ad, i) => {
          const n = res[i * 2];
          const s = res[i * 2 + 1];
          out[ad.toLowerCase()] = {
            name: n?.status === "success" ? String(n.result) : shortAddr(ad),
            symbol: s?.status === "success" ? String(s.result) : "",
          };
        });
        setNames(out);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [pools, client]);

  /* ── my position in each pool ────────────────────────────────────────── */
  const loadMine = useCallback(async () => {
    if (!pools || !client || !me) {
      setMine({});
      return;
    }
    const out: Record<number, { count: bigint; pending: bigint; ids: bigint[] }> = {};

    for (const p of pools) {
      const [stake, pending] = await Promise.all([
        client
          .readContract({
            address: a.nftStaking,
            abi: devoxNFTStakingAbi,
            functionName: "stakeOf",
            args: [BigInt(p.id), me],
          })
          .catch(() => null),
        client
          .readContract({
            address: a.nftStaking,
            abi: devoxNFTStakingAbi,
            functionName: "pendingReward",
            args: [BigInt(p.id), me],
          })
          .catch(() => 0n),
      ]);

      const count = stake ? ((stake as unknown as { count: bigint }).count ?? 0n) : 0n;

      // Which token ids I hold that are not staked yet.
      let ids: bigint[] = [];
      try {
        const logs = await client.getLogs({
          address: p.collection,
          event: {
            type: "event",
            name: "Transfer",
            inputs: [
              { name: "from", type: "address", indexed: true },
              { name: "to", type: "address", indexed: true },
              { name: "tokenId", type: "uint256", indexed: true },
            ],
          },
          fromBlock: "earliest",
          toBlock: "latest",
        });
        const holder = new Map<string, string>();
        for (const l of logs) {
          const args = l.args as { to?: string; tokenId?: bigint };
          if (args.tokenId === undefined || !args.to) continue;
          holder.set(args.tokenId.toString(), args.to.toLowerCase());
        }
        ids = [...holder.entries()]
          .filter(([, to]) => to === me.toLowerCase())
          .map(([id]) => BigInt(id))
          .sort((x, y) => (x < y ? -1 : 1));
      } catch {
        ids = [];
      }

      out[p.id] = { count, pending: pending as bigint, ids };
    }
    setMine(out);
  }, [pools, client, me, a.nftStaking]);

  useEffect(() => {
    void loadMine();
  }, [loadMine]);

  /**
   * Which token ids I currently have staked in a pool.
   *
   * The contract records `stakerOf[pid][tokenId]` but offers no way to list a
   * user's stakes, so the candidates come from my own Staked events and are
   * then confirmed against that mapping. The events alone would be wrong the
   * moment one is unstaked; the mapping is the authority, and asking it about a
   * short candidate list is cheap.
   */
  const stakedIds = useCallback(
    async (p: Pool): Promise<bigint[]> => {
      if (!client || !me) return [];
      const logs = await client
        .getLogs({
          address: a.nftStaking,
          event: {
            type: "event",
            name: "Staked",
            inputs: [
              { name: "who", type: "address", indexed: true },
              { name: "pid", type: "uint256", indexed: true },
              { name: "tokenId", type: "uint256", indexed: false },
            ],
          },
          args: { who: me, pid: BigInt(p.id) },
          fromBlock: "earliest",
          toBlock: "latest",
        })
        .catch(() => []);

      const candidates = [
        ...new Set(logs.map((l) => (l.args as { tokenId?: bigint }).tokenId).filter(Boolean)),
      ] as bigint[];
      if (candidates.length === 0) return [];

      const owners = await client.multicall({
        contracts: candidates.map((id) => ({
          address: a.nftStaking,
          abi: devoxNFTStakingAbi,
          functionName: "stakerOf" as const,
          args: [BigInt(p.id), id],
        })),
        allowFailure: true,
      });

      return candidates.filter(
        (_, i) =>
          owners[i]?.status === "success" &&
          String(owners[i].result).toLowerCase() === me.toLowerCase(),
      );
    },
    [client, me, a.nftStaking],
  );

  /* ── actions ─────────────────────────────────────────────────────────── */
  const stake = async (p: Pool) => {
    const ids = mine[p.id]?.ids ?? [];
    if (ids.length === 0) {
      result.show({
        ok: false,
        title: "Nothing to stake",
        detail: "You do not hold any tokens from this collection yet.",
      });
      return;
    }
    setBusy("stake-" + p.id);
    try {
      const approved = (await client!.readContract({
        address: p.collection,
        abi: devoxNFTDropAbi,
        functionName: "isApprovedForAll",
        args: [me as Address, a.nftStaking],
      })) as boolean;

      if (!approved) {
        await writeContractAsync({
          address: p.collection,
          abi: devoxNFTDropAbi,
          functionName: "setApprovalForAll",
          args: [a.nftStaking, true],
          gas: 1_000_000n,
        });
        await new Promise((r) => setTimeout(r, 2500));
      }

      const hash = await writeContractAsync({
        address: a.nftStaking,
        abi: devoxNFTStakingAbi,
        functionName: "stake",
        args: [BigInt(p.id), ids],
        gas: BigInt(500_000 + 400_000 * ids.length),
      });
      result.show({
        ok: true,
        title: "Staked",
        detail: ids.length + (ids.length === 1 ? " token is" : " tokens are") + " earning now.",
        txHash: hash,
      });
      await new Promise((r) => setTimeout(r, 3000));
      await loadMine();
    } catch (e) {
      result.show({ ok: false, title: "Staking failed", detail: String((e as Error).message || e) });
    } finally {
      setBusy(null);
    }
  };

  const claim = async (p: Pool) => {
    setBusy("claim-" + p.id);
    try {
      const hash = await writeContractAsync({
        address: a.nftStaking,
        abi: devoxNFTStakingAbi,
        functionName: "claim",
        args: [BigInt(p.id)],
        gas: 1_000_000n,
      });
      result.show({ ok: true, title: "Claimed", detail: "Rewards are in your wallet.", txHash: hash });
      await new Promise((r) => setTimeout(r, 3000));
      await loadMine();
    } catch (e) {
      result.show({ ok: false, title: "Claim failed", detail: String((e as Error).message || e) });
    } finally {
      setBusy(null);
    }
  };

  const unstake = async (p: Pool) => {
    setBusy("unstake-" + p.id);
    try {
      const staked = await stakedIds(p);
      if (staked.length === 0) throw new Error("nothing staked here");

      const hash = await writeContractAsync({
        address: a.nftStaking,
        abi: devoxNFTStakingAbi,
        functionName: "unstake",
        args: [BigInt(p.id), staked],
        gas: BigInt(500_000 + 400_000 * staked.length),
      });
      result.show({
        ok: true,
        title: "Unstaked",
        detail: "Your tokens are back, and anything owed came with them.",
        txHash: hash,
      });
      await new Promise((r) => setTimeout(r, 3000));
      await loadMine();
    } catch (e) {
      result.show({ ok: false, title: "Unstake failed", detail: String((e as Error).message || e) });
    } finally {
      setBusy(null);
    }
  };

  if (!isDeployed(a.nftStaking)) {
    return (
      <Section title="NFT staking">
        <div className="card p-6 text-[13px] text-white/45">Not deployed on {net} yet.</div>
      </Section>
    );
  }

  return (
    <Section
      kicker="Staking"
      title="Hold it, and it earns"
      sub="Pools opened by collection launchers, each funded up front. A paired collection pays a fixed rate per NFT per year — the runway says how long the escrow covers it."
    >
      {pools === null ? (
        <div className="space-y-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      ) : pools.length === 0 ? (
        <Empty
          title="No pools yet"
          body="A pool opens when somebody launches a collection paired with a token. The Studio does both in one flow."
          action={{ href: "/nft/studio", label: "Open the Studio" }}
        />
      ) : (
        <div className="space-y-4">
          {!me && (
            <div className="card flex flex-wrap items-center justify-between gap-3 p-4">
              <span className="text-[13px] text-white/45">
                Connect a wallet to stake and to see what you are owed.
              </span>
              <ConnectButton />
            </div>
          )}

          {pools.map((p) => {
            const coll = names[p.collection.toLowerCase()];
            const reward = names[p.rewardToken.toLowerCase()];
            const mySlot = mine[p.id];
            const runway = BigInt(p.runwaySeconds || "0");
            const days = runway > UNBOUNDED ? null : Number(runway) / 86400;

            return (
              <div key={p.id} className="card p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={"/nft/collection/" + p.collection}
                        className="text-[16px] font-semibold hover:text-devox-200"
                      >
                        {coll?.name ?? shortAddr(p.collection)}
                      </Link>
                      {p.apyBps > 0 ? (
                        <Badge tone="mint">{(p.apyBps / 100).toFixed(1)}% APY</Badge>
                      ) : (
                        <Badge tone="devox">
                          {formatUnits(BigInt(p.rewardPerNftPerYear), 18)} {reward?.symbol ?? ""} / yr
                        </Badge>
                      )}
                    </div>
                    <div className="mono mt-1 text-[11px] text-white/35">
                      pays {reward?.symbol || shortAddr(p.rewardToken)} · {Number(p.staked).toLocaleString()}{" "}
                      staked
                      {days !== null && (
                        <>
                          {" · "}
                          <span className={days < 30 ? "text-amber-300/80" : ""}>
                            {days > 3650 ? "10y+" : days.toFixed(0) + "d"} of runway
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  {me && (
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => stake(p)}
                        disabled={busy !== null}
                        className="rounded-xl bg-gradient-to-r from-devox-500 to-cy-500 px-4 py-2 text-[13px] font-semibold text-white transition hover:brightness-110 disabled:opacity-40"
                      >
                        {busy === "stake-" + p.id ? <Spinner /> : "Stake"}
                      </button>
                      <button
                        onClick={() => claim(p)}
                        disabled={busy !== null || !mySlot || mySlot.count === 0n}
                        className="rounded-xl border border-white/10 px-4 py-2 text-[13px] font-semibold text-white/70 transition hover:bg-white/[0.06] disabled:opacity-40"
                      >
                        {busy === "claim-" + p.id ? <Spinner /> : "Claim"}
                      </button>
                      <button
                        onClick={() => unstake(p)}
                        disabled={busy !== null || !mySlot || mySlot.count === 0n}
                        className="rounded-xl border border-white/10 px-4 py-2 text-[13px] font-semibold text-white/70 transition hover:bg-white/[0.06] disabled:opacity-40"
                      >
                        {busy === "unstake-" + p.id ? <Spinner /> : "Unstake"}
                      </button>
                    </div>
                  )}
                </div>

                {me && mySlot && (
                  <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <Stat label="You staked" value={mySlot.count.toString()} />
                    <Stat
                      label="Pending"
                      value={Number(formatUnits(mySlot.pending, 18)).toFixed(4)}
                      sub={reward?.symbol}
                      tone={mySlot.pending > 0n ? "up" : "default"}
                    />
                    <Stat label="Holding, unstaked" value={mySlot.ids.length} />
                    <Stat
                      label="Budget left"
                      value={Number(formatUnits(BigInt(p.budget), 18)).toLocaleString(undefined, {
                        maximumFractionDigits: 0,
                      })}
                      sub={reward?.symbol}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}
