import type { Address, PublicClient } from "viem";
import { toFunctionSelector } from "viem";
import { devoxNFTMarketAbi } from "./nft-abis";

/**
 * The seller's side of a listing: take it down, or change what it costs.
 *
 * Until now the app could only create listings. A price, once set, was
 * permanent - not because the marketplace forbade repricing, but because
 * nothing in the interface offered it and `list()` refuses a token that is
 * already listed, so there was no route back.
 *
 * Repricing has two possible shapes depending on which marketplace is
 * deployed, and this file picks between them by asking the chain rather than by
 * assuming. `updatePrice` moves the number in place for one signature; where
 * the deployed contract predates it, the same intent is expressed as delist
 * then list, which costs two signatures and gives the listing a new id. Both
 * end with the token on sale at the new price, so the caller does not have to
 * care which happened - but it is told, because two wallet prompts when one was
 * expected is the kind of surprise that makes people abandon a transaction
 * halfway.
 */

/** The dispatch table of a Solidity contract contains its selectors verbatim. */
const UPDATE_PRICE_SELECTOR = toFunctionSelector("updatePrice(uint256,uint256)");

const supportCache = new Map<string, boolean>();

/**
 * Whether the deployed marketplace can reprice in place.
 *
 * Read from the contract's own bytecode rather than by trying the call and
 * seeing what happens: a revert would be ambiguous, since `updatePrice` also
 * reverts for a caller who is not the seller, a delisted id, or a zero price.
 * Absence of the selector is unambiguous.
 */
export async function marketCanReprice(
  client: PublicClient | undefined,
  market: Address,
): Promise<boolean> {
  if (!client) return false;
  const key = client.chain?.id + ":" + market.toLowerCase();
  const hit = supportCache.get(key);
  if (hit !== undefined) return hit;

  try {
    const code = await client.getCode({ address: market });
    const ok = !!code && code.includes(UPDATE_PRICE_SELECTOR.slice(2));
    supportCache.set(key, ok);
    return ok;
  } catch {
    // Unknown is treated as "no". Falling back to delist-and-relist always
    // works; calling a function that is not there never does.
    return false;
  }
}

export interface RepriceArgs {
  client: PublicClient | undefined;
  writeContractAsync: (config: Record<string, unknown>) => Promise<`0x${string}`>;
  confirm: (hash: `0x${string}`) => Promise<void>;
  market: Address;
  /** The listing being repriced. */
  id: bigint;
  collection: Address;
  tokenId: bigint;
  payToken: Address;
  newPrice: bigint;
  /** Told what is about to happen, so a second wallet prompt is not a shock. */
  onStep?: (message: string) => void;
}

export interface RepriceResult {
  /** How many wallet confirmations it actually took. */
  signatures: number;
  /** True when the listing kept its id, false when it had to be recreated. */
  inPlace: boolean;
  hash: `0x${string}`;
}

export async function repriceListing(a: RepriceArgs): Promise<RepriceResult> {
  if (a.newPrice <= 0n) throw new Error("Set a price above zero.");

  if (await marketCanReprice(a.client, a.market)) {
    a.onStep?.("Updating the price");
    const hash = await a.writeContractAsync({
      address: a.market,
      abi: devoxNFTMarketAbi,
      functionName: "updatePrice",
      args: [a.id, a.newPrice],
      gas: 1_000_000n,
    });
    await a.confirm(hash);
    return { signatures: 1, inPlace: true, hash };
  }

  /**
   * The older marketplace has no reprice, and `list()` rejects a token that is
   * already listed, so the old listing has to go first. That leaves the token
   * briefly unlisted - which is safe here only because nothing is escrowed and
   * the NFT never leaves the seller's wallet. If the second signature is
   * refused the token is simply not for sale, which is recoverable by listing
   * again; it is not a state where anything can be lost.
   */
  a.onStep?.("This marketplace needs two steps: taking the old listing down");
  const off = await a.writeContractAsync({
    address: a.market,
    abi: devoxNFTMarketAbi,
    functionName: "delist",
    args: [a.id],
    gas: 1_000_000n,
  });
  await a.confirm(off);

  a.onStep?.("Listing again at the new price");
  const on = await a.writeContractAsync({
    address: a.market,
    abi: devoxNFTMarketAbi,
    functionName: "list",
    args: [a.collection, a.tokenId, a.payToken, a.newPrice],
    gas: 1_000_000n,
  });
  await a.confirm(on);

  return { signatures: 2, inPlace: false, hash: on };
}

export interface DelistArgs {
  writeContractAsync: (config: Record<string, unknown>) => Promise<`0x${string}`>;
  confirm: (hash: `0x${string}`) => Promise<void>;
  market: Address;
  id: bigint;
}

/** Takes a listing down. The NFT never moved, so nothing comes back. */
export async function delistListing(a: DelistArgs): Promise<`0x${string}`> {
  const hash = await a.writeContractAsync({
    address: a.market,
    abi: devoxNFTMarketAbi,
    functionName: "delist",
    args: [a.id],
    gas: 1_000_000n,
  });
  await a.confirm(hash);
  return hash;
}

export interface BuyArgs {
  writeContractAsync: (config: Record<string, unknown>) => Promise<`0x${string}`>;
  confirm: (hash: `0x${string}`) => Promise<void>;
  market: Address;
  id: bigint;
  /** Native listings are paid with the transaction; ERC-20 ones are not. */
  payToken: Address;
  price: bigint;
}

export const NATIVE_PAY = "0x0000000000000000000000000000000000000000" as Address;

/**
 * Buys a listing.
 *
 * `buy` re-checks ownership and approval at execution, so a listing whose
 * seller has since moved the token fails instead of transferring somebody
 * else's NFT. That check is the contract's, not this function's - which is why
 * the price is sent exactly as listed rather than rounded or padded: the
 * contract reverts with WrongPayment on anything else.
 */
export async function buyListing(a: BuyArgs): Promise<`0x${string}`> {
  const hash = await a.writeContractAsync({
    address: a.market,
    abi: devoxNFTMarketAbi,
    functionName: "buy",
    args: [a.id],
    value: a.payToken === NATIVE_PAY ? a.price : 0n,
    gas: 2_000_000n,
  });
  await a.confirm(hash);
  return hash;
}
