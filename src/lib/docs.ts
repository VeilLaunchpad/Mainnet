import type { DocGroup, DocPage } from "./docs-types";
import { nftPage } from "./docs-nft";
import { sdkPage, indexerPage } from "./docs-dev";
import { siteUrl } from "./app-url";

/** The public address, so no example can drift from the deployment. */
const SITE = siteUrl();

export type { DocBlock, DocSection, DocPage, DocGroup } from "./docs-types";

const overview: DocPage = {
  slug: "overview",
  title: "What VEILPAD is",
  description: "An agentic privacy superapp on COTI: launch, trade, message and bridge.",
  sections: [
    {
      id: "intro",
      title: "Introduction",
      blocks: [
        {
          type: "p",
          text: "VEILPAD is a launchpad, a trading venue, an agent network and an encrypted inbox, all running on COTI. The thread connecting them is that your balances stay yours: token balances live on chain as ciphertext, and only the holder's key turns one back into a number.",
        },
        {
          type: "p",
          text: "Everything on the site is backed by a deployed contract or a live read. Where something is not deployed on the current network, the interface says so plainly instead of failing with a revert.",
        },
        {
          type: "table",
          head: ["Surface", "Route", "What it does"],
          rows: [
            ["Launchpad", "/launchpad", "Every launch, sortable by graduation progress"],
            ["Token page", "/coti/{contract}", "Chart, trade panel, on-chain history"],
            ["Desk", "/desk", "SHADE, the private trading agent"],
            ["Agents", "/agents", "Six house agents plus your own"],
            ["Messages", "/messages", "Encrypted inbox, decrypted in your browser"],
            ["Swap", "/swap", "VeilSwap, where graduated launches trade"],
            ["Privacy portal", "/portal", "Move a token into privacy, and back"],
            ["Bridge", "/bridge", "COTI's privacy bridges, called from here"],
            ["Contracts", "/veil-contracts", "Every address, live from chain"],
            ["Faucet", "/faucet", "Testnet COTI without leaving the tab. Testnet only"],
            ["Dashboard", "/dashboard", "Overview, wallet, full history, agents"],
            ["Skills", "/skills", "Every capability an agent can reach for"],
            ["Status", "/status", "Indexer and service health"],
          ],
        },
      ],
    },
    {
      id: "privacy",
      title: "How privacy works here",
      blocks: [
        {
          type: "p",
          text: "COTI computes over ciphertext using garbled circuits executed by an MPC network. A contract can add two encrypted balances without any single node learning either one. That is a different mechanism from a rollup hiding state behind a proof, and different again from a chain that simply withholds data.",
        },
        {
          type: "p",
          text: "The gcEVM has run COTI mainnet since March 2025, the first production implementation of garbled circuits on a blockchain. Each user holds their own AES key issued through a precompile, and the network key is split across nodes with threshold cryptography, so no single node can reconstruct it. No operator, validator or node ever holds your plaintext.",
        },
        { type: "h3", text: "What stays private", id: "private" },
        {
          type: "list",
          items: [
            "Token balances, stored as ciphertext in contract storage",
            "The size of a transfer you make outside a public pool",
            "Aggregate supply of a private token",
            "Message bodies, sealed to sender and recipient",
          ],
        },
        { type: "h3", text: "What stays public", id: "public" },
        {
          type: "list",
          items: [
            "That a transfer or swap happened, and against which contract",
            "Message routing metadata: sender, recipient, timestamp, epoch, chunk count",
            "AMM pair reserves and price, because an AMM cannot function without them",
            "Your native COTI balance and gas spend",
          ],
        },
        {
          type: "note",
          tone: "info",
          title: "COTI draws this line explicitly",
          text: "COTI encrypts amounts, balances, and computation inputs and outputs. It does not encrypt metadata: sender, recipient, timestamp and the fact a transaction occurred stay public. That boundary is the same one the BIS, Project Agora and Circle describe. Selective disclosure, not disappearance.",
        },
        {
          type: "note",
          tone: "warn",
          title: "The trade-off, stated plainly",
          text: "MPC means trusting the network operator, the consensus and the precompile implementation. Solidity cannot re-prove MPC soundness on chain. COTI says this in its own interface documentation, and so do we.",
        },
        {
          type: "note",
          tone: "info",
          title: "totalSupply returns 0",
          text: "A COTI PrivateERC20 reports totalSupply as zero on purpose. Publishing an aggregate would leak exactly what the encryption protects. Treat a zero as a signal, not a failure.",
        },
      ],
    },
    {
      id: "keys",
      title: "Your key never leaves the browser",
      blocks: [
        {
          type: "p",
          text: "Reading your own encrypted state needs an AES key that only you can derive. Your wallet signs an RSA public key, the on-chain onboarding contract returns the AES key sealed to it, and the SDK unwraps it locally.",
        },
        {
          type: "p",
          text: "VEILPAD caches that key in your browser so you sign once rather than once per read. It never reaches our server. Every decrypt on this site happens on your machine, which means we could not read your messages if you asked us to.",
        },
      ],
    },
  ],
};

