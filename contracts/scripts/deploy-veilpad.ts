import { ethers, network } from "hardhat";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Deploys the VEILPAD protocol token, its treasury and staking.
 *
 * The token address is mined before it exists, the same way every launch on
 * this platform is: CREATE2 turns the address into a function of the salt, so a
 * salt is searched locally until the result ends in 8888. The chain only checks
 * the outcome. Nothing about the token is special-cased to skip that - the
 * protocol token carrying the same mark as the tokens it launches is the point.
 *
 * Order matters. The token has to exist before a treasury can name it as its
 * reward asset, the treasury before staking can be pointed at it, and staking
 * has to be approved as a spender before it can pay anybody.
 */

const SUFFIX = "8888";

const NAME = "VEILPAD";
const SYMBOL = "VEIL";
const SUPPLY = ethers.parseUnits("1000000000", 18); // one billion, fixed forever

/** A fifth of supply is set aside to pay staking, and nothing can mint more. */
const TREASURY_ALLOCATION = ethers.parseUnits("200000000", 18);

/**
 * Pools, and the liability each one creates.
 *
 * A fixed APY on an unbounded deposit is an unbounded promise, so every pool is
 * capped and the cap is what makes the promise keepable. At these numbers the
 * treasury owes at most about 4.04M VEIL a year against a 200M reserve, which
 * is roughly fifty years of runway before anyone has to top it up.
 */
interface PoolPlan {
  key: string;
  token: string | null; // null means native COTI
  apyBps: number;
  cap: bigint;
  minStake: bigint;
  maxPerUser: bigint;
  privateToken: boolean;
  blurb: string;
}

const GCOTI_MAINNET = "0x7637C7838EC4Ec6b85080F28A678F8E234bB83D1";

function plans(veil: string, isMainnet: boolean): PoolPlan[] {
  const gcoti = isMainnet ? GCOTI_MAINNET : process.env.NEXT_PUBLIC_GCOTI_TESTNET || "";
  const list: PoolPlan[] = [
    {
      key: "COTI",
      token: null,
      apyBps: 1000,
      cap: ethers.parseUnits("2000000", 18),
      minStake: ethers.parseUnits("0.1", 18),
      maxPerUser: ethers.parseUnits("200000", 18), // a tenth of the pool
      privateToken: false,
      blurb: "Stake the gas token itself.",
    },
    {
      key: "VEIL",
      token: veil,
      apyBps: 1800,
      cap: ethers.parseUnits("20000000", 18),
      minStake: ethers.parseUnits("1", 18),
      maxPerUser: ethers.parseUnits("2000000", 18), // a tenth of the pool
      privateToken: false,
      blurb: "Stake VEILPAD, earn VEILPAD.",
    },
  ];

  if (isMainnet) {
    // p.COTI, the private twin of COTI from COTI's own privacy bridge. Its
    // balances are ciphertext, which the pool has to be told about: measuring
    // this contract's balance across the transfer would read two encrypted
    // handles and credit the depositor nothing.
    list.splice(1, 0, {
      key: "p.COTI",
      token: "0xD2F2692B83C3ecDF2EAa0f7c2632BBd46Ae1cC91",
      apyBps: 1400,
      cap: ethers.parseUnits("2000000", 18),
      minStake: ethers.parseUnits("0.1", 18),
      maxPerUser: ethers.parseUnits("200000", 18),
      privateToken: true,
    });
  }

  if (gcoti && gcoti.startsWith("0x")) {
    list.splice(1, 0, {
      key: "gCOTI",
      token: gcoti,
      apyBps: 1200,
      cap: ethers.parseUnits("2000000", 18),
      minStake: ethers.parseUnits("0.1", 18),
      maxPerUser: ethers.parseUnits("200000", 18),
      privateToken: false,
      blurb: "Governance COTI, staked.",
    });
  }
  return list;
}

/**
 * COTI's RPC rejects the `pending` block tag on eth_estimateGas, which is what
 * hardhat-ethers reaches for by default. Estimating against `latest` and passing
 * an explicit gasLimit makes ethers skip its own estimation entirely.
 */
async function deployContract(name: string, args: unknown[] = []) {
  const factory = await ethers.getContractFactory(name);
  const [signer] = await ethers.getSigners();

  const tx = await factory.getDeployTransaction(...(args as never[]));
  const estimate: string = await ethers.provider.send("eth_estimateGas", [
    { from: signer.address, data: tx.data },
    "latest",
  ]);
  const gasLimit = (BigInt(estimate) * 125n) / 100n;

  const contract = await factory.deploy(...(args as never[]), { gasLimit });
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log("  " + name.padEnd(22) + address + "  gas " + BigInt(estimate).toLocaleString("en-US"));
  return { address, contract };
}

