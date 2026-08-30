import { cookies, headers } from "next/headers";
import {
  DEFAULT_NETWORK,
  NETWORK_COOKIE,
  NETWORK_PIN_PARAM,
  hostPin,
  isNetworkName,
  type CotiNetworkName,
} from "./chain";
import type { NetworkResolution } from "./network";

/**
 * The selected network, for a server component.
 *
 * Route handlers get theirs from `resolveNetwork(req)`; a server component has
 * no request object, so it reads the same signals through Next's accessors and
 * applies the same precedence. Both end at the same value, which is what keeps
 * a server-rendered page and the client tree that hydrates it describing the
 * same chain.
 *
 * The pin arrives twice over: as a query parameter the proxy attached, and as
 * the forwarded hostname. Either is enough, and checking both means a direct
 * hit on the origin behaves the same as one through the proxy.
 */
export async function serverNetworkResolution(): Promise<NetworkResolution> {
  const h = await headers();

  const host = h.get("x-forwarded-host") ?? h.get("host");
  const fromHost = hostPin(host);
  if (fromHost) return { net: fromHost, pinned: true, needsChoice: false };

  // Middleware copies the pin onto the request so a server component can see a
  // query parameter it otherwise has no access to.
  const pin = h.get("x-devox-network-pin");
  if (isNetworkName(pin)) return { net: pin, pinned: true, needsChoice: false };

  const stored = (await cookies()).get(NETWORK_COOKIE)?.value;
  if (isNetworkName(stored)) return { net: stored, pinned: false, needsChoice: false };

  return { net: DEFAULT_NETWORK, pinned: false, needsChoice: true };
}

/** Just the network, for pages that only need to render against one. */
export async function serverNetwork(): Promise<CotiNetworkName> {
  return (await serverNetworkResolution()).net;
}

export { NETWORK_PIN_PARAM };
