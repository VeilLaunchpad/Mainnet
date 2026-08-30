import { ethers, network } from "hardhat";

/**
 * Uses the product, on mainnet, with real value.
 *
 * Everything here was deployed and then left untouched, which makes the whole
 * app read as empty even when it works perfectly. This puts a real position in
 * every pool and a real listing on the marketplace, so the pages have something
 * true to show and anyone can follow the transactions on CotiScan.
 *
 * Each step is independent and skips itself if it has already been done, so
 * this is safe to re-run.
 *
 * Four interfaces here are not what you would guess, and each one cost a
 * reverted transaction to find out:
 *
 *   DevoxSwap        is not a Uniswap fork. The router takes a token, not a
 *                   path: swapExactCotiForTokens(token, minOut, to, deadline).
 *
 *   COTI's bridge   has a separate native interface. `deposit` takes only the
 *                   two oracle stamps - the amount rides in msg.value - and the
 *                   fee is taken *out of* what you send, so N COTI in mints
 *                   N - fee p.COTI.
 *
 *   p.COTI          is a PrivateERC20. Its approve refuses to overwrite a
 *                   non-zero allowance, so a failed attempt leaves a stale
 *                   approval that blocks the next one until it is zeroed.
 *
 *   gCOTI           has no DevoxSwap pair; it only trades on the order book, and
 *                   an order-book trade has to name the strategies it fills
 *                   against.
 *
 *   npx hardhat run scripts/seed-history.ts --network cotiMainnet
 */

const STAKING = "0xEfACd7A94FDf34B5b35965D23d25c1509fa57546";
const ROUTER = "0x8C464A9Ad2E08209f4e92D8c912d9B9467a2d74a";
const DEVOX = "0x11728cBe1734b437723D06Dd137549e05f358888";
const GCOTI = "0x7637C7838EC4Ec6b85080F28A678F8E234bB83D1";
const P_COTI = "0xD2F2692B83C3ecDF2EAa0f7c2632BBd46Ae1cC91";
const COTI_BRIDGE = "0x44D864973392064304dD88E2BDef39fF1ab11b7b";
const CARBON = "0x59f21012B2E9BA67ce6a7605E74F945D0D4C84EA";
const CARBON_NATIVE = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const GENESIS = "0xD1F29a647CF56C0b13c1555794B5C383E0b08888";
const NFT_STAKING = "0x4CE6e04338bB15334c52290F145A50e1Cdc73546";
const MARKET = "0x93604ce0a1DD3f3A136a759E52f86b09218E0Fb8";

const erc20 = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
];
const routerAbi = [
  "function quoteBuyWithCoti(address,uint256) view returns (uint256)",
  "function swapExactCotiForTokens(address token,uint256 amountOutMin,address to,uint256 deadline) payable returns (uint256)",
];
const nativeBridgeAbi = [
  "function deposit(uint256 cotiOracleTimestamp,uint256 tokenOracleTimestamp) payable",
  "function estimateDepositFee(uint256) view returns (uint256 fee,uint256 cotiLastUpdated,uint256 blockTimestamp)",
  "function isDepositEnabled() view returns (bool)",
  "function paused() view returns (bool)",
];
const carbonAbi = [
  "function calculateTradeTargetAmount(address,address,(uint256 strategyId,uint128 amount)[]) view returns (uint128)",
  "function tradeBySourceAmount(address,address,(uint256 strategyId,uint128 amount)[],uint256,uint128) payable returns (uint128)",
];

/** A gCOTI-selling strategy with inventory, read off the book beforehand. */
const GCOTI_STRATEGY = 340282366920938463463374607431768211465n;

