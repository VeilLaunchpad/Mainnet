import type { Address } from "viem";
import { ACTIVE_NETWORK, type CotiNetworkName } from "./chain";

/**
 * COTI's own bridges, as deployed, not as reimplemented.
 *
 * Two different things get called "the bridge" and conflating them is what
 * made the earlier version of this page send people away:
 *
 *  1. The privacy bridge. Contracts on COTI itself that take a public token
 *     and mint its private twin, or burn the twin and release the public
 *     token. Every one of them is a real, verified, callable contract, so
 *     VEILPAD does this in-app. Nothing is handed off.
 *
 *  2. The cross-chain bridge. Ethereum to COTI and back. This one has no
 *     contract on either side: the user sends the token to a recipient
 *     address and COTI's relayer credits the same address on the far chain.
 *     That is a plain transfer, which VEILPAD can also build in-app, so the
 *     signature happens here too.
 *
 * Only assets COTI actually operates appear here. There is no long menu of
 * chains we cannot reach, because a bridge that lists a route it cannot
 * complete is worse than one that admits its limits.
 */

/* ------------------------------------------------------------------ */
/* Privacy bridge: public token <-> private twin, on COTI              */
/* ------------------------------------------------------------------ */

export interface PrivacyBridgeAsset {
  key: string;
  symbol: string;
  name: string;
  decimals: number;
  /** Band oracle symbol the contract quotes its fee against. */
  oracleSymbol: string;
  /** The PrivacyBridge contract. */
  bridge: Address;
  /** The public ERC20, or null when the asset is native COTI. */
  token: Address | null;
  /** The private twin that gets minted. */
  privateToken: Address;
  native: boolean;
  blurb: string;
}

/**
 * Verified on COTI testnet by reading each contract: `token()`,
 * `privateToken()`, `decimals()` and `tokenSymbol()` all came from chain,
 * not from a docs table, because docs drift and deployments do not.
 */
const TESTNET_ASSETS: PrivacyBridgeAsset[] = [
  {
    key: "COTI",
    symbol: "COTI",
    name: "COTI",
    decimals: 18,
    oracleSymbol: "COTI",
    bridge: "0xb8Bb4fe953eAa53D528FAc95C1d9955B2b60D582",
    token: null,
    privateToken: "0x6cE8907414986E73De9e7D28d62Ea2080F8E88E1",
    native: true,
    blurb: "The gas token itself, held as an encrypted balance.",
  },
  {
    key: "gCOTI",
    symbol: "gCOTI",
    name: "gCOTI",
    decimals: 18,
    oracleSymbol: "GCOTI",
    bridge: "0x8A6ca3984Cb187f90C9Bd24c71C70eF97A71A8fA",
    token: "0x878a42D3cB737DEC9E6c7e7774d973F46fd8ed4C",
    privateToken: "0x1503b02a4Aa27812306c65116FD23b733603F142",
    native: false,
    blurb: "Governance token for the COTI treasury.",
  },
  {
    key: "WETH",
    symbol: "WETH",
    name: "Wrapped Ether",
    decimals: 18,
    oracleSymbol: "ETH",
    bridge: "0x1841071A0296364739370a6d2F64c0eE46361fA0",
    token: "0x8bca4e6bbE402DB4aD189A316137aD08206154FB",
    privateToken: "0xF009BADb181d471995a1CFF406C3Db7B180F64eA",
    native: false,
    blurb: "Ether, bridged onto COTI and shielded.",
  },
  {
    key: "WBTC",
    symbol: "WBTC",
    name: "Wrapped BTC",
    decimals: 8,
    oracleSymbol: "WBTC",
    bridge: "0x362faD66210401ADfAf27B98776F1e8D21dfc529",
    token: "0x5dBDb2E5D51c3FFab5D6B862Caa11FCe1D83F492",
    privateToken: "0xB50F1680a4C69145ABc09A2A71c8D5b8051578cF",
    native: false,
    blurb: "Eight decimals, not eighteen. The twin matches.",
  },
  {
    key: "USDT",
    symbol: "USDT",
    name: "Tether USD",
    decimals: 6,
    oracleSymbol: "USDT",
    bridge: "0x73116aa5a50cADca47FD03Ca0B80D133346442FA",
    token: "0x9e961430053cd5AbB3b060544cEcCec848693Cf0",
    privateToken: "0xcEF137E96eDF68EE99D4CdEa7085f154d74895cD",
    native: false,
    blurb: "A dollar balance nobody else can total up.",
  },
  {
    key: "USDC.e",
    symbol: "USDC.e",
    name: "Bridged USDC",
    decimals: 6,
    oracleSymbol: "USDC",
    bridge: "0x9C92Ad40553758C3d11Dcd8495Ee0ce3fd8fE0A1",
    token: "0x63f3D2Cc8F5608F57ce6E5Aa3590A2Beb428D19C",
    privateToken: "0x37f78dcCd15876F74391EF1F01b76557D9FF1dea",
    native: false,
    blurb: "The bridged flavour of USDC, quoted against USDC.",
  },
  {
    key: "WADA",
    symbol: "WADA",
    name: "Wrapped ADA",
    decimals: 6,
    oracleSymbol: "ADA",
    bridge: "0x3cB6e1E9cd504669DAb49910c30cDAfA8D05B641",
    token: "0xe3E2cd3Abf412c73a404b9b8227B71dE3CfE829D",
    privateToken: "0x1245f50a3E9129A219b4bf66D10fEaEA47467B69",
    native: false,
    blurb: "Cardano's token, wrapped and then shielded.",
  },
];

