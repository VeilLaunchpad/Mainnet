import { ethers, network } from "hardhat";

/**
 * Opens the VEIL/WCOTI market on VeilSwap, and proves it works.
 *
 * VEILPAD cannot go on a bonding curve, and that is not a gap in the plumbing -
 * it is the token keeping its promise. VeilCurve mints on every buy and burns on
 * every sell, and VeilpadToken has no mint function at all. Bonding it would
 * mean redeploying the token with a minter and giving up the one property that
 * is verified on chain and printed on every card.
 *
 * A real pair is the better answer anyway. A bespoke curve is tradable in
 * exactly one interface; a constant-product pair is composable, so any router,
 * aggregator or bot that can reach VeilSwap can price and route VEIL without
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
const VEIL_IN = ethers.parseUnits(process.env.SEED_VEIL || "1200000", 18);

/** Enough to prove both directions execute, small enough not to matter. */
const PROBE = ethers.parseEther(process.env.SEED_PROBE || "1");

const suffix = () => (network.name === "cotiMainnet" ? "MAINNET" : "TESTNET");
const env = (k: string) => process.env[k + "_" + suffix()] || "";

async function main() {
  const [signer] = await ethers.getSigners();

  const veil = env("NEXT_PUBLIC_VEIL_TOKEN");
  const router = env("NEXT_PUBLIC_SWAP_ROUTER");
  const factory = env("NEXT_PUBLIC_SWAP_FACTORY");
  const wcoti = env("NEXT_PUBLIC_WCOTI");
  if (!veil || !router || !factory || !wcoti) throw new Error("addresses missing for " + network.name);

  const token = await ethers.getContractAt("VeilpadToken", veil);
  const swap = await ethers.getContractAt("VeilSwapRouter", router);
  const fac = await ethers.getContractAt("VeilSwapFactory", factory);

  const coti = await ethers.provider.getBalance(signer.address);
  const held = await token.balanceOf(signer.address);

  console.log("network :", network.name);
  console.log("signer  :", signer.address);
  console.log("VEIL    :", veil);
  console.log("balance :", ethers.formatEther(coti), "COTI /", ethers.formatUnits(held, 18), "VEIL\n");

  if (coti < COTI_IN + ethers.parseEther(process.env.SEED_GAS_BUFFER || "5")) {
    throw new Error("not enough COTI to seed and still pay gas");
  }
  if (held < VEIL_IN) throw new Error("not enough VEIL");

  const existing = await fac.getPair(veil, wcoti);
  if (existing !== ethers.ZeroAddress) {
    console.log("a pair already exists at", existing);
    console.log("refusing to seed twice - adding to a live pool is a different operation.");
    return;
  }

  // ── seed ────────────────────────────────────────────────────────────────
  console.log("seeding the pair");
  console.log("  " + ethers.formatEther(COTI_IN) + " COTI + " + ethers.formatUnits(VEIL_IN, 18) + " VEIL");
  console.log(
    "  start price " +
      (Number(ethers.formatEther(COTI_IN)) / Number(ethers.formatUnits(VEIL_IN, 18))).toFixed(8) +
      " COTI per VEIL",
  );

  await (await token.approve(router, VEIL_IN, { gasLimit: 200_000 })).wait();
  console.log("  approved the router");

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 900);
  const add = await swap.addLiquidityCoti(veil, VEIL_IN, signer.address, deadline, {
    value: COTI_IN,
    gasLimit: 6_000_000,
  });
  await add.wait();

  const pair = await fac.getPair(veil, wcoti);
  console.log("  pair " + pair);

  const p = await ethers.getContractAt("VeilSwapPair", pair);
  const [r0, r1] = await p.getReserves();
  const t0 = await p.token0();
  const veilRes = t0.toLowerCase() === veil.toLowerCase() ? r0 : r1;
  const cotiRes = t0.toLowerCase() === veil.toLowerCase() ? r1 : r0;
  console.log(
    "  reserves " + ethers.formatUnits(veilRes, 18) + " VEIL / " + ethers.formatEther(cotiRes) + " WCOTI",
  );

  // ── prove it trades ─────────────────────────────────────────────────────
  console.log("\nbuying " + ethers.formatEther(PROBE) + " COTI worth");
  const quoted = await swap.quoteBuyWithCoti(veil, PROBE);
  const before = await token.balanceOf(signer.address);

  await (
    await swap.swapExactCotiForTokens(veil, (quoted * 95n) / 100n, signer.address, deadline, {
      value: PROBE,
      gasLimit: 6_000_000,
    })
  ).wait();

  const bought = (await token.balanceOf(signer.address)) - before;
  console.log("  quoted " + ethers.formatUnits(quoted, 18) + " VEIL");
  console.log("  got    " + ethers.formatUnits(bought, 18) + " VEIL");

  console.log("\nselling it straight back");
  await (await token.approve(router, bought, { gasLimit: 200_000 })).wait();
  const cotiBefore = await ethers.provider.getBalance(signer.address);
  await (
    await swap.swapExactTokensForCoti(veil, bought, 0, signer.address, deadline, { gasLimit: 6_000_000 })
  ).wait();
  const back = (await ethers.provider.getBalance(signer.address)) - cotiBefore;

  console.log("  received " + ethers.formatEther(back) + " COTI back, after gas and the 0.3% fee both ways");

  const price = await swap.priceInCoti(veil);
  console.log("\nprice now " + ethers.formatEther(price) + " COTI per VEIL");
  console.log("VEIL is buyable and sellable on VeilSwap.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
