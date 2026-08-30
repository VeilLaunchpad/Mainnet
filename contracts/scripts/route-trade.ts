import { ethers, network } from "hardhat";

/**
 * Takes a route from DEVOXPAD's own quote endpoint and fills it.
 *
 * This is exactly what the swap page does: ask the API which venue can serve
 * the trade, then send the actions it returned. Running it as a script proves
 * the whole path - routing, order selection, and execution - against mainnet
 * rather than only the quoting half.
 *
 *   QUOTE_BASE=http://localhost:3111 TOKEN=0x… AMOUNT=5 \
 *     npx hardhat run scripts/route-trade.ts --network cotiMainnet
 */

const CARBON = "0x59f21012B2E9BA67ce6a7605E74F945D0D4C84EA";
const CARBON_NATIVE = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

const carbonAbi = [
  "function tradeBySourceAmount(address,address,(uint256 strategyId,uint128 amount)[],uint256,uint128) payable returns (uint128)",
];
const erc20 = [
  "function balanceOf(address) view returns (uint256)",
  "function symbol() view returns (string)",
];

async function main() {
  if (network.name !== "cotiMainnet") throw new Error("mainnet only");
  const [me] = await ethers.getSigners();

  const base = process.env.QUOTE_BASE || "http://localhost:3111";
  const token = process.env.TOKEN || "";
  const amount = process.env.AMOUNT || "5";
  const side = process.env.SIDE || "buy";
  if (!token) throw new Error("set TOKEN");

  const url = base + "/api/swap/quote?token=" + token + "&side=" + side + "&amount=" + amount + "&__net=mainnet";
  const q = (await (await fetch(url)).json()) as {
    ok: boolean;
    venue?: string;
    venueLabel?: string;
    decimals?: number;
    amountIn?: string;
    amountOut?: string;
    actions?: { strategyId: string; amount: string }[];
    message?: string;
  };

  if (!q.ok) throw new Error("no route: " + (q.message ?? "unknown"));
  console.log("venue   :", q.venueLabel);
  console.log("route   :", (q.actions ?? []).length, "order(s)");

  const t = new ethers.Contract(token, erc20, me);
  const sym = await t.symbol().catch(() => "token");
  const dec = q.decimals ?? 18;
  const inDec = side === "sell" ? dec : 18;
  const outDec = side === "sell" ? 18 : dec;
  console.log(
    "quote   : " + ethers.formatUnits(q.amountIn!, inDec) + " " + (side === "sell" ? sym : "COTI") +
      " -> " + ethers.formatUnits(q.amountOut!, outDec) + " " + (side === "sell" ? "COTI" : sym),
  );

  if (q.venue !== "carbon") throw new Error("this script only fills order-book routes");

  const selling = side === "sell";
  const source = selling ? token : CARBON_NATIVE;
  const target = selling ? CARBON_NATIVE : token;

  // Measure whichever side we are receiving.
  const before = selling
    ? await ethers.provider.getBalance(me.address)
    : ((await t.balanceOf(me.address)) as bigint);

  if (selling) {
    // Selling means the controller has to move the token, so it needs an
    // allowance first. Native COTI needs none - it rides in msg.value.
    const approvable = new ethers.Contract(token, ["function approve(address,uint256) returns (bool)"], me);
    await (await approvable.approve(CARBON, BigInt(q.amountIn!), { gasLimit: 300_000 })).wait();
  }

  const ctrl = new ethers.Contract(CARBON, carbonAbi, me);
  const actions = q.actions!.map((a) => ({ strategyId: BigInt(a.strategyId), amount: BigInt(a.amount) }));
  const minReturn = (BigInt(q.amountOut!) * 97n) / 100n;

  const tx = await ctrl.tradeBySourceAmount(
    source,
    target,
    actions,
    Math.floor(Date.now() / 1000) + 900,
    minReturn,
    { value: selling ? 0n : BigInt(q.amountIn!), gasLimit: 6_000_000 },
  );
  const rec = await tx.wait();

  // Selling receives COTI, so the gas spent has to be added back before the
  // balance delta means anything.
  const after = selling
    ? await ethers.provider.getBalance(me.address)
    : ((await t.balanceOf(me.address)) as bigint);
  const gas = selling ? rec.gasUsed * rec.gasPrice : 0n;
  const got = after - before + gas;

  console.log("received: " + ethers.formatUnits(got, selling ? 18 : dec) + " " + (selling ? "COTI" : sym));
  console.log("tx      : " + tx.hash);

  const quoted = BigInt(q.amountOut!);
  const drift = got > quoted ? got - quoted : quoted - got;
  console.log("vs quote: " + (quoted === 0n ? "-" : (Number(drift) / Number(quoted) * 100).toFixed(4) + "% off"));
}

main().catch((e) => {
  console.error(String((e as Error).message).split("\n")[0].slice(0, 200));
  process.exitCode = 1;
});
