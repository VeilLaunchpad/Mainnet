/* eslint-disable @typescript-eslint/no-explicit-any */
import { ethers, network } from "hardhat";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * End-to-end proof against a live chain: read the factory, launch a token, buy
 * on its curve, sell part of it back, and read the state at each step.
 *
 * Everything uses explicit gas limits - COTI's RPC rejects the `pending` block
 * tag that ethers reaches for during estimation, and MPC operations on a
 * PrivateERC20 cost far more than a plain SSTORE.
 *
 * Set DEVOX_TOKEN and DEVOX_CURVE to continue against an existing launch instead
 * of minting another one.
 */

const GAS = {
  launch: 9_000_000n,
  buy: 12_000_000n,
  approve: 6_000_000n,
  sell: 14_000_000n,
};

// Overridable so the same script can mint a distinct token each run instead of
// colliding with an earlier one.
const NAME = process.env.DEVOX_NAME || "Night Shift";
const SYMBOL = process.env.DEVOX_SYMBOL || "NIGHT";
const DESCRIPTION =
  process.env.DEVOX_DESC || "For the people who ship at 3am. Smoke-test launch.";

function masterTable() {
  return JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../../config/devoxpad.testnet.json"), "utf8"),
  );
}

async function main() {
  const [signer] = await ethers.getSigners();
  const factoryAddress = masterTable().contracts.devoxpad.factory.address;

  console.log("network :", network.name);
  console.log("signer  :", signer.address);
  console.log(
    "balance :",
    ethers.formatEther(await ethers.provider.getBalance(signer.address)),
    "COTI",
  );
  console.log("factory :", factoryAddress);
  console.log("");

  const factory = await ethers.getContractAt("DevoxPadFactory", factoryAddress);
  const launchFee = await factory.launchFee();

  console.log("factory params");
  console.log("  launchFee        ", ethers.formatEther(launchFee), "COTI");
  console.log("  virtualCoti      ", ethers.formatEther(await factory.virtualCoti()), "COTI");
  console.log("  curveSupply      ", ethers.formatUnits(await factory.curveSupply(), 18));
  console.log("  poolSupply       ", ethers.formatUnits(await factory.poolSupply(), 18));
  console.log("  graduationTarget ", ethers.formatEther(await factory.graduationTarget()), "COTI");
  console.log("  feeTier          ", (await factory.feeTier()).toString());
  console.log("  tokenCount       ", (await factory.tokenCount()).toString());
  console.log("");

  const { token, curve, launchTxHash } = await launchOrResume(factory, launchFee);

  const c = await ethers.getContractAt("DevoxCurve", curve);
  const erc = await ethers.getContractAt("DevoxToken", token);

  console.log("token metadata, read back from chain");
  console.log("  name         ", await erc.name());
  console.log("  symbol       ", await erc.symbol());
  console.log("  decimals     ", (await erc.decimals()).toString());
  console.log("  totalSupply  ", (await erc.totalSupply()).toString(), " <- 0 by design: private");
  console.log("  metadataURI  ", (await erc.metadataURI()).slice(0, 58) + "...");
  console.log("  curve is minter    ", await erc.hasRole(await erc.MINTER_ROLE(), curve));
  console.log(
    "  factory still admin",
    await erc.hasRole(ethers.ZeroHash, factoryAddress),
    " <- false: it renounced",
  );
  console.log("");

  // ── buy ───────────────────────────────────────────────────────────────
  const spend = ethers.parseEther("1");
  const quoted = await c.quoteBuy(spend);
  console.log("buying with 1 COTI");
  console.log("  quoteBuy     ", ethers.formatUnits(quoted, 18), SYMBOL);

  const buyTx = await c.buy(0n, { value: spend, gasLimit: GAS.buy });
  const buyReceipt = await buyTx.wait();
  console.log("  tx           ", buyTx.hash);
  console.log("  gas          ", buyReceipt!.gasUsed.toString());
  await printCurve(c, "curve state after buy");

  // A private balance is ciphertext to everyone but the holder's AES key.
  // PrivateERC20 overloads balanceOf, so name the signature explicitly.
  const raw = await erc["balanceOf(address)"](signer.address);
  console.log("  balanceOf(me) ciphertext:", raw.toString().slice(0, 26) + "...");
  console.log("  unreadable without the AES key - that is the point");
  console.log("");

  // ── sell half back ────────────────────────────────────────────────────
  const sellAmount = quoted / 2n;
  console.log("selling half of that back");
  console.log("  quoteSell    ", ethers.formatEther(await c.quoteSell(sellAmount)), "COTI");

  // approve is overloaded too (public uint256 vs encrypted itUint256).
  const approveTx = await erc["approve(address,uint256)"](curve, sellAmount, {
    gasLimit: GAS.approve,
  });
  await approveTx.wait();
  console.log("  approved     ", approveTx.hash);

  const sellTx = await c.sell(sellAmount, 0n, { gasLimit: GAS.sell });
  const sellReceipt = await sellTx.wait();
  console.log("  tx           ", sellTx.hash);
  console.log("  gas          ", sellReceipt!.gasUsed.toString());
  await printCurve(c, "curve state after sell");

  console.log("factory tokenCount:", (await factory.tokenCount()).toString());
  console.log("curveOf(token)    :", await factory.curveOf(token));
  console.log("");
  console.log("explorer: https://testnet.cotiscan.io/address/" + token);
  console.log("app     : http://localhost:3000/coti/" + token);

  // Hand the launch to the indexer so it shows up in the UI.
  const outFile = path.resolve(__dirname, "../../data/smoke-launch.json");
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(
    outFile,
    JSON.stringify(
      {
        address: token,
        curve,
        name: NAME,
        symbol: SYMBOL,
        decimals: 18,
        description: DESCRIPTION,
        creator: signer.address,
        kind: "private",
        txHash: launchTxHash,
      },
      null,
      2,
    ) + "\n",
  );
  console.log("wrote data/smoke-launch.json for the indexer");
}