/**
 * Deliberately empty. COTI operates these on mainnet too, but this app has
 * only verified the testnet deployment on chain. Copying addresses from a
 * docs page into a mainnet money path is exactly the kind of guess that
 * loses funds, so mainnet reports "not configured" until someone reads the
 * real addresses off the real network.
 */
/**
 * COTI mainnet privacy bridges.
 *
 * Every address here was read off chain rather than copied from a table, and
 * each one was checked four ways before being written down: the contract has
 * code, `isDepositEnabled()` is true, `paused()` is false, and `owner()` is the
 * deployer that created the live set (0xE4D559...) in blocks 7285553-7285566.
 * The public and private token of each pair were then read back and their
 * symbols and decimals matched.
 *
 * Two traps are worth recording, because both would have cost real money:
 *
 * 1. COTI's mainnet docs page under Privacy Portal lists *token* addresses, not
 *    bridges. Sending a token to one of those is a permanent loss - they are
 *    plain ERC-20s and revert on `token()` and `isDepositEnabled()`.
 *
 * 2. An older, abandoned deployment is still on chain under the same names, and
 *    it is the one the explorer's name search finds, because the live WETH
 *    bridge is unverified and therefore unnamed. The decoy native bridge even
 *    reads deposits-enabled and unpaused, but holds nothing and points at a
 *    private token nothing uses. Both decoys are owned by 0xAb81c5..., which is
 *    how they are told apart.
 */
