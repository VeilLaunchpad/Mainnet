import { ethers, network } from "hardhat";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Deploys the VEILPAD stack and writes the resulting addresses straight back
 * into ../.env.local, so the app picks them up on the next boot with no
 * copy-paste step.
 */
/**
 * COTI's RPC rejects the `pending` block tag on eth_estimateGas, which is what
 * hardhat-ethers reaches for by default - every deploy dies with "pending
 * block is not available" before a byte is sent.
 *
 * So we estimate against `latest` over the raw provider and pass an explicit
 * gasLimit, which makes ethers skip its own estimation entirely.
 */
async function deployContract(name: string, args: unknown[] = []) {
  const factory = await ethers.getContractFactory(name);
  const [signer] = await ethers.getSigners();

  const tx = await factory.getDeployTransaction(...(args as never[]));
  const estimate: string = await ethers.provider.send("eth_estimateGas", [
    { from: signer.address, data: tx.data },
    "latest",
  ]);

  // 25% headroom, still far under the 120M block limit.
  const gasLimit = (BigInt(estimate) * 125n) / 100n;

  const contract = await factory.deploy(...(args as never[]), { gasLimit });
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log(
    "  " + name.padEnd(21) + address + "  gas " + BigInt(estimate).toLocaleString("en-US"),
  );
  return address;
}

async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("No signer. Set DEPLOYER_PRIVATE_KEY in ../.env.local");

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("network :", network.name);
  console.log("deployer:", deployer.address);
  console.log("balance :", ethers.formatEther(balance), "COTI\n");

  if (balance === 0n) {
    throw new Error("Deployer has no COTI. Fund it from the COTI faucet first.");
  }

  const out: Record<string, string> = {};
  console.log("deploying:");

  out.WCOTI = await deployContract("WCOTI");
  out.SWAP_FACTORY = await deployContract("VeilSwapFactory");
  out.SWAP_ROUTER = await deployContract("VeilSwapRouter", [out.SWAP_FACTORY, out.WCOTI]);

  const privDepAddr = await deployContract("PrivateTokenDeployer");
  const pubDepAddr = await deployContract("PublicTokenDeployer");
  out.LOCKER = await deployContract("VeilLocker");
  out.VEIL_FACTORY = await deployContract("VeilPadFactory", [
    deployer.address,
    privDepAddr,
    pubDepAddr,
    out.LOCKER,
  ]);
  out.PROFILE_REGISTRY = await deployContract("ProfileRegistry");
  out.AGENT_REGISTRY = await deployContract("AgentRegistry");

  // Testnet economics. A 100 COTI graduation is right for mainnet and absurd
  // when the faucet hands out ten, so tune the curve to something a tester can
  // actually push over the line and watch graduate.
  if (network.name !== "cotiMainnet") {
    const factory = await ethers.getContractAt("VeilPadFactory", out.VEIL_FACTORY);
    const tune = await factory.setParams(
      ethers.parseEther("2"),          // virtualCoti
      ethers.parseUnits("800000000", 18), // curveSupply
      ethers.parseUnits("200000000", 18), // poolSupply
      ethers.parseEther("2"),          // graduationTarget
      3000,                            // feeTier, informational on VeilSwap
      { gasLimit: 300_000 },
    );
    await tune.wait();
    console.log("  tuned for testnet: virtualCoti 2 COTI, graduationTarget 2 COTI");
  }

  const suffix = network.name === "cotiMainnet" ? "MAINNET" : "TESTNET";
  const netKey = network.name === "cotiMainnet" ? "mainnet" : "testnet";
  const mapping: Record<string, string> = {
    ["NEXT_PUBLIC_VEIL_FACTORY_" + suffix]: out.VEIL_FACTORY,
    ["NEXT_PUBLIC_PROFILE_REGISTRY_" + suffix]: out.PROFILE_REGISTRY,
    ["NEXT_PUBLIC_AGENT_REGISTRY_" + suffix]: out.AGENT_REGISTRY,
    ["NEXT_PUBLIC_WCOTI_" + suffix]: out.WCOTI,
    ["NEXT_PUBLIC_SWAP_FACTORY_" + suffix]: out.SWAP_FACTORY,
    ["NEXT_PUBLIC_SWAP_ROUTER_" + suffix]: out.SWAP_ROUTER,
    ["NEXT_PUBLIC_LOCKER_" + suffix]: out.LOCKER,
  };

  writeEnv(mapping);

  // The master table is the registry of record - keep it in step with the env
  // so /api/config and the agents see the same addresses the app does.
  writeMasterTable(
    netKey,
    {
      wcoti: out.WCOTI,
      swapFactory: out.SWAP_FACTORY,
      swapRouter: out.SWAP_ROUTER,
      locker: out.LOCKER,
      privateTokenDeployer: privDepAddr,
      publicTokenDeployer: pubDepAddr,
      factory: out.VEIL_FACTORY,
      profileRegistry: out.PROFILE_REGISTRY,
      agentRegistry: out.AGENT_REGISTRY,
    },
    deployer.address,
  );

  console.log("\nWrote to ../.env.local:");
  for (const [k, v] of Object.entries(mapping)) console.log("  " + k + "=" + v);
  console.log("Updated ../config/veilpad." + netKey + ".json");
  console.log(
    "\nVeilSwap is the DEX graduated launches land in. COTI has no Uniswap" +
      "\ndeployment, and a stock V2 pair could not work here anyway: it derives" +
      "\nreserves from balanceOf, which on a PrivateERC20 is ciphertext.",
  );
}

/**
 * Rewrites only the veilpad contract block and the deployer status. Curve
 * tuning, routes and the agent catalog are left exactly as they were - this
 * script deploys contracts, it does not own the rest of the table.
 */
function writeMasterTable(
  netKey: string,
  addresses: Record<string, string>,
  deployerAddress: string,
) {
  const file = path.resolve(__dirname, "../../config/veilpad." + netKey + ".json");
  if (!fs.existsSync(file)) {
    console.warn("master table not found at " + file + " - skipping");
    return;
  }

  const table = JSON.parse(fs.readFileSync(file, "utf8"));
  const block = table?.contracts?.veilpad;
  if (!block) {
    console.warn("master table has no contracts.veilpad block - skipping");
    return;
  }

  for (const [key, address] of Object.entries(addresses)) {
    if (!block[key]) block[key] = {};
    block[key].address = address;
    block[key].status = "deployed";
  }

  block.veilCurve = block.veilCurve || {};
  block.veilCurve.status = "per-token";

  if (table.deployer) {
    table.deployer.address = deployerAddress;
    table.deployer.funded = true;
  }
  if (table.contracts.uniswapV3) {
    table.contracts.uniswapV3.wcotiForPools = addresses.wcoti;
  }
  table.deployedAt = new Date().toISOString();
  table.deployedChainId = Number(network.config.chainId);

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
