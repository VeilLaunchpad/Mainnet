import { ethers, network } from "hardhat";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Deploys the privacy portal on its own, so the launchpad does not have to be
 * redeployed to gain it. Writes the addresses into .env.local and the master
 * table, same as the main deploy.
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
  console.log("  " + name.padEnd(21) + address + "  gas " + BigInt(estimate).toLocaleString("en-US"));
  return address;
}

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("network :", network.name);
  console.log("deployer:", deployer.address);
  console.log("balance :", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "COTI");
  console.log("");
  console.log("deploying:");

  const tokenDeployer = await deployContract("PortalTokenDeployer");
  const portal = await deployContract("DevoxPortal", [tokenDeployer]);

  const suffix = network.name === "cotiMainnet" ? "MAINNET" : "TESTNET";
  const netKey = network.name === "cotiMainnet" ? "mainnet" : "testnet";

  writeEnv({
    ["NEXT_PUBLIC_PORTAL_" + suffix]: portal,
  });

  writeMasterTable(netKey, { portal, portalTokenDeployer: tokenDeployer });

  console.log("");
  console.log("NEXT_PUBLIC_PORTAL_" + suffix + "=" + portal);
  console.log("Updated ../config/devoxpad." + netKey + ".json");
}

function writeMasterTable(netKey: string, addresses: Record<string, string>) {
  const file = path.resolve(__dirname, "../../config/devoxpad." + netKey + ".json");
  if (!fs.existsSync(file)) return;

  const table = JSON.parse(fs.readFileSync(file, "utf8"));
  const block = table?.contracts?.devoxpad;
  if (!block) return;

  const roles: Record<string, string> = {
    portal:
      "Privacy portal. Locks a public token and mints its private twin one to one; burns the twin to release the escrow.",
    portalTokenDeployer:
      "Holds DevoxPortalToken creation code so the portal stays under the 24KB limit. Renounces its own admin on every twin it makes.",
  };

  for (const [key, address] of Object.entries(addresses)) {
    block[key] = block[key] || {};
    block[key].address = address;
    block[key].status = "deployed";
    block[key].role = roles[key] ?? block[key].role;
    if (key === "portal")
      block[key].envKey =
        "NEXT_PUBLIC_PORTAL_" + (netKey === "mainnet" ? "MAINNET" : "TESTNET");
  }

  block.portalTwin = {
    address: "0x0000000000000000000000000000000000000000",
    status: "per-token",
    role: "Not a singleton. One private twin per wrapped token; read it from portal.twinOf(publicToken).",
    envKey: null,
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
