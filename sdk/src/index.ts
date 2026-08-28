import type {
  AgentEvent,
  AgentSummary,
  CandleResponse,
  Comment,
  Network,
  PortalPair,
  Profile,
  Timeframe,
  TokenDetail,
  TokenSummary,
  Trade,
} from "./types.js";

export * from "./types.js";

/**
 * Where the client points when nothing is passed.
 *
 * This is the public address of VEILPAD, not the origin behind it. Anyone
 * running their own deployment passes `baseUrl` instead.
 */
export const DEFAULT_BASE_URL = "https://veilpad-app.vercel.app";

export interface VeilpadOptions {
  /** Base URL of a VEILPAD deployment. Defaults to the public one. */
  baseUrl?: string;
  /** Passed to every fetch, so you can wire up your own retry or caching. */
  fetch?: typeof fetch;
  /** Milliseconds before a request is abandoned. Default 20000. */
  timeoutMs?: number;
  headers?: Record<string, string>;
  /**
   * Which COTI network to read.
   *
   * VEILPAD runs on both, and they share nothing: a token on one does not
   * exist on the other. Left unset, the deployment answers with its own
   * default, which is mainnet. Setting it here appends `?network=` to every
   * request, so a client is pinned for its whole lifetime rather than
   * depending on what the server happens to prefer.
   *
   * The per-network hosts do the same thing at the URL level:
   * `https://veilpad-mainnet.vercel.app` and `https://veilpad-testnet.vercel.app`.
   */
  network?: Network;
}

export class VeilpadError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly path: string,
  ) {
    super(message);
    this.name = "VeilpadError";
  }
}

/**
 * VEILPAD SDK.
 *
 * Read side only: everything here is a public read against the indexer, so no
 * key is needed and nothing you call can move funds. Writing is deliberately
 * left to your own wallet library, because signing belongs where the keys are.
 *
 * ```ts
 * const veil = new Veilpad();
 * const tokens = await veil.tokens.list({ sort: "progress" });
 * const chart = await veil.tokens.candles(tokens[0].address, "5m");
 * ```
 */
export class Veilpad {
  readonly baseUrl: string;
  private readonly doFetch: typeof fetch;
  private readonly timeoutMs: number;
  private readonly headers: Record<string, string>;
  readonly network?: Network;

  constructor(options: VeilpadOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.doFetch = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.headers = options.headers ?? {};
    this.network = options.network;

    if (!this.doFetch) {
      throw new Error("No fetch implementation available. Pass one via options.fetch.");
    }
  }

  /* ── low level ──────────────────────────────────────────────────────── */

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await this.doFetch(this.baseUrl + this.withNetwork(path), {
        ...init,
        signal: controller.signal,
        headers: { accept: "application/json", ...this.headers, ...(init.headers ?? {}) },
      });

      const text = await res.text();
      const json = text ? JSON.parse(text) : {};

      if (!res.ok) {
        throw new VeilpadError(json?.error ?? "HTTP " + res.status, res.status, path);
      }
      return json as T;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Attaches the chosen network, if one was chosen.
   *
   * A path that already names a network is left alone, so an explicit call
   * still wins over the client-wide setting.
   */
  private withNetwork(path: string): string {
    if (!this.network || /[?&]network=/.test(path)) return path;
    return path + (path.includes("?") ? "&" : "?") + "network=" + this.network;
  }

