import { ethers, network } from "hardhat";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * The full lifecycle, end to end on a live chain:
 *
 *   launch -> buy on the curve -> sell back -> fill the curve -> graduate
 *   -> pair created on VeilSwap -> swap COTI for the token and back again
 *
 * Explicit gas limits throughout: COTI's RPC rejects the `pending` block tag
 * during estimation, and MPC operations on a PrivateERC20 cost far more than
 * ordinary storage writes.
 */

const GAS = {
  launch: 9_000_000n,
  buy: 12_000_000n,
  approve: 6_000_000n,
  sell: 14_000_000n,
  graduate: 30_000_000n,
  swap: 16_000_000n,
};

const NAME = "Kopi Malam";
const SYMBOL = "KOPI";
const DESCRIPTION =
  "Token komunitas Kopi Malam. Ngobrol, nge-gas, dan ngopi di jam yang orang lain tidur.";

function table() {
  return JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../../config/veilpad.testnet.json"), "utf8"),
  );
}

function fmt(v: bigint, d = 18) {
  return Number(ethers.formatUnits(v, d)).toLocaleString("en-US", { maximumFractionDigits: 6 });
}

async function main() {
  const [signer] = await ethers.getSigners();
  const t = table();
  const veilpad = t.contracts.veilpad;

  const factoryAddress = veilpad.factory.address;
  const swapFactoryAddress = veilpad.swapFactory.address;
  const routerAddress = veilpad.swapRouter.address;
  const wcotiAddress = veilpad.wcoti.address;

  console.log("network :", network.name);
  console.log("signer  :", signer.address);
  console.log("balance :", fmt(await ethers.provider.getBalance(signer.address)), "COTI");
  console.log("factory :", factoryAddress);
  console.log("swap    :", swapFactoryAddress);
  console.log("router  :", routerAddress);
  console.log("");

  const factory = await ethers.getContractAt("VeilPadFactory", factoryAddress);
  const swapFactory = await ethers.getContractAt("VeilSwapFactory", swapFactoryAddress);
  const router = await ethers.getContractAt("VeilSwapRouter", routerAddress);

  const launchFee = await factory.launchFee();
  const target = await factory.graduationTarget();
  console.log("curve params: virtualCoti", fmt(await factory.virtualCoti()), "COTI, target", fmt(target), "COTI");
  console.log("");

  // ── 1. launch ───────────────────────────────────────────────────────────
  console.log("[1] launching " + SYMBOL + " with encrypted balances");
  const launchTx = await factory.launch(
    NAME,
    SYMBOL,
    JSON.stringify({ description: DESCRIPTION, image: "" }),
    true,
    ethers.ZeroHash,
    { value: launchFee, gasLimit: GAS.launch },
  );
  const launchReceipt = await launchTx.wait();

  let token = "";
  let curveAddress = "";
  for (const log of launchReceipt!.logs) {
    try {
      const parsed = factory.interface.parseLog({ topics: [...log.topics], data: log.data });
      if (parsed?.name === "Launched") {
        token = parsed.args.token;
        curveAddress = parsed.args.curve;
      }
    } catch {
      /* not ours */
    }
  }
  if (!token) throw new Error("no Launched event");

  console.log("    tx    ", launchTx.hash);
  console.log("    token ", token);
  console.log("    curve ", curveAddress);
  console.log("");

  const curve = await ethers.getContractAt("VeilCurve", curveAddress);
  const erc = await ethers.getContractAt("VeilToken", token);

  // ── 2. buy, then sell part back, to leave a real trade history ──────────
  console.log("[2] trading on the bonding curve");

  const firstBuy = ethers.parseEther("0.5");
  const gotFirst = await curve.quoteBuy(firstBuy);
  const buy1 = await curve.buy(0n, { value: firstBuy, gasLimit: GAS.buy });
  await buy1.wait();
  console.log("    buy  0.5 COTI  ->", fmt(gotFirst), SYMBOL, " ", buy1.hash);

  const sellBack = gotFirst / 4n;
  const cotiBack = await curve.quoteSell(sellBack);
  const approveCurve = await erc["approve(address,uint256)"](curveAddress, sellBack, {
    gasLimit: GAS.approve,
  });
  await approveCurve.wait();
  const sell1 = await curve.sell(sellBack, 0n, { gasLimit: GAS.sell });
  await sell1.wait();
  console.log("    sell", fmt(sellBack), SYMBOL, " ->", fmt(cotiBack), "COTI ", sell1.hash);

  // ── 3. fill the curve ───────────────────────────────────────────────────
  let reserve = await curve.reserve();
  console.log("");
  console.log("[3] filling the curve to " + fmt(target) + " COTI (now " + fmt(reserve) + ")");

  while (reserve < target) {
    // The 1% trade fee does not count toward the reserve, so overshoot a little.
    const missing = target - reserve;
    const spend = ((missing * 102n) / 100n) + ethers.parseEther("0.05");
    const got = await curve.quoteBuy(spend);
    const tx = await curve.buy(0n, { value: spend, gasLimit: GAS.buy });
    await tx.wait();
    reserve = await curve.reserve();
    console.log("    buy ", fmt(spend), "COTI ->", fmt(got), SYMBOL, " reserve now", fmt(reserve));
  }

  console.log("    progress", (Number(await curve.progressBps()) / 100).toFixed(2) + "%");
  console.log("");

  // ── 4. graduate ─────────────────────────────────────────────────────────
  console.log("[4] graduating into VeilSwap");
  const gradTx = await curve.graduate(swapFactoryAddress, wcotiAddress, {
    gasLimit: GAS.graduate,
  });
  const gradReceipt = await gradTx.wait();
  console.log("    tx   ", gradTx.hash);
  console.log("    gas  ", gradReceipt!.gasUsed.toString());
  console.log("    graduated:", await curve.graduated());

  const pairAddress = await curve.pool();
  console.log("    pair ", pairAddress);
  if (pairAddress === ethers.ZeroAddress) throw new Error("graduation produced no pair");

  const pair = await ethers.getContractAt("VeilSwapPair", pairAddress);
  const [r0, r1] = await pair.getReserves();
  const token0 = await pair.token0();
  const isTokenFirst = token0.toLowerCase() === token.toLowerCase();
  console.log("    reserves:", fmt(isTokenFirst ? r0 : r1), SYMBOL, "/", fmt(isTokenFirst ? r1 : r0), "WCOTI");
  console.log("    LP locked in curve:", fmt(await pair.balanceOf(curveAddress)));
  console.log("    price:", ethers.formatEther(await router.priceInCoti(token)), "COTI per", SYMBOL);
  console.log("");

  // ── 5. trade on the DEX ─────────────────────────────────────────────────
  console.log("[5] swapping on VeilSwap");

  const swapIn = ethers.parseEther("0.2");
  const expected = await router.quoteBuyWithCoti(token, swapIn);
  console.log("    quote 0.2 COTI ->", fmt(expected), SYMBOL);

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 900);
  const swapBuy = await router.swapExactCotiForTokens(token, 0n, signer.address, deadline, {
    value: swapIn,
    gasLimit: GAS.swap,
  });
  await swapBuy.wait();
  console.log("    bought                 ", swapBuy.hash);

  const sellAmount = expected / 2n;
  const expectBack = await router.quoteSellForCoti(token, sellAmount);
  console.log("    quote", fmt(sellAmount), SYMBOL, "->", fmt(expectBack), "COTI");

  const approveRouter = await erc["approve(address,uint256)"](routerAddress, sellAmount, {
    gasLimit: GAS.approve,
  });
  await approveRouter.wait();

  const swapSell = await router.swapExactTokensForCoti(
    token,
    sellAmount,
    0n,
    signer.address,
    deadline,
    { gasLimit: GAS.swap },
  );
  await swapSell.wait();
  console.log("    sold                   ", swapSell.hash);

  const [f0, f1] = await pair.getReserves();
  console.log("    reserves now:", fmt(isTokenFirst ? f0 : f1), SYMBOL, "/", fmt(isTokenFirst ? f1 : f0), "WCOTI");
  console.log("    price now   :", ethers.formatEther(await router.priceInCoti(token)), "COTI per", SYMBOL);
  console.log("");

  console.log("pairs on VeilSwap:", (await swapFactory.allPairsLength()).toString());
  console.log("explorer:", "https://testnet.cotiscan.io/address/" + token);
  console.log("app     :", "http://localhost:3000/coti/" + token);

  const outFile = path.resolve(__dirname, "../../data/graduated-launch.json");
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(
    outFile,
    JSON.stringify(
      {
        address: token,
        curve: curveAddress,
        pool: pairAddress,
        name: NAME,
        symbol: SYMBOL,
        decimals: 18,
        description: DESCRIPTION,
        creator: signer.address,
        kind: "private",
        graduated: true,
        feeTier: 3000,
        txHash: launchTx.hash,
      },
      null,
      2,
    ) + "\n",
  );
  console.log("wrote data/graduated-launch.json for the indexer");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