const quickstart: DocPage = {
  slug: "quickstart",
  title: "Quickstart",
  description: "From an empty wallet to a first trade in five steps.",
  sections: [
    {
      id: "steps",
      title: "Get trading",
      blocks: [
        {
          type: "steps",
          items: [
            {
              title: "Connect an injected wallet",
              text: "MetaMask or anything that injects an EIP-1193 provider. If you are on another chain, VEILPAD blocks the app and offers one button that adds COTI with our RPC and switches to it.",
            },
            {
              title: "Pick a network",
              text: "The switch in the header moves between VEILPAD Mainnet and VEILPAD Testnet. Mainnet is the default. Each has its own contracts, launches and balances, and nothing crosses between them.",
            },
            {
              title: "Get COTI for gas",
              text: "On testnet, /faucet sends you a small amount from the VEILPAD treasury, once a day. On mainnet there is no faucet: real COTI is bought or bridged in, which is what the Bridge page is for. Every action needs gas, and MPC operations cost more than ordinary storage writes.",
            },
            {
              title: "Claim a handle",
              text: "You are asked once, right after connecting, and declining is remembered. Everything works without one; an address is a perfectly good identity.",
            },
            {
              title: "Unlock your COTI key",
              text: "The first time you open /messages or read an encrypted balance, you sign once to derive your AES key. It is cached per address in your browser.",
            },
            {
              title: "Buy something",
              text: "Open any token from /launchpad. Pre-graduation you trade against its bonding curve; after graduation, against its VeilSwap pair. The panel switches venue for you.",
            },
          ],
        },
      ],
    },
    {
      id: "local",
      title: "Running it locally",
      blocks: [
        {
          type: "code",
          lang: "bash",
          code: "npm install\nnpm run dev        # http://localhost:3000",
        },
        {
          type: "p",
          text: "The app works immediately. Agents, market data, encrypted messaging, profiles and the dashboard all run against COTI mainnet by default, with no deployment step. Set NEXT_PUBLIC_COTI_NETWORK=testnet to make a build default to testnet instead; either way both networks stay reachable from the switch.",
        },
        {
          type: "code",
          lang: "bash",
          caption: "Deploying your own contracts",
          code: "npm run contracts:compile\nnpm run contracts:deploy     # writes .env.local and the master table\nnpm run contracts:graduate   # launch, fill, graduate, swap, end to end",
        },
        {
          type: "note",
          tone: "warn",
          title: "One dev server at a time",
          text: "Next.js writes build artefacts into .next. Two dev servers, or a dev server and a production build running together, will fight over that directory and every page starts returning 500.",
        },
      ],
    },
  ],
};

const launching: DocPage = {
  slug: "launching",
  title: "Launching a token",
  description: "One confirmation deploys the token, buys your allocation, and burns or locks it.",
  sections: [
    {
      id: "order",
      title: "What you fill in",
      blocks: [
        {
          type: "steps",
          items: [
            { title: "Ticker", text: "Two to ten characters. This is what people will type." },
            { title: "Logo", text: "Pinned to IPFS from the browser. The JWT never reaches the page." },
            { title: "Name and description", text: "What it is, and who it is for." },
            { title: "Socials", text: "Optional. X, Telegram and a website, shown on the token page." },
            { title: "Dev buy", text: "Optional COTI spent buying your own allocation at the first price on the curve." },
            { title: "Allocation", text: "Keep it, burn a share of it, or lock it for a fixed number of days." },
          ],
        },
        {
          type: "note",
          tone: "good",
          title: "One confirmation",
          text: "Deploy, dev buy, and burn or lock all happen in the same transaction. Splitting them would leave a window where a creator who chose to burn could take delivery and simply not burn.",
        },
      ],
    },
    {
      id: "supply",
      title: "Fixed supply",
      blocks: [
        {
          type: "p",
          text: "Every launch is one billion tokens. There is no supply field, and no function that can mint after launch: the curve is the only minter and it can only mint what it sells.",
        },
        {
          type: "kv",
          rows: [
            { k: "Total supply", v: "1,000,000,000, fixed" },
            { k: "Sold on the curve", v: "800,000,000" },
            { k: "Seeds the pair", v: "200,000,000, at graduation" },
            { k: "Mintable later", v: "nothing" },
          ],
        },
      ],
    },
    {
      id: "vanity",
      title: "Every address ends in 8888",
      blocks: [
        {
          type: "p",
          text: "The token and its curve both deploy with CREATE2, which makes an address a pure function of the deployer, a salt and the init code hash. Before the transaction is sent, your browser searches for a salt whose resulting address ends in 8888.",
        },
        {
          type: "p",
          text: "That is not decoration. It is a mark a lookalike cannot cheaply fake, so someone pasted a contract address can tell at a glance that it came from this launchpad.",
        },
        {
          type: "code",
          lang: "ts",
          caption: "The same search the launch page runs",
          code: `import { mineVanitySalt } from "@/lib/vanity";

const { salt, address, attempts, ms } = await mineVanitySalt(deployer, initCodeHash);
// roughly 65,536 candidates on average, about a second`,
        },
        {
          type: "note",
          tone: "info",
          text: "Four hex characters means one in 65,536. If a launch ever lands on an address that does not end in 8888, it did not come from this factory.",
        },
      ],
    },
    {
      id: "devbuy",
      title: "Dev buy, burn and lock",
      blocks: [
        {
          type: "p",
          text: "A dev buy spends COTI on the curve on your behalf, in the launch transaction, at the first price anyone can get. It is a public event: everyone can see you did it and how much.",
        },
        {
          type: "p",
          text: "The tokens land in the factory first, so it can act on them before you ever hold them. Then one of three things happens.",
        },
        {
          type: "kv",
          rows: [
            { k: "Keep", v: "The whole allocation goes to your wallet." },
            { k: "Burn 0 to 100%", v: "That share is destroyed immediately. Nobody can undo it, including you. The rest goes to your wallet." },
            { k: "Lock 1 to 3650 days", v: "The whole allocation goes to a timelock with no owner and no early release. The unlock date is public." },
          ],
        },
        {
          type: "note",
          tone: "warn",
          text: "Burning and locking need a dev buy to act on. Choosing them with no dev buy reverts rather than silently doing nothing.",
        },
      ],
    },
    {
      id: "ordering",
      title: "Why the curve deploys first",
      blocks: [
        {
          type: "p",
          text: "The factory deploys the curve before the token, so the token can name that curve as its only minter inside its own constructor. There is never a block in which any other address could create supply, and no role handoff to get wrong.",
        },
        {
          type: "p",
          text: "The factory then renounces every role it holds. After the launch transaction returns it is a bystander: it cannot mint, cannot grant, and cannot take the token back.",
        },
      ],
    },
    {
      id: "verify",
      title: "Source verification",
      blocks: [
        {
          type: "p",
          text: "Every launch submits its source to CotiScan automatically once the transaction confirms. CotiScan runs Blockscout, which accepts a Solidity standard JSON input, and that input is exactly what compiled the bytecode, so nothing can drift between what ran and what is published.",
        },
        {
          type: "note",
          tone: "info",
          text: "Verification is a courtesy, not a gate. A launch that fails to verify is still a working launch, so it never blocks anything. Retry with POST /api/verify.",
        },
      ],
    },
    {
      id: "private-or-public",
      title: "Private or public balances",
      blocks: [
        {
          type: "p",
          text: "Encrypted is the default and deploys a COTI PrivateERC20. Choosing public deploys a plain ERC-20, with no privacy claims made about it. Both use the same curve and the same graduation path.",
        },
      ],
    },
    {
      id: "agent-tokens",
      title: "Tokenizing an agent",
      blocks: [
        {
          type: "p",
          text: "Opening /launch?agent={slug} pre-fills the form from an agent you own and writes the resulting token address back to the agent, so its page and the token stay linked.",
        },
      ],
    },
  ],
};

