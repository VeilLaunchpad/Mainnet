import type { NextRequest } from "next/server";
import { parseUnits, type Address } from "viem";
import { networkFrom } from "@/lib/network";
import { publicClient } from "@/lib/rpc";
import { addressesFor, isDeployed } from "@/lib/addresses";
import { erc20Abi, devoxSwapFactoryAbi, devoxSwapRouterAbi } from "@/lib/abis";
import { routeCarbon } from "@/lib/carbon-route";
import { isAddress } from "@/lib/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One quote endpoint, two venues.
 *
 * DevoxSwap is preferred when it has a pair, because it is a constant-product
 * pool: the price is continuous, the route is one hop, and the gas is
 * predictable. When it does not - which is every token this launchpad did not
 * create - the order book is asked instead, and if it has depth the swap works
 * exactly the same from the user's side.
 *
 * The venue is reported rather than hidden. Somebody trading their own token
 * should be able to see that it filled against posted orders rather than a
 * pool, because the two behave differently: an order book can fill part of a
 * trade and then run out, and a pool cannot.
 */

const NATIVE = "0x0000000000000000000000000000000000000000" as Address;

export async function GET(req: NextRequest) {
  const net = networkFrom(req);
  const a = addressesFor(net);
  const client = publicClient(net);

  const token = req.nextUrl.searchParams.get("token") ?? "";
  const side = req.nextUrl.searchParams.get("side") === "sell" ? "sell" : "buy";
  const amountRaw = req.nextUrl.searchParams.get("amount") ?? "0";

  if (!isAddress(token)) {
    return Response.json({ ok: false, error: "bad token address" }, { status: 400 });
  }

  let decimals = 18;
  try {
    decimals = Number(
      await client.readContract({ address: token as Address, abi: erc20Abi, functionName: "decimals" }),
    );
  } catch {
    return Response.json({ ok: false, error: "not an ERC-20 on " + net }, { status: 404 });
  }

  // Buying spends COTI (18dp); selling spends the token.
  const inDecimals = side === "buy" ? 18 : decimals;
  let amountIn: bigint;
  try {
    amountIn = parseUnits(amountRaw, inDecimals);
  } catch {
    return Response.json({ ok: false, error: "bad amount" }, { status: 400 });
  }
  if (amountIn <= 0n) return Response.json({ ok: false, error: "amount is zero" }, { status: 400 });

  /* ── DevoxSwap first ───────────────────────────────────────────────────── */
  if (isDeployed(a.swapFactory) && isDeployed(a.swapRouter)) {
    const pair = (await client
      .readContract({
        address: a.swapFactory,
        abi: devoxSwapFactoryAbi,
        functionName: "getPair",
        args: [token as Address, a.wcoti],
      })
      .catch(() => NATIVE)) as Address;

    if (isDeployed(pair)) {
      const out = (await client
        .readContract({
          address: a.swapRouter,
          abi: devoxSwapRouterAbi,
          functionName: side === "buy" ? "quoteBuyWithCoti" : "quoteSellForCoti",
          args: [token as Address, amountIn],
        })
        .catch(() => null)) as bigint | null;

      if (out !== null && out > 0n) {
        return Response.json({
          ok: true,
          venue: "devoxswap",
          venueLabel: "DevoxSwap",
          network: net,
          side,
          token,
          decimals,
          amountIn: amountIn.toString(),
          amountOut: out.toString(),
          partial: false,
          pair,
          note: "A DevoxSwap pool. One hop, continuous pricing.",
        });
      }
    }
  }

  /* ── otherwise the order book ─────────────────────────────────────────── */
  const source = side === "buy" ? NATIVE : (token as Address);
  const target = side === "buy" ? (token as Address) : NATIVE;

  const route = await routeCarbon(net, source, target, amountIn).catch(() => null);

  if (!route) {
    return Response.json({
      ok: false,
      error: "no-route",
      message:
        "Neither DevoxSwap nor the order book can fill this. DevoxSwap has no pair for this token, and nobody has posted an order for it against COTI.",
      network: net,
      token,
    });
  }

  return Response.json({
    ok: true,
    venue: "carbon",
    venueLabel: "Order book",
    network: net,
    side,
    token,
    decimals,
    amountIn: route.amountIn,
    amountOut: route.amountOut,
    partial: route.partial,
    actions: route.actions,
    strategiesUsed: route.strategiesUsed,
    note: route.partial
      ? "Filled against " +
        route.strategiesUsed +
        " posted orders. There was not enough depth for the whole amount, so this quote is for what the book can actually cover."
      : "Filled against " + route.strategiesUsed + " posted orders, cheapest first.",
  });
}
