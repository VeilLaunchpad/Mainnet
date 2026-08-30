import { expect } from "chai";
import { ethers } from "hardhat";

/**
 * Graduation must send the raise where the protocol says, not where the caller
 * says.
 *
 * `graduate` used to take the swap factory and WCOTI as arguments while having
 * no caller check at all. Anyone could call it once a launch filled and pass
 * addresses they controlled: `_seed` forwards the entire reserve with
 * `IWCOTI(wcoti).deposit{value: cotiLiquidity}()`, and a forged `getPair` also
 * received the 200,000,000-token pool allocation by approval. The sibling
 * `seedPool` was gated with `msg.sender != factory`; the function that moved
 * more money was not.
 *
 * Keeping graduation permissionless is deliberate - a filled launch must not be
 * hostage to the team finishing it - so the fix was not to add an owner check.
 * It was to stop the caller naming the destination. These tests pin both halves
 * of that: still callable by anyone, and no longer redirectable.
 */

const DAY = 24 * 60 * 60;

async function deployStack() {
  const [deployer, creator, buyer, attacker] = await ethers.getSigners();

  const WCOTI = await ethers.getContractFactory("WCOTI");
  const wcoti = await WCOTI.deploy();
  await wcoti.waitForDeployment();

  const SwapFactory = await ethers.getContractFactory("DevoxSwapFactory");
  const swapFactory = await SwapFactory.deploy();
  await swapFactory.waitForDeployment();

  const Priv = await ethers.getContractFactory("PrivateTokenDeployer");
  const priv = await Priv.deploy();
  await priv.waitForDeployment();

  const Pub = await ethers.getContractFactory("PublicTokenDeployer");
  const pub = await Pub.deploy();
  await pub.waitForDeployment();

  const Locker = await ethers.getContractFactory("DevoxLocker");
  const locker = await Locker.deploy();
  await locker.waitForDeployment();

  const Pad = await ethers.getContractFactory("DevoxPadFactory");
  const pad = await Pad.deploy(
    deployer.address,
    await priv.getAddress(),
    await pub.getAddress(),
    await locker.getAddress(),
  );
  await pad.waitForDeployment();

  await (await pad.setDex(await swapFactory.getAddress(), await wcoti.getAddress())).wait();

  return { deployer, creator, buyer, attacker, wcoti, swapFactory, pad };
}

/** Launches a public token and returns its curve. */
async function launch(pad: any, creator: any) {
  const salt = ethers.hexlify(ethers.randomBytes(32));
  const tokenSalt = ethers.hexlify(ethers.randomBytes(32));
  const fee = await pad.launchFee();
  // The factory requires a non-zero dev buy, so the launch is funded like a
  // real one rather than with a zero that reverts on _validate.
  const devBuy = ethers.parseEther("1");

  await (
    await pad.connect(creator).launch(
      {
        name: "Graduation Test",
        symbol: "GRAD",
        metadataURI: "",
        privateBalances: false,
        agentId: ethers.ZeroHash,
        curveSalt: salt,
        tokenSalt,
        devBuy,
        allocation: 1,
        burnPercent: 100,
        lockDays: 0,
      },
      { value: fee + devBuy },
    )
  ).wait();

  const token = await pad.tokenAt(0);
  const curveAddr = await pad.curveOf(token);
  return ethers.getContractAt("DevoxCurve", curveAddr);
}

/** Buys until the curve's reserve reaches its graduation target. */
async function fillToTarget(curve: any, buyer: any) {
  const target = await curve.graduationTarget();
  for (let i = 0; i < 40; i++) {
    if ((await curve.reserve()) >= target) return;
    await (await curve.connect(buyer).buy(0, { value: ethers.parseEther("10") })).wait();
  }
  throw new Error("could not reach the target");
}

describe("DevoxCurve graduation, after the redirect fix", () => {
  it("cannot be pointed at a destination the caller chose", async () => {
    const { pad, creator, buyer, attacker } = await deployStack();
    const curve = await launch(pad, creator);
    await fillToTarget(curve, buyer);

    // The old signature is gone: the entry point takes no addresses, which is
    // the property that made the theft possible. (Asserting that ethers throws
    // on the old signature is not the test - v6 returns null instead, so that
    // assertion measured the library, not the contract.)
    const frag = curve.interface.getFunction("graduate")!;
    expect(frag.inputs.length).to.equal(0);

    // A raw call with the old selector and attacker-controlled arguments finds
    // no such function and reverts rather than being silently accepted.
    const oldSelector = ethers.id("graduate(address,address)").slice(0, 10);
    const evil = attacker.address.toLowerCase().replace("0x", "").padStart(64, "0");
    await expect(
      attacker.sendTransaction({
        to: await curve.getAddress(),
        data: oldSelector + evil + evil,
      }),
    ).to.be.reverted;
  });

  it("still lets anyone graduate a filled launch, and the raise lands in the real pair", async () => {
    const { pad, creator, buyer, attacker, wcoti, swapFactory } = await deployStack();
    const curve = await launch(pad, creator);
    await fillToTarget(curve, buyer);

    const reserveBefore = await curve.reserve();
    expect(reserveBefore).to.be.greaterThan(0n);

    // Permissionless on purpose: a stranger finishing the job is the intended
    // behaviour, and the reason an owner check was the wrong fix.
    await (await curve.connect(attacker).graduate()).wait();

    expect(await curve.graduated()).to.equal(true);

    const pool = await curve.pool();
    expect(pool).to.not.equal(ethers.ZeroAddress);

    const token = await curve.token();
    const expected = await swapFactory.getPair(token, await wcoti.getAddress());
    expect(pool).to.equal(expected);

    // The COTI is in the pair as WCOTI, not with whoever called graduate.
    expect(await wcoti.balanceOf(pool)).to.equal(reserveBefore);
    expect(await ethers.provider.getBalance(await curve.getAddress())).to.equal(
      await curve.accruedFees(),
    );
  });

  it("refuses to graduate twice", async () => {
    const { pad, creator, buyer, attacker } = await deployStack();
    const curve = await launch(pad, creator);
    await fillToTarget(curve, buyer);

    await (await curve.connect(attacker).graduate()).wait();
    await expect(curve.connect(attacker).graduate()).to.be.reverted;
  });

  it("refuses to graduate before the target is reached", async () => {
    const { pad, creator, attacker } = await deployStack();
    const curve = await launch(pad, creator);
    await expect(curve.connect(attacker).graduate()).to.be.reverted;
  });

  it("keeps seedPool for the factory alone, and it takes no addresses either", async () => {
    const { pad, creator, attacker } = await deployStack();
    const curve = await launch(pad, creator);

    const frag = curve.interface.getFunction("seedPool")!;
    expect(frag.inputs.length).to.equal(0);

    // An owner typo used to be able to brick a launch the same way an attacker
    // could steal from it, so the arguments are gone from this path too.
    await expect(curve.connect(attacker).seedPool()).to.be.reverted;
  });
});
