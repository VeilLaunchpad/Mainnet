import type { Address } from "viem";
import { publicClient } from "./rpc";
import { CARBON_CONTROLLER, CARBON_NATIVE } from "./carbon";
import type { CotiNetworkName } from "./chain";

/**
 * Routing a swap through COTI's order book.
 *
 * VeilSwap only has pairs for tokens launched here, which left every other
 * token on the chain untradable in this app - the page could show you a market
 * and then had nowhere to send you. The order book has depth for all of them,
 * so this builds the route.
 *
 * An order-book trade is not a path. `tradeBySourceAmount` takes a list of
 * strategies and how much of the input to send to each, and the caller is
 * responsible for choosing them well: the contract fills exactly what it is
 * told and reverts if an order cannot cover its share. So the matching that a
 * DEX router does on chain has to happen here instead.
 *
 * The curve maths below is the contract's own, re-derived rather than guessed,
 * and checked against `calculateTradeTargetAmount` on real strategies before
 * any of it was used. Two things were wrong on the first pass and are worth
 * naming because both produce plausible numbers:
 *
 *   - the marginal rate is the SQUARE of (A·y + B·z) / (z · 2^48); using it
 *     unsquared sorts the book by a monotonic function of price, so the route
 *     still "works" while filling in the wrong order;
 *   - the contract deducts a 0.2% trading fee from the target amount, so a
 *     locally computed quote is high by exactly 1/(1 - fee) and looks like a
 *     rounding bug rather than a missing fee.
 *
 * The contract is still asked for the final number. This code picks *which*
 * orders to fill; it never gets to decide what the user is told they receive.
 */

const ONE = 1n << 48n;

/** The contract's `_expandRate`: mantissa in the low 48 bits, exponent above. */
function expandRate(v: bigint): bigint {
  return (v % ONE) << (v / ONE);
}

export interface CarbonOrder {
  y: bigint;
  z: bigint;
  A: bigint;
  B: bigint;
}

/**
 * What one order gives for `x` of the source token, before the fee.
 *
 *            x · (A·y + B·z)²
 *   dy = ─────────────────────────────
 *         z²·2^96 + x·A·(A·y + B·z)
 */
export function targetAmountOf(o: CarbonOrder, x: bigint): bigint {
  const A = expandRate(o.A);
  const B = expandRate(o.B);
  if (A === 0n) return (x * B * B) / (ONE * ONE);
  const t2 = A * o.y + B * o.z;
  const denom = o.z * o.z * ONE * ONE + x * A * t2;
  if (denom === 0n) return 0n;
  return (x * t2 * t2) / denom;
}

/**
 * The most source this order can absorb, i.e. what it costs to drain it.
 *
 * Setting the target to the order's whole inventory collapses the source
 * formula, because (A·y + B·z) − A·y is just B·z:
 *
 *   dx = y·z·2^96 / ((A·y + B·z)·B)
 */
export function maxSourceOf(o: CarbonOrder): bigint {
  const A = expandRate(o.A);
  const B = expandRate(o.B);
  // B = 0 means the order's low bound is zero: it would hand out inventory for
  // nothing, and the cost to drain it diverges. Not routable.
  if (B === 0n || o.y === 0n || o.z === 0n) return 0n;
  const t2 = A * o.y + B * o.z;
  return (o.y * o.z * ONE * ONE) / (t2 * B);
}

/** Target per source at the margin. The square matters. */
export function marginalRate(o: CarbonOrder): number {
  const t2 = expandRate(o.A) * o.y + expandRate(o.B) * o.z;
  const r = Number(t2) / Number(o.z * ONE);
  return r * r;
}

export const carbonRouteAbi = [
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
          {
            name: "orders",
            type: "tuple[2]",
            components: [
              { name: "y", type: "uint128" },
              { name: "z", type: "uint128" },
              { name: "A", type: "uint64" },
              { name: "B", type: "uint64" },
            ],
          },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "calculateTradeTargetAmount",
    stateMutability: "view",
    inputs: [
      { name: "sourceToken", type: "address" },
      { name: "targetToken", type: "address" },
      {
        name: "tradeActions",
        type: "tuple[]",
        components: [
          { name: "strategyId", type: "uint256" },
          { name: "amount", type: "uint128" },
        ],
      },
    ],
    outputs: [{ type: "uint128" }],
  },
  {
    type: "function",
    name: "tradeBySourceAmount",
    stateMutability: "payable",
    inputs: [
      { name: "sourceToken", type: "address" },
      { name: "targetToken", type: "address" },
      {
        name: "tradeActions",
        type: "tuple[]",
        components: [
          { name: "strategyId", type: "uint256" },
          { name: "amount", type: "uint128" },
        ],
      },
      { name: "deadline", type: "uint256" },
      { name: "minReturn", type: "uint128" },
    ],
    outputs: [{ type: "uint128" }],
  },
] as const;

export interface TradeAction {
  strategyId: string;
  amount: string;
}

export interface CarbonRoute {
  venue: "carbon";
  /** Exactly what goes into `tradeBySourceAmount`. */
  actions: TradeAction[];
  /** The contract's own answer, fee included. Never the local estimate. */
  amountOut: string;
  /** How much of the requested input the book could actually fill. */
  amountIn: string;
  /** True when the book ran out before the whole amount was covered. */
  partial: boolean;
  strategiesUsed: number;
  /** Best marginal price seen, as target per source. For display only. */
  bestRate: number;
}

