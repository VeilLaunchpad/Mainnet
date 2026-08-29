import type { Address } from "viem";
import { publicClient } from "./rpc";
import { addressesFor, isDeployed } from "./addresses";
import { ACTIVE_NETWORK, type CotiNetworkName } from "./chain";
import {
  veilNFTDropAbi,
  veilNFTEditionsAbi,
  veilNFTFactoryAbi,
  veilNFTEditionsFactoryAbi,
  veilNFTMarketAbi,
  veilNFTStakingAbi,
} from "./nft-abis";

/**
 * Reading the NFT side of the chain.
 *
 * Two factories exist because a scheduled drop and an open collection are
 * different contracts, and the marketplace has to show both in one grid. Every
 * function here normalises them into a single `NFTCollection` shape so the UI
 * never branches on which factory something came from - only on `kind`, when
 * the difference genuinely matters (a drop has one supply, an open collection
 * has editions).
 *
 * What is deliberately absent is metadata. `previewURI` is public and readable
 * here; the private metadata is a ciphertext that only a holder's key opens, so
 * it is fetched in the browser by the holder and never passes through here.
 */

export type CollectionKind = "drop" | "editions";

export interface NFTCollection {
  address: Address;
  kind: CollectionKind;
  creator: Address;
  name: string;
  symbol: string;
  previewURI: string;
  createdAt: number;
  official: boolean;
  /** Drops only: the fixed run. Open collections report their edition count. */
  maxSupply: string;
  minted: string;
  mintPrice: string;
  payToken: Address;
  editionCount?: number;
  /** Set when the collection is paired with a token for staking. */
  paired?: { poolId: number; rewardToken: Address; apyBps: number; rewardPerYear: string };
}

export interface NFTListing {
  id: number;
  collection: Address;
  tokenId: string;
  seller: Address;
  payToken: Address;
  price: string;
  live: boolean;
  reason: string;
}

export interface NFTPool {
  id: number;
  collection: Address;
  rewardToken: Address;
  rewardPerNftPerYear: string;
  notionalPerNft: string;
  apyBps: number;
  staked: string;
  budget: string;
  runwaySeconds: string;
}

const EMPTY: Address = "0x0000000000000000000000000000000000000000";

/** Both factories, newest first, merged into one list. */
export async function collections(
  net: CotiNetworkName = ACTIVE_NETWORK,
  limit = 60,
): Promise<NFTCollection[]> {
  const a = addressesFor(net);
  const client = publicClient(net);
  const out: NFTCollection[] = [];

  if (isDeployed(a.nftFactory)) {
    const page = (await client
      .readContract({
        address: a.nftFactory,
        abi: veilNFTFactoryAbi,
        functionName: "page",
        args: [0n, BigInt(limit)],
      })
      .catch(() => [])) as readonly {
      addr: Address;
      creator: Address;
      name: string;
      symbol: string;
      maxSupply: bigint;
      mintPrice: bigint;
      payToken: Address;
      createdAt: bigint;
    }[];

    for (const c of page) {
      out.push({
        address: c.addr,
        kind: "drop",
        creator: c.creator,
        name: c.name,
        symbol: c.symbol,
        previewURI: "",
        createdAt: Number(c.createdAt) * 1000,
        official: false,
        maxSupply: c.maxSupply.toString(),
        minted: "0",
        mintPrice: c.mintPrice.toString(),
        payToken: c.payToken,
      });
    }
  }

  if (isDeployed(a.nftEditionsFactory)) {
    const page = (await client
      .readContract({
        address: a.nftEditionsFactory,
        abi: veilNFTEditionsFactoryAbi,
        functionName: "page",
        args: [0n, BigInt(limit)],
      })
      .catch(() => [])) as readonly {
      addr: Address;
      creator: Address;
      name: string;
      symbol: string;
      createdAt: bigint;
    }[];

    for (const c of page) {
      out.push({
        address: c.addr,
        kind: "editions",
        creator: c.creator,
        name: c.name,
        symbol: c.symbol,
        previewURI: "",
        createdAt: Number(c.createdAt) * 1000,
        official: false,
        maxSupply: "0",
        minted: "0",
        mintPrice: "0",
        payToken: EMPTY,
      });
    }
  }

  out.sort((x, y) => y.createdAt - x.createdAt);
  await enrich(out, net);
  return out;
}

/**
 * Fills in the live numbers a registry entry cannot know.
 *
 * The factory records a collection as it was launched; how much has since been
 * minted, whether the marketplace marked it official, and whether it was paired
 * for staking all live in other contracts. One multicall batch per field rather
 * than a round trip per collection.
 */
