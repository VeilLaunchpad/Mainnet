import { NextResponse, type NextRequest } from "next/server";
import { NETWORK_PIN_PARAM, isNetworkName } from "@/lib/chain";

/**
 * Keeps the shared cache from mixing the two networks up.
 *
 * Pages are rendered against whichever network the visitor chose, and that
 * choice travels in a cookie. The HTML is also cached at the edge for thirty
 * seconds, so without a `Vary` on that cookie one visitor's mainnet page would
 * be handed to the next visitor on testnet, contract addresses and all.
 *
 * This lives in middleware rather than in `next.config.ts` because Next writes
 * its own `Vary` for the router protocol and replaces anything set there.
 * Appending after the fact is the only placement that survives, and it appends
 * rather than overwrites so the router's own entries are left intact.
 */
export function middleware(req: NextRequest) {
  /**
   * A server component cannot read the query string of the request that is
   * rendering it, and the per-network proxy pins the network with exactly
   * that. Copying it onto a request header is the one place both can see it.
   */
  const pin = req.nextUrl.searchParams.get(NETWORK_PIN_PARAM);
  const forwarded = new Headers(req.headers);
  if (isNetworkName(pin)) forwarded.set("x-devox-network-pin", pin);

  const res = NextResponse.next({ request: { headers: forwarded } });

  const existing = res.headers.get("Vary");
  const parts = existing ? existing.split(",").map((p) => p.trim()) : [];
  if (!parts.some((p) => p.toLowerCase() === "cookie")) parts.push("Cookie");
  res.headers.set("Vary", parts.join(", "));

  return res;
}

export const config = {
  /**
   * Static assets are identical on both networks and are cached for a year, so
   * varying them on a cookie would only fragment the cache for nothing.
   */
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
