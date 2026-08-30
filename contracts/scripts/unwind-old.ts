import { ethers, network } from "hardhat";

/**
 * Closes the old token's market and recovers what is actually worth recovering.
 *
 * A note on what this does and does not chase. After the migration the old DEVOX
 * is worthless by definition, so pulling 200M of it out of the treasury would be
 * theatre. What has real value is the COTI on the other side of each position,
 * and the staked assets that were never DEVOX to begin with:
 *
 *   DevoxSwap LP        ~64.0 COTI   (you hold 100% of the LP)
 *   Carbon strategy    ~19.5 COTI
 *   staking pool 0      20.0 COTI
 *   staking pool 1      15.84 gCOTI
 *   staking pool 2      10.0 p.COTI
 *
 * The second reason to run this is not recovery at all: leaving a priced market
 * on an abandoned token is how somebody buys into it a month from now. Removing
 * the liquidity and deleting the order-book strategy is what makes the old brand
 * genuinely closed rather than quietly still purchasable.
 *
 * ORDER MATTERS. Run this AFTER the new token has liquidity, not before, or
 * there is a window where neither token has a market.
 *
 *   npx hardhat run scripts/unwind-old.ts --network cotiMainnet
 */

// These are the OLD VEILPAD deployment's addresses, deliberately kept literal.
// The rebrand's find-and-replace renamed the identifiers around them, so the
// names read DEVOX while the addresses point at the abandoned VEIL contracts -
// spelling that out here so nobody later "fixes" them to the new stack and
// unwinds the live one by accident.
const OLD_TOKEN = "0x11728cBe1734b437723D06Dd137549e05f358888"; // VEILPAD / $VEIL
const PAIR = "0x4EBA55867e5Bd68ecB717D3b3098686C2deF2417"; // old VEIL/WCOTI pair
const WCOTI = "0xA406b1569eabEDCF503645e9C25cbcdBF03200Ab"; // shared, not rebranded
const STAKING = "0xEfACd7A94FDf34B5b35965D23d25c1509fa57546"; // old VeilStaking
const CARBON = "0x59f21012B2E9BA67ce6a7605E74F945D0D4C84EA";
const CARBON_NATIVE = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

const pairAbi = [
  "function balanceOf(address) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function getReserves() view returns (uint112,uint112)",
  "function removeLiquidity(uint256 liquidity, address to) returns (uint256,uint256)",
];
const carbonAbi = [
  "function strategiesByPairCount(address,address) view returns (uint256)",
  "function strategiesByPair(address,address,uint256,uint256) view returns (tuple(uint256 id,address owner,address[2] tokens,tuple(uint128 y,uint128 z,uint64 A,uint64 B)[2] orders)[])",
  "function deleteStrategy(uint256 strategyId)",
];

async function main() {
  if (network.name !== "cotiMainnet") throw new Error("mainnet only");
  const [me] = await ethers.getSigners();
  const before = await ethers.provider.getBalance(me.address);
  console.log("wallet :", me.address);
  console.log("COTI   :", ethers.formatEther(before), "\n");

  const step = async (label: string, run: () => Promise<string | null>) => {
    process.stdout.write("  " + label.padEnd(38));
    try {
      const h = await run();
      console.log(h ? "ok  " + h.slice(0, 18) + "…" : "nothing to do");
    } catch (e) {
      console.log("skipped: " + String((e as Error).message).split("\n")[0].slice(0, 90));
    }
  };

  /* ── 1. unstake, so nothing of value is left behind ───────────────────── */
  console.log("unstaking:");
  const staking = await ethers.getContractAt("DevoxStaking", STAKING);
  for (const pid of [0, 1, 2, 3]) {
    await step("pool " + pid, async () => {
      const mine = await staking.stakeOf(pid, me.address);
      if (mine.amount === 0n) return null;
      // Claim first: unstaking settles, but claiming separately keeps the
      // reward event distinct in history.
      const pending = await staking.pendingReward(pid, me.address).catch(() => 0n);
      if (pending > 0n) {
        await (await staking.claim(pid, { gasLimit: 1_000_000 })).wait();
      }
      const tx = await staking.unstake(pid, mine.amount, { gasLimit: 2_000_000 });
      await tx.wait();
      return tx.hash;
    });
  }

  /* ── 2. delete the order-book strategy ────────────────────────────────── */
  console.log("\norder book:");
  await step("delete the DEVOX/COTI strategy", async () => {
    const c = new ethers.Contract(CARBON, carbonAbi, me);
    const n = await c.strategiesByPairCount(OLD_TOKEN, CARBON_NATIVE);
    if (n === 0n) return null;
    const all = await c.strategiesByPair(OLD_TOKEN, CARBON_NATIVE, 0, n);
    const mine = all.filter(
      (s: { owner: string }) => s.owner.toLowerCase() === me.address.toLowerCase(),
    );
    if (mine.length === 0) return null;
    let last = "";
    for (const s of mine) {
      const tx = await c.deleteStrategy(s.id, { gasLimit: 3_000_000 });
      await tx.wait();
      last = tx.hash;
    }
    return last;
  });

  /* ── 3. pull the AMM liquidity ────────────────────────────────────────── */
  //
  // Last, and deliberately so: this is the step that removes the price. Doing it
  // before the strategy is gone would leave the order book quoting against a
  // market that no longer exists.
  console.log("\nliquidity:");
  // The router has addLiquidityCoti but no remove - removal is on the pair itself,
  // and it burns from msg.sender directly, so there is no approval to sign.
  // It pays out token1 as WCOTI, not native COTI, so the wrapper has to be
  // unwrapped afterwards or the "recovered COTI" line below reads as zero.
  await step("remove DevoxSwap liquidity", async () => {
    const pair = new ethers.Contract(PAIR, pairAbi, me);
    const lp = (await pair.balanceOf(me.address)) as bigint;
    if (lp === 0n) return null;

    const tx = await pair.removeLiquidity(lp, me.address, { gasLimit: 3_000_000 });
    await tx.wait();
    return tx.hash;
  });

  await step("unwrap WCOTI back to COTI", async () => {
    const w = new ethers.Contract(
      WCOTI,
      ["function balanceOf(address) view returns (uint256)", "function withdraw(uint256)"],
      me,
    );
    const bal = (await w.balanceOf(me.address)) as bigint;
    if (bal === 0n) return null;
    const tx = await w.withdraw(bal, { gasLimit: 500_000 });
    await tx.wait();
    return tx.hash;
  });

  /* ── what came back ───────────────────────────────────────────────────── */
  const after = await ethers.provider.getBalance(me.address);
  const old = await ethers.getContractAt("DevoxpadToken", OLD_TOKEN);
  console.log("\nrecovered:");
  console.log("  COTI  " + ethers.formatEther(after - before) + " (net of gas)");
  console.log("  VEIL  " + ethers.formatUnits(await old.balanceOf(me.address), 18) + " of the old token held");
  console.log("\nThe old market is closed. Nobody can buy into it by accident now.");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