async function enrich(list: NFTCollection[], net: CotiNetworkName) {
  if (list.length === 0) return;
  const a = addressesFor(net);
  const client = publicClient(net);

  const drops = list.filter((c) => c.kind === "drop");
  const editions = list.filter((c) => c.kind === "editions");

  const [mintedRes, previewRes, edCountRes, edPreviewRes, officialRes, poolRes] = await Promise.all([
    client.multicall({
      contracts: drops.map((c) => ({
        address: c.address,
        abi: veilNFTDropAbi,
        functionName: "totalMinted",
      })),
      allowFailure: true,
    }),
    client.multicall({
      contracts: drops.map((c) => ({
        address: c.address,
        abi: veilNFTDropAbi,
        functionName: "previewURI",
      })),
      allowFailure: true,
    }),
    client.multicall({
      contracts: editions.map((c) => ({
        address: c.address,
        abi: veilNFTEditionsAbi,
        functionName: "editionCount",
      })),
      allowFailure: true,
    }),
    client.multicall({
      contracts: editions.map((c) => ({
        address: c.address,
        abi: veilNFTEditionsAbi,
        functionName: "previewURI",
      })),
      allowFailure: true,
    }),
    isDeployed(a.nftMarket)
      ? client.multicall({
          contracts: list.map((c) => ({
            address: a.nftMarket,
            abi: veilNFTMarketAbi,
            functionName: "official",
            args: [c.address],
          })),
          allowFailure: true,
        })
      : Promise.resolve([]),
    isDeployed(a.nftStaking)
      ? client.multicall({
          contracts: list.map((c) => ({
            address: a.nftStaking,
            abi: veilNFTStakingAbi,
            functionName: "poolOf",
            args: [c.address],
          })),
          allowFailure: true,
        })
      : Promise.resolve([]),
  ]);

  drops.forEach((c, i) => {
    const m = mintedRes[i];
    if (m?.status === "success") c.minted = String(m.result);
    const p = previewRes[i];
    if (p?.status === "success") c.previewURI = String(p.result);
  });

  editions.forEach((c, i) => {
    const n = edCountRes[i];
    if (n?.status === "success") c.editionCount = Number(n.result);
    const p = edPreviewRes[i];
    if (p?.status === "success") c.previewURI = String(p.result);
  });

  list.forEach((c, i) => {
    const o = officialRes[i];
    if (o?.status === "success") c.official = Boolean(o.result);
  });

  // A paired collection has a staking pool; ask that pool what it pays.
  const pairedIdx: number[] = [];
  list.forEach((c, i) => {
    const p = poolRes[i];
    if (p?.status === "success") {
      const [has, id] = p.result as unknown as [boolean, bigint];
      if (has) {
        c.paired = { poolId: Number(id), rewardToken: EMPTY, apyBps: 0, rewardPerYear: "0" };
        pairedIdx.push(i);
      }
    }
  });

  if (pairedIdx.length > 0 && isDeployed(a.nftStaking)) {
    const [poolsRes, apyRes] = await Promise.all([
      client.multicall({
        contracts: pairedIdx.map((i) => ({
          address: a.nftStaking,
          abi: veilNFTStakingAbi,
          functionName: "pool",
          args: [BigInt(list[i].paired!.poolId)],
        })),
        allowFailure: true,
      }),
      client.multicall({
        contracts: pairedIdx.map((i) => ({
          address: a.nftStaking,
          abi: veilNFTStakingAbi,
          functionName: "apyBps",
          args: [BigInt(list[i].paired!.poolId)],
        })),
        allowFailure: true,
      }),
    ]);

    pairedIdx.forEach((listIndex, k) => {
      const p = poolsRes[k];
      const paired = list[listIndex].paired!;
      if (p?.status === "success") {
        const r = p.result as unknown as Record<string, unknown>;
        paired.rewardToken = (r.rewardToken as Address) ?? EMPTY;
        paired.rewardPerYear = String(r.rewardPerNftPerYear ?? "0");
      }
      const y = apyRes[k];
      if (y?.status === "success") paired.apyBps = Number(y.result);
    });
  }
}

/** One collection, or null if this address is not from either factory. */
export async function collection(
  address: Address,
  net: CotiNetworkName = ACTIVE_NETWORK,
): Promise<NFTCollection | null> {
  const a = addressesFor(net);
  const client = publicClient(net);

  if (isDeployed(a.nftFactory)) {
    const [from, c] = (await client
      .readContract({
        address: a.nftFactory,
        abi: veilNFTFactoryAbi,
        functionName: "isFromFactory",
        args: [address],
      })
      .catch(() => [false, null])) as [boolean, Record<string, unknown> | null];

    if (from && c) {
      const one: NFTCollection[] = [
        {
          address,
          kind: "drop",
          creator: c.creator as Address,
          name: String(c.name),
          symbol: String(c.symbol),
          previewURI: "",
          createdAt: Number(c.createdAt) * 1000,
          official: false,
          maxSupply: String(c.maxSupply),
          minted: "0",
          mintPrice: String(c.mintPrice),
          payToken: c.payToken as Address,
        },
      ];
      await enrich(one, net);
      return one[0];
    }
  }

  if (isDeployed(a.nftEditionsFactory)) {
    const [from, c] = (await client
      .readContract({
        address: a.nftEditionsFactory,
        abi: veilNFTEditionsFactoryAbi,
        functionName: "isFromFactory",
        args: [address],
      })
      .catch(() => [false, null])) as [boolean, Record<string, unknown> | null];

    if (from && c) {
      const one: NFTCollection[] = [
        {
          address,
          kind: "editions",
          creator: c.creator as Address,
          name: String(c.name),
          symbol: String(c.symbol),
          previewURI: "",
          createdAt: Number(c.createdAt) * 1000,
          official: false,
          maxSupply: "0",
          minted: "0",
          mintPrice: "0",
          payToken: EMPTY,
        },
      ];
      await enrich(one, net);
      return one[0];
    }
  }

  return null;
}

