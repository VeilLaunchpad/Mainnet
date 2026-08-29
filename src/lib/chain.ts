import { defineChain } from "viem";
import { mainnet, sepolia } from "viem/chains";

/**
 * COTI v2 - a privacy-preserving EVM L2 where confidentiality comes from
 * garbled circuits executed by an MPC network, not from ZK proofs.
 * Balances/messages live on-chain as ciphertext; only key-holders can read them.
 */
/**
 * Multicall3, at the address it has on nearly every EVM chain.
 *
 * COTI does have it deployed; viem simply refuses to batch unless a chain
 * declares it, so without this every page fans out into one RPC round trip per
 * read. Verified with eth_getCode on both networks rather than assumed from the
 * address being canonical.
 */
const MULTICALL3 = {
  multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" as const },
};

export const cotiMainnet = defineChain({
  id: 2632500,
  name: "COTI",
  nativeCurrency: { name: "COTI", symbol: "COTI", decimals: 18 },
  rpcUrls: {
    default: {
      http: [process.env.NEXT_PUBLIC_COTI_MAINNET_RPC || "https://mainnet.coti.io/rpc"],
      webSocket: [process.env.NEXT_PUBLIC_COTI_MAINNET_WS || "wss://mainnet.coti.io/ws"],
    },
  },
  blockExplorers: {
    default: { name: "CotiScan", url: "https://mainnet.cotiscan.io" },
  },
  contracts: MULTICALL3,
  testnet: false,
});

export const cotiTestnet = defineChain({
  id: 7082400,
  name: "COTI Testnet",
  nativeCurrency: { name: "COTI", symbol: "COTI", decimals: 18 },
  rpcUrls: {
    default: {
      http: [process.env.NEXT_PUBLIC_COTI_TESTNET_RPC || "https://testnet.coti.io/rpc"],
      webSocket: [process.env.NEXT_PUBLIC_COTI_TESTNET_WS || "wss://testnet.coti.io/ws"],
    },
  },
  blockExplorers: {
    default: { name: "CotiScan", url: "https://testnet.cotiscan.io" },
  },
  contracts: MULTICALL3,
  testnet: true,
});

/**
 * The Ethereum side of COTI's cross-chain bridge. Sepolia pairs with COTI
 * testnet and Ethereum with COTI mainnet, so the two always move together and
 * a wallet is never asked to switch to a chain the route does not use.
 */
export const ethSide = { mainnet, testnet: sepolia } as const;

export type CotiNetworkName = "mainnet" | "testnet";

export function isNetworkName(value: unknown): value is CotiNetworkName {
  return value === "mainnet" || value === "testnet";
}

export const chainByNetwork = { mainnet: cotiMainnet, testnet: cotiTestnet } as const;

/** Either COTI chain, for code that is handed whichever one is selected. */
export type CotiChain = (typeof chainByNetwork)[CotiNetworkName];

/**
 * What each network is called in the interface.
 *
 * Both are VEILPAD; only the chain underneath differs. Naming them after the
 * app rather than after COTI is what makes the switch read as one product on
 * two chains instead of two separate deployments.
 */
export const NETWORK_LABEL: Record<CotiNetworkName, string> = {
  mainnet: "VEILPAD Mainnet",
  testnet: "VEILPAD Testnet",
};

export const NETWORK_BLURB: Record<CotiNetworkName, string> = {
  mainnet: "Real COTI. Launches, trades and transfers settle for value.",
  testnet: "Free COTI from the faucet. Nothing here is worth anything.",
};

export const NETWORKS: CotiNetworkName[] = ["mainnet", "testnet"];

/**
 * The network a visitor lands on before they choose anything.
 *
 * Mainnet is the default because that is where the contracts people actually
 * use are deployed. `NEXT_PUBLIC_COTI_NETWORK` can pin a deployment to testnet,
 * which is what a preview build wants, but the public app ships on mainnet.
 */
export const DEFAULT_NETWORK: CotiNetworkName = isNetworkName(process.env.NEXT_PUBLIC_COTI_NETWORK)
  ? process.env.NEXT_PUBLIC_COTI_NETWORK
  : "mainnet";