const MAINNET_ASSETS: PrivacyBridgeAsset[] = [
  {
    key: "COTI",
    symbol: "COTI",
    name: "COTI",
    decimals: 18,
    oracleSymbol: "COTI",
    bridge: "0x44D864973392064304dD88E2BDef39fF1ab11b7b",
    token: null,
    privateToken: "0xD2F2692B83C3ecDF2EAa0f7c2632BBd46Ae1cC91",
    native: true,
    blurb: "The gas token itself, held as an encrypted balance.",
  },
  {
    key: "gCOTI",
    symbol: "gCOTI",
    name: "gCOTI",
    decimals: 18,
    oracleSymbol: "GCOTI",
    bridge: "0xD4e0d9AB16b48c68044cB6aeA3A089380d6D8cD4",
    token: "0x7637C7838EC4Ec6b85080F28A678F8E234bB83D1",
    privateToken: "0x394b3c4328160f000763Ca391D07F902926EDaAc",
    native: false,
    blurb: "Governance COTI, shielded the same way.",
  },
  {
    key: "WETH",
    symbol: "WETH",
    name: "Wrapped Ether",
    decimals: 18,
    oracleSymbol: "ETH",
    bridge: "0x7286c83300f0C7131b4006f3cf9F8e44BeB45c13",
    token: "0x639aCc80569c5FC83c6FBf2319A6Cc38bBfe26d1",
    privateToken: "0x4727FE8D8450CEBcB142331FAc034Cd8d311f0E5",
    native: false,
    blurb: "Ether that already crossed to COTI, now made private.",
  },
  {
    key: "WBTC",
    symbol: "WBTC",
    name: "Wrapped Bitcoin",
    decimals: 8,
    oracleSymbol: "BTC",
    bridge: "0xc3B7EdEe4f1c0A0bA1AcD341e4982371eC869862",
    token: "0x8C39B1fD0e6260fdf20652Fc436d25026832bfEA",
    privateToken: "0x65449561257ba5756631Aa0d34f07f6457a319be",
    native: false,
    blurb: "Eight decimals, not eighteen. The amount field follows the token.",
  },
  {
    key: "USDT",
    symbol: "USDT",
    name: "Tether USD",
    decimals: 6,
    oracleSymbol: "USDT",
    bridge: "0x7685B473DAF1c6DeD815Ca64C6fa18Da2227440D",
    token: "0xfA6f73446b17A97a56e464256DA54AD43c2Cbc3E",
    privateToken: "0x42107250C3D385ddfABE69ab6de163702040FeB0",
    native: false,
    blurb: "Dollars, with the balance hidden rather than the transfer.",
  },
  {
    key: "USDC.e",
    symbol: "USDC.e",
    name: "USD Coin",
    decimals: 6,
    oracleSymbol: "USDC",
    bridge: "0x29334fC23ffa2c44AF1b372336C2296591Eadd86",
    token: "0xf1Feebc4376c68B7003450ae66343Ae59AB37D3C",
    privateToken: "0x63C9a1D05471fc8d47C83968725Dcfdcb5410392",
    native: false,
    blurb: "The bridged USDC COTI's own docs name as canonical.",
  },
  {
    key: "wADA",
    symbol: "wADA",
    name: "Wrapped ADA",
    decimals: 6,
    oracleSymbol: "ADA",
    bridge: "0xFa2126C07F517013c8d237cc465342da89B96f92",
    token: "0xe757Ca19d2c237AA52eBb1d2E8E4368eeA3eb331",
    privateToken: "0x3a8b49aAC1dAD86aa45a75231FbeC5bEb810e416",
    native: false,
    blurb: "Cardano's token on COTI, six decimals.",
  },
];

export function privacyAssets(net: CotiNetworkName = ACTIVE_NETWORK): PrivacyBridgeAsset[] {
  return net === "mainnet" ? MAINNET_ASSETS : TESTNET_ASSETS;
}

export function privacyAsset(
  key: string,
  net: CotiNetworkName = ACTIVE_NETWORK,
): PrivacyBridgeAsset | null {
  const k = key.toLowerCase();
  return privacyAssets(net).find((a) => a.key.toLowerCase() === k) ?? null;
}

/* ------------------------------------------------------------------ */
/* ABIs                                                                */
/* ------------------------------------------------------------------ */

/**
 * The fee is quoted and then committed to.
 *
 * `estimateDepositFee` hands back the oracle's `lastUpdated` stamps along
 * with the fee, and `deposit` takes those stamps and reverts unless they
 * still match. That is the contract refusing to price your transfer against
 * a quote you never saw. It also means a quote goes stale the moment the
 * oracle ticks, so the UI re-quotes immediately before sending.
 */