/** Live listings, newest first. Stale ones are marked, not hidden. */
export async function listings(
  net: CotiNetworkName = ACTIVE_NETWORK,
  limit = 60,
): Promise<NFTListing[]> {
  const a = addressesFor(net);
  if (!isDeployed(a.nftMarket)) return [];
  const client = publicClient(net);

  const count = Number(
    await client
      .readContract({ address: a.nftMarket, abi: veilNFTMarketAbi, functionName: "listingCount" })
      .catch(() => 0n),
  );
  if (count === 0) return [];

  const ids: number[] = [];
  for (let i = count - 1; i >= 0 && ids.length < limit; i--) ids.push(i);

  const [rows, live] = await Promise.all([
    client.multicall({
      contracts: ids.map((i) => ({
        address: a.nftMarket,
        abi: veilNFTMarketAbi,
        functionName: "listing",
        args: [BigInt(i)],
      })),
      allowFailure: true,
    }),
    client.multicall({
      contracts: ids.map((i) => ({
        address: a.nftMarket,
        abi: veilNFTMarketAbi,
        functionName: "listingLive",
        args: [BigInt(i)],
      })),
      allowFailure: true,
    }),
  ]);

  const out: NFTListing[] = [];
  ids.forEach((id, k) => {
    const r = rows[k];
    if (r?.status !== "success") return;
    const v = r.result as unknown as Record<string, unknown>;
    const l = live[k];
    const [ok, why] =
      l?.status === "success" ? (l.result as unknown as [boolean, string]) : [false, "unknown"];
    out.push({
      id,
      collection: v.collection as Address,
      tokenId: String(v.tokenId),
      seller: v.seller as Address,
      payToken: v.payToken as Address,
      price: String(v.price),
      live: ok,
      reason: why,
    });
  });
  return out;
}

/** Every staking pool, with the APY the launcher set. */
export async function pools(net: CotiNetworkName = ACTIVE_NETWORK): Promise<NFTPool[]> {
  const a = addressesFor(net);
  if (!isDeployed(a.nftStaking)) return [];
  const client = publicClient(net);

  const count = Number(
    await client
      .readContract({ address: a.nftStaking, abi: veilNFTStakingAbi, functionName: "poolCount" })
      .catch(() => 0n),
  );
  if (count === 0) return [];

  const ids = Array.from({ length: count }, (_, i) => i);
  const [rows, apy, runway] = await Promise.all([
    client.multicall({
      contracts: ids.map((i) => ({
        address: a.nftStaking,
        abi: veilNFTStakingAbi,
        functionName: "pool",
        args: [BigInt(i)],
      })),
      allowFailure: true,
    }),
    client.multicall({
      contracts: ids.map((i) => ({
        address: a.nftStaking,
        abi: veilNFTStakingAbi,
        functionName: "apyBps",
        args: [BigInt(i)],
      })),
      allowFailure: true,
    }),
    client.multicall({
      contracts: ids.map((i) => ({
        address: a.nftStaking,
        abi: veilNFTStakingAbi,
        functionName: "runway",
        args: [BigInt(i)],
      })),
      allowFailure: true,
    }),
  ]);

  const out: NFTPool[] = [];
  ids.forEach((id, k) => {
    const r = rows[k];
    if (r?.status !== "success") return;
    const v = r.result as unknown as Record<string, unknown>;
    out.push({
      id,
      collection: v.collection as Address,
      rewardToken: v.rewardToken as Address,
      rewardPerNftPerYear: String(v.rewardPerNftPerYear ?? "0"),
      notionalPerNft: String(v.notionalPerNft ?? "0"),
      apyBps: apy[k]?.status === "success" ? Number(apy[k].result) : 0,
      staked: String(v.staked ?? "0"),
      budget: String(v.budget ?? "0"),
      runwaySeconds: runway[k]?.status === "success" ? String(runway[k].result) : "0",
    });
  });
  return out;
}
