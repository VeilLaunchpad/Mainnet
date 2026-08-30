import type { Address } from "viem";
import { publicClient } from "./rpc";
import { addressesFor } from "./addresses";
import type { CotiNetworkName } from "./chain";

/**
 * Reading Carbon DeFi straight from the chain.
 *
 * Carbon's own API is the right source for the whole table - it carries trade
 * counts and USD liquidity that no contract knows about - but it indexes off
 * chain and lags a new strategy by some minutes. That is fine for somebody
 * else's pair and not fine for ours: "DEVOXPAD is not on Carbon" is a false
 * statement to render while the position is demonstrably live.
 *
 * So the protocol token's pair is read from the contract as well, and merged
 * over whatever the API said.
 *
 * The rate codec below is the contract's own, and it is easy to get wrong in
 * two specific ways. The mantissa is the LOW 48 bits and the exponent is above
 * it, not the other way round. And A and B expand independently: the high bound
 * is expand(B) + expand(A), never expand(B + A).
 */

export const CARBON_CONTROLLER = "0x59f21012B2E9BA67ce6a7605E74F945D0D4C84EA" as Address;

/** Carbon spells native COTI as this sentinel rather than the zero address. */
export const CARBON_NATIVE = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" as Address;

const ONE = 1n << 48n;

/** The contract's `_expandRate`. */
export function expandRate(v: bigint): bigint {
  return (v % ONE) << (v / ONE);
}

/** Sqrt-space bound back to a plain rate. */
export function rateOf(sqrtSpace: bigint): number {
  return (Number(sqrtSpace) / Number(ONE)) ** 2;
}

const orderComponents = [
  { name: "y", type: "uint128" },
  { name: "z", type: "uint128" },
  { name: "A", type: "uint64" },
  { name: "B", type: "uint64" },
] as const;

const carbonAbi = [
  {
    type: "function",
    name: "strategiesByPairCount",
    stateMutability: "view",
    inputs: [{ type: "address" }, { type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "strategiesByPair",
    stateMutability: "view",
    inputs: [{ type: "address" }, { type: "address" }, { type: "uint256" }, { type: "uint256" }],
    outputs: [
      {
        type: "tuple[]",
        components: [
          { name: "id", type: "uint256" },
          { name: "owner", type: "address" },
          { name: "tokens", type: "address[2]" },
          { name: "orders", type: "tuple[2]", components: orderComponents },
        ],
      },
    ],
  },
] as const;

export interface CarbonSide {
  /** True when this side holds DEVOX and is therefore the ask. */
  holdsToken: boolean;
  amount: bigint;
  /** Price bounds in counter-token per token, low first. */
  priceLow: number;
  priceHigh: number;
}

export interface CarbonPosition {
  strategies: number;
  sides: CarbonSide[];
  tokenLiquidity: bigint;
  nativeLiquidity: bigint;
}

/**
 * The protocol token's Carbon position, or null when nothing is posted.
 *
 * Carbon is an order book: a pair with no strategies has no price at all, which
 * is why its chart reads "not available" rather than showing zero. Returning
 * null for that case lets the caller say so plainly.
 */
export async function devoxCarbonPosition(
  net: CotiNetworkName,
): Promise<CarbonPosition | null> {
  if (net !== "mainnet") return null;

  const devox = addressesFor(net).devoxToken;
  if (!devox || /^0x0{40}$/.test(devox)) return null;

  try {
    const c = publicClient(net);
    const count = (await c.readContract({
      address: CARBON_CONTROLLER,
      abi: carbonAbi,
      functionName: "strategiesByPairCount",
      args: [devox, CARBON_NATIVE],
    })) as bigint;

    if (count === 0n) return null;

    const list = (await c.readContract({
      address: CARBON_CONTROLLER,
      abi: carbonAbi,
      functionName: "strategiesByPair",
      args: [devox, CARBON_NATIVE, 0n, count > 20n ? 20n : count],
    })) as readonly {
      tokens: readonly Address[];
      orders: readonly { y: bigint; z: bigint; A: bigint; B: bigint }[];
    }[];

    const sides: CarbonSide[] = [];
    let tokenLiquidity = 0n;
    let nativeLiquidity = 0n;

    for (const s of list) {
      s.orders.forEach((o, i) => {
        if (o.y === 0n) return;
        const holdsToken = s.tokens[i].toLowerCase() === devox.toLowerCase();
        const low = rateOf(expandRate(o.B));
        const high = rateOf(expandRate(o.B) + expandRate(o.A));

        // An order's rate is its own token out per counter-token in. For the
        // side holding DEVOX that is DEVOX-per-COTI, so the price is inverted.
        const [priceLow, priceHigh] = holdsToken
          ? [high > 0 ? 1 / high : 0, low > 0 ? 1 / low : 0]
          : [low, high];

        if (holdsToken) tokenLiquidity += o.y;
        else nativeLiquidity += o.y;

        sides.push({ holdsToken, amount: o.y, priceLow, priceHigh });
      });
    }

    return { strategies: list.length, sides, tokenLiquidity, nativeLiquidity };
  } catch {
    return null;
  }
}
