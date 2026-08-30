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
 *   DEVOX_VERIFY=0x...            verify one address
 *   DEVOX_CONTRACT=DevoxToken      name it when autodetection cannot
 *   DEVOX_ARGS=0x...              ABI-encoded constructor args, when a factory
 *                                deployed it and autodetection cannot find them
 */

const EXPLORER =
  process.env.DEVOX_EXPLORER ||
  (network.name === "cotiMainnet" ? "https://mainnet.cotiscan.io" : "https://testnet.cotiscan.io");

const LICENSE = "mit";

interface BuildInfo {
  solcLongVersion: string;
  input: unknown;
  output: { contracts: Record<string, Record<string, unknown>> };
}

/**
 * Finds the build-info that actually produced the code at a given address.
 *
 * Taking the first build-info that merely mentions the contract name is wrong
 * as soon as a contract has been recompiled, and it fails in the worst way:
 * Blockscout accepts the submission, compares the old source against the new
 * bytecode, and the job simply never verifies - no error surfaces anywhere.
 * That is what happened to the redeployed marketplace, which had two
 * build-infos, one per version.
 *
 * So the deployed runtime code decides. `deployedBytecode` carries the metadata
 * hash at its tail, which differs between builds, and only the build that
 * produced this contract matches it. When nothing matches - a contract compiled
 * elsewhere, say - the newest is used and the caller is told it was a guess.
 */
function buildInfoFor(
  contractName: string,
  runtime?: string,
): { info: BuildInfo; sourcePath: string; matched: boolean } | null {
  const dir = path.resolve(__dirname, "../artifacts/build-info");
  if (!fs.existsSync(dir)) return null;

  const onChain = (runtime || "").replace(/^0x/, "").toLowerCase();
  const candidates: { info: BuildInfo; sourcePath: string; mtime: number; compiled: string }[] = [];

  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const full = path.join(dir, file);
    const info = JSON.parse(fs.readFileSync(full, "utf8")) as BuildInfo;
    for (const [sourcePath, contracts] of Object.entries(info.output.contracts ?? {})) {
      if (!(contractName in contracts)) continue;
      const c = contracts[contractName] as {
        evm?: { deployedBytecode?: { object?: string } };
      };
      candidates.push({
        info,
        sourcePath,
        mtime: fs.statSync(full).mtimeMs,
        compiled: (c.evm?.deployedBytecode?.object || "").replace(/^0x/, "").toLowerCase(),
      });
    }
  }
  if (!candidates.length) return null;

  if (onChain) {
    const hit = candidates.find((c) => c.compiled && c.compiled === onChain);
    if (hit) return { info: hit.info, sourcePath: hit.sourcePath, matched: true };
  }

  candidates.sort((a, b) => b.mtime - a.mtime);
  return { info: candidates[0].info, sourcePath: candidates[0].sourcePath, matched: false };
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

  // The code actually at the address, so the right build is chosen rather than
  // whichever one the directory listing happened to yield first.
  const runtime = await ethers.provider.getCode(address).catch(() => "");
  const found = buildInfoFor(contractName, runtime);
  if (!found) return "no build-info for " + contractName + "; run hardhat compile";

  const { info, sourcePath, matched } = found;
  if (!matched) {
    console.log("    ! no build matches the deployed code; using the newest, which may fail");
  }

  const form = new FormData();
  form.append("compiler_version", "v" + info.solcLongVersion);
  form.append("license_type", LICENSE);
  form.append("contract_name", sourcePath + ":" + contractName);
  // Blockscout can usually work the constructor arguments out from the tail of
  // the creation bytecode, but it fails on contracts deployed through a factory
  // with a struct argument - DevoxNFTDrop being exactly that. Passing them
  // explicitly is the fix, and DEVOX_ARGS carries the ABI-encoded bytes.
  const explicitArgs = process.env.DEVOX_ARGS?.replace(/^0x/, "");
  if (explicitArgs) {
    form.append("autodetect_constructor_args", "false");
    form.append("constructor_args", explicitArgs);
  } else {
    form.append("autodetect_constructor_args", "true");
  }
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
  const file = path.resolve(__dirname, "../../config/devoxpad." + (network.name === "cotiMainnet" ? "mainnet" : "testnet") + ".json");
  const table = JSON.parse(fs.readFileSync(file, "utf8"));
  const v = table.contracts.devoxpad;

  console.log("explorer:", EXPLORER);
  console.log("");

  const single = process.env.DEVOX_VERIFY;
  const targets: [string, string][] = single
    ? [[process.env.DEVOX_CONTRACT || "DevoxToken", single]]
    : [
        ["WCOTI", v.wcoti?.address],
        ["DevoxSwapFactory", v.swapFactory?.address],
        ["DevoxSwapRouter", v.swapRouter?.address],
        ["PrivateTokenDeployer", v.privateTokenDeployer?.address],
        ["PublicTokenDeployer", v.publicTokenDeployer?.address],
        ["DevoxLocker", v.locker?.address],
        ["DevoxPadFactory", v.factory?.address],
        ["ProfileRegistry", v.profileRegistry?.address],
        ["AgentRegistry", v.agentRegistry?.address],
        ["DevoxPortal", v.portal?.address],
        ["PortalTokenDeployer", v.portalTokenDeployer?.address],
        ["DevoxpadTokenDeployer", v.devoxpadTokenDeployer?.address],
        ["DevoxpadToken", v.devoxpadToken?.address],
        ["DevoxTreasury", v.devoxTreasury?.address],
        ["DevoxStaking", v.devoxStaking?.address],
        // The NFT stack lives under its own key rather than contracts.devoxpad,
        // because it was deployed separately and has its own official entry.
        ["DevoxNFTFactory", table.nft?.factory],
        ["DevoxNFTEditionsFactory", table.nft?.editionsFactory],
        ["DevoxNFTMarket", table.nft?.market],
        ["DevoxNFTStaking", table.nft?.staking],
        ["DevoxNFTDrop", table.nft?.official?.genesis?.address],
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
