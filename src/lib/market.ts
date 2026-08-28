/**
 * Market + research data. Everything here runs server-side so no key ever
 * reaches the browser. Each provider degrades independently: if CoinGecko is
 * throttled the agent still gets news, and vice versa.
 */

const CG = process.env.COINGECKO_BASE || "https://api.coingecko.com/api/v3";
const CG_KEY = process.env.COINGECKO_KEY || "";
const DEXS = process.env.DEXSCREENER_BASE || "https://api.dexscreener.com";
const EXA_SEARCH = process.env.EXA_SEARCH_URL || "https://api.exa.ai/search";

const cache = new Map<string, { at: number; data: unknown }>();

async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.data as T;
  const data = await fn();
  cache.set(key, { at: Date.now(), data });
  return data;
}

export interface CoinQuote {
  id: string;
  symbol: string;
  price: number;
  change24h: number;
  marketCap: number;
  volume24h: number;
}

/** COTI's own market state - the denominator for every price on VEILPAD. */
export async function cotiQuote(): Promise<CoinQuote | null> {
  return cached("coti-quote", 60_000, async () => {
    try {
      const url = new URL(CG + "/simple/price");
      url.searchParams.set("ids", "coti");
      url.searchParams.set("vs_currencies", "usd");
      url.searchParams.set("include_24hr_change", "true");
      url.searchParams.set("include_market_cap", "true");
      url.searchParams.set("include_24hr_vol", "true");
      const res = await fetch(url, {
        headers: CG_KEY ? { "x-cg-demo-api-key": CG_KEY } : {},
        next: { revalidate: 60 },
      });
      if (!res.ok) return null;
      const j = (await res.json()) as Record<string, Record<string, number>>;
      const c = j.coti;
      if (!c) return null;
      return {
        id: "coti",
        symbol: "COTI",
        price: c.usd ?? 0,
        change24h: c.usd_24h_change ?? 0,
        marketCap: c.usd_market_cap ?? 0,
        volume24h: c.usd_24h_vol ?? 0,
      };
    } catch {
      return null;
    }
  });
}

export async function coinQuotes(ids: string[]): Promise<Record<string, CoinQuote>> {
  if (!ids.length) return {};
  const key = "coins:" + ids.sort().join(",");
  return cached(key, 60_000, async () => {
    try {
      const url = new URL(CG + "/simple/price");
      url.searchParams.set("ids", ids.join(","));
      url.searchParams.set("vs_currencies", "usd");
      url.searchParams.set("include_24hr_change", "true");
      url.searchParams.set("include_market_cap", "true");
      url.searchParams.set("include_24hr_vol", "true");
      const res = await fetch(url, { headers: CG_KEY ? { "x-cg-demo-api-key": CG_KEY } : {} });
      if (!res.ok) return {};
      const j = (await res.json()) as Record<string, Record<string, number>>;
      const out: Record<string, CoinQuote> = {};
      for (const [id, v] of Object.entries(j)) {
        out[id] = {
          id,
          symbol: id.toUpperCase(),
          price: v.usd ?? 0,
          change24h: v.usd_24h_change ?? 0,
          marketCap: v.usd_market_cap ?? 0,
          volume24h: v.usd_24h_vol ?? 0,
        };
      }
      return out;
    } catch {
      return {};
    }
  });
}

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

/** OHLC for the COTI/USD reference chart. */
export async function cotiCandles(days = 1): Promise<Candle[]> {
  return cached("coti-ohlc-" + days, 120_000, async () => {
    try {
      const url = new URL(CG + "/coins/coti/ohlc");
      url.searchParams.set("vs_currency", "usd");
      url.searchParams.set("days", String(days));
      const res = await fetch(url, { headers: CG_KEY ? { "x-cg-demo-api-key": CG_KEY } : {} });
      if (!res.ok) return [];
      const raw = (await res.json()) as number[][];
      return raw.map(([t, o, h, l, c]) => ({
        time: Math.floor(t / 1000),
        open: o,
        high: h,
        low: l,
        close: c,
      }));
    } catch {
      return [];
    }
  });
}

export async function dexPairs(query: string) {
  return cached("dex:" + query, 60_000, async () => {
    try {
      const res = await fetch(DEXS + "/latest/dex/search?q=" + encodeURIComponent(query));
      if (!res.ok) return [];
      const j = (await res.json()) as { pairs?: unknown[] };
      return (j.pairs || []).slice(0, 10);
    } catch {
      return [];
    }
  });
}

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

/**
 * Web research for the agents. Exa keys are tried in order; a spent key (402)
 * or throttled key (429) rolls to the next, and when all are gone we fall back
 * to DuckDuckGo so research never fully stops working.
 */
export async function webSearch(query: string, limit = 5): Promise<SearchHit[]> {
  const keys = (process.env.EXA_KEYS || "").split(",").map((k) => k.trim()).filter(Boolean);

  for (const key of keys) {
    try {
      const res = await fetch(EXA_SEARCH, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": key },
        body: JSON.stringify({
          query,
          numResults: limit,
          type: "auto",
          contents: { text: { maxCharacters: 600 } },
        }),
      });
      if (res.status === 402 || res.status === 429) continue;
      if (!res.ok) continue;
      const j = (await res.json()) as {
        results?: { title?: string; url?: string; text?: string }[];
      };
      const hits = (j.results || []).map((r) => ({
        title: r.title || "",
        url: r.url || "",
        snippet: (r.text || "").slice(0, 600),
      }));
      if (hits.length) return hits;
    } catch {
      continue;
    }
  }

  try {
    const res = await fetch(
      "https://api.duckduckgo.com/?format=json&no_html=1&q=" + encodeURIComponent(query),
    );
    if (!res.ok) return [];
    const j = (await res.json()) as {
      AbstractText?: string;
      AbstractURL?: string;
      Heading?: string;
      RelatedTopics?: { Text?: string; FirstURL?: string }[];
    };
    const out: SearchHit[] = [];
    if (j.AbstractText) {
      out.push({ title: j.Heading || query, url: j.AbstractURL || "", snippet: j.AbstractText });
    }
    for (const t of j.RelatedTopics || []) {
      if (out.length >= limit) break;
      if (t.Text) out.push({ title: t.Text.slice(0, 90), url: t.FirstURL || "", snippet: t.Text });
    }
    return out;
  } catch {
    return [];
  }
}
