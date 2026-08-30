/**
 * Checks the three fixes behind one failed sell, against COTI mainnet.
 *
 *   node scripts/verify-tx-truthfulness.mjs
 *
 * The transaction below reverted on chain while the app showed "Confirmed".
 * Chasing that turned up three separate causes, and each is checked here
 * against live state rather than a fixture, because all three were failures to
 * read what the chain actually returned:
 *
 *   1. a receipt was treated as a success without reading receipt.status
 *   2. a 192-byte private allowance was decoded as one uint256, so an approval
 *      that was needed got skipped - the reason the sell reverted at all
 *   3. a 64-byte private balance would decode the same way, as a huge number
 *
 * Both directions are asserted throughout. A checker that always says "failed"
 * would pass a one-sided test while being just as wrong.
 */
import { createPublicClient, http, encodeFunctionData, formatUnits } from "viem";

const RPC = process.env.COTI_RPC || "https://mainnet.coti.io/rpc";
const client = createPublicClient({ transport: http(RPC) });

const FAILED_SELL = "0x2b3b6f123fda9e731a217559a1c1f7338c62b6ae3c35a1843738b5ca3b9da1a9";
const CURVE = "0x444736b6856b63c0b497fec2b2894abc8141d968";
const SELLER = "0xc6e17b753a03cf9245e25d4939f6efd2791f9f2b";
const PRIVATE_TOKEN = "0x02a85B6A2d6170F0805E6bC1cEa65aB7562d8888";
const PUBLIC_TOKEN = "0x17f23bdE4f3111777fD113390B7dAA3C49c28888"; // DEVOX

const ERC20 = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "uint256" }] },
];

let failures = 0;
function check(label, ok, detail) {
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${detail ? "  -> " + detail : ""}`);
}

async function rawCall(to, data) {
  const res = await client.call({ to, data });
  return res.data || "0x";
}
const byteLen = (hex) => (hex.length - 2) / 2;

// ---------------------------------------------------------------- 1. receipts
console.log("\n1. a receipt is not a success");
{
  const bad = await client.getTransactionReceipt({ hash: FAILED_SELL });
  check("the reported transaction really did revert", bad.status === "reverted", bad.status);

  // A successful control, found rather than assumed - without one, a rule that
  // always reports failure would pass this section.
  const head = await client.getBlockNumber();
  let good = null;
  for (let n = head; n > head - 400n && !good; n--) {
    const b = await client.getBlock({ blockNumber: n });
    for (const h of b.transactions) {
      const r = await client.getTransactionReceipt({ hash: h });
      if (r.status === "success") { good = r; break; }
    }
  }
  check("a successful transaction was found as a control", !!good);
  if (good) {
    const rule = (r) => r.status === "success";
    check("the rule accepts the success and rejects the revert", rule(good) && !rule(bad));
  }
}

// --------------------------------------------------------------- 2. allowance
console.log("\n2. an allowance of the wrong shape is not a number");
{
  const data = encodeFunctionData({ abi: ERC20, functionName: "allowance", args: [SELLER, CURVE] });
  const hex = await rawCall(PRIVATE_TOKEN, data);
  const n = byteLen(hex);
  check("the private token answers with a six-word struct", n === 192, n + " bytes");

  const amount = 1587000n * 10n ** 18n; // the size of the failed sell
  const oldRead = BigInt("0x" + hex.slice(2, 66)); // what one uint256 decodes to
  check(
    "the old read looked ample, so no approval was signed",
    oldRead >= amount,
    "decoded " + formatUnits(oldRead, 18),
  );

  const readable = n === 32;
  check("the new read refuses to call it readable", readable === false);
  check("so an approval is signed instead of skipped", !(readable && oldRead >= amount));

  // The same rule must still accept an ordinary allowance.
  const pubHex = await rawCall(PUBLIC_TOKEN, encodeFunctionData({ abi: ERC20, functionName: "allowance", args: [SELLER, CURVE] }));
  check("a public token still reads as one word", byteLen(pubHex) === 32, byteLen(pubHex) + " bytes");
}

// ----------------------------------------------------------------- 3. balance
console.log("\n3. an encrypted balance is not a huge number");
{
  const priv = await rawCall(PRIVATE_TOKEN, encodeFunctionData({ abi: ERC20, functionName: "balanceOf", args: [SELLER] }));
  const pub = await rawCall(PUBLIC_TOKEN, encodeFunctionData({ abi: ERC20, functionName: "balanceOf", args: [SELLER] }));

  check("the private balance is a two-word ciphertext", byteLen(priv) === 64, byteLen(priv) + " bytes");
  check("the public balance is one word", byteLen(pub) === 32, byteLen(pub) + " bytes");

  const classify = (hex) => (byteLen(hex) === 64 ? "encrypted" : byteLen(hex) === 32 ? "public" : "unknown");
  check("each is classified correctly", classify(priv) === "encrypted" && classify(pub) === "public");

  // Percentages must come off the integer, or Max lands above the balance.
  const raw = BigInt(pub);
  const percentOf = (v, p) => (p >= 100 ? v : (v * BigInt(p)) / 100n);
  const parse = (v, d) => {
    const [w, f = ""] = v.split(".");
    return BigInt(w || "0") * 10n ** BigInt(d) + BigInt((f + "0".repeat(d)).slice(0, d) || "0");
  };
  const exact = [25, 50, 75, 100].every((p) => {
    const take = percentOf(raw, p);
    return parse(formatUnits(take, 18), 18) === take && take <= raw;
  });
  check("every percentage round-trips exactly and stays within the balance", exact);
}

console.log(failures === 0 ? "\nall checks passed\n" : `\n${failures} check(s) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
