import { ethers, network } from "hardhat";
import { Wallet as CotiWallet, JsonRpcProvider as CotiProvider } from "@coti-io/coti-ethers";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Deploys the NFT stack and opens VEILPAD's own collection.
 *
 * Order is forced by dependency. The factory and marketplace stand alone; the
 * official collection has to exist before it can be marked official or paired;
 * and a paired pool cannot open until its reward budget is escrowed, which is
 * the whole point of pairing.
 *
 * The private metadata is the step that needs COTI itself. `setSecret` takes a
 * value encrypted to the deployer's AES key, which only exists after the wallet
 * has onboarded through AccountOnboard - so this script cannot be rehearsed on
 * a local EVM, and is written to be run against a real network.
 */

const SUFFIX = "8888";

/** The official collection. Free to mint, and capped like a real drop. */
const OFFICIAL = {
  name: "VEILPAD Genesis",
  symbol: "VEILG",
  supply: 10_000n,
  price: 0n, // free mint
  maxPerWallet: 10n,
  preview: "https://veilpad-nft.vercel.app/genesis/",
  /** What only a holder can read. Sealed to each minter by the contract. */
  secret: "VEILPAD Genesis · holder key · veilpad-nft.vercel.app/genesis/unlock",
};

/** What a staked Genesis earns, and what backs it. */
const PAIRING = {
  rewardPerNftPerYear: ethers.parseUnits("500", 18), // 500 VEIL per NFT per year
  notionalPerNft: 0n, // a free mint has no price to be a percentage of
  budget: ethers.parseUnits("5000000", 18), // 5M VEIL escrowed up front
};

const MARKET_FEE_BPS = 250; // 2.5%
const LAUNCH_FEE = ethers.parseEther("0.05");

async function deploy(name: string, args: unknown[] = []) {
  const factory = await ethers.getContractFactory(name);
  const [signer] = await ethers.getSigners();

  const tx = await factory.getDeployTransaction(...(args as never[]));
  const estimate: string = await ethers.provider.send("eth_estimateGas", [
    { from: signer.address, data: tx.data },
    "latest",
  ]);
  const contract = await factory.deploy(...(args as never[]), {
    gasLimit: (BigInt(estimate) * 125n) / 100n,
  });
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log("  " + name.padEnd(18) + address + "  gas " + BigInt(estimate).toLocaleString("en-US"));
  return { address, contract };
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const isMainnet = network.name === "cotiMainnet";
  const suffix = isMainnet ? "MAINNET" : "TESTNET";
  const netKey = isMainnet ? "mainnet" : "testnet";

  const veil = process.env["NEXT_PUBLIC_VEIL_TOKEN_" + suffix] || "";
  if (!veil) throw new Error("VEILPAD token address missing for " + netKey);

  console.log("network :", network.name);
  console.log("deployer:", deployer.address);
  console.log("balance :", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "COTI");
  console.log("$VEIL   :", veil, "\n");

  // ── the three singletons ────────────────────────────────────────────────
  console.log("deploying:");
  const { address: factoryAddr, contract: factory } = await deploy("VeilNFTFactory", [
    deployer.address,
    deployer.address,
    LAUNCH_FEE,
  ]);
  const { address: marketAddr } = await deploy("VeilNFTMarket", [
    deployer.address,
    deployer.address,
    MARKET_FEE_BPS,
  ]);
  const { address: stakingAddr } = await deploy("VeilNFTStaking", [deployer.address]);

  // Re-attached through getContractAt so the calls below are typed. The factory
  // handle from `deploy` is a bare BaseContract and knows none of these methods.
  const market = await ethers.getContractAt("VeilNFTMarket", marketAddr);
  const staking = await ethers.getContractAt("VeilNFTStaking", stakingAddr);

  // ── the official collection, at a mined address ─────────────────────────
  const params = {
    name: OFFICIAL.name,
    symbol: OFFICIAL.symbol,
    previewURI: OFFICIAL.preview,
    maxSupply: OFFICIAL.supply,
    mintPrice: OFFICIAL.price,
    payToken: ethers.ZeroAddress,
    maxPerWallet: OFFICIAL.maxPerWallet,
    presaleStart: 0n,
    publicStart: 0n,
  };

  const initCodeHash = await (factory as never as {
    dropInitCodeHash: (p: unknown, c: string) => Promise<string>;
  }).dropInitCodeHash(params, deployer.address);

  console.log("\nmining a collection address ending in " + SUFFIX);
  const began = Date.now();
  let attempts = 0;
  let seed = BigInt(ethers.hexlify(ethers.randomBytes(16)));
  let salt = "";
  let predicted = "";
  for (;;) {
    const candidate = "0x" + seed.toString(16).padStart(64, "0");
    const addr = ethers.getCreate2Address(factoryAddr, candidate, initCodeHash);
    attempts += 1;
    seed += 1n;
    if (addr.toLowerCase().endsWith(SUFFIX)) {
      salt = candidate;
      predicted = addr;
      break;
    }
    if (attempts > 5_000_000) throw new Error("no salt found");
  }
  console.log(
    "  found after " + attempts.toLocaleString("en-US") + " tries in " + (Date.now() - began) + "ms",
  );

  await (
    await (factory as never as {
      createDrop: (s: string, p: unknown, e: string, o: object) => Promise<{ wait: () => Promise<unknown> }>;
    }).createDrop(salt, params, predicted, { value: LAUNCH_FEE, gasLimit: 6_000_000 })
  ).wait();

  const code = await ethers.provider.getCode(predicted);
  if (code === "0x") throw new Error("collection did not land at the predicted address");
  console.log("  VEILPAD Genesis   " + predicted + "  (mined, verified on chain)");

  // ── the private metadata, encrypted to the network ──────────────────────
  //
  // This is the step that needs COTI. The value is encrypted under the
  // deployer's AES key, validated by the MPC network, and stored as a network
  // ciphertext the contract re-seals to each minter.
  console.log("\nsealing the private metadata");
  const pk = process.env.DEPLOYER_PRIVATE_KEY || "";
  const rpc = isMainnet
    ? process.env.NEXT_PUBLIC_COTI_MAINNET_RPC || "https://mainnet.coti.io/rpc"
    : process.env.NEXT_PUBLIC_COTI_TESTNET_RPC || "https://testnet.coti.io/rpc";

  const cotiProvider = new CotiProvider(rpc);
  const cotiWallet = new CotiWallet(pk.startsWith("0x") ? pk : "0x" + pk, cotiProvider);

  // Onboarding is idempotent: an account that already has a key gets the same
  // one back rather than a new one.
  await cotiWallet.generateOrRecoverAes();
  console.log("  deployer AES key ready");

  const drop = await ethers.getContractAt("VeilNFTDrop", predicted);
  const selector = drop.interface.getFunction("setSecret")!.selector;
  const encrypted = await cotiWallet.encryptValue(OFFICIAL.secret, predicted, selector);

  await (await drop.setSecret(encrypted as never, { gasLimit: 12_000_000 })).wait();
  console.log("  secret set, and only a holder can read it");

  // ── mark it, and pair it ────────────────────────────────────────────────
  console.log("\nwiring:");
  await (await market.setOfficial(predicted, true, { gasLimit: 200_000 })).wait();
  console.log("  marked official on the marketplace");

  await (await market.setRoyalty(predicted, deployer.address, 500, { gasLimit: 300_000 })).wait();
  console.log("  royalty 5% to the creator");

  const token = await ethers.getContractAt("VeilpadToken", veil);
  await (await token.approve(stakingAddr, PAIRING.budget, { gasLimit: 200_000 })).wait();
  await (
    await staking.openPool(
      predicted,
      veil,
      PAIRING.rewardPerNftPerYear,
      PAIRING.notionalPerNft,
      PAIRING.budget,
      { gasLimit: 1_000_000 },
    )
  ).wait();
  console.log(
    "  paired with $VEIL: " +
      ethers.formatUnits(PAIRING.rewardPerNftPerYear, 18) +
      " per NFT per year, " +
      Number(ethers.formatUnits(PAIRING.budget, 18)).toLocaleString("en-US") +
      " escrowed",
  );

  // ── record it ───────────────────────────────────────────────────────────
  const mapping: Record<string, string> = {
    ["NEXT_PUBLIC_NFT_FACTORY_" + suffix]: factoryAddr,
    ["NEXT_PUBLIC_NFT_MARKET_" + suffix]: marketAddr,
    ["NEXT_PUBLIC_NFT_STAKING_" + suffix]: stakingAddr,
    ["NEXT_PUBLIC_NFT_GENESIS_" + suffix]: predicted,
  };
  writeEnv(mapping);
  writeMasterTable(netKey, factoryAddr, marketAddr, stakingAddr, predicted);

  console.log("\nWrote to ../.env.local:");
  for (const [k, v] of Object.entries(mapping)) console.log("  " + k + "=" + v);

  const staked = await staking.runway(0);
  console.log(
    "\nGenesis: " +
      OFFICIAL.supply +
      " free to mint, max " +
      OFFICIAL.maxPerWallet +
      " per wallet, metadata sealed to the holder.",
  );
  console.log("Stake one and it earns $VEIL. Runway with nothing staked yet: unbounded (" + staked + ").");
}

