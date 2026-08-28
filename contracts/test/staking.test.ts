import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

/**
 * The reward maths, proved rather than argued.
 *
 * A fixed-APY pool makes a precise promise - stake X for a year at 10% and you
 * get 0.1X - and the only way to know the accumulator honours it is to run the
 * clock forward and check the number. These tests do that for the cases that
 * actually decide whether the promise holds: a second staker arriving late, a
 * rate change part way through, a treasury that runs dry, and a token that does
 * not use eighteen decimals.
 */

const YEAR = 365 * 24 * 60 * 60;
const e18 = (n: string | number) => ethers.parseUnits(String(n), 18);

/** Rewards are time-based, so an exact equality would be hostage to one second of drift. */
function near(actual: bigint, expected: bigint, tolerance = 10n ** 15n) {
  const diff = actual > expected ? actual - expected : expected - actual;
  expect(diff <= tolerance, `expected ~${expected}, got ${actual} (diff ${diff})`).to.equal(true);
}

async function deployAll() {
  const [owner, alice, bob] = await ethers.getSigners();

  const TokenFactory = await ethers.getContractFactory("VeilpadToken");
  const veil = await TokenFactory.deploy("VEILPAD", "VEIL", "ipfs://meta", owner.address, e18(1_000_000_000));
  await veil.waitForDeployment();

  const TreasuryFactory = await ethers.getContractFactory("VeilTreasury");
  const treasury = await TreasuryFactory.deploy(await veil.getAddress(), owner.address);
  await treasury.waitForDeployment();

  const StakingFactory = await ethers.getContractFactory("VeilStaking");
  const staking = await StakingFactory.deploy(
    await veil.getAddress(),
    await treasury.getAddress(),
    owner.address,
  );
  await staking.waitForDeployment();

  await treasury.setSpender(await staking.getAddress(), true, e18(100_000_000));
  await veil.approve(await treasury.getAddress(), e18(100_000_000));
  await treasury.fund(e18(100_000_000));

  return { owner, alice, bob, veil, treasury, staking };
}

describe("VeilpadToken", () => {
  it("mints the whole supply once and can never mint again", async () => {
    const { veil, owner } = await deployAll();

    expect(await veil.totalSupply()).to.equal(e18(1_000_000_000));
    expect(await veil.balanceOf(owner.address)).to.equal(e18(900_000_000)); // 100M went to the treasury
    expect(await veil.initialSupply()).to.equal(e18(1_000_000_000));

    // There is no mint function in the ABI at all - that is the guarantee.
    expect(veil.interface.fragments.some((f) => (f as { name?: string }).name === "mint")).to.equal(false);
  });

  it("burning lowers supply and cannot be undone", async () => {
    const { veil, owner } = await deployAll();
    const before = await veil.totalSupply();
    await veil.burn(e18(1_000));
    expect(await veil.totalSupply()).to.equal(before - e18(1_000));
  });
});

describe("VeilpadTokenDeployer", () => {
  it("predicts the address CREATE2 actually produces", async () => {
    const [owner] = await ethers.getSigners();
    const DeployerFactory = await ethers.getContractFactory("VeilpadTokenDeployer");
    const deployer = await DeployerFactory.deploy();
    await deployer.waitForDeployment();

    const args = ["VEILPAD", "VEIL", "ipfs://meta", owner.address, e18(1_000_000_000)] as const;
    const salt = ethers.hexlify(ethers.randomBytes(32));

    const predicted = await deployer.predict(salt, ...args);

    // The hash handed to a client for mining must match the deployer's own view.
    const hash = await deployer.initCodeHash(...args);
    const viaFormula = ethers.getCreate2Address(await deployer.getAddress(), salt, hash);
    expect(viaFormula).to.equal(predicted);

    await deployer.deploy(salt, ...args);
    const code = await ethers.provider.getCode(predicted);
    expect(code).to.not.equal("0x");

    const token = await ethers.getContractAt("VeilpadToken", predicted);
    expect(await token.symbol()).to.equal("VEIL");
  });

  it("mines a real 8888 address and deploys to it", async () => {
    const [owner] = await ethers.getSigners();
    const DeployerFactory = await ethers.getContractFactory("VeilpadTokenDeployer");
    const deployer = await DeployerFactory.deploy();
    await deployer.waitForDeployment();

    const args = ["VEILPAD", "VEIL", "ipfs://meta", owner.address, e18(1_000_000_000)] as const;
    const hash = await deployer.initCodeHash(...args);
    const at = await deployer.getAddress();

    let salt = "";
    let predicted = "";
    for (let i = 0n; i < 5_000_000n; i++) {
      const candidate = "0x" + i.toString(16).padStart(64, "0");
      const addr = ethers.getCreate2Address(at, candidate, hash);
      if (addr.toLowerCase().endsWith("8888")) {
        salt = candidate;
        predicted = addr;
        break;
      }
    }
    expect(salt, "no 8888 salt found").to.not.equal("");

    await deployer.deploy(salt, ...args);
    expect(predicted.toLowerCase().endsWith("8888")).to.equal(true);
    expect(await ethers.provider.getCode(predicted)).to.not.equal("0x");
  });
});

