import type { DocPage } from "./docs-types";
import { siteUrl } from "./app-url";

/** The public address, so no example can drift from the deployment. */
const SITE = siteUrl();

/**
 * Developer-facing documentation: the SDK and the indexer API.
 *
 * Split out of docs.ts because those two pages carry most of the code samples
 * and would otherwise dominate the file that holds the product docs.
 */

export const sdkPage: DocPage = {
  slug: "sdk",
  title: "SDK",
  description: "A typed TypeScript client for the launchpad, the charts, the portal and the agents.",
  sections: [
    {
      id: "install",
      title: "Install",
      blocks: [
        {
          type: "code",
          lang: "bash",
          code: `npm install @devoxpad/sdk`,
        },
        {
          type: "p",
          text: "There is no API key and no auth header. Everything this client reads is public, which is why a browser can call it directly. It points at the public deployment by default, so the two lines below are a working program.",
        },
        {
          type: "note",
          tone: "good",
          title: "Check it rather than trust this page",
          text: "The repository ships a smoke test that calls every method against the live deployment and exits non-zero if anything is broken. Run `npm run smoke` in `sdk/` before you build on top of it.",
        },
        {
          type: "code",
          lang: "ts",
          caption: "Hello, launchpad",
          code: `import { Devoxpad } from "@devoxpad/sdk";

const devox = new Devoxpad();

const tokens = await devox.tokens.list({ sort: "progress", limit: 5 });
const chart = await devox.tokens.candles(tokens[0].address, "5m");

console.log(tokens[0].symbol, chart.spotCoti, "COTI");`,
        },
        {
          type: "note",
          tone: "info",
          title: "Read only, on purpose",
          text: "Everything the SDK exposes is a public read. Nothing it can call moves funds, and no key is needed. Signing is left to your own wallet library, because signing belongs where the keys are.",
        },
      ],
    },
    {
      id: "client",
      title: "The client",
      blocks: [
        {
          type: "code",
          lang: "ts",
          code: `const devox = new Devoxpad({
  baseUrl: "${SITE}",                // this is the default, so it can be omitted
  timeoutMs: 20_000,
  fetch: myInstrumentedFetch,        // your own retry or caching
  headers: { "x-app": "my-bot" },
});`,
        },
        {
          type: "kv",
          rows: [
            { k: "baseUrl", v: "Any DEVOXPAD deployment. Point it at your own instance." },
            { k: "fetch", v: "Swap in your own implementation for retries, caching or logging." },
            { k: "timeoutMs", v: "Requests abort past this. Default 20000." },
            { k: "headers", v: "Merged into every request." },
          ],
        },
        {
          type: "p",
          text: "Failures throw a DevoxpadError carrying the HTTP status and the path, so a bad address and a network outage are distinguishable without parsing message strings.",
        },
      ],
    },
    {
      id: "tokens",
      title: "devox.tokens",
      blocks: [
        {
          type: "table",
          head: ["Method", "Returns"],
          rows: [
            ["list(opts)", "TokenSummary[], sortable by new, progress or graduated"],
            ["get(address)", "TokenDetail: curve state, pair state, merged trade history"],
            ["candles(address, tf)", "OHLCV plus market cap and issued supply"],
            ["trades(address, limit)", "Recorded fills"],
            ["comments(address, limit)", "The token thread. Private entries carry no body."],
          ],
        },
        {
          type: "code",
          lang: "ts",
          caption: "Watching a launch fill",
          code: `const { curve } = await devox.tokens.get(address);

if (curve && !curve.graduated) {
  console.log(curve.progressPct.toFixed(1) + "% of the way to graduation");
  console.log(curve.reserveCoti + " of " + curve.targetCoti + " COTI raised");
}`,
        },
        {
          type: "note",
          tone: "warn",
          title: "Private tokens report zero supply",
          text: "TokenDetail exposes isPrivate. When it is true, treat any aggregate supply as unavailable rather than as zero. Use issuedSupply from candles() if you need something to value the token against.",
        },
      ],
    },
    {
      id: "portal-sdk",
      title: "devox.portal",
      blocks: [
        {
          type: "code",
          lang: "ts",
          code: `const { pairs } = await devox.portal.pairs();

for (const p of pairs) {
  console.log(p.twinSymbol, "backed by", p.locked, p.symbol);
}

const twin = await devox.portal.twinOf(wcotiAddress);`,
        },
        {
          type: "p",
          text: "Escrow figures are public by design, so a client can verify each twin is fully backed without any special access.",
        },
      ],
    },
    {
      id: "agents-sdk",
      title: "devox.agents",
      blocks: [
        {
          type: "p",
          text: "chat() returns an async generator. Every step an agent takes arrives as it happens: the tools it calls, the text it streams, and any proposal it produces for a wallet to sign.",
        },
        {
          type: "code",
          lang: "ts",
          caption: "Streaming an agent turn",
          code: `for await (const ev of devox.agents.chat("shade", "what is worth buying")) {
  switch (ev.type) {
    case "tool_start":
      console.log("...", ev.name);
      break;
    case "text":
      process.stdout.write(ev.text);
      break;
    case "action":
      console.log("proposal:", ev.action);
      break;
  }
}`,
        },
        {
          type: "note",
          tone: "good",
          title: "Actions are proposals, never executions",
          text: "An action event describes a transaction. Nothing happens until your wallet signs it. The SDK will never sign anything for you.",
        },
      ],
    },
    {
      id: "health",
      title: "Config and health",
      blocks: [
        {
          type: "code",
          lang: "ts",
          code: `const chain = await devox.chain();
if (!chain.deployed.factory) {
  throw new Error("The launchpad is not deployed on this network yet");
}

const status = await devox.status();
console.log(status.head, "head,", status.lag, "blocks behind");`,
        },
        {
          type: "p",
          text: "chain() returns a compact digest of what is actually live, which is the honest way to decide whether an action is possible before offering it to a user.",
        },
      ],
    },
  ],
};

