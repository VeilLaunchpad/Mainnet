import { ethers } from "hardhat";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Fires a few swaps against a graduated token so the chart has real candles.
 *
 *   DEVOX_TOKEN=0x... npx hardhat run scripts/trade.ts --network cotiTestnet
 */

const GAS = { approve: 6_000_000n, swap: 16_000_000n };

function table() {
  return JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../../config/devoxpad.testnet.json"), "utf8"),
  );
}

const fmt = (v: bigint, d = 18) =>
  Number(ethers.formatUnits(v, d)).toLocaleString("en-US", { maximumFractionDigits: 6 });

async function main() {
  const [signer] = await ethers.getSigners();
  const t = table();
  const routerAddress = t.contracts.devoxpad.swapRouter.address;
  const token = process.env.DEVOX_TOKEN;
  if (!token) throw new Error("set DEVOX_TOKEN");

  const router = await ethers.getContractAt("DevoxSwapRouter", routerAddress);
  const erc = await ethers.getContractAt("DevoxToken", token);
  const symbol = await erc.symbol();

  console.log("trading", symbol, "on DevoxSwap");
  console.log("balance:", fmt(await ethers.provider.getBalance(signer.address)), "COTI\n");

  // Alternating sides so the candles have both colours and a real high/low.
  const plan: { side: "buy" | "sell"; amount: string }[] = [
    { side: "buy", amount: "0.12" },
    { side: "sell", amount: "4000000" },
    { side: "buy", amount: "0.07" },
    { side: "buy", amount: "0.15" },
    { side: "sell", amount: "9000000" },
  ];

  for (const [i, leg] of plan.entries()) {
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 900);
    const priceBefore = await router.priceInCoti(token);

    if (leg.side === "buy") {
      const value = ethers.parseEther(leg.amount);
      const expected = await router.quoteBuyWithCoti(token, value);
      const tx = await router.swapExactCotiForTokens(token, 0n, signer.address, deadline, {
        value,
        gasLimit: GAS.swap,
      });
      await tx.wait();
      console.log(
        "  " + (i + 1) + ". buy  " + leg.amount + " COTI -> " + fmt(expected) + " " + symbol,
      );
    } else {
      const amountIn = ethers.parseUnits(leg.amount, 18);
      const expected = await router.quoteSellForCoti(token, amountIn);

      // Reset first: PrivateERC20 refuses a non-zero to non-zero approve.
      const reset = await erc["approve(address,uint256)"](routerAddress, 0n, {
        gasLimit: GAS.approve,
      });
      await reset.wait();
      const approve = await erc["approve(address,uint256)"](routerAddress, amountIn, {
        gasLimit: GAS.approve,
      });
      await approve.wait();

      const tx = await router.swapExactTokensForCoti(
        token,
        amountIn,
        0n,
        signer.address,
        deadline,
        { gasLimit: GAS.swap },
      );
      await tx.wait();
      console.log(
        "  " + (i + 1) + ". sell " + fmt(amountIn) + " " + symbol + " -> " + fmt(expected) + " COTI",
      );
    }

    const priceAfter = await router.priceInCoti(token);
    const before = Number(ethers.formatEther(priceBefore));
    const after = Number(ethers.formatEther(priceAfter));
    const move = before > 0 ? ((after - before) / before) * 100 : 0;
    console.log("     price " + after.toExponential(4) + " COTI  (" + move.toFixed(2) + "%)");
  }

  console.log("\nbalance:", fmt(await ethers.provider.getBalance(signer.address)), "COTI");
  console.log("chart  : http://localhost:3000/coti/" + token);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