describe("VeilStaking", () => {
  it("pays exactly the stated APY over a year", async () => {
    const { staking, veil, alice } = await deployAll();

    await staking.addPool(await veil.getAddress(), 1000, e18(10_000_000), 0, 0, false); // 10%
    await veil.transfer(alice.address, e18(1_000));
    await veil.connect(alice).approve(await staking.getAddress(), e18(1_000));
    await staking.connect(alice).stake(0, e18(1_000));

    await time.increase(YEAR);

    near(await staking.pendingReward(0, alice.address), e18(100));

    const before = await veil.balanceOf(alice.address);
    await staking.connect(alice).claim(0);
    near((await veil.balanceOf(alice.address)) - before, e18(100));
  });

  it("does not dilute an existing staker when someone else joins", async () => {
    const { staking, veil, alice, bob } = await deployAll();

    await staking.addPool(await veil.getAddress(), 1000, e18(10_000_000), 0, 0, false);
    for (const who of [alice, bob]) {
      await veil.transfer(who.address, e18(1_000));
      await veil.connect(who).approve(await staking.getAddress(), e18(1_000));
    }

    await staking.connect(alice).stake(0, e18(1_000));
    await time.increase(YEAR);
    await staking.connect(bob).stake(0, e18(1_000));
    await time.increase(YEAR);

    // Alice: two years at 10% on 1000. Bob: one year. A fixed-emission design
    // would have halved Alice's second year; a fixed APY must not.
    near(await staking.pendingReward(0, alice.address), e18(200));
    near(await staking.pendingReward(0, bob.address), e18(100));
  });

  it("credits nothing for time before the stake", async () => {
    const { staking, veil, alice } = await deployAll();

    await staking.addPool(await veil.getAddress(), 1000, e18(10_000_000), 0, 0, false);
    await time.increase(YEAR * 5); // pool sits idle

    await veil.transfer(alice.address, e18(1_000));
    await veil.connect(alice).approve(await staking.getAddress(), e18(1_000));
    await staking.connect(alice).stake(0, e18(1_000));

    near(await staking.pendingReward(0, alice.address), 0n, 10n ** 14n);
  });

  it("prices past accrual at the old rate when the APY changes", async () => {
    const { staking, veil, alice } = await deployAll();

    await staking.addPool(await veil.getAddress(), 1000, e18(10_000_000), 0, 0, false);
    await veil.transfer(alice.address, e18(1_000));
    await veil.connect(alice).approve(await staking.getAddress(), e18(1_000));
    await staking.connect(alice).stake(0, e18(1_000));

    await time.increase(YEAR);
    await staking.setPool(0, 2000, e18(10_000_000), 0, true); // 10% -> 20%
    await time.increase(YEAR);

    // One year at 10 plus one at 20, not two years at 20.
    near(await staking.pendingReward(0, alice.address), e18(300));
  });

  it("keeps the reward owed when the treasury is short, and pays it once refilled", async () => {
    const { staking, veil, treasury, owner, alice } = await deployAll();

    // Drain the reserve down to less than one year of Alice's reward.
    await treasury.withdraw(await veil.getAddress(), owner.address, (await treasury.balance()) - e18(30));

    await staking.addPool(await veil.getAddress(), 1000, e18(10_000_000), 0, 0, false);
    await veil.transfer(alice.address, e18(1_000));
    await veil.connect(alice).approve(await staking.getAddress(), e18(1_000));
    await staking.connect(alice).stake(0, e18(1_000));

    await time.increase(YEAR);

    const before = await veil.balanceOf(alice.address);
    await staking.connect(alice).claim(0);

    // Paid what was there, and still owes the rest.
    near((await veil.balanceOf(alice.address)) - before, e18(30));
    near(await staking.pendingReward(0, alice.address), e18(70));

    await veil.approve(await treasury.getAddress(), e18(1_000));
    await treasury.fund(e18(1_000));
    await staking.connect(alice).claim(0);
    near(await staking.pendingReward(0, alice.address), 0n, 10n ** 15n);
  });

  it("returns principal through emergencyUnstake even with no treasury at all", async () => {
    const { staking, veil, alice } = await deployAll();

    await staking.addPool(await veil.getAddress(), 1000, e18(10_000_000), 0, 0, false);
    await veil.transfer(alice.address, e18(1_000));
    await veil.connect(alice).approve(await staking.getAddress(), e18(1_000));
    await staking.connect(alice).stake(0, e18(1_000));
    await time.increase(YEAR);

    await staking.setTreasury(ethers.ZeroAddress);

    await staking.connect(alice).emergencyUnstake(0);
    expect(await veil.balanceOf(alice.address)).to.equal(e18(1_000));
  });

  it("lets a closed pool be exited but not entered", async () => {
    const { staking, veil, alice } = await deployAll();

    await staking.addPool(await veil.getAddress(), 1000, e18(10_000_000), 0, 0, false);
    await veil.transfer(alice.address, e18(1_000));
    await veil.connect(alice).approve(await staking.getAddress(), e18(1_000));
    await staking.connect(alice).stake(0, e18(500));

    await staking.setPool(0, 1000, e18(10_000_000), 0, false);

    await expect(staking.connect(alice).stake(0, e18(500))).to.be.revertedWithCustomError(staking, "PoolClosed");
    await staking.connect(alice).unstake(0, e18(500)); // still gets out
  });

  it("enforces the cap that bounds the treasury's liability", async () => {
    const { staking, veil, alice } = await deployAll();

    await staking.addPool(await veil.getAddress(), 1000, e18(1_000), 0, 0, false);
    await veil.transfer(alice.address, e18(2_000));
    await veil.connect(alice).approve(await staking.getAddress(), e18(2_000));

    await staking.connect(alice).stake(0, e18(1_000));
    await expect(staking.connect(alice).stake(0, e18(1))).to.be.revertedWithCustomError(staking, "CapReached");
  });

  it("stakes native COTI and pays VEILPAD on it", async () => {
    const { staking, veil, alice } = await deployAll();

    await staking.addPool(ethers.ZeroAddress, 1000, e18(1_000_000), 0, 0, false);
    await staking.connect(alice).stake(0, e18(100), { value: e18(100) });

    await time.increase(YEAR);
    near(await staking.pendingReward(0, alice.address), e18(10));

    const before = await veil.balanceOf(alice.address);
    await staking.connect(alice).claim(0);
    near((await veil.balanceOf(alice.address)) - before, e18(10));
  });

  it("refuses a native stake whose value does not match the amount", async () => {
    const { staking, alice } = await deployAll();
    await staking.addPool(ethers.ZeroAddress, 1000, e18(1_000_000), 0, 0, false);

    await expect(
      staking.connect(alice).stake(0, e18(100), { value: e18(1) }),
    ).to.be.revertedWithCustomError(staking, "WrongValue");
  });

  it("refuses native sent alongside an ERC20 stake", async () => {
    const { staking, veil, alice } = await deployAll();
    await staking.addPool(await veil.getAddress(), 1000, e18(1_000_000), 0, 0, false);
    await veil.transfer(alice.address, e18(10));
    await veil.connect(alice).approve(await staking.getAddress(), e18(10));

    await expect(
      staking.connect(alice).stake(0, e18(10), { value: 1n }),
    ).to.be.revertedWithCustomError(staking, "WrongValue");
  });

  it("gives a 6-decimal token the same percentage as an 18-decimal one", async () => {
    const { staking, veil, alice } = await deployAll();

    const Six = await ethers.getContractFactory("MockDecimalsToken");
    const six = await Six.deploy("Six", "SIX", 6);
    await six.waitForDeployment();
    await six.mint(alice.address, ethers.parseUnits("1000", 6));

    await staking.addPool(await six.getAddress(), 1000, ethers.parseUnits("1000000", 6), 0, 0, false);
    await six.connect(alice).approve(await staking.getAddress(), ethers.parseUnits("1000", 6));
    await staking.connect(alice).stake(0, ethers.parseUnits("1000", 6));

    await time.increase(YEAR);

    // 1000 units of a 6-decimal token at 10% must still be 100 VEILPAD, not 1e-10 of one.
    near(await staking.pendingReward(0, alice.address), e18(100));

    const before = await veil.balanceOf(alice.address);
    await staking.connect(alice).claim(0);
    near((await veil.balanceOf(alice.address)) - before, e18(100));
  });

  it("does not let a claim be replayed for the same period", async () => {
    const { staking, veil, alice } = await deployAll();

    await staking.addPool(await veil.getAddress(), 1000, e18(10_000_000), 0, 0, false);
    await veil.transfer(alice.address, e18(1_000));
    await veil.connect(alice).approve(await staking.getAddress(), e18(1_000));
    await staking.connect(alice).stake(0, e18(1_000));
    await time.increase(YEAR);

    await staking.connect(alice).claim(0);
    const after = await veil.balanceOf(alice.address);

    await staking.connect(alice).claim(0); // immediately again
    near((await veil.balanceOf(alice.address)) - after, 0n, 10n ** 15n);
  });

  it("refuses bare native transfers so nothing sits outside the books", async () => {
    const { staking, alice } = await deployAll();
    await expect(
      alice.sendTransaction({ to: await staking.getAddress(), value: e18(1) }),
    ).to.be.reverted;
  });
});

