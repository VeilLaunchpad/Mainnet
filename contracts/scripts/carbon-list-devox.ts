import { ethers, network } from "hardhat";

/**
 * Lists DEVOX on Carbon DeFi by posting a two-sided position.
 *
 * Carbon is an order book, not an AMM. A pair does not exist until somebody
 * posts an order for it, which is exactly why coti.carbondefi.xyz says "price
 * data for this pair is currently not available" for DEVOX/COTI - not a broken
 * listing, just an empty book. Posting a strategy is what creates it.
 *
 * The rate codec is the part worth being careful about, because getting it
 * wrong means real money sitting at a nonsense price waiting to be arbitraged.
 * Two things are easy to get wrong and both were, first time round:
 *
 *   1. The bit layout. `_expandRate(v) = (v % 2^48) << (v / 2^48)`: the mantissa
 *      is the LOW 48 bits and the exponent is the high bits, not the reverse.
 *   2. A and B expand INDEPENDENTLY. sqrtH*2^48 is expand(B) + expand(A), not
 *      expand(B + A). Adding the encoded values first gives garbage.
 *
 * Rate direction: each order's rate is "wei of THIS order's own token paid OUT
 * per 1 wei of the other token paid IN". So the COTI-holding order is the bid
 * for DEVOX, and the DEVOX-holding order is the ask. An order starts at its most
 * aggressive price (M = H when z == y) and improves for the owner as it fills.
 *
 * Run with DRY=1 to print the decoded book without sending anything.
 */

const CARBON = "0x59f21012B2E9BA67ce6a7605E74F945D0D4C84EA";
const NATIVE = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

const ONE = 1n << 48n;

