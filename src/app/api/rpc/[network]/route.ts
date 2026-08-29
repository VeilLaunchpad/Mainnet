import type { NextRequest } from "next/server";
import { isNetworkName, chainByNetwork } from "@/lib/chain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A same-origin JSON-RPC proxy for COTI.
 *
 * This exists because of a real bug on COTI's side, not a preference. The
 * mainnet endpoint answers browser requests with the CORS header duplicated:
 *
 *     Access-Control-Allow-Origin: *
 *     Access-Control-Allow-Origin: *
 *
 * A browser reads that as the single value "*, *", decides it is not a valid
 * origin, and blocks the response. Every read the app made from the browser
 * against mainnet therefore failed - which is why pages that work perfectly
 * from a script showed nothing at all on screen. Testnet sends the header once
 * and was unaffected, which is exactly why the symptom looked like a mainnet
 * data problem rather than a transport one.
 *
 * Forwarding through here makes the request same-origin, so CORS never enters
 * into it. Server-side code keeps talking to the RPC directly, because Node
 * does not enforce CORS and the extra hop would be waste.
 *
 * The method allowlist is an allowlist on purpose. A blocklist here would have
 * to anticipate every namespace a node might expose, and that is the kind of
 * guess that is wrong quietly.
 */

const ALLOWED = new Set([
  // reads the app actually makes
  "eth_call",
  "eth_estimateGas",
  "eth_gasPrice",
  "eth_maxPriorityFeePerGas",
  "eth_feeHistory",
  "eth_blockNumber",
  "eth_chainId",
  "eth_getBalance",
  "eth_getCode",
  "eth_getStorageAt",
  "eth_getLogs",
  "eth_getTransactionCount",
  "eth_getTransactionByHash",
  "eth_getTransactionReceipt",
  "eth_getBlockByNumber",
  "eth_getBlockByHash",
  "eth_createAccessList",
  "net_version",
  "web3_clientVersion",
  // Broadcasting an already-signed transaction. The signature was produced in
  // the user's wallet; this only relays the bytes, and anyone could relay them
  // to the same public node without us.
  "eth_sendRawTransaction",
]);

interface RpcCall {
  method?: unknown;
  id?: unknown;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ network: string }> }) {
  const { network } = await ctx.params;
  if (!isNetworkName(network)) {
    return Response.json({ error: "unknown network" }, { status: 404 });
  }

  const body = await req.text();
  if (body.length > 1_000_000) {
    return Response.json({ error: "payload too large" }, { status: 413 });
  }

  let parsed: RpcCall | RpcCall[];
  try {
    parsed = JSON.parse(body);
  } catch {
    return Response.json({ error: "malformed JSON-RPC" }, { status: 400 });
  }

  // A batch is a JSON array, and every call in it has to pass on its own.
  const calls = Array.isArray(parsed) ? parsed : [parsed];
  if (calls.length > 100) {
    return Response.json({ error: "batch too large" }, { status: 413 });
  }

  const blocked = calls.find((c) => typeof c?.method !== "string" || !ALLOWED.has(c.method as string));
  if (blocked) {
    return Response.json(
      {
        jsonrpc: "2.0",
        id: (blocked.id as number) ?? null,
        error: { code: -32601, message: "method not proxied: " + String(blocked.method) },
      },
      { status: 200 },
    );
  }

  const upstream = chainByNetwork[network].rpcUrls.default.http[0];

  try {
    const res = await fetch(upstream, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      // A hung upstream should surface as an error, not as a page that spins
      // forever with no explanation.
      signal: AbortSignal.timeout(30_000),
    });

    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    return Response.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32603, message: "upstream RPC unreachable: " + String((e as Error).message) },
      },
      { status: 502 },
    );
  }
}
