import { DEFAULT_NETWORK, type CotiNetworkName } from "./chain";
import type { Address } from "viem";

const ZERO = "0x0000000000000000000000000000000000000000" as Address;

function pick(net: CotiNetworkName, testnet?: string, mainnet?: string): Address {
  const v = net === "mainnet" ? mainnet : testnet;
  return (v && v.startsWith("0x") ? v : ZERO) as Address;
}

/**
 * COTI's own AccountOnboard is deployed at the same address on both networks,
 * and the bytecode is byte-identical, so one constant covers both. Checked by
 * reading `eth_getCode` on each chain rather than trusting the docs.
 */
const ACCOUNT_ONBOARD = "0x536A67f0cc46513E7d27a370ed1aF9FDcC7A5095";

export interface VeilAddresses {
  veilFactory: Address;
  veilCurve: Address;
  agentRegistry: Address;
  profileRegistry: Address;
  locker: Address;
  portal: Address;
  swapFactory: Address;
  swapRouter: Address;
  univ3Factory: Address;
  univ3Router: Address;
  univ3PositionManager: Address;
  univ3Quoter: Address;
  wcoti: Address;
  privateMessaging: Address;
  accountOnboard: Address;
  /** The protocol token, its reward reserve, its staking, and its private twin. */
  veilToken: Address;
  veilTreasury: Address;
  veilStaking: Address;
  veilTokenTwin: Address;
}

/**
 * Every address is env-driven so the same build can point at a fresh
 * deployment without a code change. `isDeployed()` guards the UI so an
 * unconfigured contract degrades to a clear "not deployed yet" state
 * instead of a confusing revert.
 *
 * Both networks are resolved from the same build. `NEXT_PUBLIC_*` values are
 * inlined by the bundler at compile time, which is why every pair is written
 * out literally here: a computed `process.env[key]` would survive typechecking
 * and then be `undefined` in the browser.
 */
function build(net: CotiNetworkName): VeilAddresses {
  return {
    veilFactory: pick(
      net,
      process.env.NEXT_PUBLIC_VEIL_FACTORY_TESTNET,
      process.env.NEXT_PUBLIC_VEIL_FACTORY_MAINNET,
    ),
    veilCurve: pick(
      net,
      process.env.NEXT_PUBLIC_VEIL_CURVE_TESTNET,
      process.env.NEXT_PUBLIC_VEIL_CURVE_MAINNET,
    ),
    agentRegistry: pick(
      net,
      process.env.NEXT_PUBLIC_AGENT_REGISTRY_TESTNET,
      process.env.NEXT_PUBLIC_AGENT_REGISTRY_MAINNET,
    ),
    profileRegistry: pick(
      net,
      process.env.NEXT_PUBLIC_PROFILE_REGISTRY_TESTNET,
      process.env.NEXT_PUBLIC_PROFILE_REGISTRY_MAINNET,
    ),
    locker: pick(net, process.env.NEXT_PUBLIC_LOCKER_TESTNET, process.env.NEXT_PUBLIC_LOCKER_MAINNET),
    portal: pick(net, process.env.NEXT_PUBLIC_PORTAL_TESTNET, process.env.NEXT_PUBLIC_PORTAL_MAINNET),
    swapFactory: pick(
      net,
      process.env.NEXT_PUBLIC_SWAP_FACTORY_TESTNET,
      process.env.NEXT_PUBLIC_SWAP_FACTORY_MAINNET,
    ),
    swapRouter: pick(
      net,
      process.env.NEXT_PUBLIC_SWAP_ROUTER_TESTNET,
      process.env.NEXT_PUBLIC_SWAP_ROUTER_MAINNET,
    ),
    univ3Factory: pick(
      net,
      process.env.NEXT_PUBLIC_UNIV3_FACTORY_TESTNET,
      process.env.NEXT_PUBLIC_UNIV3_FACTORY_MAINNET,
    ),
    univ3Router: pick(
      net,
      process.env.NEXT_PUBLIC_UNIV3_ROUTER_TESTNET,
      process.env.NEXT_PUBLIC_UNIV3_ROUTER_MAINNET,
    ),
    univ3PositionManager: pick(
      net,
      process.env.NEXT_PUBLIC_UNIV3_POSITION_MANAGER_TESTNET,
      process.env.NEXT_PUBLIC_UNIV3_POSITION_MANAGER_MAINNET,
    ),
    univ3Quoter: pick(
      net,
      process.env.NEXT_PUBLIC_UNIV3_QUOTER_TESTNET,
      process.env.NEXT_PUBLIC_UNIV3_QUOTER_MAINNET,
    ),
    wcoti: pick(net, process.env.NEXT_PUBLIC_WCOTI_TESTNET, process.env.NEXT_PUBLIC_WCOTI_MAINNET),
    privateMessaging: pick(
      net,
      process.env.NEXT_PUBLIC_PRIVATE_MESSAGING_TESTNET ||
        "0xa4C514225Db5B8AE6eF1548d4CE912234A7CD954",
      process.env.NEXT_PUBLIC_PRIVATE_MESSAGING_MAINNET ||
        "0xe461F448cB935a14585F6f1a30F5b4C73ffF8c05",
    ),
    accountOnboard: pick(
      net,
      process.env.NEXT_PUBLIC_ACCOUNT_ONBOARD_TESTNET || ACCOUNT_ONBOARD,
      process.env.NEXT_PUBLIC_ACCOUNT_ONBOARD_MAINNET || ACCOUNT_ONBOARD,
    ),
    veilToken: pick(
      net,
      process.env.NEXT_PUBLIC_VEIL_TOKEN_TESTNET,
      process.env.NEXT_PUBLIC_VEIL_TOKEN_MAINNET,
    ),
    veilTreasury: pick(
      net,
      process.env.NEXT_PUBLIC_VEIL_TREASURY_TESTNET,
      process.env.NEXT_PUBLIC_VEIL_TREASURY_MAINNET,
    ),
    veilStaking: pick(
      net,
      process.env.NEXT_PUBLIC_VEIL_STAKING_TESTNET,
      process.env.NEXT_PUBLIC_VEIL_STAKING_MAINNET,
    ),
    veilTokenTwin: pick(
      net,
      process.env.NEXT_PUBLIC_VEIL_TOKEN_TWIN_TESTNET,
      process.env.NEXT_PUBLIC_VEIL_TOKEN_TWIN_MAINNET,
    ),
  };
}

const CACHE: Partial<Record<CotiNetworkName, VeilAddresses>> = {};

/** The contract set for one network. Resolved once per network, then reused. */
export function addressesFor(net: CotiNetworkName): VeilAddresses {
  return (CACHE[net] ??= build(net));
}

/**
 * The default network's addresses, for the code that resolves a network once at
 * import: background sweeps, seeds, and anything with no request to read a
 * preference from. Anything a person can switch calls `addressesFor(net)`.
 */
export const addresses: VeilAddresses = addressesFor(DEFAULT_NETWORK);

export function isDeployed(a: Address | string | undefined): boolean {
  return !!a && a !== ZERO && /^0x[0-9a-fA-F]{40}$/.test(a);
}

/**
 * VeilSwap charges one flat 0.3% fee, the Uniswap V2 default. The tier list
 * survives only so an external V3 deployment could be pointed at later.
 */
export const SWAP_FEE_BPS = 30;
export const FEE_TIERS = [500, 3000, 10000] as const;
export const DEFAULT_FEE_TIER = 3000;

export { ZERO as ZERO_ADDRESS };