/**
 * Kept because a great deal of code resolves a network once, at import, and
 * genuinely does not need to change it: a background indexer sweep, a build-time
 * default, the fallback when a request carries no preference. Anything a person
 * can switch reads the network per request or from `useNetwork()` instead.
 */
export const ACTIVE_NETWORK: CotiNetworkName = DEFAULT_NETWORK;

export const activeChain = chainByNetwork[DEFAULT_NETWORK];

/** How the chosen network travels: a cookie the server can read, plus a query string. */
export const NETWORK_COOKIE = "veil-network";
export const NETWORK_PARAM = "network";

/**
 * The parameter a per-network host pins itself with.
 *
 * `veilpad-mainnet.vercel.app` proxies every request to the origin with
 * `__net=mainnet` attached, and that beats both the query string and the
 * cookie. A hostname that names a network has to mean that network for
 * everyone who opens the link, or it is not worth having.
 *
 * It is deliberately not `network`: keeping the pin and the ordinary parameter
 * distinct is what stops a visitor's own `?network=` from colliding with the
 * proxy's, which would leave two values for one key and no defined winner.
 */
export const NETWORK_PIN_PARAM = "__net";

/**
 * Hostnames that pin a network, and the network each one means.
 *
 * Two shapes are recognised. The first is a real subdomain, which is what a
 * custom domain would give: `mainnet.veilpad.app`. The second is a dedicated
 * project host, which is what Vercel actually allows today, since it reserves
 * the `*.vercel.app` namespace and will not delegate a subdomain of a project
 * URL. Supporting both means moving to a custom domain later changes nothing
 * here.
 */
export function hostPin(host: string | null | undefined): CotiNetworkName | null {
  if (!host) return null;
  const h = host.toLowerCase().split(":")[0];

  if (h.startsWith("mainnet.")) return "mainnet";
  if (h.startsWith("testnet.")) return "testnet";

  const label = h.split(".")[0];
  if (label === "veilpad-mainnet" || label.startsWith("veilpad-mainnet-")) return "mainnet";
  if (label === "veilpad-testnet" || label.startsWith("veilpad-testnet-")) return "testnet";

  return null;
}

/**
 * VEILPAD's own token on mainnet, the one every other copy is measured against.
 *
 * It lives here rather than beside the seeding code because the client needs it
 * too - the testnet launchpad points at it by address - and that module reaches
 * for the database, which has no business in a browser bundle.
 */
export const OFFICIAL_MAINNET_TOKEN = "0x11728cBe1734b437723D06Dd137549e05f358888";

/** Where to send someone who wants the other network as a URL rather than a cookie. */
export const NETWORK_HOST: Record<CotiNetworkName, string> = {
  mainnet: "https://veilpad-mainnet.vercel.app",
  testnet: "https://veilpad-testnet.vercel.app",
};

export function chainFor(net: CotiNetworkName) {
  return chainByNetwork[net];
}

export function explorerTx(hash: string, net: CotiNetworkName = DEFAULT_NETWORK) {
  return `${chainByNetwork[net].blockExplorers.default.url}/tx/${hash}`;
}

export function explorerAddress(addr: string, net: CotiNetworkName = DEFAULT_NETWORK) {
  return `${chainByNetwork[net].blockExplorers.default.url}/address/${addr}`;
}

export function explorerToken(addr: string, net: CotiNetworkName = DEFAULT_NETWORK) {
  return `${chainByNetwork[net].blockExplorers.default.url}/token/${addr}`;
}

export const activeEthChain = DEFAULT_NETWORK === "mainnet" ? mainnet : sepolia;

export function ethChainFor(net: CotiNetworkName) {
  return ethSide[net];
}

/** Explorer for the Ethereum side, which is not CotiScan. */
export function ethExplorerTx(hash: string, net: CotiNetworkName = DEFAULT_NETWORK) {
  return `${ethSide[net].blockExplorers.default.url}/tx/${hash}`;
}
