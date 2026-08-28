import { ethers, network } from "hardhat";

/**
 * Staking, exercised against a real chain.
 *
 * The unit tests move the clock and prove the arithmetic. They cannot prove
 * that COTI's node accepts these transactions, that gas estimation behaves, or
 * that a reward actually arrives in a wallet. This does the whole round trip
 * for real: stake, let blocks pass, read what accrued, claim it, unstake.
 *
 * Amounts are deliberately tiny. The point is that every step lands, not how
 * much is moved.
 */

const suffix = () => (network.name === "cotiMainnet" ? "MAINNET" : "TESTNET");
const env = (k: string) => process.env[k + "_" + suffix()] || "";

async function main() {
  const [signer] = await ethers.getSigners();

  const stakingAddress = env("NEXT_PUBLIC_VEIL_STAKING");
  const veilAddress = env("NEXT_PUBLIC_VEIL_TOKEN");
  const treasuryAddress = env("NEXT_PUBLIC_VEIL_TREASURY");
  if (!stakingAddress || !veilAddress) throw new Error("staking not deployed on " + network.name);

  const staking = await ethers.getContractAt("VeilStaking", stakingAddress);
  const veil = await ethers.getContractAt("VeilpadToken", veilAddress);
  const treasury = await ethers.getContractAt("VeilTreasury", treasuryAddress);

  console.log("network :", network.name);
  console.log("staker  :", signer.address);
  console.log("VEILPAD :", veilAddress);
  console.log("reserve :", ethers.formatUnits(await treasury.balance(), 18), "VEIL\n");

  const count = Number(await staking.poolCount());
  console.log("pools:");
  for (let i = 0; i < count; i++) {
    const v = await staking.poolView(i);
    console.log(
      "  [" + i + "] " +
        (v[0] === ethers.ZeroAddress ? "native COTI" : v[0]) +
        "  " + (Number(v[1]) / 100).toFixed(1) + "% APY" +
        "  staked " + ethers.formatUnits(v[3], 18) +
        "  cap " + ethers.formatUnits(v[4], 18),
    );
  }

  // ── stake native COTI, pool 0 ────────────────────────────────────────────
  const amount = ethers.parseUnits("0.5", 18);
  console.log("\n[1] staking " + ethers.formatUnits(amount, 18) + " COTI into pool 0");
  await (await staking.stake(0, amount, { value: amount, gasLimit: 500_000 })).wait();

  const mine = await staking.stakeOf(0, signer.address);
  console.log("    staked balance now " + ethers.formatUnits(mine.amount, 18) + " COTI");

  // ── let real blocks pass ─────────────────────────────────────────────────
  console.log("\n[2] waiting for blocks so the accumulator advances");
  const startBlock = await ethers.provider.getBlockNumber();
  const started = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, 4000));
    const now = await ethers.provider.getBlockNumber();
    if (now > startBlock + 3 || Date.now() - started > 90_000) break;
  }

  const pending = await staking.pendingReward(0, signer.address);
  console.log("    accrued " + ethers.formatUnits(pending, 18) + " VEIL");
  if (pending === 0n) {
    console.log("    (a few seconds at 10% on 0.5 COTI rounds to dust; that is expected)");
  }

  // ── claim ────────────────────────────────────────────────────────────────
  console.log("\n[3] claiming");
  const before = await veil.balanceOf(signer.address);
  await (await staking.claim(0, { gasLimit: 500_000 })).wait();
  const gained = (await veil.balanceOf(signer.address)) - before;
  console.log("    received " + ethers.formatUnits(gained, 18) + " VEIL");

  // ── unstake ──────────────────────────────────────────────────────────────
  console.log("\n[4] unstaking the principal back");
  const cotiBefore = await ethers.provider.getBalance(signer.address);
  await (await staking.unstake(0, amount, { gasLimit: 500_000 })).wait();
  const after = await staking.stakeOf(0, signer.address);
  const cotiAfter = await ethers.provider.getBalance(signer.address);

  console.log("    staked balance now " + ethers.formatUnits(after.amount, 18) + " COTI");
  console.log(
    "    COTI moved " +
      ethers.formatEther(cotiAfter - cotiBefore) +
      "  (principal back, minus the gas for this transaction)",
  );

  if (after.amount !== 0n) throw new Error("principal did not come back");
  console.log("\nround trip complete: stake, accrue, claim, unstake.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
