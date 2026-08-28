import { db, rows } from "@/lib/db";
import { cotiQuote } from "@/lib/market";
import { chainInfo } from "@/lib/rpc";
import { brainStatus } from "@/lib/llm";
import { addressesFor, isDeployed } from "@/lib/addresses";
import { networkFrom } from "@/lib/network";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Dashboard header - one call, everything the operator needs at a glance. */
export async function GET(req: Request) {
  const net = networkFrom(req);
  const one = (sql: string, ...args: unknown[]) =>
    (db()
      .prepare(sql)
      .get(...(args as never[])) as { c: number } | undefined)?.c ?? 0;

  /**
   * Launch and trade counts are per network; agents, profiles and threads are
   * not. A handle and an agent belong to a person rather than to a chain, so
   * they stay whole across the switch instead of appearing to vanish.
   */
  const tokens = one("SELECT COUNT(*) AS c FROM tokens WHERE network = ?", net);
  const graduated = one(
    "SELECT COUNT(*) AS c FROM tokens WHERE graduated = 1 AND network = ?",
    net,
  );
  const agents = one("SELECT COUNT(*) AS c FROM agents");
  const liveAgents = one("SELECT COUNT(*) AS c FROM agents WHERE heartbeat_sec > 0");
  const trades = one(
    "SELECT COUNT(*) AS c FROM trades WHERE token IN (SELECT address FROM tokens WHERE network = ?)",
    net,
  );
  const profiles = one("SELECT COUNT(*) AS c FROM profiles");
  const threads = one("SELECT COUNT(*) AS c FROM threads");

  const recentLaunches = rows(
    db()
      .prepare(
        "SELECT address, name, symbol, image, created_at FROM tokens WHERE network = ? ORDER BY created_at DESC LIMIT 6",
      )
      .all(net),
  );
  const recentEvents = rows(
    db()
      .prepare(
        `SELECT e.kind, e.title, e.body, e.created_at, a.name AS agent_name, a.slug AS agent_slug
         FROM agent_events e JOIN agents a ON a.id = e.agent_id
         ORDER BY e.id DESC LIMIT 12`,
      )
      .all(),
  );

  const info = chainInfo(net);
  const contracts = Object.fromEntries(
    Object.entries(addressesFor(net)).map(([k, v]) => [k, { address: v, deployed: isDeployed(v) }]),
  );

  return Response.json({
    counts: { tokens, graduated, agents, liveAgents, trades, profiles, threads },
    recentLaunches,
    recentEvents,
    coti: await cotiQuote(),
    chain: { network: info.network, chainId: info.chainId, name: info.name, explorer: info.explorer },
    contracts,
    brain: brainStatus(),
  });
}
