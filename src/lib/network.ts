import {
  DEFAULT_NETWORK,
  NETWORK_COOKIE,
  NETWORK_PARAM,
  NETWORK_PIN_PARAM,
  hostPin,
  isNetworkName,
  type CotiNetworkName,
} from "./chain";

export interface NetworkResolution {
  net: CotiNetworkName;
  /**
   * True when the hostname decided it. A pinned host is not switchable in
   * place - the switch becomes a link to the other host instead of a cookie.
   */
  pinned: boolean;
  /** True when nothing at all said which network, so the visitor should be asked. */
  needsChoice: boolean;
}

/**
 * Which network a request is asking about.
 *
 * Order matters, and it runs from least to most negotiable.
 *
 * A pinned host wins outright. `devoxpad-mainnet.vercel.app` proxies with
 * `__net=mainnet`, and no cookie from a previous visit may override it - the
 * whole reason to have a per-network URL is that the link means one thing for
 * everyone who opens it.
 *
 * Then an explicit `?network=`, so a shared link still carries its meaning on
 * the apex. Then the cookie, so ordinary navigation keeps the choice already
 * made. Then the deployment default, and in that last case the visitor has
 * expressed nothing, which is what `needsChoice` reports so the apex can ask
 * rather than assume.
 *
 * Accepts a bare `Request`, so route handlers, the SDK and the Telegram webhook
 * all resolve a network the same way.
 */
export function resolveNetwork(req: Request): NetworkResolution {
  const url = safeUrl(req.url);

  const pin = url?.searchParams.get(NETWORK_PIN_PARAM);
  if (isNetworkName(pin)) return { net: pin, pinned: true, needsChoice: false };

  // Behind the proxy the origin sees its own host, so the original one arrives
  // as a forwarded header. Direct access uses Host as normal.
  const host =
    req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url?.host ?? null;
  const fromHost = hostPin(host);
  if (fromHost) return { net: fromHost, pinned: true, needsChoice: false };

  const q = url?.searchParams.get(NETWORK_PARAM);
  if (isNetworkName(q)) return { net: q, pinned: false, needsChoice: false };

  const cookie = cookieValue(req.headers.get("cookie"), NETWORK_COOKIE);
  if (isNetworkName(cookie)) return { net: cookie, pinned: false, needsChoice: false };

  return { net: DEFAULT_NETWORK, pinned: false, needsChoice: true };
}

/** The network alone, for the many callers that do not care how it was decided. */
export function networkFrom(req: Request): CotiNetworkName {
  return resolveNetwork(req).net;
}

function safeUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

/**
 * Reads one cookie without pulling in a parser. Values here are `mainnet` or
 * `testnet` and are validated by the caller, so anything unexpected simply
 * falls through to the default rather than being trusted.
 */
function cookieValue(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}