function writeMasterTable(
  netKey: string,
  factory: string,
  market: string,
  staking: string,
  genesis: string,
) {
  const file = path.resolve(__dirname, "../../config/veilpad." + netKey + ".json");
  if (!fs.existsSync(file)) return;
  const table = JSON.parse(fs.readFileSync(file, "utf8"));

  table.nft = {
    _comment:
      "The NFT stack. Drops are COTI PrivateERC721: the preview is public so a marketplace can render it, and the metadata is a ciphertext re-sealed to whoever holds the token.",
    factory,
    market,
    staking,
    marketFeeBps: MARKET_FEE_BPS,
    launchFeeCoti: ethers.formatEther(LAUNCH_FEE),
    official: {
      genesis: {
        address: genesis,
        name: OFFICIAL.name,
        symbol: OFFICIAL.symbol,
        supply: OFFICIAL.supply.toString(),
        mintPrice: "0",
        maxPerWallet: OFFICIAL.maxPerWallet.toString(),
        pairedWith: "VEIL",
        rewardPerNftPerYear: ethers.formatUnits(PAIRING.rewardPerNftPerYear, 18),
        budget: ethers.formatUnits(PAIRING.budget, 18),
      },
    },
  };
  fs.writeFileSync(file, JSON.stringify(table, null, 2) + "\n");
}

function writeEnv(mapping: Record<string, string>) {
  const envPath = path.resolve(__dirname, "../../.env.local");
  let text = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  for (const [key, value] of Object.entries(mapping)) {
    const line = key + "=" + value;
    const re = new RegExp("^" + key + "=.*$", "m");
    text = re.test(text) ? text.replace(re, line) : text.trimEnd() + "\n" + line + "\n";
  }
  fs.writeFileSync(envPath, text);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
