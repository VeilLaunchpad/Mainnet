import { ethers, network } from "hardhat";
import { Wallet as CotiWallet, JsonRpcProvider as CotiProvider } from "@coti-io/coti-ethers";

/**
 * The open-collection flow, against a real chain.
 *
 * The claim worth testing here is the one that separates this contract from the
 * drop: an edition has many holders at once, so the same secret is sealed
 * separately to each of them. Proving that means two real wallets, each with
 * its own onboarded key, both reading the same edition - and a third with a
 * valid key reading nothing.
 *
 * That needs a funded second wallet, so this costs a little COTI to run.
 */

const SECRET = "DEVOXPAD Editions · print no.1 · devoxpad-nft.vercel.app/editions/unlock";

async function main() {
  const [signer] = await ethers.getSigners();
  const isMainnet = network.name === "cotiMainnet";
  const suffix = isMainnet ? "MAINNET" : "TESTNET";
  const rpc = isMainnet
    ? process.env.NEXT_PUBLIC_COTI_MAINNET_RPC || "https://mainnet.coti.io/rpc"
    : process.env.NEXT_PUBLIC_COTI_TESTNET_RPC || "https://testnet.coti.io/rpc";

  const factoryAddr = process.env["NEXT_PUBLIC_NFT_EDITIONS_FACTORY_" + suffix] || "";
  if (!factoryAddr) throw new Error("editions factory not deployed on " + network.name);

  const factory = await ethers.getContractAt("DevoxNFTEditionsFactory", factoryAddr);
  console.log("network :", network.name);
  console.log("wallet  :", signer.address);
  console.log("factory :", factoryAddr);

  // ── 1. open a collection at a mined address ─────────────────────────────
  const params = { name: "DEVOXPAD Editions", symbol: "DEVOXE", previewURI: "https://devoxpad-nft.vercel.app/editions/" };
  const initCodeHash = await factory.editionsInitCodeHash(params, signer.address);

  console.log("\n[1] mining an address ending in 8888");
  let seed = BigInt(ethers.hexlify(ethers.randomBytes(16)));
  let salt = "";
  let predicted = "";
  let tries = 0;
  for (;;) {
    const candidate = "0x" + seed.toString(16).padStart(64, "0");
    const addr = ethers.getCreate2Address(factoryAddr, candidate, initCodeHash);
    tries += 1;
    seed += 1n;
    if (addr.toLowerCase().endsWith("8888")) {
      salt = candidate;
      predicted = addr;
      break;
    }
    if (tries > 5_000_000) throw new Error("no salt found");
  }
  const fee = await factory.launchFee();
  await (await factory.createEditions(salt, params, predicted, { value: fee, gasLimit: 6_000_000 })).wait();
  if ((await ethers.provider.getCode(predicted)) === "0x") throw new Error("collection did not land");
  console.log("    " + predicted + "  after " + tries.toLocaleString("en-US") + " tries");

  const coll = await ethers.getContractAt("DevoxNFTEditions", predicted);

  // ── 2. open an edition, open-ended, free ────────────────────────────────
  console.log("\n[2] opening an edition: open-ended supply, free");
  const pk = process.env.DEPLOYER_PRIVATE_KEY || "";
  const alice = new CotiWallet(pk.startsWith("0x") ? pk : "0x" + pk, new CotiProvider(rpc));
  await alice.generateOrRecoverAes();

  const selector = coll.interface.getFunction("createEdition")!.selector;
  const encrypted = await alice.encryptValue(SECRET, predicted, selector);

  await (
    await coll.createEdition(0n, 0n, ethers.ZeroAddress, 0n, 0n, 0n, "", encrypted as never, {
      gasLimit: 12_000_000,
    })
  ).wait();
  const id = await coll.editionCount();
  const e = await coll.editions(id);
  console.log("    edition #" + id + ", maxSupply " + (e.maxSupply === 0n ? "open-ended" : e.maxSupply));

  // ── 3. mint several copies ──────────────────────────────────────────────
  console.log("\n[3] minting 3 copies");
  await (await coll.mint(id, 3, { value: 0, gasLimit: 12_000_000 })).wait();
  console.log("    balance: " + (await coll.balanceOf(signer.address, id)));

  const sealedA = await coll.secretOf(id, signer.address);
  const plainA = String(await alice.decryptValue(sealedA as never));
  console.log("    holder A reads: " + plainA);
  if (!plainA.includes("DEVOXPAD")) throw new Error("holder A could not read it, got: " + plainA);

  // ── 4. a second real holder, with their own key ─────────────────────────
  console.log("\n[4] sending one copy to a second wallet");
  const bobPk = ethers.Wallet.createRandom().privateKey;
  const bob = new CotiWallet(bobPk, new CotiProvider(rpc));
  console.log("    holder B: " + bob.address);

  // Onboarding needs gas, so stake them enough to get a key and nothing more.
  // An explicit gas limit, because estimating would ask for the pending block
  // and COTI does not serve one.
  await (
    await signer.sendTransaction({ to: bob.address, value: ethers.parseEther("1.5"), gasLimit: 100_000 })
  ).wait();
  await bob.generateOrRecoverAes();
  console.log("    holder B onboarded, has their own AES key");

  await (
    await coll.safeTransferFrom(signer.address, bob.address, id, 1, "0x", { gasLimit: 12_000_000 })
  ).wait();
  console.log(
    "    balances now A=" +
      (await coll.balanceOf(signer.address, id)) +
      " B=" +
      (await coll.balanceOf(bob.address, id)),
  );

  const sealedB = await coll.secretOf(id, bob.address);
  const plainB = String(await bob.decryptValue(sealedB as never));
  console.log("    holder B reads: " + plainB);
  if (plainB !== plainA) throw new Error("the two holders read different things: " + plainB);

  const sameBytes = JSON.stringify(sealedA.map(String)) === JSON.stringify(sealedB.map(String));
  console.log("    same plaintext, " + (sameBytes ? "SAME" : "different") + " ciphertext");
  if (sameBytes) throw new Error("*** both holders share one ciphertext - keys are not separate ***");

  // ── 5. and a stranger still gets nothing ────────────────────────────────
  console.log("\n[5] a third wallet with a valid key");
  const stranger = new CotiWallet(ethers.Wallet.createRandom().privateKey, new CotiProvider(rpc));
  stranger.disableAutoOnboard();
  stranger.setAesKey(ethers.hexlify(ethers.randomBytes(16)).slice(2));
  let saw: string;
  try {
    saw = String(await stranger.decryptValue(sealedA as never));
  } catch (err) {
    saw = "<threw: " + String((err as Error).message).slice(0, 40) + ">";
  }
  console.log("    sees: " + saw.replace(/[^\x20-\x7e]/g, "·").slice(0, 46));
  if (saw === plainA) throw new Error("*** a non-holder decrypted the edition ***");

  // ── 6. give the leftover gas back ───────────────────────────────────────
  const left = await ethers.provider.getBalance(bob.address);
  const keep = ethers.parseEther("0.3");
  if (left > keep) {
    await (
      await bob.sendTransaction({ to: signer.address, value: left - keep, gasLimit: 200_000 })
    ).wait();
    console.log("\n    returned " + ethers.formatEther(left - keep) + " COTI of test gas");
  }

  console.log("\nTwo holders, one edition, two keys, one secret. On " + network.name + ".");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
