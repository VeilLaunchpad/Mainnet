import { ethers, network } from "hardhat";

/**
 * Exercises the new marketplace against the live listings.
 *
 * `updatePrice` is the whole reason the marketplace was redeployed, so it is
 * worth proving on chain rather than only in the test suite: one transaction,
 * the price moves, everything else about the listing stays where it was.
 *
 * It sets the price and then sets it straight back, so the marketplace is left
 * exactly as it was found - the point is the two transactions in the history,
 * not a different asking price.
 *
 *   npx hardhat run scripts/exercise-reprice.ts --network cotiMainnet
 */

async function main() {
  const [deployer] = await ethers.getSigners();
  const suffix = network.name === "cotiMainnet" ? "MAINNET" : "TESTNET";
  const addr = process.env["NEXT_PUBLIC_NFT_MARKET_" + suffix] || "";
  if (!addr) throw new Error("no marketplace address for " + network.name);

  const market = await ethers.getContractAt("DevoxNFTMarket", addr);
  console.log("market  :", addr);
  console.log("wallet  :", deployer.address, "\n");

  const count: bigint = await market.listingCount();
  let target = -1n;
  for (let i = 0n; i < count; i++) {
    const l = await market.listing(i);
    if (l.active && l.seller.toLowerCase() === deployer.address.toLowerCase()) {
      target = i;
      break;
    }
  }
  if (target < 0n) throw new Error("no live listing of your own to exercise");

  const before = await market.listing(target);
  const original = before.price;
  const probe = (original * 80n) / 100n; // 20% off, then back

  console.log("listing " + target + ": #" + before.tokenId + " at " + ethers.formatEther(original) + " COTI");

  const down = await market.updatePrice(target, probe, { gasLimit: 300_000 });
  const r1 = await down.wait();
  console.log("  reprice -> " + ethers.formatEther(probe) + " COTI   tx " + r1?.hash);

  const mid = await market.listing(target);
  if (mid.price !== probe) throw new Error("the price did not move");
  // Everything except the price must be untouched, which is the property the
  // contract's tests pin and the one a reprice must never break.
  for (const [k, a, b] of [
    ["seller", mid.seller, before.seller],
    ["collection", mid.collection, before.collection],
    ["tokenId", mid.tokenId, before.tokenId],
    ["payToken", mid.payToken, before.payToken],
    ["listedAt", mid.listedAt, before.listedAt],
  ] as [string, unknown, unknown][]) {
    if (String(a) !== String(b)) throw new Error(k + " changed during a reprice");
  }
  console.log("  seller, collection, token, pay token and listedAt all unchanged");

  const up = await market.updatePrice(target, original, { gasLimit: 300_000 });
  const r2 = await up.wait();
  console.log("  restore -> " + ethers.formatEther(original) + " COTI   tx " + r2?.hash);

  const after = await market.listing(target);
  const [live, reason] = await market.listingLive(target);
  console.log(
    "\nfinal: #" + after.tokenId + " at " + ethers.formatEther(after.price) +
      " COTI  live=" + live + (reason ? " (" + reason + ")" : ""),
  );
  if (after.price !== original) throw new Error("the listing was not restored");
  console.log("restored exactly as found; two reprices are now in its history");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
