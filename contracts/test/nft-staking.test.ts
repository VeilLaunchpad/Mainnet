import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

/**
 * The pairing mechanism, proved rather than described.
 *
 * The claim on the page will be "stake this NFT, earn this token at this rate,
 * and the rewards are already escrowed". Each of those three is a number the
 * contract has to actually produce, so each gets a test: the rate over a year,
 * the escrow as a hard ceiling, and the NFT coming back regardless.
 */

const YEAR = 365 * 24 * 60 * 60;
const e18 = (n: string | number) => ethers.parseUnits(String(n), 18);

function near(actual: bigint, expected: bigint, tolerance = 10n ** 15n) {
  const diff = actual > expected ? actual - expected : expected - actual;
  expect(diff <= tolerance, `expected ~${expected}, got ${actual} (diff ${diff})`).to.equal(true);
}

async function setup() {
  const [owner, alice, bob] = await ethers.getSigners();

  const Token = await ethers.getContractFactory("VeilpadToken");
  const reward = await Token.deploy("Reward", "RWD", "", owner.address, e18(1_000_000_000));
  await reward.waitForDeployment();

  // A plain ERC-721 stands in for the collection here. The private drop is
  // tested separately; staking only ever needs transferFrom.
  const Nft = await ethers.getContractFactory("MockERC721");
  const nft = await Nft.deploy("Art", "ART");
  await nft.waitForDeployment();

  const Staking = await ethers.getContractFactory("VeilNFTStaking");
  const staking = await Staking.deploy(owner.address);
  await staking.waitForDeployment();

  return { owner, alice, bob, reward, nft, staking };
}