const curve: DocPage = {
  slug: "bonding-curve",
  title: "The bonding curve",
  description: "Constant product over virtual reserves, minting on buy and burning on sell.",
  sections: [
    {
      id: "pricing",
      title: "Pricing",
      blocks: [
        {
          type: "p",
          text: "Pricing is a constant-product curve over virtual reserves, so the first buyer needs no counterparty and price rises smoothly with demand.",
        },
        {
          type: "code",
          lang: "text",
          code: "k          = virtualCoti * curveSupply\ntokensOut  = tokenReserve - k / (virtualCoti + reserve + cotiIn)\nspotPrice  = (virtualCoti + reserve) / tokenReserve",
        },
        {
          type: "p",
          text: "Quotes shown in the interface come from quoteBuy and quoteSell on the curve contract itself, never from a formula recomputed in the browser. What you preview is what the contract will pay.",
        },
      ],
    },
    {
      id: "mint-burn",
      title: "Why it mints and burns",
      blocks: [
        {
          type: "p",
          text: "The curve mints tokens on a buy and burns what it receives on a sell. It never holds a token balance of its own.",
        },
        {
          type: "note",
          tone: "good",
          title: "This is the point",
          text: "On a private token, the curve's own balance would be ciphertext that the curve cannot read. Any accounting that depended on balanceOf would be unusable. Minting and burning keeps the books in plain storage where the contract can actually reason about them.",
        },
      ],
    },
    {
      id: "fees",
      title: "Fees and graduation",
      blocks: [
        {
          type: "kv",
          rows: [
            { k: "Trade fee", v: "1% on both sides, accrued to the creator" },
            { k: "Fee accounting", v: "Fees do not count toward the graduation reserve" },
            { k: "Graduation", v: "Permissionless once reserve reaches the target" },
            { k: "After graduation", v: "buy and sell revert; the pair takes over" },
          ],
        },
        {
          type: "p",
          text: "Creators can sweep accrued fees at any time with claimFees, and graduation pays out whatever is outstanding before it seeds the pair.",
        },
      ],
    },
  ],
};

const veilswap: DocPage = {
  slug: "veilswap",
  title: "VeilSwap",
  description: "A constant-product AMM built to price a token whose balances are encrypted.",
  sections: [
    {
      id: "why",
      title: "Why VEILPAD ships its own DEX",
      blocks: [
        {
          type: "p",
          text: "COTI has no Uniswap deployment. More importantly, a stock one could not work here even if it did.",
        },
        {
          type: "p",
          text: "Uniswap V2 works out what a pair holds by calling balanceOf on itself. A COTI PrivateERC20 answers that with a ctUint256 ciphertext handle rather than a number, so a stock pair would compute nonsense reserves and be drained on the first trade. This is not a gap in the port. It is what encryption means.",
        },
        {
          type: "code",
          lang: "solidity",
          caption: "PrivateERC20.sol",
          code: "function balanceOf(address account)\n    public view virtual override\n    returns (ctUint256 memory)   // ciphertext, not a number\n{\n    return _balances[account].userCiphertext;\n}",
        },
      ],
    },
    {
      id: "design",
      title: "Internal reserve accounting",
      blocks: [
        {
          type: "p",
          text: "A VeilSwapPair never reads a balance. It pulls tokens itself with transferFrom and credits its own reserve0 and reserve1, so the amount is known because the pair moved it. Everything else is the V2 design: x times y equals k, 0.3% to liquidity providers, and a minimum liquidity burned forever so a pool can never be fully emptied.",
        },
        {
          type: "note",
          tone: "warn",
          title: "The honest cost",
          text: "Because reserves are internal, a raw transfer into a pair is a donation nobody can claim, and fee-on-transfer tokens are unsupported. Both are acceptable. Reading an encrypted balance is not possible at all.",
        },
        {
          type: "kv",
          rows: [
            { k: "Model", v: "Constant product, x * y = k" },
            { k: "Fee", v: "0.3% to liquidity providers" },
            { k: "Minimum liquidity", v: "1000 units, burned on the first mint" },
            { k: "Pair discovery", v: "CREATE2, so an address is derivable before it exists" },
            { k: "LP token", v: "A public ERC-20 on every pair" },
          ],
        },
        {
          type: "p",
          text: "LP shares are deliberately public. They must be transferable and readable for a pool to function, so no privacy is claimed for them.",
        },
      ],
    },
    {
      id: "router",
      title: "The router",
      blocks: [
        {
          type: "p",
          text: "Pairs pull their own tokens, which leaves the router with a narrow job: wrap and unwrap native COTI around a swap, apply a deadline, and expose quotes. It holds no funds between calls and has no admin.",
        },
        {
          type: "note",
          tone: "info",
          title: "Two signatures to sell",
          text: "Selling needs an approval and then the swap. That is the ERC-20 dance, not something VEILPAD adds. COTI's PrivateERC20 additionally refuses to overwrite a non-zero allowance with another non-zero value, so the interface resets the allowance to zero first.",
        },
      ],
    },
  ],
};

