import { expect } from "chai";
import { ethers } from "hardhat";

/**
 * The studio and the marketplace.
 *
 * What is *not* tested here is the private drop's minting, and that is
 * deliberate rather than an omission: `setSecret` and `mint` go through COTI's
 * MPC precompile at 0x64, which does not exist on a local EVM. Faking it would
 * prove nothing, so those paths are exercised against a real COTI network by
 * scripts/nft-smoke.ts instead. Everything reachable without MPC is here.
 */

const e18 = (n: string | number) => ethers.parseUnits(String(n), 18);
const ZERO = ethers.ZeroAddress;

function params(over: Partial<Record<string, unknown>> = {}) {
  return {
    name: "Devox Art",
    symbol: "VART",
    previewURI: "ipfs://preview/",
    maxSupply: 10_000n,
    mintPrice: 0n,
    payToken: ZERO,
    maxPerWallet: 5n,
    presaleStart: 0n,
    publicStart: 0n,
    ...over,
  };
}

async function setup() {
  const [owner, alice, bob, fee] = await ethers.getSigners();

  const Factory = await ethers.getContractFactory("DevoxNFTFactory");
  const factory = await Factory.deploy(owner.address, fee.address, e18("0.01"));
  await factory.waitForDeployment();

  const Market = await ethers.getContractFactory("DevoxNFTMarket");
  const market = await Market.deploy(owner.address, fee.address, 250); // 2.5%
  await market.waitForDeployment();

  const Token = await ethers.getContractFactory("DevoxpadToken");
  const devox = await Token.deploy("DEVOXPAD", "DEVOX", "", owner.address, e18(1_000_000_000));
  await devox.waitForDeployment();

  const Nft = await ethers.getContractFactory("MockERC721");
  const nft = await Nft.deploy("Art", "ART");
  await nft.waitForDeployment();

  return { owner, alice, bob, fee, factory, market, devox, nft };
}

describe("DevoxNFTFactory", () => {
  it("deploys a collection the creator owns, not the factory", async () => {
    const { alice, factory } = await setup();

    const p = params();
    const predicted = await factory.predictDrop(ethers.ZeroHash, p, alice.address);
    await factory.connect(alice).createDrop(ethers.ZeroHash, p, predicted, { value: e18("0.01") });

    const drop = await ethers.getContractAt("DevoxNFTDrop", predicted);
    expect(await drop.owner()).to.equal(alice.address);
    expect(await drop.maxSupply()).to.equal(10_000n);
    expect(await drop.mintPrice()).to.equal(0n); // a free mint is a real setting
    expect(await factory.collectionCount()).to.equal(1n);
  });

  it("lands exactly where the client predicted", async () => {
    const { alice, factory } = await setup();
    const p = params();

    const salt = ethers.hexlify(ethers.randomBytes(32));
    const predicted = await factory.predictDrop(salt, p, alice.address);

    // The same address, computed independently from the published hash.
    const hash = await factory.dropInitCodeHash(p, alice.address);
    const viaFormula = ethers.getCreate2Address(await factory.getAddress(), salt, hash);
    expect(viaFormula).to.equal(predicted);

    await factory.connect(alice).createDrop(salt, p, predicted, { value: e18("0.01") });
    expect(await ethers.provider.getCode(predicted)).to.not.equal("0x");
  });

  it("can mine an 8888 address, like every token launch here", async () => {
    const { alice, factory } = await setup();
    const p = params();
    const hash = await factory.dropInitCodeHash(p, alice.address);
    const at = await factory.getAddress();

    let salt = "";
    let predicted = "";
    for (let i = 0n; i < 2_000_000n; i++) {
      const candidate = "0x" + i.toString(16).padStart(64, "0");
      const addr = ethers.getCreate2Address(at, candidate, hash);
      if (addr.toLowerCase().endsWith("8888")) {
        salt = candidate;
        predicted = addr;
        break;
      }
    }
    expect(salt, "no 8888 salt found").to.not.equal("");

    await factory.connect(alice).createDrop(salt, p, predicted, { value: e18("0.01") });
    expect(predicted.toLowerCase().endsWith("8888")).to.equal(true);
    expect(await ethers.provider.getCode(predicted)).to.not.equal("0x");
  });

  it("reverts rather than hand over an address nobody was shown", async () => {
    const { alice, factory } = await setup();
    const p = params();
    const wrong = "0x000000000000000000000000000000000000dEaD";
    await expect(
      factory.connect(alice).createDrop(ethers.ZeroHash, p, wrong, { value: e18("0.01") }),
    ).to.be.revertedWithCustomError(factory, "WrongAddress");
  });

  it("refunds anything sent over the launch fee", async () => {
    const { alice, fee, factory } = await setup();
    const p = params();
    const predicted = await factory.predictDrop(ethers.ZeroHash, p, alice.address);

    const feeBefore = await ethers.provider.getBalance(fee.address);
    await factory.connect(alice).createDrop(ethers.ZeroHash, p, predicted, { value: e18(1) });

    // The fee recipient gets the fee and not the overpayment.
    expect((await ethers.provider.getBalance(fee.address)) - feeBefore).to.equal(e18("0.01"));
  });

  it("refuses a launch that underpays", async () => {
    const { alice, factory } = await setup();
    await expect(
      factory.connect(alice).createDrop(ethers.ZeroHash, params(), ZERO, { value: 0 }),
    ).to.be.revertedWithCustomError(factory, "FeeTooLow");
  });

  it("pages the registry newest first", async () => {
    const { alice, factory } = await setup();
    for (const n of ["A", "B", "C"]) {
      const p = params({ name: n, symbol: n });
      const predicted = await factory.predictDrop(ethers.ZeroHash, p, alice.address);
      await factory.connect(alice).createDrop(ethers.ZeroHash, p, predicted, { value: e18("0.01") });
    }
    const page = await factory.page(0, 2);
    expect(page.length).to.equal(2);
    expect(page[0].name).to.equal("C");
    expect(page[1].name).to.equal("B");
  });
});