  private query(params: Record<string, string | number | undefined>): string {
    const parts = Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== "")
      .map(([k, v]) => encodeURIComponent(k) + "=" + encodeURIComponent(String(v)));
    return parts.length ? "?" + parts.join("&") : "";
  }

  /* ── config and health ──────────────────────────────────────────────── */

  /** The master table: chain params, contract addresses, launch economics. */
  config(section?: string) {
    return this.request<Record<string, unknown>>("/api/config" + this.query({ section }));
  }

  /** Compact summary of what is actually deployed. */
  chain() {
    return this.request<{
      app: string;
      network: Network;
      chainId: number;
      explorer: string;
      deployed: Record<string, string>;
      notDeployed: string[];
    }>("/api/config?digest=1");
  }

  /** Indexer health: head block, lag, and whether reads are trustworthy. */
  status() {
    return this.request<IndexerStatus>("/api/indexer/status");
  }

  stats() {
    return this.request<Record<string, unknown>>("/api/stats");
  }

  /* ── namespaces ─────────────────────────────────────────────────────── */

  readonly tokens = {
    list: (opts: { sort?: "new" | "progress" | "graduated"; limit?: number; q?: string; creator?: string } = {}) =>
      this.request<{ tokens: TokenSummary[]; network: Network }>(
        "/api/tokens" + this.query(opts),
      ).then((r) => r.tokens),

    get: (address: string) => this.request<TokenDetail>("/api/tokens/" + address),

    candles: (address: string, timeframe: Timeframe = "5m") =>
      this.request<CandleResponse>("/api/candles" + this.query({ token: address, tf: timeframe })),

    trades: (address: string, limit = 50) =>
      this.request<{ trades: Trade[] }>("/api/trades" + this.query({ token: address, limit })).then(
        (r) => r.trades,
      ),

    comments: (address: string, limit = 100) =>
      this.request<{ comments: Comment[] }>(
        "/api/comments" + this.query({ token: address, limit }),
      ).then((r) => r.comments),
  };

  readonly portal = {
    /** Every private twin the portal has minted, with its public escrow. */
    pairs: () =>
      this.request<{ deployed: boolean; portal: string; pairs: PortalPair[] }>("/api/portal"),

    /** The private twin of a public token, or null if nothing has crossed yet. */
    twinOf: async (publicToken: string) => {
      const { pairs } = await this.portal.pairs();
      return pairs.find((p) => p.underlying.toLowerCase() === publicToken.toLowerCase()) ?? null;
    },
  };

  readonly agents = {
    list: (opts: { owner?: string; kind?: string } = {}) =>
      this.request<{ agents: AgentSummary[] }>("/api/agents" + this.query(opts)).then((r) => r.agents),

    get: (slug: string) =>
      this.request<{ agent: AgentSummary; memory: string[]; events: unknown[]; threads: unknown[] }>(
        "/api/agents/" + slug,
      ),

    /**
     * Talks to an agent and yields its work as it happens: tool calls, streamed
     * text, and any signable proposal it produces.
     *
     * ```ts
     * for await (const ev of veil.agents.chat("shade", "what is worth buying")) {
     *   if (ev.type === "text") process.stdout.write(ev.text);
     * }
     * ```
     */
    chat: (
      agent: string,
      message: string,
      opts: { threadId?: string; address?: string; signal?: AbortSignal } = {},
    ) => this.streamChat(agent, message, opts),
  };

  readonly profiles = {
    get: (handleOrAddress: string) =>
      this.request<{ profile: Profile; balanceCoti: string; launches: TokenSummary[] }>(
        "/api/profile/" + encodeURIComponent(handleOrAddress.replace(/^@/, "")),
      ),

    list: () =>
      this.request<{ profiles: { username: string; address: string }[] }>("/api/profile").then(
        (r) => r.profiles,
      ),
  };

  /* ── streaming ──────────────────────────────────────────────────────── */

  private async *streamChat(
    agent: string,
    message: string,
    opts: { threadId?: string; address?: string; signal?: AbortSignal },
  ): AsyncGenerator<AgentEvent> {
    const res = await this.doFetch(this.baseUrl + "/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json", ...this.headers },
      body: JSON.stringify({ agent, message, threadId: opts.threadId, address: opts.address }),
      signal: opts.signal,
    });

    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => "");
      throw new VeilpadError(detail || "HTTP " + res.status, res.status, "/api/chat");
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          yield JSON.parse(payload) as AgentEvent;
        } catch {
          /* a partial frame is not worth failing the stream over */
        }
      }
    }
  }
}

export interface IndexerStatus {
  ok: boolean;
  network: Network;
  chainId: number;
  head: number;
  /** Highest block the indexer has read events from. */
  indexed: number;
  /** head minus indexed. Anything under a few blocks is healthy. */
  lag: number;
  rpcLatencyMs: number;
  services: { name: string; ok: boolean; detail: string }[];
  counts: Record<string, number>;
  updatedAt: number;
}

/** Convenience for the common case. */
export function createClient(options?: VeilpadOptions) {
  return new Veilpad(options);
}

export default Veilpad;