export const indexerPage: DocPage = {
  slug: "indexer",
  title: "Indexer API",
  description: "How DEVOXPAD reads chain state, and every endpoint that serves it.",
  sections: [
    {
      id: "model",
      title: "How it works",
      blocks: [
        {
          type: "p",
          text: "There is no background crawler and no separate database of chain history. When a token page is requested, the server reads that token's Traded events from its curve and Swap events from its pair, straight from the RPC, then merges them with the small amount the local index holds.",
        },
        {
          type: "list",
          items: [
            "History is complete regardless of where a trade originated: a script, another front end, or an agent acting on its own.",
            "There is no reorg handling or replay backlog to get wrong, because there is no cursor to fall behind.",
            "The cost is an RPC round trip per read rather than a database lookup, which is why latency is published.",
          ],
        },
        {
          type: "note",
          tone: "info",
          title: "What the local database actually holds",
          text: "Only what a chain cannot cheaply serve: launch metadata, profiles, agent memory and transcripts, comments, and recorded fills. Balances, ownership and message bodies always come from the chain.",
        },
      ],
    },
    {
      id: "status-endpoint",
      title: "Status",
      blocks: [
        { type: "code", lang: "bash", code: `curl ${SITE}/api/indexer/status` },
        {
          type: "code",
          lang: "json",
          code: `{
  "ok": true,
  "network": "testnet",
  "chainId": 7082400,
  "head": 9238125,
  "indexed": 9238125,
  "lag": 0,
  "rpcLatencyMs": 184,
  "mode": "on-demand event reader",
  "services": [
    { "name": "coti-rpc", "ok": true, "detail": "184ms, head 9238125" },
    { "name": "index-db", "ok": true, "detail": "2 tokens indexed" }
  ],
  "counts": { "tokens": 2, "trades": 10, "agents": 6 }
}`,
        },
        {
          type: "p",
          text: "Returns 200 when the RPC and the index are both reachable, and 503 when either is not. lag is zero by construction; a non-zero value would mean the reader could not reach the chain at all.",
        },
      ],
    },
    {
      id: "endpoints",
      title: "Endpoints",
      blocks: [
        {
          type: "table",
          head: ["Endpoint", "Purpose"],
          rows: [
            ["GET /api/indexer/status", "Health, head block, service checks, indexed counts"],
            ["GET /api/config", "The master table. ?section= ?digest=1 ?refresh=1"],
            ["GET /api/stats", "Counts, COTI price, contract status, model pool health"],
            ["GET /api/tokens", "Launches. ?sort=new|progress|graduated &limit &q &creator"],
            ["GET /api/tokens/{address}", "Curve state, pair state, merged trade history"],
            ["GET /api/candles", "OHLCV. ?token &tf=1m|5m|15m|1h|4h|1d"],
            ["GET /api/trades", "Recorded fills. ?token &limit"],
            ["GET /api/comments", "Token thread. ?token &limit"],
            ["GET /api/portal", "Private twins and their public escrow"],
            ["GET /api/agents", "Agents. ?owner &kind"],
            ["GET /api/profile/{handle}", "Resolve a handle or an address"],
            ["GET /api/messages", "Inbox metadata. Never plaintext."],
            ["GET /api/market", "COTI price and reference candles"],
            ["GET /api/history", "One timeline per address. ?address &limit &kind"],
            ["GET /api/verify", "Whether a contract is verified on CotiScan. ?address"],
            ["POST /api/verify", "Submit a contract for verification"],
          ],
        },
        {
          type: "note",
          tone: "warn",
          title: "What no indexer can give you",
          text: "Private balances and private transfer amounts are ciphertext on chain. No endpoint here returns them, and none ever could: decryption needs a key that exists only in the holder's browser.",
        },
      ],
    },
    {
      id: "rates",
      title: "Rate limits and caching",
      blocks: [
        {
          type: "kv",
          rows: [
            { k: "Rate limit", v: "None on a self-hosted deployment. Be reasonable with the public one." },
            { k: "Market data", v: "Cached for 60 seconds upstream of CoinGecko." },
            { k: "Candles", v: "Computed per request from events. Poll at most every 15 seconds." },
            { k: "Chain reads", v: "Uncached, so they are always current and always cost a round trip." },
          ],
        },
        {
          type: "p",
          text: "If you are polling hard, run your own deployment and point the SDK at it with baseUrl. Everything is open and there is no key to obtain.",
        },
      ],
    },
  ],
};
