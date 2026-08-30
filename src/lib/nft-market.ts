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
 * Looks for a selector where a dispatch table actually puts one.
 *
 * Solidity compares selectors by pushing them, so every real entry is preceded
 * by PUSH4 (0x63). Scanning for the bare four bytes would also match them
 * sitting at an odd offset inside unrelated code - rare, but it would answer
 * "yes" for a contract that cannot do the thing, and the call would revert.
 */
function hasSelector(code: string | undefined, selector: string): boolean {
  if (!code || code.length < 10) return false;
  return code.toLowerCase().includes("63" + selector.slice(2).toLowerCase());
}

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
    const ok = hasSelector(code, UPDATE_PRICE_SELECTOR);
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

/**
 * The fallback got halfway: the old listing is down, the new one was never made.
 *
 * This has to be its own error rather than the raw one from the second call,
 * because the two states could not be further apart. "Could not change the
 * price" reads as nothing happened, while the token is in fact no longer for
 * sale - and the seller would find that out from a buyer, not from us.
 */
export class ListingTakenDownError extends Error {
  readonly delistHash: `0x${string}`;
  constructor(delistHash: `0x${string}`, cause: unknown) {
    super(
      "The old listing came down but the new one was not created, so your NFT is no longer for sale. Nothing was lost - it never left your wallet - but you need to list it again. (" +
        String((cause as Error)?.message || cause).slice(0, 120) +
        ")",
    );
    this.name = "ListingTakenDownError";
    this.delistHash = delistHash;
  }
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
   * briefly unlisted - which is safe for custody, because nothing is escrowed
   * and the NFT never leaves the seller's wallet, but it is NOT safe to stay
   * quiet about. If the second signature is refused the token really is off the
   * market, so that case throws ListingTakenDownError rather than a message
   * that reads as though nothing happened.
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
  let on: `0x${string}`;
  try {
    on = await a.writeContractAsync({
      address: a.market,
      abi: devoxNFTMarketAbi,
      functionName: "list",
      args: [a.collection, a.tokenId, a.payToken, a.newPrice],
      gas: 1_000_000n,
    });
    await a.confirm(on);
  } catch (e) {
    throw new ListingTakenDownError(off, e);
  }

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
export async function buyListing(a: BuyArgs & { client?: PublicClient }): Promise<`0x${string}`> {
  /**
   * Pay no more than the price on screen.
   *
   * `buy(id, maxPrice)` exists because repricing in place keeps a listing's id
   * while moving the number under it: an ERC-20 purchase already in the
   * mempool would otherwise be pulled from a standing allowance at whatever
   * the seller changed it to. The marketplace deployed before repricing has no
   * such argument and does not need one - with no way to change a price in
   * place, a buy either matches the listing it saw or reverts because the
   * relist gave it a new id.
   */
  const bounded = await marketCanReprice(a.client, a.market);

  const hash = await a.writeContractAsync({
    address: a.market,
    abi: devoxNFTMarketAbi,
    functionName: "buy",
    args: bounded ? [a.id, a.price] : [a.id],
    value: a.payToken === NATIVE_PAY ? a.price : 0n,
    gas: 2_000_000n,
  });
  await a.confirm(hash);
  return hash;
}

export interface ClearStaleArgs {
  writeContractAsync: (config: Record<string, unknown>) => Promise<`0x${string}`>;
  confirm: (hash: `0x${string}`) => Promise<void>;
  market: Address;
  id: bigint;
}

/**
 * Clears a listing left behind by a previous owner.
 *
 * When a listed token is transferred off-market the listing stays active and
 * keeps the token's slot, so the new holder can neither list it nor delist it -
 * `delist` answers only to the recorded seller. `clearStaleListing` exists for
 * exactly that and is restricted on chain to listings `buy` would already
 * reject, so calling it can never cancel a sale that could still have happened.
 *
 * Only marketplaces deployed with the function have it; `marketCanClearStale`
 * says which, so the button is not offered where it would revert.
 */
export async function clearStaleListing(a: ClearStaleArgs): Promise<`0x${string}`> {
  const hash = await a.writeContractAsync({
    address: a.market,
    abi: devoxNFTMarketAbi,
    functionName: "clearStaleListing",
    args: [a.id],
    gas: 1_000_000n,
  });
  await a.confirm(hash);
  return hash;
}

const CLEAR_STALE_SELECTOR = toFunctionSelector("clearStaleListing(uint256)");
const clearCache = new Map<string, boolean>();

export async function marketCanClearStale(
  client: PublicClient | undefined,
  market: Address,
): Promise<boolean> {
  if (!client) return false;
  const key = client.chain?.id + ":" + market.toLowerCase();
  const hit = clearCache.get(key);
  if (hit !== undefined) return hit;
  try {
    const code = await client.getCode({ address: market });
    const ok = hasSelector(code, CLEAR_STALE_SELECTOR);
    clearCache.set(key, ok);
    return ok;
  } catch {
    return false;
  }
}