async function launchOrResume(
  factory: any,
  launchFee: bigint,
) {
  const resumeToken = process.env.DEVOX_TOKEN || "";
  const resumeCurve = process.env.DEVOX_CURVE || "";

  if (resumeToken && resumeCurve) {
    console.log("resuming existing launch");
    console.log("  token ", resumeToken);
    console.log("  curve ", resumeCurve);
    console.log("");
    return { token: resumeToken, curve: resumeCurve, launchTxHash: process.env.DEVOX_TX || "" };
  }

  console.log("launching " + SYMBOL + " with private balances");
  const metadata = JSON.stringify({ description: DESCRIPTION, image: "" });

  const tx = await (factory as never as {
    launch: (
      n: string,
      s: string,
      m: string,
      p: boolean,
      a: string,
      o: Record<string, unknown>,
    ) => Promise<{ hash: string; wait: () => Promise<{ gasUsed: bigint; logs: unknown[] } | null> }>;
  }).launch(NAME, SYMBOL, metadata, true, ethers.ZeroHash, {
    value: launchFee,
    gasLimit: GAS.launch,
  });

  const receipt = await tx.wait();
  console.log("  tx    ", tx.hash);
  console.log("  gas   ", receipt!.gasUsed.toString());

  let token = "";
  let curve = "";
  for (const log of receipt!.logs as { topics: string[]; data: string }[]) {
    try {
      const parsed = factory.interface.parseLog({ topics: [...log.topics], data: log.data });
      if (parsed?.name === "Launched") {
        token = parsed.args.token;
        curve = parsed.args.curve;
      }
    } catch {
      /* not a factory event */
    }
  }
  if (!token) throw new Error("no Launched event in receipt");

  console.log("  token ", token);
  console.log("  curve ", curve);
  console.log("");
  return { token, curve, launchTxHash: tx.hash };
}

async function printCurve(c: any, title: string) {
  const q = c as never as {
    reserve: () => Promise<bigint>;
    sold: () => Promise<bigint>;
    spotPrice: () => Promise<bigint>;
    progressBps: () => Promise<bigint>;
    accruedFees: () => Promise<bigint>;
    graduated: () => Promise<boolean>;
  };
  console.log(title);
  console.log("  reserve      ", ethers.formatEther(await q.reserve()), "COTI");
  console.log("  sold         ", ethers.formatUnits(await q.sold(), 18), SYMBOL);
  console.log("  spotPrice    ", ethers.formatEther(await q.spotPrice()), "COTI per token");
  console.log("  progress     ", (Number(await q.progressBps()) / 100).toFixed(2) + "%");
  console.log("  accruedFees  ", ethers.formatEther(await q.accruedFees()), "COTI");
  console.log("  graduated    ", await q.graduated());
  console.log("");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
