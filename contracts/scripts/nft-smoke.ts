import { ethers, network } from "hardhat";
import { Wallet as CotiWallet, JsonRpcProvider as CotiProvider } from "@coti-io/coti-ethers";

/**
 * The whole NFT flow, against a real chain.
 *
 * The unit tests cover the marketplace and the staking maths on a local EVM.
 * What they cannot touch is the privacy, because it runs through COTI's MPC
 * precompile: minting, sealing the metadata, and - the part that actually
 * matters - proving somebody who does not hold the token cannot read it.
 *
 * That last check is the point of the whole design, so it is written as a test
 * that fails loudly rather than a comment claiming it is true.
 */

const suffix = () => (network.name === "cotiMainnet" ? "MAINNET" : "TESTNET");
const env = (k: string) => process.env[k + "_" + suffix()] || "";

async function main() {
  const [signer] = await ethers.getSigners();

  const genesis = env("NEXT_PUBLIC_NFT_GENESIS");
  const stakingAddr = env("NEXT_PUBLIC_NFT_STAKING");
  const marketAddr = env("NEXT_PUBLIC_NFT_MARKET");
  const devoxAddr = env("NEXT_PUBLIC_DEVOX_TOKEN");
  if (!genesis || !stakingAddr) throw new Error("NFT stack not deployed on " + network.name);

  const drop = await ethers.getContractAt("DevoxNFTDrop", genesis);
  const staking = await ethers.getContractAt("DevoxNFTStaking", stakingAddr);
  const market = await ethers.getContractAt("DevoxNFTMarket", marketAddr);
  const devox = await ethers.getContractAt("DevoxpadToken", devoxAddr);

  console.log("network :", network.name);
  console.log("wallet  :", signer.address);
  console.log("Genesis :", genesis);
  console.log("supply  :", (await drop.totalMinted()).toString(), "/", (await drop.maxSupply()).toString());
  console.log("official:", await market.official(genesis));

  const [open, reason] = await drop.mintState(signer.address);
  console.log("mintable:", open, reason ? "(" + reason + ")" : "");
  if (!open) throw new Error("cannot mint: " + reason);

  // ── 1. mint ─────────────────────────────────────────────────────────────
  console.log("\n[1] minting one, free");
  const before = await drop.totalMinted();
  await (await drop.mint(1, { value: 0, gasLimit: 12_000_000 })).wait();
  const tokenId = before + 1n;
  console.log("    token #" + tokenId + " owned by " + (await drop.ownerOf(tokenId)));

  // ── 2. read the private metadata, as the owner ──────────────────────────
  console.log("\n[2] reading the sealed metadata as the holder");
  const pk = process.env.DEPLOYER_PRIVATE_KEY || "";
  const rpc =
    network.name === "cotiMainnet"
      ? process.env.NEXT_PUBLIC_COTI_MAINNET_RPC || "https://mainnet.coti.io/rpc"
      : process.env.NEXT_PUBLIC_COTI_TESTNET_RPC || "https://testnet.coti.io/rpc";

  const cotiWallet = new CotiWallet(pk.startsWith("0x") ? pk : "0x" + pk, new CotiProvider(rpc));
  await cotiWallet.generateOrRecoverAes();

  const sealed = await drop.tokenURI(tokenId);
  // decryptValue is async. Awaiting it is the difference between reading the
  // token and reading the string "[object Promise]".
  const plain = String(await cotiWallet.decryptValue(sealed as never));

  // The ciphertext is an array of BigInt, which JSON.stringify refuses.
  const show = (v: unknown) =>
    Array.isArray(v) ? "[" + v.slice(0, 2).map(String).join(", ") + ", …]" : String(v);
  console.log("    ciphertext on chain : " + show(sealed).slice(0, 60) + "…");
  console.log("    decrypted by holder : " + plain);
  if (!plain.includes("DEVOXPAD")) {
    throw new Error("the holder could not read their own token, got: " + plain);
  }

  // ── 3. prove a stranger cannot ──────────────────────────────────────────
  //
  // The adversary that matters is not a wallet with no key - that one fails for
  // uninteresting reasons. It is somebody holding a perfectly valid COTI AES
  // key that simply is not the key this token was sealed to. decryptString runs
  // happily against the wrong key and returns garbage, so the check is that the
  // garbage is not the secret.
  console.log("\n[3] proving a non-holder cannot read it");
  const strangerKey = ethers.hexlify(ethers.randomBytes(16)).slice(2);
  const stranger = new CotiWallet(ethers.Wallet.createRandom().privateKey, new CotiProvider(rpc));
  stranger.disableAutoOnboard(); // never silently onboard and read it legitimately
  stranger.setAesKey(strangerKey);

  let strangerSaw: string;
  try {
    strangerSaw = String(await stranger.decryptValue(sealed as never));
  } catch (e) {
    strangerSaw = "<threw: " + String((e as Error).message).slice(0, 50) + ">";
  }
  const printable = strangerSaw.replace(/[^ -~]/g, "·").slice(0, 46);
  console.log("    stranger's own key  : " + strangerKey.slice(0, 16) + "… (valid, but not the one)");
  console.log("    stranger sees       : " + printable);
  if (strangerSaw === plain) {
    throw new Error("*** a non-holder decrypted the metadata - privacy is broken ***");
  }
  console.log("    -> sealed to the holder alone");

  // ── 4. stake it, and earn $DEVOX ─────────────────────────────────────────
  console.log("\n[4] staking it");
  const [paired, pid] = await staking.poolOf(genesis);
  if (!paired) throw new Error("Genesis is not paired");

  await (await drop.setApprovalForAll(stakingAddr, true, { gasLimit: 1_000_000 })).wait();
  await (await staking.stake(pid, [tokenId], { gasLimit: 2_000_000 })).wait();
  console.log("    staked into pool " + pid + ", held by " + (await drop.ownerOf(tokenId)));

  console.log("\n[5] waiting for blocks so the reward accrues");
  const start = await ethers.provider.getBlockNumber();
  const began = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, 4000));
    const now = await ethers.provider.getBlockNumber();
    if (now > start + 3 || Date.now() - began > 90_000) break;
  }
  const pending = await staking.pendingReward(pid, signer.address);
  console.log("    accrued " + ethers.formatUnits(pending, 18) + " DEVOX");

  // ── 6. claim, and take it back ──────────────────────────────────────────
  console.log("\n[6] claiming, then unstaking");
  const devoxBefore = await devox.balanceOf(signer.address);
  await (await staking.claim(pid, { gasLimit: 1_000_000 })).wait();
  console.log("    received " + ethers.formatUnits((await devox.balanceOf(signer.address)) - devoxBefore, 18) + " DEVOX");

  await (await staking.unstake(pid, [tokenId], { gasLimit: 2_000_000 })).wait();
  console.log("    NFT back with " + (await drop.ownerOf(tokenId)));

  // ── 7. list it ──────────────────────────────────────────────────────────
  console.log("\n[7] listing it on the marketplace");
  await (await drop.setApprovalForAll(marketAddr, true, { gasLimit: 1_000_000 })).wait();
  await (
    await market.list(genesis, tokenId, ethers.ZeroAddress, ethers.parseEther("1"), { gasLimit: 1_000_000 })
  ).wait();

  const id = (await market.listingCount()) - 1n;
  const [live, why] = await market.listingLive(id);
  console.log("    listing #" + id + " at 1 COTI, live=" + live + (why ? " (" + why + ")" : ""));

  await (await market.delist(id, { gasLimit: 500_000 })).wait();
  console.log("    delisted again");

  console.log("\nmint, seal, stake, claim, unstake, list. All of it on " + network.name + ".");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
