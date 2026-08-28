import { db, now } from "./db";
import { publicClient } from "./rpc";
import { parseAbiItem, type Address } from "viem";
import { addressesFor, isDeployed } from "./addresses";
import { NETWORKS, OFFICIAL_MAINNET_TOKEN, type CotiNetworkName } from "./chain";

/**
 * VEILPAD's own token, put into the index it does not come from.
 *
 * Every other row in `tokens` was written by a launch: the factory emitted an
 * event, the indexer read it. VEILPAD was deployed on its own, through CREATE2,
 * with no curve and no factory - so nothing would ever have indexed it, and the
 * launchpad would have listed a hundred tokens without listing the one the site
 * is named after.
 *
 * Seeding it here fixes that, and the `official` flag is what keeps the fix
 * honest. A launchpad is precisely where a convincing fake gets listed next to
 * the real thing, so "this one is ours" has to be a column the server sets and
 * the card renders, never a name that anybody could copy.
 *
 * Both networks get a row. On testnet that row is deliberately a signpost: the
 * testnet token is a rehearsal, the real one is on mainnet, and the card says so
 * rather than letting someone believe they are holding the protocol token.
 */

export interface OfficialTokenFacts {
  address: string;
  network: CotiNetworkName;
  /** The mainnet address, whatever network is being viewed. */
  canonical: string;
  isCanonical: boolean;
}

function description(net: CotiNetworkName): string {
  return net === "mainnet"
    ? "The VEILPAD protocol token. One billion, minted once in the constructor, with no mint function afterwards. Stake it, or wrap it through the portal for its private twin."
    : "VEILPAD official token launched on Mainnet. This is the testnet rehearsal of it: the same contract at the same 8888 address shape, worth nothing, for trying staking and the portal before you use the real one.";
}

/**
 * When the token was actually created.
 *
 * A fixed timestamp was the first attempt and it was a bad one: it read
 * "launched 365d ago" because the date I picked happened to be a year old.
 * A wrong date is worse than no date, so this asks the chain.
 *
 * `_mint` in the constructor emits a Transfer from the zero address, and that
 * log is the token's birth certificate - one event, in the deployment block.
 * Finding it needs no explorer and no archive node.
 *
 * If the scan cannot reach the chain, the caller falls back to now, which reads
 * "just now". That is wrong in a way somebody notices and reports, rather than
 * wrong in a way that looks deliberate.
 */
async function birthOf(address: Address, net: CotiNetworkName): Promise<number | null> {
  try {
    const c = publicClient(net);
    const logs = await c.getLogs({
      address,
      event: parseAbiItem(
        "event Transfer(address indexed from, address indexed to, uint256 value)",
      ),
      args: { from: "0x0000000000000000000000000000000000000000" as Address },
      fromBlock: 0n,
      toBlock: "latest",
    });
    if (logs.length === 0) return null;

    const block = await c.getBlock({ blockNumber: logs[0].blockNumber });
    return Number(block.timestamp) * 1000;
  } catch {
    return null;
  }
}

/**
 * Writes the row, or refreshes it.
 *
 * `ON CONFLICT` updates rather than ignoring, so redeploying the token or
 * editing its description takes effect on the next boot instead of needing the
 * row deleted by hand.
 */
export async function seedOfficialToken(net: CotiNetworkName): Promise<boolean> {
  const address = addressesFor(net).veilToken;
  if (!isDeployed(address)) return false;

  const creator = process.env.NEXT_PUBLIC_DEPLOYER_ADDRESS || "";
  const createdAt = (await birthOf(address, net)) ?? now();

  db()
    .prepare(
      `INSERT INTO tokens (address, network, name, symbol, decimals, description, image, banner,
                           creator, kind, curve, pool, fee_tier, graduated, agent_id, links,
                           tx_hash, created_at, official)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
       ON CONFLICT(address) DO UPDATE SET
         name = excluded.name, symbol = excluded.symbol, description = excluded.description,
         image = excluded.image, links = excluded.links, official = 1, network = excluded.network,
         created_at = excluded.created_at`,
    )
    .run(
      address,
      net,
      "VEILPAD",
      "VEIL",
      18,
      description(net),
      "/veil-token.svg",
      "",
      creator,
      // A public ERC20, not a PrivateERC20: staking has to read a balance, and
      // ciphertext cannot be read by a contract. Privacy comes from the portal.
      "public",
      "", // no curve - it was never sold on one
      "",
      3000,
      0,
      "",
      JSON.stringify({
        site: "https://veilpad-app.vercel.app",
        stake: "https://veilpad-app.vercel.app/stake",
        contracts: "https://veilpad-app.vercel.app/veil-contracts",
        x: "https://x.com/LaunchOnVeil",
      }),
      "",
      createdAt,
    );

  return true;
}

/** Seeds every network that has a token deployed. Called once at boot. */
export async function seedOfficialTokens(): Promise<{
  seeded: CotiNetworkName[];
  skipped: CotiNetworkName[];
}> {
  const seeded: CotiNetworkName[] = [];
  const skipped: CotiNetworkName[] = [];

  for (const net of NETWORKS) {
    if (await seedOfficialToken(net)) seeded.push(net);
    else skipped.push(net);
  }
  return { seeded, skipped };
}

/** What the UI needs to say which token is the real one. */
export function officialTokenFacts(net: CotiNetworkName): OfficialTokenFacts | null {
  const address = addressesFor(net).veilToken;
  if (!isDeployed(address)) return null;

  return {
    address,
    network: net,
    canonical: OFFICIAL_MAINNET_TOKEN,
    isCanonical: address.toLowerCase() === OFFICIAL_MAINNET_TOKEN.toLowerCase(),
  };
}

export { now };