async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("No signer. Set DEPLOYER_PRIVATE_KEY in ../.env.local");

  const isMainnet = network.name === "cotiMainnet";
  const suffix = isMainnet ? "MAINNET" : "TESTNET";
  const netKey = isMainnet ? "mainnet" : "testnet";

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("network :", network.name);
  console.log("deployer:", deployer.address);
  console.log("balance :", ethers.formatEther(balance), "COTI\n");
  if (balance === 0n) throw new Error("Deployer has no COTI.");

  const metadataURI =
    process.env.VEIL_METADATA_URI || "https://veilpad-app.vercel.app/veil.json";

  console.log("deploying:");
  const { address: deployerAddress, contract: tokenDeployer } =
    await deployContract("VeilpadTokenDeployer");

  // ── mine the 8888 address ────────────────────────────────────────────────
  const initCodeHash = await (tokenDeployer as never as {
    initCodeHash: (
      n: string, s: string, m: string, r: string, sup: bigint,
    ) => Promise<string>;
  }).initCodeHash(NAME, SYMBOL, metadataURI, deployer.address, SUPPLY);

  console.log("\nmining an address ending in " + SUFFIX);
  const began = Date.now();
  let attempts = 0;
  let seed = BigInt(ethers.hexlify(ethers.randomBytes(16)));
  let salt = "";
  let predicted = "";

  for (;;) {
    const candidate = "0x" + seed.toString(16).padStart(64, "0");
    const addr = ethers.getCreate2Address(deployerAddress, candidate, initCodeHash);
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
  console.log("  VEILPAD will be " + predicted);

  const deployTx = await (tokenDeployer as never as {
    deploy: (
      s: string, n: string, sym: string, m: string, r: string, sup: bigint,
      o: { gasLimit: bigint },
    ) => Promise<{ wait: () => Promise<unknown> }>;
  }).deploy(salt, NAME, SYMBOL, metadataURI, deployer.address, SUPPLY, {
    gasLimit: 4_000_000n,
  });
  await deployTx.wait();

  const code = await ethers.provider.getCode(predicted);
  if (code === "0x") throw new Error("token did not land at the predicted address");
  if (!predicted.toLowerCase().endsWith(SUFFIX)) throw new Error("address does not end in " + SUFFIX);
  console.log("  VeilpadToken          " + predicted + "  (mined, verified on chain)");

  const veil = await ethers.getContractAt("VeilpadToken", predicted);

  // ── treasury and staking ─────────────────────────────────────────────────
  console.log("");
  const { address: treasuryAddress } = await deployContract("VeilTreasury", [
    predicted,
    deployer.address,
  ]);
  const { address: stakingAddress } = await deployContract("VeilStaking", [
    predicted,
    treasuryAddress,
    deployer.address,
  ]);

  const treasury = await ethers.getContractAt("VeilTreasury", treasuryAddress);
  const staking = await ethers.getContractAt("VeilStaking", stakingAddress);

  console.log("\nwiring:");
  // The grant is a budget, not a blank cheque: staking may pay out at most the
  // allocation the treasury actually holds.
  await (
    await treasury.setSpender(stakingAddress, true, TREASURY_ALLOCATION, { gasLimit: 200_000 })
  ).wait();
  console.log("  staking approved as the only treasury spender");

  await (await veil.approve(treasuryAddress, TREASURY_ALLOCATION, { gasLimit: 200_000 })).wait();
  await (await treasury.fund(TREASURY_ALLOCATION, { gasLimit: 300_000 })).wait();
  console.log("  treasury funded with " + ethers.formatUnits(TREASURY_ALLOCATION, 18) + " VEIL");

  console.log("\npools:");
  const pools = plans(predicted, isMainnet);
  const created: { pid: number; key: string; token: string; apyBps: number; cap: string }[] = [];

  for (const p of pools) {
    const token = p.token ?? ethers.ZeroAddress;
    const tx = await staking.addPool(token, p.apyBps, p.cap, p.minStake, p.maxPerUser, p.privateToken, {
      gasLimit: 500_000,
    });
    await tx.wait();
    const pid = Number(await staking.poolCount()) - 1;
    created.push({
      pid,
      key: p.key,
      token,
      apyBps: p.apyBps,
      cap: ethers.formatUnits(p.cap, 18),
    });
    console.log(
      "  [" + pid + "] " + p.key.padEnd(6) + (p.apyBps / 100).toFixed(1) + "% APY   cap " +
        Number(ethers.formatUnits(p.cap, 18)).toLocaleString("en-US"),
    );
  }

  // ── the private twin ─────────────────────────────────────────────────────
  const portal = process.env["NEXT_PUBLIC_PORTAL_" + suffix] || "";
  let twin = "";
  if (portal.startsWith("0x")) {
    console.log("\nprivate twin:");
    const seedAmount = ethers.parseUnits("1000", 18);
    const p = await ethers.getContractAt("VeilPortal", portal);
    await (await veil.approve(portal, seedAmount, { gasLimit: 200_000 })).wait();
    await (await p.wrap(predicted, seedAmount, { gasLimit: 12_000_000 })).wait();
    twin = await p.twinOf(predicted);
    console.log("  p.VEILPAD             " + twin);
    console.log("  backed by " + ethers.formatUnits(await p.locked(predicted), 18) + " VEIL in escrow");
  } else {
    console.log("\nprivate twin: skipped, no portal address for " + netKey);
  }

  // ── record it ────────────────────────────────────────────────────────────
  const mapping: Record<string, string> = {
    ["NEXT_PUBLIC_VEIL_TOKEN_" + suffix]: predicted,
    ["NEXT_PUBLIC_VEIL_TREASURY_" + suffix]: treasuryAddress,
    ["NEXT_PUBLIC_VEIL_STAKING_" + suffix]: stakingAddress,
    ["NEXT_PUBLIC_VEIL_TOKEN_DEPLOYER_" + suffix]: deployerAddress,
  };
  if (twin) mapping["NEXT_PUBLIC_VEIL_TOKEN_TWIN_" + suffix] = twin;

  writeEnv(mapping);
  writeMasterTable(netKey, {
    veilpadToken: predicted,
    veilpadTokenDeployer: deployerAddress,
    veilTreasury: treasuryAddress,
    veilStaking: stakingAddress,
    ...(twin ? { veilpadTokenTwin: twin } : {}),
  }, created, twin);

  console.log("\nWrote to ../.env.local:");
  for (const [k, v] of Object.entries(mapping)) console.log("  " + k + "=" + v);
  console.log("Updated ../config/veilpad." + netKey + ".json");
  console.log(
    "\nSupply is fixed at " + ethers.formatUnits(SUPPLY, 18) +
      " VEIL. There is no mint function, so nothing can raise it.",
  );
}

