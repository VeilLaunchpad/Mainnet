import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { ACTIVE_NETWORK, type CotiNetworkName } from "./chain";

/**
 * The master table.
 *
 * `config/devoxpad.{network}.json` is the human- and agent-readable registry of
 * everything this deployment is: chain params, contract addresses, curve
 * tuning, routes, the agent roster and the tool catalog. It holds no secrets,
 * so it is safe to commit and safe to hand to an agent verbatim.
 *
 * Read at runtime with fs rather than imported, so 27KB of config never lands
 * in a client bundle. Server-side only.
 */

export interface ContractEntry {
  address: string;
  status: "deployed" | "pending" | "per-token" | "external";
  role?: string;
  envKey?: string | null;
  abi?: string;
  deployOrder?: number;
  [k: string]: unknown;
}

export interface MasterTable {
  app: { name: string; tagline: string; version: string; network: CotiNetworkName };
  chain: {
    id: number;
    name: string;
    nativeCurrency: { name: string; symbol: string; decimals: number };
    rpc: string[];
    ws: string[];
    explorer: { name: string; url: string; tx: string; address: string; token: string };
    /**
     * Null on mainnet. Real COTI is bought or bridged, and pointing someone at
     * a testnet faucet channel that will not fund them is worse than saying
     * nothing.
     */
    faucet: { kind: string; url: string; note: string } | null;
    bridge: { url: string; etaMinutes: number[]; assets: string[]; counterparties: { name: string; chainId: number }[] };
  };
  deployer: { address: string; funded: boolean; envKey: string; note: string };
  contracts: {
    coti: Record<string, ContractEntry>;
    devoxpad: Record<string, ContractEntry>;
    uniswapV3: Record<string, unknown>;
  };
  launch: Record<string, unknown>;
  routes: Record<string, string>;
  api: Record<string, unknown>;
  agents: Record<string, unknown>;
  tools: Record<string, unknown>;
  services: Record<string, unknown>;
  storage: Record<string, unknown>;
  privacy: Record<string, unknown>;
  /** Written by contracts/scripts/fees.ts, read straight off the contracts. */
  fees?: Record<string, unknown>;
  dex?: Record<string, unknown>;
  /** Stand-ins for the mainnet portal set, written by deploy-assets.ts. */
  assets?: Record<string, unknown>;
  verification?: Record<string, unknown>;
}

const cache = new Map<CotiNetworkName, MasterTable | null>();

export function masterTable(net: CotiNetworkName = ACTIVE_NETWORK): MasterTable | null {
  if (cache.has(net)) return cache.get(net) ?? null;

  const file = path.join(process.cwd(), "config", "devoxpad." + net + ".json");
  let table: MasterTable | null = null;
  if (existsSync(file)) {
    try {
      table = JSON.parse(readFileSync(file, "utf8")) as MasterTable;
    } catch {
      table = null;
    }
  }

  cache.set(net, table);
  return table;
}

/** Only in dev - the deploy script rewrites the table while the server runs. */
export function invalidateMasterTable() {
  cache.clear();
}

/**
 * Address resolution order: env wins, master table fills in, zero means
 * "not deployed". Env winning matters because a hosted deployment sets vars
 * without shipping a rewritten config file.
 */
export function resolveAddress(
  group: "coti" | "devoxpad",
  key: string,
  net: CotiNetworkName = ACTIVE_NETWORK,
): { address: string; status: string; source: "env" | "master" | "none" } {
  const entry = masterTable(net)?.contracts?.[group]?.[key];
  const envKey = entry?.envKey;
  const fromEnv = envKey ? process.env[envKey] : undefined;

  if (fromEnv && /^0x[0-9a-fA-F]{40}$/.test(fromEnv) && !/^0x0{40}$/.test(fromEnv)) {
    return { address: fromEnv, status: "deployed", source: "env" };
  }
  if (entry?.address && !/^0x0{40}$/.test(entry.address)) {
    return { address: entry.address, status: entry.status, source: "master" };
  }
  return { address: "0x0000000000000000000000000000000000000000", status: entry?.status ?? "pending", source: "none" };
}

/**
 * A compact digest for the agents' `get_chain_info` tool. Deliberately small:
 * the models are metered per minute, so context spent here is context not
 * available for reasoning.
 */
export function chainDigest(net: CotiNetworkName = ACTIVE_NETWORK) {
  const t = masterTable(net);
  if (!t) return null;

  const deployed: Record<string, string> = {};
  const pending: string[] = [];

  for (const group of ["coti", "devoxpad"] as const) {
    for (const key of Object.keys(t.contracts[group] || {})) {
      if (key.startsWith("_")) continue; // documentation keys, not contracts
      const r = resolveAddress(group, key, net);
      if (r.source === "none") pending.push(key);
      else deployed[key] = r.address;
    }
  }

  return {
    app: t.app.name,
    network: t.app.network,
    chainId: t.chain.id,
    explorer: t.chain.explorer.url,
    faucet: t.chain.faucet?.url ?? null,
    deployed,
    notDeployed: pending,
    launchFeeCoti: t.launch.launchFeeCoti,
    graduationTargetCoti: (t.launch.curve as Record<string, unknown>)?.graduationTargetCoti,
  };
}
