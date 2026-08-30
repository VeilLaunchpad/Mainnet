import { ethers, network } from "hardhat";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Redeploys the contracts that still carry the old brand on the explorer.
 *
 * The rebrand renamed every source file, but a contract already on chain keeps
 * whatever name it was verified under. Five of them were never redeployed, so
 * CotiScan still lists VeilPadFactory, VeilSwapFactory, VeilSwapRouter,
 * VeilLocker and VeilPortal - the on-chain behaviour is right and the label is
 * wrong, which is exactly the thing a rebrand cannot leave behind.
 *
 * Deliberately NOT redeployed:
 *
 *   WCOTI, ProfileRegistry, AgentRegistry, PrivateMessaging
 *     Their names never carried the brand, so they already read correctly.
 *     Redeploying ProfileRegistry would also throw away every handle anyone has
 *     claimed on chain, for no gain.
 *
 * The swap pair is the consequence to plan for: a new factory means a new pair
 * address, so the DEVOX market has to be re-seeded afterwards and the old pair
 * drained first. This script only deploys; seeding is seed-devox-pair.ts.
 *
 *   npx hardhat run scripts/redeploy-branded.ts --network cotiMainnet
 */

async function deployContract(name: string, args: unknown[] = []) {
  const factory = await ethers.getContractFactory(name);
  const [signer] = await ethers.getSigners();
  const tx = await factory.getDeployTransaction(...(args as never[]));
  const estimate: string = await ethers.provider.send("eth_estimateGas", [
    { from: signer.address, data: tx.data },
    "latest",
  ]);
  const c = await factory.deploy(...(args as never[]), {
    gasLimit: (BigInt(estimate) * 125n) / 100n,
  });
  await c.waitForDeployment();
  const address = await c.getAddress();
  console.log("  " + name.padEnd(24) + address + "  gas " + BigInt(estimate).toLocaleString("en-US"));
  return address;
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const isMainnet = network.name === "cotiMainnet";
  const suffix = isMainnet ? "MAINNET" : "TESTNET";

  const wcoti = process.env["NEXT_PUBLIC_WCOTI_" + suffix] || "";
  if (!wcoti) throw new Error("WCOTI address missing for " + network.name);

  console.log("network :", network.name);
  console.log("deployer:", deployer.address);
  console.log("balance :", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "COTI");
  console.log("reusing WCOTI:", wcoti, "\n");

  console.log("deploying:");
  const swapFactory = await deployContract("DevoxSwapFactory");
  const swapRouter = await deployContract("DevoxSwapRouter", [swapFactory, wcoti]);
  const locker = await deployContract("DevoxLocker");

  // The launchpad factory needs both token deployers; they hold creation code
  // so the factory itself stays under the 24KB limit.
  const privDep = await deployContract("PrivateTokenDeployer");
  const pubDep = await deployContract("PublicTokenDeployer");
  const padFactory = await deployContract("DevoxPadFactory", [
    deployer.address,
    privDep,
    pubDep,
    locker,
  ]);

  const portalTokenDeployer = await deployContract("PortalTokenDeployer");
  const portal = await deployContract("DevoxPortal", [portalTokenDeployer]);

  const mapping: Record<string, string> = {
    ["NEXT_PUBLIC_SWAP_FACTORY_" + suffix]: swapFactory,
    ["NEXT_PUBLIC_SWAP_ROUTER_" + suffix]: swapRouter,
    ["NEXT_PUBLIC_LOCKER_" + suffix]: locker,
    ["NEXT_PUBLIC_DEVOX_FACTORY_" + suffix]: padFactory,
    ["NEXT_PUBLIC_PORTAL_" + suffix]: portal,
    ["NEXT_PUBLIC_PRIVATE_TOKEN_DEPLOYER_" + suffix]: privDep,
    ["NEXT_PUBLIC_PUBLIC_TOKEN_DEPLOYER_" + suffix]: pubDep,
    ["NEXT_PUBLIC_PORTAL_TOKEN_DEPLOYER_" + suffix]: portalTokenDeployer,
  };
  writeEnv(mapping);

  console.log("\nWrote to ../.env.local:");
  for (const [k, v] of Object.entries(mapping)) console.log("  " + k + "=" + v);
  console.log("\nNext: re-seed the DEVOX pair on the new factory, then verify.");
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

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