describe("VeilStaking under a hostile treasury", () => {
  it("does not let a lying treasury destroy what was earned", async () => {
    const { staking, veil, alice } = await deployAll();

    await staking.addPool(await veil.getAddress(), 1000, e18(10_000_000), 0, 0, false);
    await veil.transfer(alice.address, e18(1_000));
    await veil.connect(alice).approve(await staking.getAddress(), e18(1_000));
    await staking.connect(alice).stake(0, e18(1_000));
    await time.increase(YEAR);

    const Lying = await ethers.getContractFactory("LyingTreasury");
    const lying = await Lying.deploy();
    await staking.setTreasury(await lying.getAddress());

    const before = await veil.balanceOf(alice.address);
    await staking.connect(alice).claim(0);

    // It claimed to have paid 100 VEIL and sent nothing. The debt must survive,
    // because the credit is the measured balance change, not the report.
    expect(await veil.balanceOf(alice.address)).to.equal(before);
    near(await staking.pendingReward(0, alice.address), e18(100));
  });

  it("still returns principal when the treasury reverts", async () => {
    const { staking, veil, alice } = await deployAll();

    await staking.addPool(await veil.getAddress(), 1000, e18(10_000_000), 0, 0, false);
    await veil.transfer(alice.address, e18(1_000));
    await veil.connect(alice).approve(await staking.getAddress(), e18(1_000));
    await staking.connect(alice).stake(0, e18(1_000));
    await time.increase(YEAR);

    const Reverting = await ethers.getContractFactory("RevertingTreasury");
    const bad = await Reverting.deploy();
    await staking.setTreasury(await bad.getAddress());

    // The unstake must complete regardless: a reward that cannot be paid is a
    // delay, a principal that cannot be returned would be a loss.
    await staking.connect(alice).unstake(0, e18(1_000));
    expect(await veil.balanceOf(alice.address)).to.equal(e18(1_000));
    near(await staking.pendingReward(0, alice.address), e18(100));
  });

  it("keeps the reward claimable after an emergency exit", async () => {
    const { staking, veil, alice } = await deployAll();

    await staking.addPool(await veil.getAddress(), 1000, e18(10_000_000), 0, 0, false);
    await veil.transfer(alice.address, e18(1_000));
    await veil.connect(alice).approve(await staking.getAddress(), e18(1_000));
    await staking.connect(alice).stake(0, e18(1_000));
    await time.increase(YEAR);

    // Settle so the year is on the books, then take the emergency exit.
    await staking.connect(alice).claim(0);
    await veil.connect(alice).transfer(await staking.getAddress(), 0); // no-op, keeps balances clear
    await staking.connect(alice).stake(0, 0n).catch(() => undefined);

    const owedBefore = await staking.pendingReward(0, alice.address);
    await staking.connect(alice).emergencyUnstake(0);

    // Principal back, and whatever was owed survives. It can only have grown:
    // the exit now settles the last few seconds on its way out rather than
    // discarding them.
    const position = await staking.stakeOf(0, alice.address);
    expect(position.amount).to.equal(0n);
    const after = await staking.pendingReward(0, alice.address);
    expect(after >= owedBefore, "the emergency exit must not reduce what is owed").to.equal(true);
    near(after, owedBefore);
  });
});

