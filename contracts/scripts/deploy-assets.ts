/* eslint-disable @typescript-eslint/no-explicit-any */
import { ethers, network } from "hardhat";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Deploys stand-ins for the seven assets the COTI privacy portal carries on
 * mainnet, then portals each of them once so every private twin exists.
 *
 * Nothing here has value. The point is that the portal on testnet offers the
 * same set a user would meet on mainnet, with the right decimals, rather than
 * two tokens and a note apologising for the rest.
 */

const GAS = { faucet: 400_000n, approve: 400_000n, wrap: 14_000_000n };

/** The mainnet set, with the decimals each asset actually uses. */
const ASSETS: { name: string; symbol: string; decimals: number; represents: string }[] = [
  { name: "Wrapped Ether", symbol: "wETH", decimals: 18, represents: "Ether bridged to COTI" },
  { name: "Wrapped BTC", symbol: "wBTC", decimals: 8, represents: "Bitcoin bridged to COTI" },
  { name: "Tether USD", symbol: "USDT", decimals: 6, represents: "Tether on COTI" },
  { name: "Bridged USDC", symbol: "USDC.e", decimals: 6, represents: "Bridged USD Coin on COTI" },
  { name: "Wrapped ADA", symbol: "wADA", decimals: 6, represents: "Cardano bridged to COTI" },
  { name: "Governance COTI", symbol: "gCOTI", decimals: 18, represents: "COTI governance token" },
];

function tablePath() {
  return path.resolve(
    __dirname,
    "../../config/devoxpad." + (network.name === "cotiMainnet" ? "mainnet" : "testnet") + ".json",
  );
}

async function deployContract(name: string, args: unknown[] = []) {
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
  return contract.getAddress();
}

async function main() {
  const [signer] = await ethers.getSigners();
  const table = JSON.parse(fs.readFileSync(tablePath(), "utf8"));
  const portalAddress = table.contracts.devoxpad.portal.address;
  const portal = await ethers.getContractAt("DevoxPortal", portalAddress);

  console.log("signer :", signer.address);
  console.log("portal :", portalAddress);
  console.log("balance:", ethers.formatEther(await ethers.provider.getBalance(signer.address)), "COTI");
  console.log("");
  console.log("deploying stand-ins for the mainnet portal set:");

  const deployed: Record<string, { address: string; decimals: number; name: string }> = {};

  for (const a of ASSETS) {
    const address = await deployContract("DevoxTestToken", [
      a.name,
      a.symbol,
      a.decimals,
      a.represents,
    ]);
    deployed[a.symbol] = { address, decimals: a.decimals, name: a.name };
    console.log("  " + a.symbol.padEnd(8) + address + "  " + a.decimals + " decimals");
  }

  // ── open a twin for each, so the private side is populated ──────────────
  console.log("");
  console.log("portalling a token of each so its private twin exists:");

  for (const a of ASSETS) {
    const info = deployed[a.symbol];
    const token = await ethers.getContractAt("DevoxTestToken", info.address);

    const mint = await token.faucet({ gasLimit: GAS.faucet });
    await mint.wait();

    const amount = ethers.parseUnits("100", a.decimals);
    const approve = await token.approve(portalAddress, amount, { gasLimit: GAS.approve });
    await approve.wait();

    const wrap = await (portal as any).wrap(info.address, amount, { gasLimit: GAS.wrap });
    await wrap.wait();

    const twin = await portal.twinOf(info.address);
    console.log("  " + a.symbol.padEnd(8) + "-> p" + a.symbol.padEnd(7) + twin);
  }

  // Native COTI already has a twin from the earlier test, but make sure.
  const nativeTwin = await portal.twinOf(ethers.ZeroAddress);
  if (nativeTwin === ethers.ZeroAddress) {
    const tx = await (portal as any).wrapNative({
      value: ethers.parseEther("0.05"),
      gasLimit: GAS.wrap,
    });
    await tx.wait();
    console.log("  COTI    -> pCOTI   " + (await portal.twinOf(ethers.ZeroAddress)));
  }

  table.assets = {
    _comment:
      "Stand-ins for the assets the COTI privacy portal carries on mainnet. Deployed by contracts/scripts/deploy-assets.ts. They have no value; decimals match the real assets so the portal behaves the way it will on mainnet.",
    testnet: true,
    faucet: "Every stand-in has an open faucet(). 1000 units per call.",
    tokens: ASSETS.map((a) => ({
      symbol: a.symbol,
      name: a.name,
      decimals: a.decimals,
      address: deployed[a.symbol].address,
      represents: a.represents,
    })),
  };

  fs.writeFileSync(tablePath(), JSON.stringify(table, null, 2) + "\n");

  console.log("");
  console.log("twins on the portal:", (await portal.twinCount()).toString());
  console.log("wrote the asset list into the master table");
  console.log("balance:", ethers.formatEther(await ethers.provider.getBalance(signer.address)), "COTI");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
