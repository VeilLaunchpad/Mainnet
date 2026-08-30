import { ethers, network } from "hardhat";

/**
 * Redeploys DevoxNFTMarket so listings can be repriced, and moves the live
 * listings across.
 *
 * The deployed marketplace has no way to change a price. A seller who wants a
 * different number has to delist and list again, and until now the app offered
 * neither, so a price was permanent once set. `updatePrice` fixes that, and a
 * function cannot be added to a contract already on chain.
 *
 * Redeploying a live marketplace is only cheap while it is nearly empty, which
 * is exactly the case here and will not be later: two listings, both from the
 * deployer's own wallet, and no offers at all. Offers are the dangerous part -
 * `makeOffer` escrows the bid inside the contract, so abandoning a market that
 * held any would strand somebody else's money. `offerCount` is checked below
 * rather than assumed, and the script refuses to continue if that has changed.
 *
 * Order matters for the migration. The new listings are created before the old
 * ones are cancelled, so at no point is a token unlisted on both markets - and
 * because nothing is ever escrowed, the NFTs never leave the seller's wallet at
 * any stage.
 *
 * Every write carries an explicit gasLimit. Without one, ethers estimates
 * against the `pending` block, which COTI's RPC does not serve - the script
 * would die on its first setOfficial having already deployed the contract.
 * redeploy-staking.ts does the same thing for the same reason.
 *
 *   npx hardhat run scripts/redeploy-market.ts --network cotiMainnet
 */