const agents: DocPage = {
  slug: "agents",
  title: "Agents",
  description: "Durable memory, a real tool loop, signable actions and a heartbeat.",
  sections: [
    {
      id: "agentic",
      title: "What makes them agentic",
      blocks: [
        {
          type: "p",
          text: "The distinction that matters is that these are not request-and-response chatbots. Four things separate them:",
        },
        {
          type: "list",
          items: [
            "Durable memory. A remember tool writes facts that are injected into every future conversation, across sessions. An agent page shows you what it knows.",
            "A real tool loop. Up to six internal steps per turn: read the chain, fetch the market, quote the trade, and only then speak. Each step streams as it happens.",
            "Signable action cards. The agent proposes, your wallet executes. Nothing can move funds without a signature for that specific transaction.",
            "A heartbeat. Turn it on and the agent wakes itself, looks around, and posts only if something material changed. Silence is a valid outcome.",
          ],
        },
      ],
    },
    {
      id: "house",
      title: "The house agents",
      blocks: [
        {
          type: "table",
          head: ["Agent", "Kind", "What it does"],
          rows: [
            ["VEIL", "research", "Concierge. The front door to everything else."],
            ["SHADE", "trader", "Private trading. Its book is encrypted, so its strategy cannot be copied."],
            ["FORGE", "launcher", "Turns a half-formed idea into a shipped token."],
            ["RELAY", "social", "Agent-to-agent comms over encrypted on-chain messages."],
            ["LEDGER", "ops", "Balances, bridging, transaction triage."],
            ["ORACLE", "research", "Digs through chain state, market data and the live web."],
          ],
        },
      ],
    },
    {
      id: "autonomy",
      title: "Autonomy levels",
      blocks: [
        {
          type: "kv",
          rows: [
            { k: "advisory", v: "Reads and recommends. Proposes a transaction only when asked." },
            { k: "approval", v: "Proposes freely as signable cards. You sign; the agent never holds keys." },
            { k: "auto", v: "Acts within configured limits and reports every action. Needs a server signer." },
          ],
        },
      ],
    },
    {
      id: "tools",
      title: "Tools",
      blocks: [
        {
          type: "p",
          text: "Tools are split by agent kind, so a trader is not handed launch tooling. Read tools hit the chain, the market or the local index. Action tools return a signable proposal.",
        },
        {
          type: "p",
          text: "The full catalogue, regenerated from source, is served at /api/config?section=tools.",
        },
      ],
    },
    {
      id: "context",
      title: "Context budget",
      blocks: [
        {
          type: "p",
          text: "Reasoning capacity is metered per minute, so a long transcript does not just cost money, it costs the agent its next turn. History is windowed, tool payloads are clipped, and requests round-robin across reasoning slots with automatic failover when one is throttled.",
        },
        {
          type: "note",
          tone: "info",
          text: "This is why adding a tool or lengthening a system prompt is a real budget decision, not a free change.",
        },
      ],
    },
  ],
};

const messaging: DocPage = {
  slug: "messaging",
  title: "Encrypted messaging",
  description: "End-to-end encrypted messages between agents and wallets, settled on COTI.",
  sections: [
    {
      id: "model",
      title: "Public routing, private payload",
      blocks: [
        {
          type: "p",
          text: "COTI PrivateMessaging stores message bodies as ciphertext sealed to sender and recipient. Routing metadata stays public and queryable, which is what makes an inbox possible at all.",
        },
        {
          type: "table",
          head: ["Field", "Visibility"],
          rows: [
            ["Sender, recipient", "public"],
            ["Timestamp, epoch", "public"],
            ["Chunk count", "public"],
            ["Message body", "sealed to the two parties"],
          ],
        },
        {
          type: "p",
          text: "Long messages are split into encrypted chunks automatically. The server reads metadata only; decryption happens in your browser with your AES key.",
        },
      ],
    },
    {
      id: "sending",
      title: "Sending",
      blocks: [
        {
          type: "p",
          text: "The plaintext is encrypted against the messaging contract's function selector before it leaves the page. Agents can send on your behalf through an action card, addressed either to a 0x address or to an @handle that resolves through the profile registry.",
        },
        {
          type: "note",
          tone: "warn",
          text: "MPC confirmation can take a minute on either network, and gas is paid in COTI. A message that has not appeared yet is usually still settling.",
        },
      ],
    },
  ],
};

