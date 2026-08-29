/* eslint-disable @typescript-eslint/no-explicit-any */
import { ethers, network } from "hardhat";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Verifies contracts on CotiScan.
 *
 * CotiScan runs Blockscout, which accepts a Solidity standard JSON input. That
 * input is exactly what Hardhat already wrote into artifacts/build-info, so
 * verification needs no separate flattening step and no chance of the submitted
 * source drifting from what was compiled.
 *
 *   npx hardhat run scripts/verify.ts --network cotiTestnet
 *   VEIL_VERIFY=0x...            verify one address
 *   VEIL_CONTRACT=VeilToken      name it when autodetection cannot
 */

const EXPLORER =
  process.env.VEIL_EXPLORER ||
  (network.name === "cotiMainnet" ? "https://mainnet.cotiscan.io" : "https://testnet.cotiscan.io");

const LICENSE = "mit";

interface BuildInfo {
  solcLongVersion: string;
  input: unknown;
  output: { contracts: Record<string, Record<string, unknown>> };
}

/** Finds the build-info that actually produced a given contract. */
function buildInfoFor(contractName: string): { info: BuildInfo; sourcePath: string } | null {
  const dir = path.resolve(__dirname, "../artifacts/build-info");
  if (!fs.existsSync(dir)) return null;

  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const info = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as BuildInfo;
    for (const [sourcePath, contracts] of Object.entries(info.output.contracts ?? {})) {
      if (contractName in contracts) return { info, sourcePath };
    }
  }
  return null;
}

async function alreadyVerified(address: string): Promise<boolean> {
  try {
    const res = await fetch(EXPLORER + "/api/v2/smart-contracts/" + address);
    if (!res.ok) return false;
    const j = (await res.json()) as { is_verified?: boolean };
    return !!j.is_verified;
  } catch {
    return false;
  }
}

async function verify(address: string, contractName: string): Promise<string> {
  if (await alreadyVerified(address)) return "already verified";

  const found = buildInfoFor(contractName);
  if (!found) return "no build-info for " + contractName + "; run hardhat compile";

  const { info, sourcePath } = found;

  const form = new FormData();
  form.append("compiler_version", "v" + info.solcLongVersion);
  form.append("license_type", LICENSE);
  form.append("contract_name", sourcePath + ":" + contractName);
  form.append("autodetect_constructor_args", "true");
  form.append(
    "files[0]",
    new Blob([JSON.stringify(info.input)], { type: "application/json" }),
    "standard-input.json",
  );

  const res = await fetch(
    EXPLORER + "/api/v2/smart-contracts/" + address + "/verification/via/standard-input",
    { method: "POST", body: form },
  );

  const text = await res.text();
  if (!res.ok) return "HTTP " + res.status + ": " + text.slice(0, 160);

  // Blockscout queues the job, so success here means accepted, not finished.
  return "submitted: " + text.slice(0, 120);
}

/** Waits for the queued job to land, so the script reports the real outcome. */
async function settle(address: string, tries = 12): Promise<boolean> {
  for (let i = 0; i < tries; i += 1) {
    await new Promise((r) => setTimeout(r, 5_000));
    if (await alreadyVerified(address)) return true;
  }
  return false;
}

async function main() {
  const file = path.resolve(__dirname, "../../config/veilpad." + (network.name === "cotiMainnet" ? "mainnet" : "testnet") + ".json");
  const table = JSON.parse(fs.readFileSync(file, "utf8"));
  const v = table.contracts.veilpad;

  console.log("explorer:", EXPLORER);
  console.log("");

  const single = process.env.VEIL_VERIFY;
  const targets: [string, string][] = single
    ? [[process.env.VEIL_CONTRACT || "VeilToken", single]]
    : [
        ["WCOTI", v.wcoti?.address],
        ["VeilSwapFactory", v.swapFactory?.address],
        ["VeilSwapRouter", v.swapRouter?.address],
        ["PrivateTokenDeployer", v.privateTokenDeployer?.address],
        ["PublicTokenDeployer", v.publicTokenDeployer?.address],
        ["VeilLocker", v.locker?.address],
        ["VeilPadFactory", v.factory?.address],
        ["ProfileRegistry", v.profileRegistry?.address],
        ["AgentRegistry", v.agentRegistry?.address],
        ["VeilPortal", v.portal?.address],
        ["PortalTokenDeployer", v.portalTokenDeployer?.address],
        ["VeilpadTokenDeployer", v.veilpadTokenDeployer?.address],
        ["VeilpadToken", v.veilpadToken?.address],
        ["VeilTreasury", v.veilTreasury?.address],
        ["VeilStaking", v.veilStaking?.address],
        // The NFT stack lives under its own key rather than contracts.veilpad,
        // because it was deployed separately and has its own official entry.
        ["VeilNFTFactory", table.nft?.factory],
        ["VeilNFTEditionsFactory", table.nft?.editionsFactory],
        ["VeilNFTMarket", table.nft?.market],
        ["VeilNFTStaking", table.nft?.staking],
        ["VeilNFTDrop", table.nft?.official?.genesis?.address],
      ].filter((t): t is [string, string] => !!t[1] && t[1] !== ethers.ZeroAddress);

  const submitted: string[] = [];

  for (const [name, address] of targets) {
    process.stdout.write("  " + name.padEnd(21) + address + "  ");
    const result = await verify(address, name);
    console.log(result);
    if (result.startsWith("submitted")) submitted.push(address);
  }

  if (submitted.length) {
    console.log("");
    console.log("waiting for " + submitted.length + " job(s) to settle...");
    for (const address of submitted) {
      const ok = await settle(address);
      console.log("  " + address + "  " + (ok ? "verified" : "still pending, check the explorer"));
    }
  }

  console.log("");
  console.log("Verified contracts are readable at " + EXPLORER + "/address/{address}?tab=contract");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