/** Carbon spells native COTI its own way; everything else here uses the zero address. */
export function toCarbonToken(addr: Address): Address {
  return addr === "0x0000000000000000000000000000000000000000" ? CARBON_NATIVE : addr;
}

interface RawStrategy {
  id: bigint;
  owner: Address;
  tokens: readonly [Address, Address];
  orders: readonly [CarbonOrder, CarbonOrder];
}

/** Every strategy on a pair, in pages the RPC will actually serve. */
async function strategiesFor(
  net: CotiNetworkName,
  a: Address,
  b: Address,
): Promise<RawStrategy[]> {
  const client = publicClient(net);

  const count = (await client
    .readContract({
      address: CARBON_CONTROLLER,
      abi: carbonRouteAbi,
      functionName: "strategiesByPairCount",
      args: [a, b],
    })
    .catch(() => 0n)) as bigint;

  if (count === 0n) return [];

  const out: RawStrategy[] = [];
  const PAGE = 100n;
  for (let start = 0n; start < count; start += PAGE) {
    const end = start + PAGE > count ? count : start + PAGE;
    const page = (await client
      .readContract({
        address: CARBON_CONTROLLER,
        abi: carbonRouteAbi,
        functionName: "strategiesByPair",
        args: [a, b, start, end],
      })
      .catch(() => [])) as readonly RawStrategy[];
    out.push(...page);
  }
  return out;
}

/**
 * Builds a route, or returns null when the book cannot serve this pair at all.
 *
 * Greedy by price: the cheapest order is filled first, then the next, until the
 * input is covered. That is the correct fill for an order book - there is no
 * better price to be had by spreading the trade across worse orders.
 */
export async function routeCarbon(
  net: CotiNetworkName,
  sourceToken: Address,
  targetToken: Address,
  amountIn: bigint,
): Promise<CarbonRoute | null> {
  if (amountIn <= 0n) return null;

  const source = toCarbonToken(sourceToken);
  const target = toCarbonToken(targetToken);
  if (source.toLowerCase() === target.toLowerCase()) return null;

  const strategies = await strategiesFor(net, source, target);
  if (strategies.length === 0) return null;

  // An order sells tokens[i], so the one that can hand us the target is the
  // side holding it.
  const candidates: { id: bigint; order: CarbonOrder; rate: number; max: bigint }[] = [];
  for (const s of strategies) {
    const i = s.tokens[0].toLowerCase() === target.toLowerCase() ? 0 : 1;
    if (s.tokens[i].toLowerCase() !== target.toLowerCase()) continue;

    const order = s.orders[i];
    if (order.y === 0n) continue;

    const max = maxSourceOf(order);
    if (max === 0n) continue;

    candidates.push({ id: s.id, order, rate: marginalRate(order), max });
  }
  if (candidates.length === 0) return null;

  // Best price first: more target per unit of source.
  candidates.sort((x, y) => y.rate - x.rate);

  const actions: TradeAction[] = [];
  let remaining = amountIn;

  for (const c of candidates) {
    if (remaining === 0n) break;
    // A hair under the computed capacity. The contract rounds its own way and
    // an action that asks for the last wei of an order reverts the whole trade.
    const capacity = (c.max * 999n) / 1000n;
    if (capacity === 0n) continue;

    const take = remaining < capacity ? remaining : capacity;
    actions.push({ strategyId: c.id.toString(), amount: take.toString() });
    remaining -= take;

    // Carbon caps how many orders one trade may touch, and a huge action list
    // costs more gas than the price improvement is worth.
    if (actions.length >= 20) break;
  }

  if (actions.length === 0) return null;

  const filled = amountIn - remaining;

  // The contract has the final word on the output, fee and all. If it will not
  // price these actions, the route is not offered at all rather than shown with
  // a number this file made up.
  const amountOut = (await publicClient(net)
    .readContract({
      address: CARBON_CONTROLLER,
      abi: carbonRouteAbi,
      functionName: "calculateTradeTargetAmount",
      args: [
        source,
        target,
        actions.map((a) => ({ strategyId: BigInt(a.strategyId), amount: BigInt(a.amount) })),
      ],
    })
    .catch(() => null)) as bigint | null;

  if (amountOut === null || amountOut === 0n) return null;

  return {
    venue: "carbon",
    actions,
    amountOut: amountOut.toString(),
    amountIn: filled.toString(),
    partial: remaining > 0n,
    strategiesUsed: actions.length,
    bestRate: candidates[0].rate,
  };
}

/** Whether the order book has anything at all for this pair. */
export async function carbonHasPair(
  net: CotiNetworkName,
  a: Address,
  b: Address,
): Promise<boolean> {
  const count = (await publicClient(net)
    .readContract({
      address: CARBON_CONTROLLER,
      abi: carbonRouteAbi,
      functionName: "strategiesByPairCount",
      args: [toCarbonToken(a), toCarbonToken(b)],
    })
    .catch(() => 0n)) as bigint;
  return count > 0n;
}