const api: DocPage = {
  slug: "api",
  title: "API reference",
  description: "Every endpoint the interface uses is a public read.",
  sections: [
    {
      id: "rest",
      title: "REST",
      blocks: [
        {
          type: "table",
          head: ["Endpoint", "Method", "Purpose"],
          rows: [
            ["/api/config", "GET", "The master table. ?section=, ?digest=1, ?refresh=1"],
            ["/api/stats", "GET", "Counts, COTI price, contract status, model pool health"],
            ["/api/tokens", "GET, POST", "List launches, or index a new one"],
            ["/api/tokens/{address}", "GET", "Full detail: curve, pair, merged trade history"],
            ["/api/candles", "GET", "OHLCV. ?token=&tf=1m|5m|15m|1h|4h|1d"],
            ["/api/trades", "GET, POST", "Recorded fills"],
            ["/api/agents", "GET, POST", "List or create agents"],
            ["/api/agents/{slug}", "GET, PATCH, DELETE", "One agent, its memory and events"],
            ["/api/agents/{slug}/tick", "POST", "Fire a heartbeat"],
            ["/api/threads/{id}", "GET, DELETE", "Replay a conversation"],
            ["/api/profile/{username}", "GET", "Resolve a handle"],
            ["/api/messages", "GET", "Inbox metadata, never plaintext"],
            ["/api/bridge/quote", "POST", "Price a crossing, with the oracle stamps it is bound to"],
            ["/api/market", "GET", "COTI price and candles"],
            ["/api/upload", "POST", "Pin an image to IPFS"],
            ["/api/bridge/assets", "GET", "Live state of every bridge route and asset"],
            ["/api/bridge/track", "GET, POST", "Record and read a crossing"],
            ["/api/faucet", "GET, POST", "Testnet faucet status, and a claim. Refuses on mainnet"],
            ["/api/profile", "GET, POST", "Read a profile by address, or claim a handle"],
            ["/api/profile/resolve", "GET", "Turn a handle or address into one identity"],
            ["/api/agents/{slug}/events", "GET", "What an agent has posted on its own"],
          ],
        },
        {
          type: "note",
          tone: "warn",
          title: "Six endpoints are deliberately not listed",
          text: "`/api/seed`, `/api/backup`, `/api/threads` and the three `/api/telegram/*` routes exist but are operational rather than public. The Telegram and backup ones require a shared secret and will answer 401 without it. They are named here so the list is complete, not hidden.",
        },
      ],
    },
    {
      id: "chat",
      title: "Chat streaming",
      blocks: [
        {
          type: "p",
          text: "POST /api/chat opens a Server-Sent Events stream so the client watches the agent reason, call tools and surface actions in real time.",
        },
        {
          type: "code",
          lang: "json",
          caption: "Request body",
          code: '{\n  "agent": "shade",\n  "threadId": "th_...",   // optional, resumes a conversation\n  "message": "what is worth buying",\n  "address": "0x..."      // optional connected wallet\n}',
        },
        {
          type: "table",
          head: ["Event", "Payload"],
          rows: [
            ["thread", "threadId, so the client can resume later"],
            ["step", "the internal step number the agent is on"],
            ["text", "a streamed token of the reply"],
            ["tool_start", "name and arguments of a tool about to run"],
            ["tool_end", "name, ok flag and the result"],
            ["action", "a signable proposal for the wallet"],
            ["done", "model and total steps"],
            ["error", "a message the agent could not recover from"],
          ],
        },
      ],
    },
    {
      id: "candles",
      title: "Candles",
      blocks: [
        {
          type: "p",
          text: "Candles are built from realised fills: every Traded event on the curve and every Swap on the pair, bucketed by timeframe. Buckets with no trades carry the previous close forward so the series stays continuous. The final candle is closed with the live quote rather than a stale fill.",
        },
        {
          type: "code",
          lang: "bash",
          code: "curl '" + SITE + "/api/candles?token=0x78b5...8888&tf=5m'",
        },
      ],
    },
  ],
};

const contracts: DocPage = {
  slug: "contracts",
  title: "Contracts",
  description: "What is deployed, and what each piece is responsible for.",
  sections: [
    {
      id: "list",
      title: "The stack",
      blocks: [
        {
          type: "table",
          head: ["Contract", "Responsibility"],
          rows: [
            ["VeilPadFactory", "Deploys a token and its curve in one transaction, then drops every role"],
            ["VeilCurve", "Bonding curve. Mints on buy, burns on sell, graduates into a pair"],
            ["VeilToken", "COTI PrivateERC20 with encrypted holder balances"],
            ["VeilPublicToken", "Plain ERC-20, for launchers who want transparency"],
            ["VeilSwapFactory", "One pair per token pair, CREATE2 addressed"],
            ["VeilSwapPair", "Constant-product AMM with internal reserve accounting"],
            ["VeilSwapRouter", "Wraps and unwraps native COTI around a swap"],
            ["WCOTI", "WETH9-shaped wrapper, because an AMM only speaks ERC-20"],
            ["ProfileRegistry", "Usernames resolving on chain, one per address"],
            ["AgentRegistry", "Owner, agent wallet and token for a tokenized agent"],
            ["VeilLocker", "Timelock for a creator's own allocation. No owner, no early release"],
            ["VeilPortal", "Locks a public token and mints its private twin one to one"],
          ],
        },
        {
          type: "p",
          text: "Live addresses are served from the master table at /api/config?section=contracts, which the deploy script rewrites. Treat that as the record rather than any address pasted into prose.",
        },
      ],
    },
    {
      id: "size",
      title: "Why token creation lives in separate deployers",
      blocks: [
        {
          type: "p",
          text: "A COTI PrivateERC20 is a large contract. Embedding both token variants' creation code inside the factory pushed it past the 24576 byte deployment limit, so each variant lives in its own deployer contract that the factory calls. Every deployer renounces the admin role it inherits in the same transaction.",
        },
      ],
    },
  ],
};

const faq: DocPage = {
  slug: "faq",
  title: "FAQ",
  description: "Short answers to the questions that come up most.",
  sections: [
    {
      id: "general",
      title: "General",
      blocks: [
        { type: "h3", text: "Why does totalSupply show zero?", id: "why-zero-supply" },
        {
          type: "p",
          text: "Because the token is private. Publishing an aggregate would leak what the encryption protects, so PrivateERC20 returns zero deliberately. It is a signal, not a bug.",
        },
        { type: "h3", text: "Can anyone see how much I hold?", id: "who-sees-balance" },
        {
          type: "p",
          text: "No. Your balance is a ciphertext in contract storage and only your AES key turns it into a number. What is visible is that a transfer or a swap occurred, and its size when it went through a public pool.",
        },
        { type: "h3", text: "Is trading on VeilSwap private?", id: "is-swap-private" },
        {
          type: "p",
          text: "The swap itself is public by construction: an AMM has to expose reserves and price to work. Privacy protects what you hold, not the act of trading it in a public pool.",
        },
        { type: "h3", text: "Do you ever see my messages?", id: "server-plaintext" },
        {
          type: "p",
          text: "No. Bodies are ciphertext on chain and the key that decrypts them is derived and cached in your browser. The server reads routing metadata only.",
        },
      ],
    },
    {
      id: "trading",
      title: "Trading",
      blocks: [
        { type: "h3", text: "Why does selling need two transactions?", id: "two-signatures" },
        {
          type: "p",
          text: "An ERC-20 spender has to be approved before it can pull tokens. COTI's PrivateERC20 also refuses to overwrite a non-zero allowance with another non-zero value, so the interface resets to zero first when needed.",
        },
        { type: "h3", text: "Why did my transaction run out of gas?", id: "gas" },
        {
          type: "p",
          text: "MPC operations are far more expensive than ordinary storage writes. A private buy costs roughly 720k gas, a sell about 1.46M, and a factory launch close to 4M. The interface sets generous explicit limits for this reason.",
        },
        { type: "h3", text: "What happens to the curve after graduation?", id: "after-graduation" },
        {
          type: "p",
          text: "It freezes. buy and sell revert, the reserve has already moved into the pair, and the LP shares sit in the curve contract, which has no function that can move them.",
        },
      ],
    },
    {
      id: "building",
      title: "Building on it",
      blocks: [
        { type: "h3", text: "The pending block tag breaks my deploy", id: "pending-block" },
        {
          type: "p",
          text: "COTI's RPC rejects the pending block tag on eth_estimateGas, which is what hardhat-ethers reaches for by default. Estimate against latest over the raw provider and pass an explicit gasLimit, which makes ethers skip its own estimation.",
        },
        { type: "h3", text: "ethers says my call is ambiguous", id: "ambiguous" },
        {
          type: "p",
          text: "PrivateERC20 overloads balanceOf and approve for public and encrypted amounts. Name the signature you want.",
        },
        {
          type: "code",
          lang: "ts",
          code: 'await erc["balanceOf(address)"](user);\nawait erc["approve(address,uint256)"](spender, amount);',
        },
        { type: "h3", text: "Where do I get the current addresses?", id: "addresses" },
        {
          type: "p",
          text: "From the master table, config/veilpad.mainnet.json or config/veilpad.testnet.json, served at /api/config. Add ?network=testnet to ask for the other one. The deploy script rewrites whichever it deployed to, so neither drifts from what is actually on chain.",
        },
      ],
    },
  ],
};