export const cotiPrivacyBridgeErc20Abi = [
  {
    type: "function",
    name: "deposit",
    stateMutability: "payable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "cotiOracleTimestamp", type: "uint256" },
      { name: "tokenOracleTimestamp", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "withdraw",
    stateMutability: "payable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "cotiOracleTimestamp", type: "uint256" },
      { name: "tokenOracleTimestamp", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "estimateDepositFee",
    stateMutability: "view",
    inputs: [{ name: "tokenAmount", type: "uint256" }],
    outputs: [
      { name: "fee", type: "uint256" },
      { name: "cotiLastUpdated", type: "uint256" },
      { name: "tokenLastUpdated", type: "uint256" },
      { name: "blockTimestamp", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "estimateWithdrawFee",
    stateMutability: "view",
    inputs: [{ name: "tokenAmount", type: "uint256" }],
    outputs: [
      { name: "fee", type: "uint256" },
      { name: "cotiLastUpdated", type: "uint256" },
      { name: "tokenLastUpdated", type: "uint256" },
      { name: "blockTimestamp", type: "uint256" },
    ],
  },
  { type: "function", name: "token", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "privateToken", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "tokenSymbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "isDepositEnabled", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "paused", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "priceOracle", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "minDepositAmount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "maxDepositAmount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "minWithdrawAmount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "maxWithdrawAmount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalUserLiability", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "event",
    name: "Deposit",
    inputs: [
      { name: "user", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "minted", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Withdraw",
    inputs: [
      { name: "user", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "released", type: "uint256", indexed: false },
    ],
  },
] as const;

/**
 * The native bridge differs in three ways that all matter:
 * `deposit` takes no amount because the amount is `msg.value`, the fee is
 * deducted from that value rather than charged on top, `withdraw` is not
 * payable, and the estimates return three values rather than four.
 */
export const cotiPrivacyBridgeNativeAbi = [
  {
    type: "function",
    name: "deposit",
    stateMutability: "payable",
    inputs: [
      { name: "cotiOracleTimestamp", type: "uint256" },
      { name: "tokenOracleTimestamp", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "cotiOracleTimestamp", type: "uint256" },
      { name: "tokenOracleTimestamp", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "estimateDepositFee",
    stateMutability: "view",
    inputs: [{ name: "cotiAmount", type: "uint256" }],
    outputs: [
      { name: "fee", type: "uint256" },
      { name: "cotiLastUpdated", type: "uint256" },
      { name: "blockTimestamp", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "estimateWithdrawFee",
    stateMutability: "view",
    inputs: [{ name: "cotiAmount", type: "uint256" }],
    outputs: [
      { name: "fee", type: "uint256" },
      { name: "cotiLastUpdated", type: "uint256" },
      { name: "blockTimestamp", type: "uint256" },
    ],
  },
  { type: "function", name: "privateCoti", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "isDepositEnabled", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "paused", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "priceOracle", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "minDepositAmount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "maxDepositAmount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "minWithdrawAmount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "maxWithdrawAmount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalUserLiability", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

export function bridgeAbiFor(asset: PrivacyBridgeAsset) {
  return asset.native ? cotiPrivacyBridgeNativeAbi : cotiPrivacyBridgeErc20Abi;
}

/* ------------------------------------------------------------------ */
/* Cross-chain: Ethereum <-> COTI                                      */
/* ------------------------------------------------------------------ */

export interface CrossChainAsset {
  key: string;
  symbol: string;
  decimals: number;
  /** ERC20 on the Ethereum side. */
  ethToken: Address;
  /** Where the Ethereum-side transfer is sent. */
  ethRecipient: Address;
  /** null when the COTI side is the native coin. */
  cotiToken: Address | null;
  /** Where the COTI-side transfer is sent. */
  cotiRecipient: Address;
}

/**
 * Read out of the official bridge's own configuration rather than guessed, and
 * then checked against transfers that actually completed.
 *
 * COTI's config names its destinations recipient addresses: the user sends the
 * token there and a relayer credits the same address on the far chain. That is
 * why there is no contract to call and never was, and it is also why a plain
 * transfer is enough for VEILPAD to run the whole thing in app.
 *
 * The testnet addresses below are not from any doc. COTI does not publish
 * them, so each one was recovered by pulling completed transfers out of COTI's
 * own tracking service and reading where they were actually sent:
 *
 *   Sepolia side  0x0fc9..dad4d   16 of 16 transfers, COTI and gCOTI alike
 *   COTI side     0x48ab..fa530    8 of 8 native, plus 25 of 25 gCOTI
 *
 * One recipient per chain shared by both tokens, which is the same shape the
 * mainnet configuration uses.
 */
export interface CrossChainConfig {
  ethChainId: number;
  ethName: string;
  cotiChainId: number;
  assets: CrossChainAsset[];
}

const CROSS_CHAIN_MAINNET: CrossChainConfig = {
  ethChainId: 1,
  ethName: "Ethereum",
  cotiChainId: 2632500,
  assets: [
    {
      key: "COTI",
      symbol: "COTI",
      decimals: 18,
      ethToken: "0xDDB3422497E61e13543BeA06989C0789117555c5",
      ethRecipient: "0x439D73635B9590E9d9e2CC9eCAB832B057d2E25B",
      cotiToken: null,
      cotiRecipient: "0x61bf10a1a27b2d99de0a59a06200a62ed579d685",
    },
    {
      key: "gCOTI",
      symbol: "gCOTI",
      decimals: 18,
      ethToken: "0xAf2CA40d3fc4459436D11B94d21FA4b8A89fB51d",
      ethRecipient: "0x439D73635B9590E9d9e2CC9eCAB832B057d2E25B",
      cotiToken: "0x7637C7838EC4Ec6b85080F28A678F8E234bB83D1",
      cotiRecipient: "0x61bf10a1a27b2d99de0a59a06200a62ed579d685",
    },
  ],
};

const CROSS_CHAIN_TESTNET: CrossChainConfig = {
  ethChainId: 11155111,
  ethName: "Sepolia",
  cotiChainId: 7082400,
  assets: [
    {
      key: "COTI",
      symbol: "COTI",
      decimals: 18,
      ethToken: "0xDa8454e9fbDEEb466F5BAB64084aF86D5D9caB20",
      ethRecipient: "0x0fc92f51278c6d024ab6feb3527017f66d1dad4d",
      cotiToken: null,
      cotiRecipient: "0x48aba7324aabb772fbbc34d2747221bbd4bfa530",
    },
    {
      key: "gCOTI",
      symbol: "gCOTI",
      decimals: 18,
      ethToken: "0x36d9A8CB77f24595D853F9C56384870758eA668d",
      ethRecipient: "0x0fc92f51278c6d024ab6feb3527017f66d1dad4d",
      cotiToken: "0x7AC988eb3E45fe6ADB05DFaf609c8DBb4A902cdC",
      cotiRecipient: "0x48aba7324aabb772fbbc34d2747221bbd4bfa530",
    },
  ],
};

export function crossChain(net: CotiNetworkName = ACTIVE_NETWORK): CrossChainConfig {
  return net === "mainnet" ? CROSS_CHAIN_MAINNET : CROSS_CHAIN_TESTNET;
}

/** COTI's own tracking service, one gateway per network. */
export function trackingBase(net: CotiNetworkName = ACTIVE_NETWORK): string {
  const host = net === "mainnet" ? "mainnet-apps-1-gw" : "testnet-apps-1-gw";
  return `https://${host}.coti.io/workflow-orchestrator-service`;
}

/**
 * The service paginates in whole transfers and each transfer occupies four
 * rows, so it rejects any page size that is not a multiple of four.
 */
export function trackingPageSize(want: number): number {
  return Math.max(4, Math.ceil(want / 4) * 4);
}