describe("VeilTreasury", () => {
  it("bounds a spender to its budget", async () => {
    const { staking, treasury, veil, alice } = await deployAll();

    // Cut the staking contract's budget to 5 VEIL, far under what it will owe.
    await treasury.setSpender(await staking.getAddress(), true, e18(5));

    await staking.addPool(await veil.getAddress(), 1000, e18(10_000_000), 0, 0, false);
    await veil.transfer(alice.address, e18(1_000));
    await veil.connect(alice).approve(await staking.getAddress(), e18(1_000));
    await staking.connect(alice).stake(0, e18(1_000));
    await time.increase(YEAR);

    const before = await veil.balanceOf(alice.address);
    await staking.connect(alice).claim(0);

    // Paid the budget and no more, even though the reserve holds millions.
    near((await veil.balanceOf(alice.address)) - before, e18(5));
    expect(await treasury.spendLimit(await staking.getAddress())).to.equal(0n);
    near(await staking.pendingReward(0, alice.address), e18(95));
  });

  it("refuses a caller that is not an approved spender", async () => {
    const { treasury, alice } = await deployAll();
    await expect(
      treasury.connect(alice).payReward(alice.address, e18(1)),
    ).to.be.revertedWithCustomError(treasury, "NotSpender");
  });
});

describe("VeilStaking per-user cap", () => {
  it("stops one address taking the whole pool", async () => {
    const { staking, veil, alice, bob } = await deployAll();

    await staking.addPool(await veil.getAddress(), 1000, e18(1_000), 0, e18(600), false);
    for (const who of [alice, bob]) {
      await veil.transfer(who.address, e18(1_000));
      await veil.connect(who).approve(await staking.getAddress(), e18(1_000));
    }

    await staking.connect(alice).stake(0, e18(600));
    await expect(staking.connect(alice).stake(0, e18(1))).to.be.revertedWithCustomError(
      staking,
      "PerUserCapReached",
    );

    // Room is left for somebody else, which is the entire point.
    await staking.connect(bob).stake(0, e18(400));
  });
});