describe("VeilNFTStaking", () => {
  it("pays the stated rate per NFT over a year", async () => {
    const { owner, alice, reward, nft, staking } = await setup();

    await reward.approve(await staking.getAddress(), e18(1_000_000));
    await staking.openPool(
      await nft.getAddress(),
      await reward.getAddress(),
      e18(100),   // 100 RWD per NFT per year
      e18(1_000), // sold at 1,000 RWD, so 10% APY
      e18(1_000_000),
    );

    await nft.mint(alice.address, 1);
    await nft.connect(alice).setApprovalForAll(await staking.getAddress(), true);
    await staking.connect(alice).stake(0, [1]);

    await time.increase(YEAR);
    near(await staking.pendingReward(0, alice.address), e18(100));

    const before = await reward.balanceOf(alice.address);
    await staking.connect(alice).claim(0);
    near((await reward.balanceOf(alice.address)) - before, e18(100));
  });

  it("quotes an APY from the rate and the mint price", async () => {
    const { reward, nft, staking } = await setup();
    await reward.approve(await staking.getAddress(), e18(1_000_000));
    await staking.openPool(
      await nft.getAddress(), await reward.getAddress(),
      e18(150), e18(1_000), e18(1_000_000),
    );
    expect(await staking.apyBps(0)).to.equal(1500n); // 15%
  });

  it("quotes no APY for a free mint, rather than dividing by zero", async () => {
    const { reward, nft, staking } = await setup();
    await reward.approve(await staking.getAddress(), e18(1_000_000));
    // notionalPerNft = 0: a free mint has no price to be a percentage of.
    await staking.openPool(
      await nft.getAddress(), await reward.getAddress(),
      e18(100), 0, e18(1_000_000),
    );
    expect(await staking.apyBps(0)).to.equal(0n);
  });

  it("scales with the number staked", async () => {
    const { alice, reward, nft, staking } = await setup();
    await reward.approve(await staking.getAddress(), e18(1_000_000));
    await staking.openPool(
      await nft.getAddress(), await reward.getAddress(),
      e18(100), e18(1_000), e18(1_000_000),
    );

    for (const id of [1, 2, 3]) await nft.mint(alice.address, id);
    await nft.connect(alice).setApprovalForAll(await staking.getAddress(), true);
    await staking.connect(alice).stake(0, [1, 2, 3]);

    await time.increase(YEAR);
    near(await staking.pendingReward(0, alice.address), e18(300));
  });

  it("cannot pay more than was escrowed", async () => {
    const { alice, reward, nft, staking } = await setup();

    // A deliberately small budget: 40 RWD against a 100/year rate.
    await reward.approve(await staking.getAddress(), e18(40));
    await staking.openPool(
      await nft.getAddress(), await reward.getAddress(),
      e18(100), e18(1_000), e18(40),
    );

    await nft.mint(alice.address, 1);
    await nft.connect(alice).setApprovalForAll(await staking.getAddress(), true);
    await staking.connect(alice).stake(0, [1]);
    await time.increase(YEAR);

    const before = await reward.balanceOf(alice.address);
    await staking.connect(alice).claim(0);

    // Paid the whole escrow and not a token more; the rest stays owed.
    near((await reward.balanceOf(alice.address)) - before, e18(40));
    near(await staking.pendingReward(0, alice.address), e18(60));
    expect(await reward.balanceOf(await staking.getAddress())).to.equal(0n);
  });

  it("pays the remainder once somebody tops the pool up", async () => {
    const { owner, alice, reward, nft, staking } = await setup();
    await reward.approve(await staking.getAddress(), e18(40));
    await staking.openPool(
      await nft.getAddress(), await reward.getAddress(),
      e18(100), e18(1_000), e18(40),
    );
    await nft.mint(alice.address, 1);
    await nft.connect(alice).setApprovalForAll(await staking.getAddress(), true);
    await staking.connect(alice).stake(0, [1]);
    await time.increase(YEAR);
    await staking.connect(alice).claim(0);

    await reward.connect(owner).approve(await staking.getAddress(), e18(500));
    await staking.connect(owner).addBudget(0, e18(500));

    const before = await reward.balanceOf(alice.address);
    await staking.connect(alice).claim(0);
    near((await reward.balanceOf(alice.address)) - before, e18(60));
  });

  it("returns the NFT on unstake, with what it earned", async () => {
    const { alice, reward, nft, staking } = await setup();
    await reward.approve(await staking.getAddress(), e18(1_000_000));
    await staking.openPool(
      await nft.getAddress(), await reward.getAddress(),
      e18(100), e18(1_000), e18(1_000_000),
    );
    await nft.mint(alice.address, 7);
    await nft.connect(alice).setApprovalForAll(await staking.getAddress(), true);
    await staking.connect(alice).stake(0, [7]);
    expect(await nft.ownerOf(7)).to.equal(await staking.getAddress());

    await time.increase(YEAR);
    const before = await reward.balanceOf(alice.address);
    await staking.connect(alice).unstake(0, [7]);

    expect(await nft.ownerOf(7)).to.equal(alice.address);
    near((await reward.balanceOf(alice.address)) - before, e18(100));
  });

  it("returns the NFT through the emergency exit, keeping the reward owed", async () => {
    const { alice, reward, nft, staking } = await setup();
    await reward.approve(await staking.getAddress(), e18(1_000_000));
    await staking.openPool(
      await nft.getAddress(), await reward.getAddress(),
      e18(100), e18(1_000), e18(1_000_000),
    );
    await nft.mint(alice.address, 9);
    await nft.connect(alice).setApprovalForAll(await staking.getAddress(), true);
    await staking.connect(alice).stake(0, [9]);
    await time.increase(YEAR);

    await staking.connect(alice).emergencyUnstake(0, [9]);
    expect(await nft.ownerOf(9)).to.equal(alice.address);
    // Taking your art back must not cost you what you already earned.
    near(await staking.pendingReward(0, alice.address), e18(100));
  });

  it("refuses to unstake somebody else's token", async () => {
    const { alice, bob, reward, nft, staking } = await setup();
    await reward.approve(await staking.getAddress(), e18(1_000_000));
    await staking.openPool(
      await nft.getAddress(), await reward.getAddress(),
      e18(100), e18(1_000), e18(1_000_000),
    );
    await nft.mint(alice.address, 1);
    await nft.mint(bob.address, 2);
    await nft.connect(alice).setApprovalForAll(await staking.getAddress(), true);
    await nft.connect(bob).setApprovalForAll(await staking.getAddress(), true);
    await staking.connect(alice).stake(0, [1]);
    await staking.connect(bob).stake(0, [2]);

    await expect(staking.connect(bob).unstake(0, [1])).to.be.revertedWithCustomError(
      staking,
      "NotYourStake",
    );
  });

  it("refuses to pair the same collection twice", async () => {
    const { reward, nft, staking } = await setup();
    await reward.approve(await staking.getAddress(), e18(2_000));
    await staking.openPool(
      await nft.getAddress(), await reward.getAddress(),
      e18(100), e18(1_000), e18(1_000),
    );
    await expect(
      staking.openPool(await nft.getAddress(), await reward.getAddress(), e18(100), e18(1_000), e18(1_000)),
    ).to.be.revertedWithCustomError(staking, "AlreadyPaired");
  });

  it("refuses to open a pool with nothing escrowed", async () => {
    const { reward, nft, staking } = await setup();
    await expect(
      staking.openPool(await nft.getAddress(), await reward.getAddress(), e18(100), e18(1_000), 0),
    ).to.be.revertedWithCustomError(staking, "BudgetTooSmall");
  });

  it("lets a closed pool be exited but not entered", async () => {
    const { alice, reward, nft, staking } = await setup();
    await reward.approve(await staking.getAddress(), e18(1_000_000));
    await staking.openPool(
      await nft.getAddress(), await reward.getAddress(),
      e18(100), e18(1_000), e18(1_000_000),
    );
    await nft.mint(alice.address, 1);
    await nft.mint(alice.address, 2);
    await nft.connect(alice).setApprovalForAll(await staking.getAddress(), true);
    await staking.connect(alice).stake(0, [1]);

    await staking.setPool(0, e18(100), false);
    await expect(staking.connect(alice).stake(0, [2])).to.be.revertedWithCustomError(staking, "PoolClosed");
    await staking.connect(alice).unstake(0, [1]); // still gets out
  });

  it("prices past accrual at the old rate when the rate changes", async () => {
    const { alice, reward, nft, staking } = await setup();
    await reward.approve(await staking.getAddress(), e18(1_000_000));
    await staking.openPool(
      await nft.getAddress(), await reward.getAddress(),
      e18(100), e18(1_000), e18(1_000_000),
    );
    await nft.mint(alice.address, 1);
    await nft.connect(alice).setApprovalForAll(await staking.getAddress(), true);
    await staking.connect(alice).stake(0, [1]);

    await time.increase(YEAR);
    await staking.setPool(0, e18(200), true);
    await time.increase(YEAR);

    // One year at 100 plus one at 200, not two years at 200.
    near(await staking.pendingReward(0, alice.address), e18(300));
  });

  it("reports how long the escrow lasts", async () => {
    const { alice, reward, nft, staking } = await setup();
    await reward.approve(await staking.getAddress(), e18(200));
    await staking.openPool(
      await nft.getAddress(), await reward.getAddress(),
      e18(100), e18(1_000), e18(200),
    );
    await nft.mint(alice.address, 1);
    await nft.connect(alice).setApprovalForAll(await staking.getAddress(), true);
    await staking.connect(alice).stake(0, [1]);

    // 200 escrowed, 100 a year, one staked: two years.
    const r = await staking.runway(0);
    expect(r).to.be.greaterThan(BigInt(YEAR * 2) - 100n);
    expect(r).to.be.lessThan(BigInt(YEAR * 2) + 100n);
  });
});
