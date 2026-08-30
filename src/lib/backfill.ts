import type { Address } from "viem";
import { db, rows } from "./db";
import { publicClient } from "./rpc";
import { devoxFactoryAbi } from "./abis";
import { addressesFor, isDeployed } from "./addresses";
import { DEFAULT_NETWORK, type CotiNetworkName } from "./chain";

/**
 * Rebuild the launch index from the chain.
 *
 * The index is a cache, not a record. Every launch already exists on COTI as a
 * `Launched` event carrying the token, its curve, its creator and its metadata,
 * so a deployment starting on an empty disk can reconstruct the launchpad
 * rather than looking permanently empty because a SQLite file was not copied
 * from somebody's laptop.
 *
 * That distinction matters beyond convenience: an index that cannot be rebuilt
 * is a second source of truth, and a second source of truth eventually
 * disagrees with the first.
 */

interface LaunchedLog {
  args: {
    token?: Address;
    curve?: Address;
    creator?: Address;
    name?: string;
    symbol?: string;
    metadataURI?: string;
  };
  blockNumber: bigint;
  transactionHash: `0x${string}`;
}

export interface BackfillResult {
  ok: boolean;
  found: number;
  inserted: number;
  reason?: string;
}

/**
 * Metadata lives off chain behind the URI in the event. Fetching it is a nice
 * to have, so a gateway that is slow or down must not cost us the launch
 * itself: the token is indexed either way, just without its description.
 */
async function readMetadata(uri: string): Promise<Record<string, unknown> | null> {
  if (!uri) return null;

  const gateway = process.env.NEXT_PUBLIC_PINATA_GATEWAY || "https://ipfs.io/ipfs/";
  const url = uri.startsWith("ipfs://") ? gateway + uri.slice("ipfs://".length) : uri;
  if (!/^https?:\/\//.test(url)) return null;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function backfillLaunches(
  net: CotiNetworkName = DEFAULT_NETWORK,
): Promise<BackfillResult> {
  const addresses = addressesFor(net);
  if (!isDeployed(addresses.devoxFactory)) {
    return { ok: false, found: 0, inserted: 0, reason: "factory not configured" };
  }

  let logs: LaunchedLog[];
  try {
    logs = (await publicClient(net).getContractEvents({
      address: addresses.devoxFactory,
      abi: devoxFactoryAbi,
      eventName: "Launched",
      fromBlock: 0n,
      toBlock: "latest",
    })) as unknown as LaunchedLog[];
  } catch (err) {
    return { ok: false, found: 0, inserted: 0, reason: String(err).slice(0, 160) };
  }

  const insert = db().prepare(
    `INSERT INTO tokens (address, network, name, symbol, decimals, description, image, banner,
                         creator, kind, curve, pool, fee_tier, graduated, agent_id, links, tx_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(address) DO NOTHING`,
  );

  let inserted = 0;

  for (const log of logs) {
    const token = log.args.token;
    if (!token) continue;

    const meta = await readMetadata(log.args.metadataURI ?? "");

    // Block numbers are not timestamps, but they order correctly, which is all
    // the launchpad needs to show newest first.
    const createdAt = Number(log.blockNumber) * 1000;

    const info = insert.run(
      token,
      net,
      log.args.name || "Unnamed",
      (log.args.symbol || "???").toUpperCase(),
      18,
      String(meta?.description ?? ""),
      String(meta?.image ?? ""),
      String(meta?.banner ?? ""),
      log.args.creator || "",
      "private",
      log.args.curve || "",
      "",
      3000,
      0,
      "",
      JSON.stringify(meta?.links ?? {}),
      log.transactionHash,
      createdAt,
    );

    if (info.changes > 0) inserted += 1;
  }

  return { ok: true, found: logs.length, inserted };
}

/** True when the launchpad has nothing, which is the only time to rebuild. */
export function indexIsEmpty(net: CotiNetworkName = DEFAULT_NETWORK): boolean {
  const r = rows<{ n: number }>(
    db().prepare("SELECT COUNT(*) AS n FROM tokens WHERE network = ?").all(net),
  );
  return (r[0]?.n ?? 0) === 0;
}