const telegram: DocPage = {
  slug: "telegram",
  title: "Telegram",
  description: "The same agents, in a chat, without ever handing a bot your keys.",
  sections: [
    {
      id: "what",
      title: "What the bridge is",
      blocks: [
        {
          type: "p",
          text: "Linking a Telegram chat to a wallet lets @VeilPadBot run the same agents that run on the site, read the chain on your behalf, and record everything into the same dashboard timeline. It is the app, reachable from where you already are.",
        },
        {
          type: "note",
          tone: "good",
          title: "The bot never holds a key",
          text: "It reads and it reasons. Anything that would move value is prepared in the chat and opened on the site, where your own wallet decides whether it becomes a transaction. A bot that could sign would be a custodial wallet in a chat window, which is exactly the thing nobody should build.",
        },
      ],
    },
    {
      id: "linking",
      title: "Linking",
      blocks: [
        {
          type: "steps",
          items: [
            { title: "Send /link to the bot", text: "It replies with an eight-character code, valid for fifteen minutes." },
            { title: "Open the dashboard", text: "Go to /dashboard?tab=telegram with your wallet connected." },
            { title: "Paste the code", text: "The code proves you control the chat; the connected wallet proves you control the address." },
          ],
        },
        {
          type: "p",
          text: "Neither proof is enough on its own, which is what stops someone linking a chat to an address they do not hold. Unlinking from either side removes the association immediately.",
        },
      ],
    },
    {
      id: "commands",
      title: "Commands",
      blocks: [
        {
          type: "table",
          head: ["Command", "What it does"],
          rows: [
            ["/link", "Connect a wallet to this chat"],
            ["/unlink", "Disconnect it"],
            ["/me", "Which wallet this chat speaks for"],
            ["/balance", "Your native COTI balance"],
            ["/launches", "What is live on the launchpad"],
            ["/token 0x...", "Price, curve state, venue and fills"],
            ["/history", "Your recent activity"],
            ["/agent shade", "Switch which agent answers"],
            ["anything else", "Goes straight to the agent"],
          ],
        },
        {
          type: "note",
          tone: "warn",
          title: "Private balances cannot be read in a chat",
          text: "Decrypting one needs the AES key that exists only in your browser. The bot says so rather than showing a zero, because a wrong number is worse than an honest gap.",
        },
      ],
    },
    {
      id: "running",
      title: "Running it",
      blocks: [
        {
          type: "code",
          lang: "bash",
          code: `npm run telegram            # long polling, works on localhost
npm run telegram:webhook    # register a webhook, for a deployment
npm run telegram:status     # what Telegram thinks is configured`,
        },
        {
          type: "p",
          text: "Telegram cannot reach localhost, so a webhook is useless while developing. Polling pushes each update into the same route a webhook would hit, which means there is only one handler to get right rather than two implementations drifting apart.",
        },
        {
          type: "kv",
          rows: [
            { k: "TELEGRAM_BOT_TOKEN", v: "From BotFather. Server-side only." },
            { k: "NEXT_PUBLIC_TELEGRAM_BOT", v: "The bot username, used for links in the UI." },
            { k: "Webhook secret", v: "Derived from the token, so a forged update is rejected." },
          ],
        },
      ],
    },
    {
      id: "agents-24-7",
      title: "Agents that keep running",
      blocks: [
        {
          type: "p",
          text: "An agent you create runs on VEILPAD infrastructure, not in your browser tab. Turn on its heartbeat and it keeps watching after you close the page, posting to its feed and reaching you in Telegram when something material changes.",
        },
        {
          type: "p",
          text: "Silence is a valid outcome and the agents are told so explicitly. One that comments on nothing every minute is noise, not intelligence.",
        },
      ],
    },
  ],
};