function writeMasterTable(
  netKey: string,
  addresses: Record<string, string>,
  pools: { pid: number; key: string; token: string; apyBps: number; cap: string }[],
  twin: string,
) {
  const file = path.resolve(__dirname, "../../config/veilpad." + netKey + ".json");
  if (!fs.existsSync(file)) {
    console.warn("master table not found at " + file + " - skipping");
    return;
  }

  const table = JSON.parse(fs.readFileSync(file, "utf8"));
  const block = table?.contracts?.veilpad;
  if (!block) return;

  const roles: Record<string, string> = {
    veilpadToken:
      "The protocol token. One billion, minted once in the constructor, with no mint function afterwards.",
    veilpadTokenDeployer:
      "CREATE2 deployer that gave the protocol token its 8888 address. Holds no role over what it made.",
    veilTreasury:
      "Reward reserve for staking. Only the staking contract may spend it, and no staked principal is ever held here.",
    veilStaking:
      "Fixed-APY staking. Rewards are paid in VEILPAD from the treasury; principal never pays another user's reward.",
    veilpadTokenTwin:
      "p.VEILPAD, the private twin. Minted one to one against VEILPAD locked in VeilPortal.",
  };

  const suffix = netKey === "mainnet" ? "MAINNET" : "TESTNET";
  const envKeys: Record<string, string> = {
    veilpadToken: "NEXT_PUBLIC_VEIL_TOKEN_" + suffix,
    veilpadTokenDeployer: "NEXT_PUBLIC_VEIL_TOKEN_DEPLOYER_" + suffix,
    veilTreasury: "NEXT_PUBLIC_VEIL_TREASURY_" + suffix,
    veilStaking: "NEXT_PUBLIC_VEIL_STAKING_" + suffix,
    veilpadTokenTwin: "NEXT_PUBLIC_VEIL_TOKEN_TWIN_" + suffix,
  };

  for (const [key, address] of Object.entries(addresses)) {
    block[key] = block[key] || {};
    block[key].address = address;
    block[key].status = "deployed";
    block[key].role = roles[key] ?? block[key].role;
    block[key].envKey = envKeys[key] ?? null;
  }

  table.staking = {
    _comment:
      "Fixed APY per pool, paid in VEILPAD from VeilTreasury. Every pool is capped, and the caps are what bound what the treasury can owe.",
    rewardToken: addresses.veilpadToken,
    treasury: addresses.veilTreasury,
    staking: addresses.veilStaking,
    pools: pools.map((p) => ({
      pid: p.pid,
      asset: p.key,
      token: p.token === "0x0000000000000000000000000000000000000000" ? null : p.token,
      native: p.token === "0x0000000000000000000000000000000000000000",
      apyPercent: p.apyBps / 100,
      capTokens: p.cap,
    })),
  };

  table.token = {
    _comment: "The protocol token, not a launch. Fixed supply and no minter.",
    address: addresses.veilpadToken,
    symbol: "VEIL",
    name: "VEILPAD",
    decimals: 18,
    totalSupply: "1000000000",
    mintable: false,
    vanitySuffix: "8888",
    privateTwin: twin || null,
    treasuryAllocation: "200000000",
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
