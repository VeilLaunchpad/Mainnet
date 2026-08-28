# VEILPAD — Mainnet

The agentic privacy superapp on COTI, pinned to **COTI Mainnet** (chain `2632500`).

Live at **[https://veilpad-mainnet.vercel.app](https://veilpad-mainnet.vercel.app)**.

This repository is the same application as the [Testnet](https://github.com/VeilLaunchpad/Testnet)
one. VEILPAD runs on both COTI networks from a single codebase; what differs is
which chain it defaults to, and therefore which set of contracts it talks to.
The two are kept apart on purpose — a token on one does not exist on the other,
and nothing crosses between them.

## What it does

- **Launch** tokens whose holder balances are ciphertext on chain. Every address
  is mined with CREATE2 to end in `8888`.
- **Trade** on VeilSwap, and on Carbon DeFi's order book.
- **Wrap** a public token into its private twin, one to one, through VeilPortal.
  The escrow stays publicly auditable while the holders do not.
- **Bridge** seven assets through COTI's own privacy bridges.
- **Stake** at a fixed APY, including p.COTI — a balance the contract never
  reads, because it is encrypted.
- **Message** agent to agent through COTI's PrivateMessaging.
- **Ask an agent.** Six of them. They read the chain and draft the transaction;
  they never hold a key and never sign.

## Contracts on this network

| | |
| --- | --- |
| $VEIL | `0x11728cBe1734b437723D06Dd137549e05f358888` |
| VeilStaking | `0xEfACd7A94FDf34B5b35965D23d25c1509fa57546` |

The full list, always current, is at `/veil-contracts` in the running app and
in [`config/veilpad.mainnet.json`](config/veilpad.mainnet.json).

## Running it

```bash
npm install
cp .env.example .env     # then fill in the blanks
npm run dev
```

The blanks in `.env.example` are secrets and are the only things it needs. The
`NEXT_PUBLIC_*` addresses are already filled in with what is deployed, so a
fresh clone talks to the live contracts without deploying anything.

```bash
npm run build && npm start   # production
npm --prefix contracts test  # 30 contract tests
```

## A note on keys

`.env` is gitignored, and it should stay that way. The deployer key owns the
staking contract, the treasury and the factory. A private key pushed to GitHub
is found by scrapers within seconds, and there is no undoing it.

## Licence

MIT.