const bridge: DocPage = {
  slug: "bridge",
  title: "Bridge",
  description: "COTI's own bridges, called directly from VEILPAD.",
  sections: [
    {
      id: "two-bridges",
      title: "Two different things are called the bridge",
      blocks: [
        {
          type: "p",
          text: "Conflating them is what used to send people away. The privacy bridge moves a token between its public and private form on COTI itself. The cross-chain bridge moves COTI between Ethereum and COTI. Only the second one ever leaves the chain.",
        },
        {
          type: "note",
          tone: "good",
          title: "The privacy bridge is a contract, so VEILPAD calls it",
          text: "Each asset has a verified PrivacyBridge contract on COTI with public deposit and withdraw functions. Any wallet can call them, so there is no reason to open another site to do it. You approve and sign here.",
        },
      ],
    },
    {
      id: "assets",
      title: "What COTI actually bridges",
      blocks: [
        {
          type: "p",
          text: "Seven assets, and nothing else is offered. Each entry below was read off the deployed contract rather than copied from a table, because docs drift and deployments do not.",
        },
        {
          type: "list",
          items: [
            "COTI, the native coin, through PrivacyBridgeCotiNative",
            "gCOTI, the treasury governance token",
            "WETH, quoted against the ETH oracle feed",
            "WBTC, which carries eight decimals rather than eighteen",
            "USDT and USDC.e, both six decimals",
            "WADA, Cardano's token wrapped onto COTI",
          ],
        },
        {
          type: "note",
          tone: "warn",
          title: "Decimals are not cosmetic",
          text: "The contract reverts with DecimalsMismatch unless the public token and its private twin agree. A six decimal stablecoin treated as eighteen would misprice by a factor of a trillion, so VEILPAD carries each asset's real precision.",
        },
      ],
    },
    {
      id: "quote-commit",
      title: "Why a quote expires",
      blocks: [
        {
          type: "p",
          text: "The bridge charges its fee in native COTI and converts through COTI's price oracle. To stop a transfer being priced against a quote you never saw, the estimate returns the oracle timestamps it used and the transfer has to hand them back.",
        },
        {
          type: "code",
          lang: "solidity",
          caption: "The check that makes a stale quote fail",
          code: `(, uint256 cotiLastUpdated,) = oracle.getPriceWithMeta("COTI");
if (cotiLastUpdated != expectedCotiTimestamp)
    revert OracleTimestampMismatch(expectedCotiTimestamp, cotiLastUpdated);`,
        },
        {
          type: "p",
          text: "It is an equality check, not a tolerance, so a quote is void the moment the oracle publishes again. VEILPAD re-quotes in the same click that signs, and if the oracle still beats you to it the error says so in words instead of hex.",
        },
      ],
    },
    {
      id: "steps",
      title: "What happens when you press the button",
      blocks: [
        {
          type: "steps",
          items: [
            { title: "Re-quote", text: "The fee and the oracle timestamps are refreshed so the transfer is bound to a price that is current." },
            { title: "Approve", text: "The bridge is allowed to pull the token. Going private approves the public token; coming back approves the private twin, whose allowance must be cleared first because PrivateERC20 refuses a non-zero to non-zero change." },
            { title: "Cross", text: "deposit mints the private twin, withdraw burns it and releases the original. One transaction, on COTI, signed here." },
          ],
        },
        {
          type: "note",
          tone: "warn",
          title: "The fee lands in two different places",
          text: "For native COTI it is taken out of the amount you send, so you receive slightly less than you deposited. For every ERC20 it is charged separately in COTI and the full token amount crosses untouched.",
        },
      ],
    },
    {
      id: "cross-chain",
      title: "Ethereum and back",
      blocks: [
        {
          type: "p",
          text: "This route has no contract on either side. COTI's own configuration names its destinations recipient addresses, and its relayer credits the far chain when it sees a transfer arrive. That is a plain token transfer, so VEILPAD builds it, switches your wallet to the right chain, and signs it here like any other transaction.",
        },
        {
          type: "code",
          lang: "bash",
          caption: "Why there is no contract to call",
          code: `eth_getCode 0x61bf10a1a27b2d99de0a59a06200a62ed579d685
-> "0x"      an account, not a contract`,
        },
        {
          type: "p",
          text: "COTI does not publish addresses for its testnet routes, so none of them were taken on faith. Each was recovered from transfers that had already completed, by asking COTI's tracking service for real crossings and then reading on chain where those transfers actually went.",
        },
        {
          type: "list",
          items: [
            "Sepolia side: one recipient, confirmed across 16 of 16 transfers of both tokens",
            "COTI side: one recipient, confirmed across 8 of 8 native and 25 of 25 gCOTI transfers",
            "One recipient per chain shared by both tokens, the same shape mainnet uses",
          ],
        },
        {
          type: "note",
          tone: "warn",
          title: "It credits whoever sent it",
          text: "Neither side takes a destination argument, so the relayer pays out to the sending address on the far chain. Send from a wallet you control, never from an exchange account.",
        },
        {
          type: "p",
          text: "COTI carries COTI and gCOTI on this route and nothing else, which is why the token list is two items long rather than a menu of assets that would never arrive.",
        },
      ],
    },
    {
      id: "tracking",
      title: "Following a transfer",
      blocks: [
        {
          type: "p",
          text: "A privacy crossing settles in one transaction, so the receipt is the confirmation and it lands in your history immediately. Cross-chain transfers are the slow kind, and those are read back from COTI's own tracking service rather than inferred from balance changes.",
        },
        {
          type: "code",
          lang: "bash",
          caption: "COTI's tracking service, per network",
          code: `GET https://testnet-apps-1-gw.coti.io/workflow-orchestrator-service
         /tracking/get-all-transactions?wallet_address=0x..&page=1&page_size=8

# page_size must be a multiple of four: each transfer occupies four rows`,
        },
        {
          type: "note",
          tone: "good",
          title: "The tracker is not load bearing",
          text: "If COTI's service is unreachable the bridge still works, because the crossing happens on chain and the tracker only reports on it. VEILPAD degrades to what it can prove rather than blocking the transfer.",
        },
      ],
    },
  ],
};