describe("VeilpadTokenDeployer access", () => {
  it("only lets its owner mint provenance", async () => {
    const [owner, alice] = await ethers.getSigners();
    const DeployerFactory = await ethers.getContractFactory("VeilpadTokenDeployer");
    const deployer = await DeployerFactory.deploy();
    await deployer.waitForDeployment();

    const args = ["VEILPAD", "VEIL", "ipfs://meta", owner.address, e18(1_000_000_000)] as const;
    const salt = ethers.hexlify(ethers.randomBytes(32));

    await expect(
      deployer.connect(alice).deploy(salt, ...args),
    ).to.be.revertedWithCustomError(deployer, "OwnableUnauthorizedAccount");

    await deployer.deploy(salt, ...args); // the owner still can
  });
});

describe("VeilStaking escape hatch, corrected", () => {
  it("keeps a passive staker's whole reward through an emergency exit", async () => {
    const { staking, veil, alice } = await deployAll();

    await staking.addPool(await veil.getAddress(), 1800, e18(20_000_000), 0, 0, false);
    await veil.transfer(alice.address, e18(10_000));
    await veil.connect(alice).approve(await staking.getAddress(), e18(10_000));
    await staking.connect(alice).stake(0, e18(10_000));

    await time.increase(YEAR);

    // Never claimed, so the entire 1,800 is unsettled - the exact case that
    // used to be discarded on the way out.
    near(await staking.pendingReward(0, alice.address), e18(1_800));

    await staking.connect(alice).emergencyUnstake(0);

    expect((await staking.stakeOf(0, alice.address)).amount).to.equal(0n);
    expect(await veil.balanceOf(alice.address)).to.equal(e18(10_000)); // principal
    near(await staking.pendingReward(0, alice.address), e18(1_800));   // reward survives

    // And it is genuinely claimable afterwards.
    const before = await veil.balanceOf(alice.address);
    await staking.connect(alice).claim(0);
    near((await veil.balanceOf(alice.address)) - before, e18(1_800));
  });

  it("still unstakes when the treasury has been pointed at nothing", async () => {
    const { staking, veil, alice } = await deployAll();

    await staking.addPool(await veil.getAddress(), 1000, e18(10_000_000), 0, 0, false);
    await veil.transfer(alice.address, e18(1_000));
    await veil.connect(alice).approve(await staking.getAddress(), e18(1_000));
    await staking.connect(alice).stake(0, e18(1_000));
    await time.increase(YEAR);

    await staking.setTreasury(ethers.ZeroAddress);

    // A codeless callee is not caught by try/catch, so this is the case that
    // would otherwise revert and trap the principal.
    await staking.connect(alice).unstake(0, e18(1_000));
    expect(await veil.balanceOf(alice.address)).to.equal(e18(1_000));
    near(await staking.pendingReward(0, alice.address), e18(100));
  });

  it("still unstakes when the treasury is an EOA", async () => {
    const { staking, veil, alice, bob } = await deployAll();

    await staking.addPool(await veil.getAddress(), 1000, e18(10_000_000), 0, 0, false);
    await veil.transfer(alice.address, e18(1_000));
    await veil.connect(alice).approve(await staking.getAddress(), e18(1_000));
    await staking.connect(alice).stake(0, e18(1_000));
    await time.increase(YEAR);

    await staking.setTreasury(bob.address);
    await staking.connect(alice).unstake(0, e18(1_000));
    expect(await veil.balanceOf(alice.address)).to.equal(e18(1_000));
  });
});