describe("DevoxNFTMarket", () => {
  it("sells for native COTI, splitting fee and royalty", async () => {
    const { owner, alice, bob, fee, market, nft } = await setup();

    await nft.mint(alice.address, 1);
    await nft.connect(alice).setApprovalForAll(await market.getAddress(), true);
    await market.connect(alice).list(await nft.getAddress(), 1, ZERO, e18(100));

    // MockERC721 has no owner(), so the marketplace owner sets the royalty.
    await market.connect(owner).setRoyalty(await nft.getAddress(), owner.address, 500); // 5%

    const sellerBefore = await ethers.provider.getBalance(alice.address);
    const feeBefore = await ethers.provider.getBalance(fee.address);
    const royaltyBefore = await ethers.provider.getBalance(owner.address);

    await market.connect(bob).buy(0, e18(100), { value: e18(100) });

    expect(await nft.ownerOf(1)).to.equal(bob.address);
    expect((await ethers.provider.getBalance(fee.address)) - feeBefore).to.equal(e18("2.5"));
    expect((await ethers.provider.getBalance(owner.address)) - royaltyBefore).to.equal(e18(5));
    expect((await ethers.provider.getBalance(alice.address)) - sellerBefore).to.equal(e18("92.5"));
  });

  it("sells for an ERC-20", async () => {
    const { owner, alice, bob, fee, market, nft, devox } = await setup();
    await nft.mint(alice.address, 1);
    await nft.connect(alice).setApprovalForAll(await market.getAddress(), true);
    await market.connect(alice).list(await nft.getAddress(), 1, await devox.getAddress(), e18(1000));

    await devox.connect(owner).transfer(bob.address, e18(1000));
    await devox.connect(bob).approve(await market.getAddress(), e18(1000));
    await market.connect(bob).buy(0, ethers.MaxUint256);

    expect(await nft.ownerOf(1)).to.equal(bob.address);
    expect(await devox.balanceOf(fee.address)).to.equal(e18(25));   // 2.5%
    expect(await devox.balanceOf(alice.address)).to.equal(e18(975));
  });

  it("refuses a listing whose seller no longer holds the token", async () => {
    const { alice, bob, market, nft } = await setup();
    await nft.mint(alice.address, 1);
    await nft.connect(alice).setApprovalForAll(await market.getAddress(), true);
    await market.connect(alice).list(await nft.getAddress(), 1, ZERO, e18(100));

    // Sold elsewhere. Nothing was escrowed, so the listing is now a lie.
    await nft.connect(alice).transferFrom(alice.address, bob.address, 1);

    const [live, reason] = await market.listingLive(0);
    expect(live).to.equal(false);
    expect(reason).to.equal("the seller no longer holds it");
    await expect(market.connect(bob).buy(0, e18(100), { value: e18(100) })).to.be.revertedWithCustomError(
      market,
      "NotOwner",
    );
  });

  it("refuses a listing whose approval was revoked", async () => {
    const { alice, bob, market, nft } = await setup();
    await nft.mint(alice.address, 1);
    await nft.connect(alice).setApprovalForAll(await market.getAddress(), true);
    await market.connect(alice).list(await nft.getAddress(), 1, ZERO, e18(100));
    await nft.connect(alice).setApprovalForAll(await market.getAddress(), false);

    const [live, reason] = await market.listingLive(0);
    expect(live).to.equal(false);
    expect(reason).to.equal("approval was revoked");
    await expect(market.connect(bob).buy(0, e18(100), { value: e18(100) })).to.be.revertedWithCustomError(
      market,
      "NotApproved",
    );
  });

  it("refuses the wrong amount of COTI", async () => {
    const { alice, bob, market, nft } = await setup();
    await nft.mint(alice.address, 1);
    await nft.connect(alice).setApprovalForAll(await market.getAddress(), true);
    await market.connect(alice).list(await nft.getAddress(), 1, ZERO, e18(100));

    // maxPrice is the listed price, so this gets past the price guard and
    // still tests what it was written to test: the wrong amount of COTI.
    await expect(market.connect(bob).buy(0, e18(100), { value: e18(99) })).to.be.revertedWithCustomError(
      market,
      "WrongPayment",
    );
  });

  it("escrows an offer, and returns it if cancelled", async () => {
    const { owner, bob, market, nft, devox } = await setup();
    await devox.connect(owner).transfer(bob.address, e18(500));
    await devox.connect(bob).approve(await market.getAddress(), e18(500));

    await market.connect(bob).makeOffer(await nft.getAddress(), 1, await devox.getAddress(), e18(500));
    // The money is held here, so a seller can rely on the bid being funded.
    expect(await devox.balanceOf(await market.getAddress())).to.equal(e18(500));

    await market.connect(bob).cancelOffer(0);
    expect(await devox.balanceOf(bob.address)).to.equal(e18(500));
  });

  it("accepts an offer, paying from the escrow", async () => {
    const { owner, alice, bob, fee, market, nft, devox } = await setup();
    await nft.mint(alice.address, 1);
    await nft.connect(alice).setApprovalForAll(await market.getAddress(), true);

    await devox.connect(owner).transfer(bob.address, e18(400));
    await devox.connect(bob).approve(await market.getAddress(), e18(400));
    await market.connect(bob).makeOffer(await nft.getAddress(), 1, await devox.getAddress(), e18(400));

    await market.connect(alice).acceptOffer(0);

    expect(await nft.ownerOf(1)).to.equal(bob.address);
    expect(await devox.balanceOf(fee.address)).to.equal(e18(10));    // 2.5%
    expect(await devox.balanceOf(alice.address)).to.equal(e18(390));
  });

  it("closes a stale listing when an offer on the same token is accepted", async () => {
    const { owner, alice, bob, market, nft, devox } = await setup();
    await nft.mint(alice.address, 1);
    await nft.connect(alice).setApprovalForAll(await market.getAddress(), true);
    await market.connect(alice).list(await nft.getAddress(), 1, ZERO, e18(100));

    await devox.connect(owner).transfer(bob.address, e18(400));
    await devox.connect(bob).approve(await market.getAddress(), e18(400));
    await market.connect(bob).makeOffer(await nft.getAddress(), 1, await devox.getAddress(), e18(400));
    await market.connect(alice).acceptOffer(0);

    const [listed] = await market.listingOf(await nft.getAddress(), 1);
    expect(listed).to.equal(false);
  });

  it("refuses an offer in native COTI, which it cannot escrow", async () => {
    const { bob, market, nft } = await setup();
    await expect(
      market.connect(bob).makeOffer(await nft.getAddress(), 1, ZERO, e18(1)),
    ).to.be.revertedWith("offers are made in an ERC-20");
  });

  it("caps the marketplace fee, so it cannot be raised without limit", async () => {
    const { owner, fee, market } = await setup();
    await expect(market.connect(owner).setFee(fee.address, 1001)).to.be.revertedWithCustomError(
      market,
      "FeeTooHigh",
    );
    await market.connect(owner).setFee(fee.address, 1000); // the ceiling itself is fine
  });

  it("marks an official collection, and only the owner can", async () => {
    const { owner, alice, market, nft } = await setup();
    expect(await market.official(await nft.getAddress())).to.equal(false);
    await market.connect(owner).setOfficial(await nft.getAddress(), true);
    expect(await market.official(await nft.getAddress())).to.equal(true);

    await expect(
      market.connect(alice).setOfficial(await nft.getAddress(), true),
    ).to.be.revertedWithCustomError(market, "OwnableUnauthorizedAccount");
  });

  it("only lets the seller delist", async () => {
    const { alice, bob, market, nft } = await setup();
    await nft.mint(alice.address, 1);
    await nft.connect(alice).setApprovalForAll(await market.getAddress(), true);
    await market.connect(alice).list(await nft.getAddress(), 1, ZERO, e18(100));

    await expect(market.connect(bob).delist(0)).to.be.revertedWith("not the seller");
    await market.connect(alice).delist(0);
    const [listed] = await market.listingOf(await nft.getAddress(), 1);
    expect(listed).to.equal(false);
  });

  /**
   * Repricing.
   *
   * Sellers change their minds, and before `updatePrice` the only way to do it
   * was delist and list again - two signatures, and a new listing id that broke
   * the token's history. These pin the two things that matter: the new price is
   * what a buyer actually pays, and a reprice can move nothing except the price.
   */
  it("lets the seller change the asking price, and the new one is what a buyer pays", async () => {
    const { alice, bob, fee, market, nft } = await setup();
    await nft.mint(alice.address, 1);
    await nft.connect(alice).setApprovalForAll(await market.getAddress(), true);
    await market.connect(alice).list(await nft.getAddress(), 1, ZERO, e18(100));

    await expect(market.connect(alice).updatePrice(0, e18(40)))
      .to.emit(market, "PriceUpdated")
      .withArgs(0, await nft.getAddress(), 1, e18(100), e18(40));

    const [, , l] = await market.listingOf(await nft.getAddress(), 1);
    expect(l.price).to.equal(e18(40));

    // The old price must stop working, or the reprice was decorative.
    await expect(market.connect(bob).buy(0, e18(100), { value: e18(100) })).to.be.revertedWithCustomError(
      market,
      "WrongPayment",
    );

    const sellerBefore = await ethers.provider.getBalance(alice.address);
    const feeBefore = await ethers.provider.getBalance(fee.address);
    await market.connect(bob).buy(0, e18(40), { value: e18(40) });

    expect(await nft.ownerOf(1)).to.equal(bob.address);
    expect((await ethers.provider.getBalance(fee.address)) - feeBefore).to.equal(e18(1)); // 2.5%
    expect((await ethers.provider.getBalance(alice.address)) - sellerBefore).to.equal(e18(39));
  });

  it("changes only the price, never what is being sold", async () => {
    const { alice, market, nft } = await setup();
    await nft.mint(alice.address, 1);
    await nft.connect(alice).setApprovalForAll(await market.getAddress(), true);
    await market.connect(alice).list(await nft.getAddress(), 1, ZERO, e18(100));

    const [, , before] = await market.listingOf(await nft.getAddress(), 1);
    await market.connect(alice).updatePrice(0, e18(7));
    const [, , after] = await market.listingOf(await nft.getAddress(), 1);

    expect(after.seller).to.equal(before.seller);
    expect(after.collection).to.equal(before.collection);
    expect(after.tokenId).to.equal(before.tokenId);
    expect(after.payToken).to.equal(before.payToken);
    expect(after.listedAt).to.equal(before.listedAt);
    expect(after.active).to.equal(true);
    expect(after.price).to.equal(e18(7));

    // The listing keeps its identity, which is the point of repricing in place.
    const [listed, id] = await market.listingOf(await nft.getAddress(), 1);
    expect(listed).to.equal(true);
    expect(id).to.equal(0n);
  });

  it("only lets the seller reprice", async () => {
    const { alice, bob, market, nft } = await setup();
    await nft.mint(alice.address, 1);
    await nft.connect(alice).setApprovalForAll(await market.getAddress(), true);
    await market.connect(alice).list(await nft.getAddress(), 1, ZERO, e18(100));

    await expect(market.connect(bob).updatePrice(0, e18(1))).to.be.revertedWith("not the seller");
    const [, , l] = await market.listingOf(await nft.getAddress(), 1);
    expect(l.price).to.equal(e18(100));
  });

  it("refuses a zero price, a delisted listing, and a token the seller sold on", async () => {
    const { alice, bob, market, nft } = await setup();
    await nft.mint(alice.address, 1);
    await nft.connect(alice).setApprovalForAll(await market.getAddress(), true);
    await market.connect(alice).list(await nft.getAddress(), 1, ZERO, e18(100));

    // Zero would make the token free to anyone sending nothing.
    await expect(market.connect(alice).updatePrice(0, 0)).to.be.revertedWith("price is zero");

    // A stale listing must not be given a fresh price: it would sort into the
    // market by a number that can never execute.
    await nft.connect(alice).transferFrom(alice.address, bob.address, 1);
    await expect(market.connect(alice).updatePrice(0, e18(5))).to.be.revertedWithCustomError(
      market,
      "NotOwner",
    );

    // And once delisted there is nothing to reprice.
    await nft.connect(bob).transferFrom(bob.address, alice.address, 1);
    await market.connect(alice).delist(0);
    await expect(market.connect(alice).updatePrice(0, e18(5))).to.be.revertedWithCustomError(
      market,
      "NotActive",
    );
  });

  /**
   * The stale-listing lock.
   *
   * Before `clearStaleListing`, moving a listed token off-market left it
   * permanently unlistable: `list()` refused it as AlreadyListed and `delist`
   * answered only to the recorded seller, who no longer had any reason to help.
   */
  it("lets anyone clear a listing whose seller has moved the token on", async () => {
    const { alice, bob, market, nft } = await setup();
    await nft.mint(alice.address, 1);
    await nft.connect(alice).setApprovalForAll(await market.getAddress(), true);
    await market.connect(alice).list(await nft.getAddress(), 1, ZERO, e18(100));

    // Sold or gifted outside the marketplace.
    await nft.connect(alice).transferFrom(alice.address, bob.address, 1);

    // This is the state that used to be a dead end for bob.
    await nft.connect(bob).setApprovalForAll(await market.getAddress(), true);
    await expect(
      market.connect(bob).list(await nft.getAddress(), 1, ZERO, e18(50)),
    ).to.be.revertedWithCustomError(market, "AlreadyListed");
    await expect(market.connect(bob).delist(0)).to.be.revertedWith("not the seller");

    await expect(market.connect(bob).clearStaleListing(0))
      .to.emit(market, "Delisted")
      .withArgs(0, await nft.getAddress(), 1);

    // And now the new owner can sell it.
    await market.connect(bob).list(await nft.getAddress(), 1, ZERO, e18(50));
    const [listed, , l] = await market.listingOf(await nft.getAddress(), 1);
    expect(listed).to.equal(true);
    expect(l.seller).to.equal(bob.address);
    expect(l.price).to.equal(e18(50));
  });

  it("will not let a stranger clear a listing that is still good", async () => {
    const { alice, bob, market, nft } = await setup();
    await nft.mint(alice.address, 1);
    await nft.connect(alice).setApprovalForAll(await market.getAddress(), true);
    await market.connect(alice).list(await nft.getAddress(), 1, ZERO, e18(100));

    await expect(market.connect(bob).clearStaleListing(0)).to.be.revertedWith(
      "the seller still holds it",
    );

    // A revoked approval is the seller's own business, not grounds for a
    // stranger to cancel their sale.
    await nft.connect(alice).setApprovalForAll(await market.getAddress(), false);
    await expect(market.connect(bob).clearStaleListing(0)).to.be.revertedWith(
      "the seller still holds it",
    );

    const [, , l] = await market.listingOf(await nft.getAddress(), 1);
    expect(l.price).to.equal(e18(100));
  });

  /**
   * Repricing must not be able to charge a buyer more than they agreed to.
   *
   * Before updatePrice existed, changing a price meant delist and relist, which
   * produced a new listing id - so a buy already in the mempool reverted on its
   * own. Repricing in place keeps the id and moves the number under it, which
   * on the ERC-20 path would have let a seller raise the price on top of a
   * pending purchase and be paid out of a standing allowance.
   */
  it("will not let a reprice overcharge a buy that is already in flight", async () => {
    const { owner, alice, bob, market, nft, devox } = await setup();
    await nft.mint(alice.address, 1);
    await nft.connect(alice).setApprovalForAll(await market.getAddress(), true);
    await market.connect(alice).list(await nft.getAddress(), 1, await devox.getAddress(), e18(10));

    // A buyer with a standing allowance, which is the normal case.
    await devox.connect(owner).transfer(bob.address, e18(5000));
    await devox.connect(bob).approve(await market.getAddress(), e18(5000));

    // The seller raises the price before the buy lands.
    await market.connect(alice).updatePrice(0, e18(5000));

    await expect(
      market.connect(bob).buy(0, e18(10)),
    ).to.be.revertedWithCustomError(market, "PriceMoved");

    // Nothing moved: the buyer still holds every token and the NFT is unsold.
    expect(await devox.balanceOf(bob.address)).to.equal(e18(5000));
    expect(await nft.ownerOf(1)).to.equal(alice.address);

    // A buyer who does agree to the new number can still buy.
    await market.connect(bob).buy(0, e18(5000));
    expect(await nft.ownerOf(1)).to.equal(bob.address);
  });

  it("lets a price drop through, since a cheaper fill never harms the buyer", async () => {
    const { alice, bob, market, nft } = await setup();
    await nft.mint(alice.address, 1);
    await nft.connect(alice).setApprovalForAll(await market.getAddress(), true);
    await market.connect(alice).list(await nft.getAddress(), 1, ZERO, e18(100));

    await market.connect(alice).updatePrice(0, e18(40));

    // Agreed to 100, charged 40. The native path still requires exact value.
    await market.connect(bob).buy(0, e18(100), { value: e18(40) });
    expect(await nft.ownerOf(1)).to.equal(bob.address);
  });

  it("refuses to reprice once approval has been revoked", async () => {
    const { alice, market, nft } = await setup();
    await nft.mint(alice.address, 1);
    await nft.connect(alice).setApprovalForAll(await market.getAddress(), true);
    await market.connect(alice).list(await nft.getAddress(), 1, ZERO, e18(100));

    await nft.connect(alice).setApprovalForAll(await market.getAddress(), false);
    await expect(market.connect(alice).updatePrice(0, e18(5))).to.be.revertedWithCustomError(
      market,
      "NotApproved",
    );
  });
});
