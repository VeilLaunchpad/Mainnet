import { ethers, network } from "hardhat";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Deploys the open-collection factory.
 *
 * Separate from `deploy-nft.ts` because the drop factory is already live with
 * the official collection inside it, and there is no reason to disturb a
 * working deployment to add a sibling.
 */

const LAUNCH_FEE = ethers.parseEther("0.05");

async function main() {
  const [deployer] = await ethers.getSigners();
  const isMainnet = network.name === "cotiMainnet";
  const suffix = isMainnet ? "MAINNET" : "TESTNET";

  console.log("network :", network.name);
  console.log("deployer:", deployer.address);
  console.log("balance :", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "COTI\n");

  const factory = await ethers.getContractFactory("DevoxNFTEditionsFactory");
  const args = [deployer.address, deployer.address, LAUNCH_FEE] as const;
  const tx = await factory.getDeployTransaction(...args);
  const estimate: string = await ethers.provider.send("eth_estimateGas", [
    { from: deployer.address, data: tx.data },
    "latest",
  ]);
  const c = await factory.deploy(...args, { gasLimit: (BigInt(estimate) * 125n) / 100n });
  await c.waitForDeployment();
  const addr = await c.getAddress();

  console.log("  DevoxNFTEditionsFactory  " + addr + "  gas " + BigInt(estimate).toLocaleString("en-US"));

  const key = "NEXT_PUBLIC_NFT_EDITIONS_FACTORY_" + suffix;
  writeEnv({ [key]: addr });
  writeMasterTable(isMainnet ? "mainnet" : "testnet", addr);
  console.log("\nWrote to ../.env.local:\n  " + key + "=" + addr);
}

function writeMasterTable(netKey: string, editionsFactory: string) {
  const file = path.resolve(__dirname, "../../config/devoxpad." + netKey + ".json");
  if (!fs.existsSync(file)) return;
  const table = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!table.nft) return;
  table.nft.editionsFactory = editionsFactory;
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