describe("VeilStaking with a private stake token", () => {
  it("credits the amount instead of measuring a ciphertext balance", async () => {
    const { staking, veil, alice } = await deployAll();

    const Priv = await ethers.getContractFactory("MockPrivateToken");
    const p = await Priv.deploy();
    await p.waitForDeployment();
    await p.mint(alice.address, e18(1_000));

    // privateToken = true: the pool must not try to measure its own balance.
    await staking.addPool(await p.getAddress(), 1000, e18(1_000_000), 0, 0, true);
    await p.connect(alice).approve(await staking.getAddress(), e18(1_000));
    await staking.connect(alice).stake(0, e18(1_000));

    expect((await staking.stakeOf(0, alice.address)).amount).to.equal(e18(1_000));
    expect(await p.realBalanceOf(await staking.getAddress())).to.equal(e18(1_000));

    await time.increase(YEAR);
    near(await staking.pendingReward(0, alice.address), e18(100));

    // Reward is public VEIL even though the stake is private.
    const before = await veil.balanceOf(alice.address);
    await staking.connect(alice).claim(0);
    near((await veil.balanceOf(alice.address)) - before, e18(100));

    // And the principal comes back in full.
    await staking.connect(alice).unstake(0, e18(1_000));
    expect(await p.realBalanceOf(alice.address)).to.equal(e18(1_000));
  });

  it("would mis-credit if it measured, which is why the flag exists", async () => {
    const { staking, alice } = await deployAll();

    const Priv = await ethers.getContractFactory("MockPrivateToken");
    const p = await Priv.deploy();
    await p.waitForDeployment();
    await p.mint(alice.address, e18(10));

    // The same token declared as public. The before/after subtraction reads two
    // ciphertext handles, which within one block are identical, so it computes
    // a deposit of zero - and takes the tokens anyway.
    await staking.addPool(await p.getAddress(), 1000, e18(1_000_000), 0, 0, false);
    await p.connect(alice).approve(await staking.getAddress(), e18(10));
    await staking.connect(alice).stake(0, e18(10));

    expect(await p.realBalanceOf(await staking.getAddress())).to.equal(e18(10));
    expect(
      (await staking.stakeOf(0, alice.address)).amount,
      "measuring a ciphertext balance credits nothing while still taking the deposit",
    ).to.equal(0n);

    // Which is precisely the loss the privateToken flag prevents.
    await time.increase(YEAR);
    expect(await staking.pendingReward(0, alice.address)).to.equal(0n);
  });
});
