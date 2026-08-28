import { Veilpad, DEFAULT_BASE_URL } from "./dist/index.js";

const veil = new Veilpad();
console.log("default baseUrl:", DEFAULT_BASE_URL);
console.log("client baseUrl :", veil.baseUrl);
console.log();

const results = [];
async function probe(label, fn) {
  try {
    const out = await fn();
    const desc = Array.isArray(out)
      ? `${out.length} item(s)`
      : typeof out === "object" && out
        ? Object.keys(out).slice(0, 4).join(", ")
        : String(out);
    console.log(`  ok    ${label.padEnd(24)} ${desc}`);
    results.push(true);
  } catch (e) {
    console.log(`  FAIL  ${label.padEnd(24)} ${String(e.message).slice(0, 80)}`);
    results.push(false);
  }
}

await probe("chain()",            () => veil.chain());
await probe("status()",           () => veil.status());
await probe("stats()",            () => veil.stats());
await probe("config('contracts')",() => veil.config("contracts"));
await probe("tokens.list()",      () => veil.tokens.list());
await probe("agents.list()",      () => veil.agents.list());
await probe("portal.pairs()",     () => veil.portal.pairs());

const tokens = await veil.tokens.list();
if (tokens.length) {
  const a = tokens[0].address;
  console.log(`\n  using token ${tokens[0].symbol} ${a.slice(0, 12)}…`);
  await probe("tokens.get()",      () => veil.tokens.get(a));
  await probe("tokens.candles()",  () => veil.tokens.candles(a, "5m"));
  await probe("tokens.trades()",   () => veil.tokens.trades(a, 5));
  await probe("tokens.comments()", () => veil.tokens.comments(a, 5));
  await probe("portal.twinOf()",   () => veil.portal.twinOf(a));
}

/**
 * The network option has to actually change which chain is answered, not just
 * be accepted. Anything else would be a setting that looks like it works.
 */
console.log();
console.log("  network selection");
const EXPECT = { mainnet: 2632500, testnet: 7082400 };
for (const net of ["mainnet", "testnet"]) {
  await probe(`network: ${net}`, async () => {
    const client = new Veilpad({ network: net });
    const chain = await client.chain();
    if (chain.network !== net) throw new Error(`asked for ${net}, got ${chain.network}`);
    if (chain.chainId !== EXPECT[net]) {
      throw new Error(`${net} should be chain ${EXPECT[net]}, got ${chain.chainId}`);
    }
    return `chain ${chain.chainId}`;
  });
}

// And the dedicated hosts must agree with the option, since they are the same
// promise made two different ways.
for (const [net, baseUrl] of [
  ["mainnet", "https://veilpad-mainnet.vercel.app"],
  ["testnet", "https://veilpad-testnet.vercel.app"],
]) {
  await probe(`host: ${baseUrl.replace("https://", "")}`, async () => {
    const chain = await new Veilpad({ baseUrl }).chain();
    if (chain.network !== net) throw new Error(`host says ${chain.network}, expected ${net}`);
    return `chain ${chain.chainId}`;
  });
}

const pass = results.filter(Boolean).length;
console.log(`\n  ${pass}/${results.length} SDK methods working against the live deployment`);
process.exit(pass === results.length ? 0 : 1);
