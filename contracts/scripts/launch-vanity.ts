/* eslint-disable @typescript-eslint/no-explicit-any */
import { ethers } from "hardhat";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Launches a token end to end with the full flow: a mined 8888 address, a dev
 * buy, and whatever the creator chose to do with that allocation.
 *
 *   VEIL_SYMBOL=GG VEIL_DEVBUY=0.3 VEIL_ALLOC=burn VEIL_BURN=50 \
 *     npx hardhat run scripts/launch-vanity.ts --network cotiTestnet
 */

const GAS = { launch: 30_000_000n };
const SUFFIX = "8888";

function table() {
  return JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../../config/veilpad.testnet.json"), "utf8"),
  );
}

const fmt = (v: bigint, d = 18) =>
  Number(ethers.formatUnits(v, d)).toLocaleString("en-US", { maximumFractionDigits: 6 });

function create2(deployer: string, salt: string, initCodeHash: string) {
  return ethers.getCreate2Address(deployer, salt, initCodeHash);
}

async function main() {
  const [signer] = await ethers.getSigners();
  const factoryAddress = table().contracts.veilpad.factory.address;
  const factory = await ethers.getContractAt("VeilPadFactory", factoryAddress);

  const name = process.env.VEIL_NAME || "Good Game";
  const symbol = process.env.VEIL_SYMBOL || "GG";
  const description = process.env.VEIL_DESC || "One confirm, mined address, dev buy, burn.";
  const devBuy = ethers.parseEther(process.env.VEIL_DEVBUY || "0.3");
  const allocation = (process.env.VEIL_ALLOC || "burn") as "keep" | "burn" | "lock";
  const burnPercent = Number(process.env.VEIL_BURN || 50);
  const lockDays = Number(process.env.VEIL_LOCK || 30);
  const isPrivate = process.env.VEIL_PUBLIC !== "1";

  const metadataURI = JSON.stringify({
    description,
    image: "",
    socials: { x: "", telegram: "", website: "" },
  });

  console.log("signer  :", signer.address);
  console.log("factory :", factoryAddress);
  console.log("balance :", fmt(await ethers.provider.getBalance(signer.address)), "COTI");
  console.log("");

  // ── 1. pick a curve salt, which fixes the curve address ─────────────────
  const curveSalt = ethers.hexlify(ethers.randomBytes(32));
  const curveAddress = await factory.predictCurve(signer.address, curveSalt);
  console.log("[1] curve salt chosen");
  console.log("    curve will be", curveAddress);

  // ── 2. mine a token salt so the address ends in 8888 ────────────────────
  const deployerAddress = await factory.deployerFor(isPrivate);
  const initCodeHash = await factory.tokenInitCodeHash(
    isPrivate,
    name,
    symbol,
    metadataURI,
    signer.address,
    curveAddress,
  );

  console.log("");
  console.log("[2] mining an address ending in " + SUFFIX);
  const began = Date.now();
  let attempts = 0;
  let seed = BigInt(ethers.hexlify(ethers.randomBytes(16)));
  let tokenSalt = "";
  let predicted = "";

  for (;;) {
    const salt = "0x" + seed.toString(16).padStart(64, "0");
    const addr = create2(deployerAddress, salt, initCodeHash);
    attempts += 1;
    seed += 1n;
    if (addr.toLowerCase().endsWith(SUFFIX)) {
      tokenSalt = salt;
      predicted = addr;
      break;
    }
    if (attempts > 3_000_000) throw new Error("no salt found");
  }

  console.log(
    "    found after " +
      attempts.toLocaleString("en-US") +
      " tries in " +
      (Date.now() - began) +
      "ms",
  );
  console.log("    token will be", predicted);

  // ── 3. one transaction ──────────────────────────────────────────────────
  const allocEnum = allocation === "keep" ? 0 : allocation === "burn" ? 1 : 2;
  const value = (await factory.launchFee()) + devBuy;

  console.log("");
  console.log("[3] launching");
  console.log("    dev buy   ", fmt(devBuy), "COTI");
  console.log(
    "    allocation",
    allocation === "burn"
      ? "burn " + burnPercent + "%"
      : allocation === "lock"
        ? "lock " + lockDays + " days"
        : "keep",
  );

  const tx = await (factory as any).launch(
    {
      name,
      symbol,
      metadataURI,
      privateBalances: isPrivate,
      agentId: ethers.ZeroHash,
      curveSalt,
      tokenSalt,
      devBuy,
      allocation: allocEnum,
      burnPercent,
      lockDays,
    },
    { value, gasLimit: GAS.launch },
  );

  const receipt = await tx.wait();
  console.log("    tx  ", tx.hash);
  console.log("    gas ", receipt.gasUsed.toString());

  let token = "";
  let curve = "";
  let bought = 0n;
  let burned = 0n;
  let lockedUntil = 0n;

  for (const log of receipt.logs) {
    try {
      const parsed = factory.interface.parseLog({ topics: [...log.topics], data: log.data });
      if (parsed?.name === "Launched") {
        token = parsed.args.token;
        curve = parsed.args.curve;
      }
      if (parsed?.name === "DevBuy") bought = parsed.args.tokensOut;
      if (parsed?.name === "AllocationBurned") burned = parsed.args.amount;
      if (parsed?.name === "AllocationLocked") lockedUntil = parsed.args.unlockAt;
    } catch {
      /* not ours */
    }
  }

  console.log("");
  console.log("[4] result");
  console.log("    token     ", token, token.toLowerCase().endsWith(SUFFIX) ? "<- ends in " + SUFFIX : "");
  console.log("    predicted ", predicted, predicted === token ? "(matches)" : "(MISMATCH)");
  console.log("    curve     ", curve);
  console.log("    dev bought", fmt(bought), symbol);
  if (burned > 0n) console.log("    burned    ", fmt(burned), symbol, "(" + burnPercent + "%)");
  if (lockedUntil > 0n)
    console.log("    locked to ", new Date(Number(lockedUntil) * 1000).toISOString());

  const c = await ethers.getContractAt("VeilCurve", curve);
  const erc = await ethers.getContractAt("VeilToken", token);
  console.log("");
  console.log("    supply cap", fmt(await factory.totalSupplyPerLaunch()), "(fixed)");
  console.log("    totalSupply", (await erc.totalSupply()).toString(), " <- 0: private by design");
  console.log("    reserve   ", fmt(await c.reserve()), "COTI");
  console.log("    progress  ", (Number(await c.progressBps()) / 100).toFixed(2) + "%");

  const outFile = path.resolve(__dirname, "../../data/vanity-launch.json");
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(
    outFile,
    JSON.stringify(
      {
        address: token,
        curve,
        name,
        symbol,
        decimals: 18,
        description,
        creator: signer.address,
        kind: isPrivate ? "private" : "public",
        txHash: tx.hash,
      },
      null,
      2,
    ) + "\n",
  );
  console.log("");
  console.log("app:", "http://localhost:3000/coti/" + token);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
