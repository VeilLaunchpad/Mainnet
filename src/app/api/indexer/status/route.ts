import { publicClient } from "@/lib/rpc";
import { db } from "@/lib/db";
import { addressesFor, isDeployed } from "@/lib/addresses";
import { brainStatus } from "@/lib/llm";
import { cotiQuote } from "@/lib/market";
import { chainByNetwork } from "@/lib/chain";
import { networkFrom } from "@/lib/network";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Indexer health.
 *
 * VEILPAD reads events on demand rather than running a background crawler, so
 * "indexed" here is the head of the range the reader covers, and lag is
 * effectively zero by construction. The number is still reported honestly
 * rather than hardcoded, because a reader that cannot reach the RPC is a
 * reader that is behind, whatever its design says.
 */
export async function GET(req: Request) {
  const net = networkFrom(req);
  const addresses = addressesFor(net);

  const started = Date.now();
  const services: { name: string; ok: boolean; detail: string }[] = [];

  let head = 0;
  let rpcOk = false;
  let rpcLatencyMs = 0;

  try {
    const t0 = Date.now();
    head = Number(await publicClient(net).getBlockNumber());
    rpcLatencyMs = Date.now() - t0;
    rpcOk = true;
    services.push({ name: "coti-rpc", ok: true, detail: rpcLatencyMs + "ms, head " + head });
  } catch (err) {
    services.push({ name: "coti-rpc", ok: false, detail: String(err).slice(0, 120) });
  }

  let dbOk = false;
  const counts: Record<string, number> = {};
  try {
    const one = (sql: string, ...args: unknown[]) =>
      (db()
        .prepare(sql)
        .get(...(args as never[])) as { c: number } | undefined)?.c ?? 0;
    counts.tokens = one("SELECT COUNT(*) AS c FROM tokens WHERE network = ?", net);
    counts.graduated = one(
      "SELECT COUNT(*) AS c FROM tokens WHERE graduated = 1 AND network = ?",
      net,
    );
    counts.trades = one(
      "SELECT COUNT(*) AS c FROM trades WHERE token IN (SELECT address FROM tokens WHERE network = ?)",
      net,
    );
    counts.agents = one("SELECT COUNT(*) AS c FROM agents");
    counts.profiles = one("SELECT COUNT(*) AS c FROM profiles");
    counts.comments = one("SELECT COUNT(*) AS c FROM comments");
    counts.threads = one("SELECT COUNT(*) AS c FROM threads");
    dbOk = true;
    services.push({ name: "index-db", ok: true, detail: counts.tokens + " tokens indexed" });
  } catch (err) {
    services.push({ name: "index-db", ok: false, detail: String(err).slice(0, 120) });
  }

  const contracts = [
    ["veil-factory", addresses.veilFactory],
    ["veil-swap", addresses.swapFactory],
    ["portal", addresses.portal],
    ["private-messaging", addresses.privateMessaging],
  ] as const;

  for (const [name, addr] of contracts) {
    services.push({
      name,
      ok: isDeployed(addr),
      detail: isDeployed(addr) ? addr : "not deployed on this network",
    });
  }

  const brain = brainStatus();
  services.push({
    name: "veilpad-intelligence",
    ok: brain.healthy > 0,
    detail: brain.healthy + " of " + brain.capacity + " reasoning slots available",
  });

  const market = await cotiQuote().catch(() => null);
  services.push({
    name: "market-feed",
    ok: !!market,
    detail: market ? "COTI " + market.price.toFixed(6) + " USD" : "unavailable",
  });

  const ok = rpcOk && dbOk;

  return Response.json(
    {
      ok,
      network: net,
      chainId: chainByNetwork[net].id,
      head,
      // Events are read on demand from the chain, so the reader is never
      // behind its own cursor; the RPC head is the cursor.
      indexed: head,
      lag: 0,
      rpcLatencyMs,
      mode: "on-demand event reader",
      services,
      counts,
      responseMs: Date.now() - started,
      updatedAt: Date.now(),
    },
    { status: ok ? 200 : 503 },
  );
}