async function main() {
  const [deployer] = await ethers.getSigners();
  const isMainnet = network.name === "cotiMainnet";
  const suffix = isMainnet ? "MAINNET" : "TESTNET";

  const oldMarketAddr = process.env["NEXT_PUBLIC_NFT_MARKET_" + suffix] || "";
  if (!oldMarketAddr) throw new Error("no existing market address for " + network.name);

  console.log("network   :", network.name);
  console.log("deployer  :", deployer.address);
  console.log("old market:", oldMarketAddr);
  console.log(
    "balance   :",
    ethers.formatEther(await ethers.provider.getBalance(deployer.address)),
    "COTI\n",
  );

  const oldMarket = await ethers.getContractAt("DevoxNFTMarket", oldMarketAddr);

  // ── read what has to survive the move ───────────────────────────────────
  const offerCount: bigint = await oldMarket.offerCount();
  if (offerCount > 0n) {
    // An escrowed offer is somebody's money sitting in the old contract. Moving
    // away from it without refunding first would strand that, so this stops.
    throw new Error(
      "the old market holds " +
        offerCount +
        " offer(s) with escrowed funds - cancel or accept them before migrating",
    );
  }

  const listingCount: bigint = await oldMarket.listingCount();
  console.log("listings on the old market:", listingCount.toString());

  type Live = { id: bigint; collection: string; tokenId: bigint; payToken: string; price: bigint };
  const live: Live[] = [];

  for (let i = 0n; i < listingCount; i++) {
    const l = await oldMarket.listing(i);
    if (!l.active) continue;
    if (l.seller.toLowerCase() !== deployer.address.toLowerCase()) {
      // Someone else's listing cannot be recreated - only they can sign a list.
      // Saying so is better than moving and silently dropping it.
      console.log(
        "  ! listing " + i + " belongs to " + l.seller + " and cannot be migrated from here",
      );
      continue;
    }
    live.push({
      id: i,
      collection: l.collection,
      tokenId: l.tokenId,
      payToken: l.payToken,
      price: l.price,
    });
    console.log(
      "  listing " +
        i +
        ": #" +
        l.tokenId +
        " of " +
        l.collection +
        " at " +
        ethers.formatEther(l.price) +
        (l.payToken === ethers.ZeroAddress ? " COTI" : " (token " + l.payToken + ")"),
    );
  }

  /**
   * Collection settings are per-market state and do not come along on their own.
   *
   * They are read from the factories rather than from the live listings.
   * Sourcing them from listings looked equivalent - the only collection with
   * settings today is also the only one listed - but the two lists are equal by
   * coincidence, not by rule. If both listings sold or were delisted in the
   * minutes before this ran, `live` would be empty, and the new market would
   * open with the Genesis "official" badge gone and its 5% royalty silently
   * switched off. Nobody would see an error; the money would just stop
   * arriving.
   */
  const known = new Set<string>(live.map((l) => l.collection.toLowerCase()));
  const registry = [
    process.env["NEXT_PUBLIC_NFT_FACTORY_" + suffix],
    process.env["NEXT_PUBLIC_NFT_EDITIONS_FACTORY_" + suffix],
  ].filter(Boolean) as string[];

  const PAGE_ABI = [
    "function page(uint256 start, uint256 count) view returns (tuple(address addr, address creator, string name, string symbol, uint256 createdAt)[])",
  ];
  for (const f of registry) {
    try {
      const factory = new ethers.Contract(f, PAGE_ABI, deployer);
      const rows = await factory.page(0n, 200n);
      for (const r of rows) known.add(String(r.addr).toLowerCase());
    } catch {
      // An editions factory with a different page shape, or none deployed. The
      // listed collections are still covered either way.
    }
  }

  const collections = [...known].map((c) => ethers.getAddress(c));
  const settings = await Promise.all(
    collections.map(async (c) => ({
      collection: c,
      official: await oldMarket.official(c),
      royaltyBps: await oldMarket.royaltyBps(c),
      royaltyRecipient: await oldMarket.royaltyRecipient(c),
    })),
  );
  console.log(
    "collections to carry over:",
    settings.filter((s) => s.official || s.royaltyBps > 0n).length,
    "of",
    collections.length,
  );

  const feeRecipient: string = await oldMarket.feeRecipient();
  const feeBps: bigint = await oldMarket.feeBps();
  console.log("\nfee       :", feeBps.toString(), "bps to", feeRecipient);

  // ── deploy ──────────────────────────────────────────────────────────────
  console.log("\ndeploying the replacement…");
  const factory = await ethers.getContractFactory("DevoxNFTMarket");
  const deployTx = await factory.getDeployTransaction(deployer.address, feeRecipient, feeBps);
  const estimate: string = await ethers.provider.send("eth_estimateGas", [
    { from: deployer.address, data: deployTx.data },
    "latest",
  ]);
  const market = await factory.deploy(deployer.address, feeRecipient, feeBps, {
    gasLimit: (BigInt(estimate) * 125n) / 100n,
  });
  await market.waitForDeployment();
  const newAddr = await market.getAddress();
  console.log("  DevoxNFTMarket", newAddr, " gas", BigInt(estimate).toLocaleString("en-US"));

  // Prove the new function is actually there before anything is migrated onto
  // it. Read from the deployed bytecode, not from `market.interface` - that
  // comes from the same local artifact that produced the bytecode, so it would
  // agree with itself no matter what reached the chain.
  const runtime = await ethers.provider.getCode(newAddr);
  for (const sig of ["updatePrice(uint256,uint256)", "clearStaleListing(uint256)", "buy(uint256,uint256)"]) {
    const selector = ethers.id(sig).slice(2, 10);
    if (!runtime.includes(selector)) throw new Error(sig + " is missing from the deployed code");
    console.log("  " + sig.padEnd(34) + "present");
  }

  const newMarket = await ethers.getContractAt("DevoxNFTMarket", newAddr);

  // ── carry the collection settings over ──────────────────────────────────
  for (const s of settings) {
    if (s.official) {
      await (await newMarket.setOfficial(s.collection, true, { gasLimit: 200_000 })).wait();
      console.log("  official  :", s.collection);
    }
    if (s.royaltyBps > 0n) {
      await (await newMarket.setRoyalty(s.collection, s.royaltyRecipient, s.royaltyBps, { gasLimit: 200_000 })).wait();
      console.log("  royalty   :", s.royaltyBps.toString(), "bps to", s.royaltyRecipient);
    }
  }

  // ── approve, relist, then release the old ones ──────────────────────────
  // Spelled out rather than resolved from an artifact name: an interface that
  // is only imported, never deployed, is not guaranteed to be in the artifacts,
  // and finding that out halfway through a migration is the wrong time.
  const ERC721_MIN = [
    "function isApprovedForAll(address owner, address operator) view returns (bool)",
    "function setApprovalForAll(address operator, bool approved)",
    "function ownerOf(uint256 tokenId) view returns (address)",
  ];

  for (const c of collections) {
    const nft = new ethers.Contract(c, ERC721_MIN, deployer);
    if (!(await nft.isApprovedForAll(deployer.address, newAddr))) {
      await (await nft.setApprovalForAll(newAddr, true, { gasLimit: 200_000 })).wait();
      console.log("  approved  :", c);
    } else {
      console.log("  approved  :", c, "(already)");
    }
    // A relist reverts if the token moved since it was listed, so it is worth
    // knowing which token that was rather than reading a bare revert.
    for (const l of live.filter((x) => x.collection === c)) {
      const holder: string = await nft.ownerOf(l.tokenId);
      if (holder.toLowerCase() !== deployer.address.toLowerCase()) {
        throw new Error("#" + l.tokenId + " is held by " + holder + ", not the deployer");
      }
    }
  }

  for (const l of live) {
    const tx = await newMarket.list(l.collection, l.tokenId, l.payToken, l.price, {
      gasLimit: 600_000,
    });
    await tx.wait();
    console.log(
      "  relisted  : #" + l.tokenId + " at " + ethers.formatEther(l.price) + " COTI",
    );
  }

  // Only now, with the token listed on the new market, is the old one released.
  for (const l of live) {
    await (await oldMarket.delist(l.id, { gasLimit: 300_000 })).wait();
    console.log("  delisted  : old listing " + l.id);
  }

  // ── verify the result by reading it back ────────────────────────────────
  const newCount: bigint = await newMarket.listingCount();
  console.log("\nnew market listings:", newCount.toString());
  for (let i = 0n; i < newCount; i++) {
    const [liveNow, reason] = await newMarket.listingLive(i);
    const l = await newMarket.listing(i);
    console.log(
      "  " +
        i +
        ": #" +
        l.tokenId +
        " at " +
        ethers.formatEther(l.price) +
        " COTI  live=" +
        liveNow +
        (reason ? " (" + reason + ")" : ""),
    );
  }
  const oldRemaining: bigint = await oldMarket.listingCount();
  let stillActive = 0;
  for (let i = 0n; i < oldRemaining; i++) if ((await oldMarket.listing(i)).active) stillActive++;
  console.log("old market still active:", stillActive);

  console.log("\n  NEXT_PUBLIC_NFT_MARKET_" + suffix + "=" + newAddr);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