async function main() {
  if (network.name !== "cotiMainnet") throw new Error("this is a mainnet script, on purpose");
  const [me] = await ethers.getSigners();
  const staking = await ethers.getContractAt("DevoxStaking", STAKING);

  console.log("wallet :", me.address);
  console.log("balance:", ethers.formatEther(await ethers.provider.getBalance(me.address)), "COTI\n");

  const step = async (label: string, run: () => Promise<string | null>) => {
    process.stdout.write("  " + label.padEnd(40));
    try {
      const hash = await run();
      console.log(hash ? "ok  " + hash.slice(0, 18) + "…" : "already done");
    } catch (e) {
      console.log("skipped: " + String((e as Error).message).split("\n")[0].slice(0, 80));
    }
  };

  const staked = async (pid: number) => (await staking.stakeOf(pid, me.address)).amount as bigint;

  console.log("token staking:");

  await step("pool 0 · 20 COTI · 10% APY", async () => {
    if ((await staked(0)) > 0n) return null;
    const tx = await staking.stake(0, ethers.parseEther("20"), {
      value: ethers.parseEther("20"),
      gasLimit: 1_000_000,
    });
    await tx.wait();
    return tx.hash;
  });

  await step("pool 3 · 1,000,000 DEVOX · 18% APY", async () => {
    if ((await staked(3)) > 0n) return null;
    const amount = ethers.parseUnits("1000000", 18);
    const t = new ethers.Contract(DEVOX, erc20, me);
    await (await t.approve(STAKING, amount, { gasLimit: 200_000 })).wait();
    const tx = await staking.stake(3, amount, { gasLimit: 1_000_000 });
    await tx.wait();
    return tx.hash;
  });

  await step("pool 1 · gCOTI · 12% APY", async () => {
    if ((await staked(1)) > 0n) return null;

    // No DevoxSwap pair, so buy it on the order book first.
    const g = new ethers.Contract(GCOTI, erc20, me);
    let held = (await g.balanceOf(me.address)) as bigint;
    if (held < ethers.parseEther("0.1")) {
      const carbon = new ethers.Contract(CARBON, carbonAbi, me);
      const actions = [{ strategyId: GCOTI_STRATEGY, amount: ethers.parseEther("3") }];
      const out = (await carbon.calculateTradeTargetAmount(CARBON_NATIVE, GCOTI, actions)) as bigint;
      const buy = await carbon.tradeBySourceAmount(
        CARBON_NATIVE,
        GCOTI,
        actions,
        Math.floor(Date.now() / 1000) + 1200,
        (out * 97n) / 100n,
        { value: ethers.parseEther("3"), gasLimit: 6_000_000 },
      );
      await buy.wait();
      held = (await g.balanceOf(me.address)) as bigint;
    }

    await (await g.approve(STAKING, held, { gasLimit: 300_000 })).wait();
    const tx = await staking.stake(1, held, { gasLimit: 1_000_000 });
    await tx.wait();
    return tx.hash;
  });

  await step("pool 2 · p.COTI · 14% APY", async () => {
    if ((await staked(2)) > 0n) return null;

    // p.COTI comes from COTI's own privacy bridge, not from DEVOXPAD's portal -
    // the portal mints a twin of its own at a different address.
    const bridge = new ethers.Contract(COTI_BRIDGE, nativeBridgeAbi, me);
    if (!(await bridge.isDepositEnabled()) || (await bridge.paused())) {
      throw new Error("COTI's bridge is not accepting deposits");
    }

    const send = ethers.parseEther("20");
    const q = await bridge.estimateDepositFee(send);
    const receives = send - (q[0] as bigint); // the fee comes out of the amount
    if (receives <= 0n) throw new Error("fee exceeds the amount");

    // Both stamps are the COTI one for a native deposit, and the contract
    // compares them for equality - so the quote is spent immediately.
    await (await bridge.deposit(q[1], q[1], { value: send, gasLimit: 14_000_000 })).wait();

    // PrivateERC20 refuses to overwrite a non-zero allowance, and a previous
    // failed run may have left one. Zero it first, always.
    const priv = new ethers.Contract(P_COTI, erc20, me);
    await (await priv.approve(STAKING, 0n, { gasLimit: 12_000_000 })).wait();
    await (await priv.approve(STAKING, receives, { gasLimit: 12_000_000 })).wait();

    // A private balance is a ciphertext the pool cannot measure, which is why
    // the pool carries a privateToken flag and credits the amount passed in.
    const tx = await staking.stake(2, receives, { gasLimit: 12_000_000 });
    await tx.wait();
    return tx.hash;
  });

  await step("claim pool 3", async () => {
    if ((await staking.pendingReward(3, me.address)) === 0n) return null;
    const tx = await staking.claim(3, { gasLimit: 1_000_000 });
    await tx.wait();
    return tx.hash;
  });

  /* ── DevoxSwap ─────────────────────────────────────────────────────────── */
  console.log("\nDevoxSwap:");
  await step("buy DEVOX with 2 COTI", async () => {
    const router = new ethers.Contract(ROUTER, routerAbi, me);
    const amountIn = ethers.parseEther("2");
    const out = (await router.quoteBuyWithCoti(DEVOX, amountIn)) as bigint;
    const tx = await router.swapExactCotiForTokens(
      DEVOX,
      (out * 97n) / 100n,
      me.address,
      Math.floor(Date.now() / 1000) + 1200,
      { value: amountIn, gasLimit: 3_000_000 },
    );
    await tx.wait();
    return tx.hash;
  });

  /* ── NFTs ─────────────────────────────────────────────────────────────── */
  console.log("\nNFTs:");
  const drop = await ethers.getContractAt("DevoxNFTDrop", GENESIS);
  const market = await ethers.getContractAt("DevoxNFTMarket", MARKET);
  const nftStaking = await ethers.getContractAt("DevoxNFTStaking", NFT_STAKING);

  await step("mint Genesis", async () => {
    if ((await drop.balanceOf(me.address)) > 0n) return null;
    const tx = await drop.mint(2, { value: 0, gasLimit: 12_000_000 });
    await tx.wait();
    return tx.hash;
  });

  await step("stake Genesis #1", async () => {
    const stake = await nftStaking.stakeOf(0, me.address);
    if (stake.count > 0n) return null;
    if (!(await drop.isApprovedForAll(me.address, NFT_STAKING))) {
      await (await drop.setApprovalForAll(NFT_STAKING, true, { gasLimit: 1_000_000 })).wait();
    }
    const tx = await nftStaking.stake(0, [1n], { gasLimit: 2_000_000 });
    await tx.wait();
    return tx.hash;
  });

  await step("list one on the marketplace", async () => {
    const count = await market.listingCount();
    for (let i = 0n; i < count; i++) {
      const [live] = await market.listingLive(i);
      if (live) return null; // something is already up
    }
    if (!(await drop.isApprovedForAll(me.address, MARKET))) {
      await (await drop.setApprovalForAll(MARKET, true, { gasLimit: 1_000_000 })).wait();
    }
    const tx = await market.list(GENESIS, 2n, ethers.ZeroAddress, ethers.parseEther("25"), {
      gasLimit: 1_000_000,
    });
    await tx.wait();
    return tx.hash;
  });

  /* ── where it landed ──────────────────────────────────────────────────── */
  console.log("\npositions:");
  for (const pid of [0, 1, 2, 3]) {
    const v = await staking.poolView(pid);
    const mine = await staking.stakeOf(pid, me.address);
    console.log(
      "  pool " + pid + "  " + (Number(v.apyBps) / 100).toFixed(0).padStart(2) + "%  " +
        ethers.formatUnits(mine.amount, 18),
    );
  }
  console.log("  Genesis minted " + (await drop.totalMinted()) + ", listings " + (await market.listingCount()));
  console.log("  COTI left: " + ethers.formatEther(await ethers.provider.getBalance(me.address)));
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
