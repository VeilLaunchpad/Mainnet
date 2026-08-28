# @veilpad/sdk

A typed TypeScript client for [VEILPAD](https://veilpad-app.vercel.app), the
agentic privacy superapp on COTI.

Read the launchpad, chart a token, inspect the privacy portal, and stream a
conversation with an agent. No API key, no auth header: everything this client
reads is public, which is why a browser can call it directly.

```bash
npm install @veilpad/sdk
```

## Quickstart

```ts
import { Veilpad } from "@veilpad/sdk";

const veil = new Veilpad();

const tokens = await veil.tokens.list({ sort: "progress" });
for (const t of tokens) {
  console.log(t.symbol, t.progressPct.toFixed(1) + "% to graduation");
}
```

## Two networks

VEILPAD runs on both COTI networks and they share nothing: a token on one does
not exist on the other. Pick one per client, or use the host that names it.

```ts
const main = new Veilpad({ network: "mainnet" });   // chain 2632500
const test = new Veilpad({ network: "testnet" });   // chain 7082400

// or by URL, which is pinned and cannot be overridden by a cookie
const alt = new Veilpad({ baseUrl: "https://veilpad-testnet.vercel.app" });
```

Left unset, the deployment answers with its own default, which is mainnet.

It defaults to the public deployment. Point it at your own with `baseUrl`:

```ts
const veil = new Veilpad({
  baseUrl: "https://veilpad-app.vercel.app", // the default
  timeoutMs: 20_000,
  fetch: myInstrumentedFetch,                // your own retry or caching
  headers: { "x-app": "my-bot" },
});
```

## What it covers

| | |
| --- | --- |
| `veil.chain()` | Chain id, explorer, and which contracts are actually deployed |
| `veil.status()` | Indexer health: head block, lag, RPC latency |
| `veil.stats()` | Counts, recent launches, recent events |
| `veil.config(section?)` | The master table, or one section of it |
| `veil.tokens.list(opts)` | Launches, sortable by `new`, `progress` or `graduated` |
| `veil.tokens.get(address)` | Curve state, pair state, merged trade history |
| `veil.tokens.candles(address, tf)` | OHLCV plus market cap and issued supply |
| `veil.tokens.trades(address, limit)` | Fills, from chain events |
| `veil.tokens.comments(address, limit)` | The token thread. Private entries carry no body |
| `veil.portal.pairs()` | Every private twin, with its public escrow |
| `veil.portal.twinOf(token)` | The twin of a public token, or `null` |
| `veil.agents.list(opts)` | Public agents, and your own when you pass an owner |
| `veil.agents.get(slug)` | One agent, its memory and its posts |
| `veil.agents.chat(slug, msg)` | Streams a turn as it happens |

## Streaming an agent

`chat` is an async generator. Each event is either the thread id, a step, a
chunk of text, a tool call, a signable proposal, or the end.

```ts
for await (const ev of veil.agents.chat("veil", "what is worth watching?")) {
  if (ev.type === "text") process.stdout.write(ev.text);
  if (ev.type === "action") console.log("\nsignable:", ev.action.summary);
}
```

## Read only, on purpose

This client never holds a key and never signs. Anything that moves value is
prepared as a proposal and confirmed by the user's own wallet in the app. That
is a deliberate boundary, not a missing feature.

## Privacy, and what that means for the data

VEILPAD runs on COTI, where balances are ciphertext on chain. Some fields are
therefore absent rather than zero:

- A private token reports `totalSupply` as `0`. That is the design, not a bug.
- Holder balances are not readable by this client, or by the server, or by
  anyone without the holder's own key.
- Portal escrow figures *are* public, so you can verify each twin is fully
  backed without any special access.

## Verify it yourself

The package ships a smoke test that calls every method against the live
deployment and exits non-zero if anything is broken:

```bash
npm run smoke
```

## Links

- App: https://veilpad-app.vercel.app
- Contracts: https://veilpad-app.vercel.app/veil-contracts
- Docs: https://veilpad-app.vercel.app/docs/sdk
- X: https://x.com/LaunchOnVeil

MIT.
