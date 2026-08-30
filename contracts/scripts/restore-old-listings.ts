import { ethers, network } from "hardhat";

/**
 * Puts the two listings back on the OLD marketplace.
 *
 * The migration moved them to the new contract and delisted them on the old
 * one, which is correct - but the deployed app still reads the old address,
 * and cannot be redeployed right now because the Railway CLI is signed into a
 * different account. The live marketplace therefore shows two listings that
 * are all marked unfillable, which is worse than showing nothing.
 *
 * Listing on both markets at once is safe here and not a double-sale risk.
 * Neither market escrows anything, and `buy` re-checks ownership at execution
 * on both - so whichever sells first leaves the other listing failing its own
 * ownership check rather than transferring a token twice.
 *
 * This is temporary. Once the app points at the new marketplace, delist these
 * again with DEVOX_UNDO=1.
 *
 *   npx hardhat run scripts/restore-old-listings.ts --network cotiMainnet
 *   DEVOX_UNDO=1 npx hardhat run scripts/restore-old-listings.ts --network cotiMainnet
 */

const TO_RESTORE = [
  { tokenId: 2n, price: ethers.parseEther("25") },
  { tokenId: 3n, price: ethers.parseEther("5") },
];

async function main() {
  const [deployer] = await ethers.getSigners();
  const suffix = network.name === "cotiMainnet" ? "MAINNET" : "TESTNET";
  const undo = process.env.DEVOX_UNDO === "1";

  const oldMarket = "0x83dAA54A3d5D96434458a294Af60a39A6EF04791";
  const collection = process.env["NEXT_PUBLIC_NFT_GENESIS_" + suffix] || "";
  if (!collection) throw new Error("no Genesis collection address for " + network.name);

  const market = await ethers.getContractAt("DevoxNFTMarket", oldMarket);
  console.log("old market:", oldMarket);
  console.log("collection:", collection);
  console.log("mode      :", undo ? "delist" : "restore", "\n");

  if (undo) {
    const count: bigint = await market.listingCount();
    for (let i = 0n; i < count; i++) {
      const l = await market.listing(i);
      if (!l.active) continue;
      if (l.seller.toLowerCase() !== deployer.address.toLowerCase()) continue;
      await (await market.delist(i, { gasLimit: 300_000 })).wait();
      console.log("  delisted listing", i.toString());
    }
    return;
  }

  // The approval from the original listings is still in place; checked rather
  // than assumed, because listing without it reverts with NotApproved.
  const nft = new ethers.Contract(
    collection,
    [
      "function isApprovedForAll(address,address) view returns (bool)",
      "function setApprovalForAll(address,bool)",
      "function ownerOf(uint256) view returns (address)",
    ],
    deployer,
  );
  if (!(await nft.isApprovedForAll(deployer.address, oldMarket))) {
    await (await nft.setApprovalForAll(oldMarket, true, { gasLimit: 200_000 })).wait();
    console.log("  re-approved the old market");
  }

  for (const t of TO_RESTORE) {
    const holder: string = await nft.ownerOf(t.tokenId);
    if (holder.toLowerCase() !== deployer.address.toLowerCase()) {
      console.log("  ! #" + t.tokenId + " is held by " + holder + ", skipping");
      continue;
    }
    const [listed] = await market.listingOf(collection, t.tokenId);
    if (listed) {
      console.log("  #" + t.tokenId + " is already listed here");
      continue;
    }
    await (
      await market.list(collection, t.tokenId, ethers.ZeroAddress, t.price, { gasLimit: 600_000 })
    ).wait();
    console.log("  listed #" + t.tokenId + " at " + ethers.formatEther(t.price) + " COTI");
  }

  const count: bigint = await market.listingCount();
  let live = 0;
  for (let i = 0n; i < count; i++) {
    const [ok] = await market.listingLive(i);
    if (ok) live++;
  }
  console.log("\nold market listings now fillable:", live);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