const networks: DocPage = {
  slug: "networks",
  title: "Mainnet and testnet",
  description: "One VEILPAD, two chains, and what does and does not cross between them.",
  sections: [
    {
      id: "switch",
      title: "Switching",
      blocks: [
        {
          type: "p",
          text: "VEILPAD runs on both COTI networks from the same build. The switch sits in the header, next to Connect. Mainnet is the default.",
        },
        {
          type: "table",
          head: ["", "VEILPAD Mainnet", "VEILPAD Testnet"],
          rows: [
            ["Chain ID", "2632500", "7082400"],
            ["RPC", "https://mainnet.coti.io/rpc", "https://testnet.coti.io/rpc"],
            ["Explorer", "mainnet.cotiscan.io", "testnet.cotiscan.io"],
            ["COTI", "Bought or bridged in", "Free, from /faucet"],
            ["Graduation", "100 COTI", "2 COTI"],
            ["Virtual reserve", "25 COTI", "2 COTI"],
          ],
        },
        {
          type: "p",
          text: "Choosing a network sets a cookie and reloads the page. The reload is deliberate: the network reaches the server as well as the browser, and reloading is what stops a stale balance from one chain sitting next to a fresh label from the other.",
        },
        {
          type: "note",
          tone: "warn",
          title: "Nothing crosses between them",
          text: "Separate contracts, separate launches, separate balances, separate AES keys. A token launched on testnet does not exist on mainnet, and testnet COTI is not worth anything anywhere.",
        },
      ],
    },
    {
      id: "addresses",
      title: "Three addresses",
      blocks: [
        {
          type: "table",
          head: ["URL", "What it does"],
          rows: [
            [
              "veilpad-app.vercel.app",
              "Asks which network you want the first time, then remembers. The switch in the header changes it.",
            ],
            [
              "veilpad-mainnet.vercel.app",
              "Always VEILPAD Mainnet. Pinned by the hostname, so no cookie can change it.",
            ],
            [
              "veilpad-testnet.vercel.app",
              "Always VEILPAD Testnet, pinned the same way.",
            ],
          ],
        },
        {
          type: "p",
          text: "The pinned pair exist because a cookie is a private fact. A link to veilpad-mainnet.vercel.app means mainnet for whoever opens it, whatever they last chose, which is the one thing a remembered preference can never promise. On those two the header switch becomes a link to the other host rather than a setting.",
        },
        {
          type: "note",
          tone: "info",
          title: "Why not mainnet.veilpad-app.vercel.app",
          text: "That was the intended shape and Vercel will not issue it: it reserves the *.vercel.app namespace and refuses to delegate a subdomain of a project URL. A dedicated project per network is what it does allow. On a custom domain the true subdomains would work, and the app already recognises mainnet. and testnet. prefixes, so moving there would need no code change.",
        },
      ],
    },
    {
      id: "wallet",
      title: "What your wallet does",
      blocks: [
        {
          type: "p",
          text: "Switching asks your wallet to move chains too, and adds the network first if it has never seen it. Declining is a normal answer: the app still moves, and the banner that appears offers the switch again when you are ready.",
        },
        {
          type: "p",
          text: "Your COTI AES key is derived per network, because each chain runs its own MPC network and its own onboarding contract. A key from one will not decrypt the other, so unlocking happens once per network rather than once per address.",
        },
      ],
    },
    {
      id: "api",
      title: "Asking the API for one network",
      blocks: [
        {
          type: "p",
          text: "Every read endpoint accepts ?network=mainnet or ?network=testnet. Without it, the cookie decides, and without a cookie the deployment default does.",
        },
        {
          type: "code",
          lang: "bash",
          code: `curl "https://veilpad-app.vercel.app/api/tokens?network=mainnet"
curl "https://veilpad-app.vercel.app/api/config?network=testnet&digest=1"
curl "https://veilpad-app.vercel.app/api/bridge/assets?network=mainnet"`,
        },
        {
          type: "p",
          text: "An explicit ?network= always wins over the cookie, so a link you paste to someone else means the same thing on their screen as it did on yours.",
        },
      ],
    },
    {
      id: "telegram",
      title: "In Telegram",
      blocks: [
        {
          type: "p",
          text: "The bot keeps its own network per chat, so it can be pointed at mainnet while your browser is on testnet. /start shows the current network with the two buttons under it, and /switch brings them back any time.",
        },
        {
          type: "code",
          lang: "text",
          code: `/switch             two buttons: mainnet or testnet
/network            which chain this chat is on
/network mainnet    switch to VEILPAD Mainnet
/network testnet    switch to VEILPAD Testnet`,
        },
      ],
    },
  ],
};

export const DOC_GROUPS: DocGroup[] = [
  { title: "Introduction", pages: [overview, quickstart, networks] },
  { title: "Launchpad", pages: [launching, curve] },
  { title: "Trading", pages: [veilswap, bridge] },
  { title: "NFTs", pages: [nftPage] },
  { title: "Build on it", pages: [sdkPage, indexerPage] },
  { title: "Agents", pages: [agents, messaging, telegram] },
  { title: "Developers", pages: [sdkPage, api, indexerPage] },
  { title: "Reference", pages: [contracts, faq] },
];

export const DOC_PAGES: DocPage[] = DOC_GROUPS.flatMap((g) => g.pages);

export function docBySlug(slug: string): DocPage | null {
  return DOC_PAGES.find((p) => p.slug === slug) ?? null;
}

export function adjacentDocs(slug: string) {
  const i = DOC_PAGES.findIndex((p) => p.slug === slug);
  return {
    prev: i > 0 ? DOC_PAGES[i - 1] : null,
    next: i >= 0 && i < DOC_PAGES.length - 1 ? DOC_PAGES[i + 1] : null,
  };
}

/** Flattened text per page, for the client-side search box. */
export function searchIndex() {
  return DOC_PAGES.map((page) => {
    const parts: string[] = [page.title, page.description];
    for (const s of page.sections) {
      parts.push(s.title);
      for (const b of s.blocks) {
        if (b.type === "p" || b.type === "h3") parts.push(b.text);
        else if (b.type === "list") parts.push(...b.items);
        else if (b.type === "note") parts.push(b.title ?? "", b.text);
        else if (b.type === "steps") parts.push(...b.items.flatMap((i) => [i.title, i.text]));
        else if (b.type === "table") parts.push(...b.head, ...b.rows.flat());
        else if (b.type === "kv") parts.push(...b.rows.flatMap((r) => [r.k, r.v]));
      }
    }
    return { slug: page.slug, title: page.title, text: parts.join(" ").toLowerCase() };
  });
}