/** Integer square root, so the sqrt-space bounds never touch a float. */
function isqrt(n: bigint): bigint {
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

/** sqrt(num/den) scaled by 2^48, computed entirely in integers. */
function sqrtScaled(num: bigint, den: bigint): bigint {
  return isqrt((num << 96n) / den);
}

const bitLength = (x: bigint) => (x <= 0n ? 0 : x.toString(2).length);

/** The contract's own float: mantissa in the low 48 bits, exponent above. */
function encodeFloat(x: bigint): bigint {
  const c = BigInt(Math.max(bitLength(x) - 48, 0));
  return (x >> c) | (c << 48n);
}

function expand(v: bigint): bigint {
  return (v % ONE) << (v / ONE);
}

/** A rate expressed as an exact fraction, to keep the encoding honest. */
interface Rate {
  num: bigint;
  den: bigint;
}

/**
 * Encodes one order.
 *
 * `low` and `high` are rates, not prices, and high is the rate the order starts
 * at. A and B are what the contract stores.
 */
function encodeOrder(y: bigint, low: Rate, high: Rate) {
  const sqrtL = sqrtScaled(low.num, low.den);
  const sqrtH = sqrtScaled(high.num, high.den);
  if (sqrtH < sqrtL) throw new Error("high rate is below low rate");

  const B = encodeFloat(sqrtL);
  const A = encodeFloat(sqrtH - sqrtL);

  // Read it straight back, the way the contract will.
  const l = Number(expand(B)) / Number(ONE);
  const h = (Number(expand(B)) + Number(expand(A))) / Number(ONE);
  return { y, z: y, A, B, decoded: { low: l * l, high: h * h } };
}

const rate = (num: number, den: number): Rate => {
  // Scale both sides to integers without losing the ratio.
  const f = 1e9;
  return { num: BigInt(Math.round(num * f)), den: BigInt(Math.round(den * f)) };
};

async function main() {
  if (network.name !== "cotiMainnet") throw new Error("Carbon is deployed on COTI mainnet only");

  const [signer] = await ethers.getSigners();
  const devox = process.env.NEXT_PUBLIC_DEVOX_TOKEN_MAINNET || "";
  if (!devox) throw new Error("DEVOXPAD address missing");

  // ── the position ────────────────────────────────────────────────────────
  // DevoxSwap prices DEVOX at 0.00005 COTI. The book straddles that: bid a little
  // under, ask a little over, so the two never cross and neither is instantly
  // arbitraged against the pair.
  const COTI_IN = ethers.parseEther("20");
  const DEVOX_IN = ethers.parseUnits("400000", 18);

  const BID_LOW = 0.000040;   // COTI per DEVOX, the price it walks down to
  const BID_HIGH = 0.000048;  // and the price it starts buying at
  const ASK_LOW = 0.000052;   // COTI per DEVOX, the price it starts selling at
  const ASK_HIGH = 0.000062;  // and the price it walks up to

  // The COTI order pays out COTI for DEVOX, so its rate is COTI per DEVOX: the bid
  // itself. It starts at its most generous, which is the higher rate.
  const cotiOrder = encodeOrder(COTI_IN, rate(BID_LOW, 1), rate(BID_HIGH, 1));

  // The DEVOX order pays out DEVOX for COTI, so its rate is DEVOX per COTI, which
  // is the reciprocal of the ask. Starting most eager means the cheapest ask,
  // which is the highest rate.
  const devoxOrder = encodeOrder(DEVOX_IN, rate(1, ASK_HIGH), rate(1, ASK_LOW));

  console.log("network :", network.name);
  console.log("signer  :", signer.address);
  console.log("DEVOX    :", devox);
  console.log("");
  console.log("position");
  console.log("  bid  " + ethers.formatEther(COTI_IN) + " COTI, buying DEVOX at " +
    cotiOrder.decoded.low.toExponential(4) + " .. " + cotiOrder.decoded.high.toExponential(4) + " COTI each");
  console.log("  ask  " + ethers.formatUnits(DEVOX_IN, 18) + " DEVOX, selling at " +
    (1 / devoxOrder.decoded.high).toExponential(4) + " .. " + (1 / devoxOrder.decoded.low).toExponential(4) + " COTI each");
  console.log("");
  console.log("encoded");
  console.log("  coti  y=" + cotiOrder.y + " z=" + cotiOrder.z + " A=" + cotiOrder.A + " B=" + cotiOrder.B);
  console.log("  devox  y=" + devoxOrder.y + " z=" + devoxOrder.z + " A=" + devoxOrder.A + " B=" + devoxOrder.B);

  // Both exponents must fit, or the contract rejects the rate outright.
  for (const [name, o] of [["coti", cotiOrder], ["devox", devoxOrder]] as const) {
    for (const [f, v] of [["A", o.A], ["B", o.B]] as const) {
      if (v / ONE > 48n) throw new Error(`${name}.${f} exponent ${v / ONE} exceeds 48`);
    }
  }

  // Sanity: the ask must sit above the bid, or the position trades against itself.
  const bestBid = cotiOrder.decoded.high;
  const bestAsk = 1 / devoxOrder.decoded.high;
  console.log("\n  best bid " + bestBid.toExponential(4) + "  best ask " + bestAsk.toExponential(4));
  if (bestAsk <= bestBid) throw new Error("the ask crosses the bid - this position would eat itself");

  if (process.env.DRY) {
    console.log("\nDRY=1, nothing sent.");
    return;
  }

  // ── send it ─────────────────────────────────────────────────────────────
  const abi = [
    "function createStrategy(address token0, address token1, (uint128 y, uint128 z, uint64 A, uint64 B)[2] orders) payable returns (uint256)",
  ];
  const carbon = new ethers.Contract(CARBON, abi, signer);

  const token = await ethers.getContractAt("DevoxpadToken", devox);
  const current = await token.allowance(signer.address, CARBON);
  if (current < DEVOX_IN) {
    await (await token.approve(CARBON, DEVOX_IN, { gasLimit: 200_000 })).wait();
    console.log("\napproved Carbon for " + ethers.formatUnits(DEVOX_IN, 18) + " DEVOX");
  }

  // tokens[i] must line up with orders[i]; the contract does not need them sorted.
  const tx = await carbon.createStrategy(
    devox,
    NATIVE,
    [
      { y: devoxOrder.y, z: devoxOrder.z, A: devoxOrder.A, B: devoxOrder.B },
      { y: cotiOrder.y, z: cotiOrder.z, A: cotiOrder.A, B: cotiOrder.B },
    ],
    { value: COTI_IN, gasLimit: 6_000_000 },
  );
  const receipt = await tx.wait();
  console.log("\ncreated in block " + receipt?.blockNumber);
  console.log("tx " + tx.hash);
  console.log("\nDEVOX/COTI is now quoted on Carbon:");
  console.log("  https://coti.carbondefi.xyz/trade/market?base=" + NATIVE + "&quote=" + devox);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
