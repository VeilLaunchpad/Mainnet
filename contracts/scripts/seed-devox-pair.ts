import { ethers, network } from "hardhat";

/**
 * Opens the DEVOX/WCOTI market on DevoxSwap, and proves it works.
 *
 * DEVOXPAD cannot go on a bonding curve, and that is not a gap in the plumbing -
 * it is the token keeping its promise. DevoxCurve mints on every buy and burns on
 * every sell, and DevoxpadToken has no mint function at all. Bonding it would
 * mean redeploying the token with a minter and giving up the one property that
 * is verified on chain and printed on every card.
 *
 * A real pair is the better answer anyway. A bespoke curve is tradable in
 * exactly one interface; a constant-product pair is composable, so any router,
 * aggregator or bot that can reach DevoxSwap can price and route DEVOX without
 * anyone's permission.
 *
 * The first deposit sets the price permanently, since there is no prior ratio to
 * anchor to. That number came from the operator, not from this script.
 *
 * After seeding it buys and sells a small amount, because a pool that exists is
 * not the same as a pool that works, and the difference is worth one COTI to
 * find out.
 */

/**
 * Overridable so the whole run can be rehearsed on testnet at a size the
 * faucet can cover. The mainnet numbers are the defaults, and they were chosen
 * by the operator rather than by this file.
 */
const COTI_IN = ethers.parseEther(process.env.SEED_COTI || "60");
const DEVOX_IN = ethers.parseUnits(process.env.SEED_DEVOX || "1200000", 18);

/** Enough to prove both directions execute, small enough not to matter. */
const PROBE = ethers.parseEther(process.env.SEED_PROBE || "1");

const suffix = () => (network.name === "cotiMainnet" ? "MAINNET" : "TESTNET");
const env = (k: string) => process.env[k + "_" + suffix()] || "";

async function main() {
  const [signer] = await ethers.getSigners();

  const devox = env("NEXT_PUBLIC_DEVOX_TOKEN");
  const router = env("NEXT_PUBLIC_SWAP_ROUTER");
  const factory = env("NEXT_PUBLIC_SWAP_FACTORY");
  const wcoti = env("NEXT_PUBLIC_WCOTI");
  if (!devox || !router || !factory || !wcoti) throw new Error("addresses missing for " + network.name);

  const token = await ethers.getContractAt("DevoxpadToken", devox);
  const swap = await ethers.getContractAt("DevoxSwapRouter", router);
  const fac = await ethers.getContractAt("DevoxSwapFactory", factory);

  const coti = await ethers.provider.getBalance(signer.address);
  const held = await token.balanceOf(signer.address);

  console.log("network :", network.name);
  console.log("signer  :", signer.address);
  console.log("DEVOX    :", devox);
  console.log("balance :", ethers.formatEther(coti), "COTI /", ethers.formatUnits(held, 18), "DEVOX\n");

  if (coti < COTI_IN + ethers.parseEther(process.env.SEED_GAS_BUFFER || "5")) {
    throw new Error("not enough COTI to seed and still pay gas");
  }
  if (held < DEVOX_IN) throw new Error("not enough DEVOX");

  const existing = await fac.getPair(devox, wcoti);
  if (existing !== ethers.ZeroAddress) {
    console.log("a pair already exists at", existing);
    console.log("refusing to seed twice - adding to a live pool is a different operation.");
    return;
  }

  // ── seed ────────────────────────────────────────────────────────────────
  console.log("seeding the pair");
  console.log("  " + ethers.formatEther(COTI_IN) + " COTI + " + ethers.formatUnits(DEVOX_IN, 18) + " DEVOX");
  console.log(
    "  start price " +
      (Number(ethers.formatEther(COTI_IN)) / Number(ethers.formatUnits(DEVOX_IN, 18))).toFixed(8) +
      " COTI per DEVOX",
  );

  await (await token.approve(router, DEVOX_IN, { gasLimit: 200_000 })).wait();
  console.log("  approved the router");

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 900);
  const add = await swap.addLiquidityCoti(devox, DEVOX_IN, signer.address, deadline, {
    value: COTI_IN,
    gasLimit: 6_000_000,
  });
  await add.wait();

  const pair = await fac.getPair(devox, wcoti);
  console.log("  pair " + pair);

  const p = await ethers.getContractAt("DevoxSwapPair", pair);
  const [r0, r1] = await p.getReserves();
  const t0 = await p.token0();
  const devoxRes = t0.toLowerCase() === devox.toLowerCase() ? r0 : r1;
  const cotiRes = t0.toLowerCase() === devox.toLowerCase() ? r1 : r0;
  console.log(
    "  reserves " + ethers.formatUnits(devoxRes, 18) + " DEVOX / " + ethers.formatEther(cotiRes) + " WCOTI",
  );

  // ── prove it trades ─────────────────────────────────────────────────────
  console.log("\nbuying " + ethers.formatEther(PROBE) + " COTI worth");
  const quoted = await swap.quoteBuyWithCoti(devox, PROBE);
  const before = await token.balanceOf(signer.address);

  await (
    await swap.swapExactCotiForTokens(devox, (quoted * 95n) / 100n, signer.address, deadline, {
      value: PROBE,
      gasLimit: 6_000_000,
    })
  ).wait();

  const bought = (await token.balanceOf(signer.address)) - before;
  console.log("  quoted " + ethers.formatUnits(quoted, 18) + " DEVOX");
  console.log("  got    " + ethers.formatUnits(bought, 18) + " DEVOX");

  console.log("\nselling it straight back");
  await (await token.approve(router, bought, { gasLimit: 200_000 })).wait();
  const cotiBefore = await ethers.provider.getBalance(signer.address);
  await (
    await swap.swapExactTokensForCoti(devox, bought, 0, signer.address, deadline, { gasLimit: 6_000_000 })
  ).wait();
  const back = (await ethers.provider.getBalance(signer.address)) - cotiBefore;

  console.log("  received " + ethers.formatEther(back) + " COTI back, after gas and the 0.3% fee both ways");

  const price = await swap.priceInCoti(devox);
  console.log("\nprice now " + ethers.formatEther(price) + " COTI per DEVOX");
  console.log("DEVOX is buyable and sellable on DevoxSwap.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
