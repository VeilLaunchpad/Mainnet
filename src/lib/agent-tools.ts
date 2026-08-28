import type { Address } from "viem";
import type { ToolSpec } from "./llm";
import { db, rows, row, now } from "./db";
import { publicClient, readToken, readCurve, readPool, findPair, chainInfo } from "./rpc";
import { chainDigest } from "./master";
import { addresses, isDeployed, DEFAULT_FEE_TIER } from "./addresses";
import { cotiQuote, webSearch, cotiCandles, dexPairs } from "./market";
import { veilCurveAbi, veilSwapRouterAbi } from "./abis";
import { fmtUnits, isAddress } from "./format";
import { appUrl } from "@/lib/app-url";

/**
 * The agent's hands.
 *
 * Two classes of tool:
 *   READ  - hits the chain / market / index and returns facts.
 *   ACT   - returns an `action` envelope. The UI renders it as a signable card
 *           so the user keeps custody; an agent in `auto` mode with a server
 *           signer can execute it directly. Either way the agent gets a
 *           structured receipt back and keeps talking.
 */

export interface ToolContext {
  /** Connected wallet, when the conversation has one. */
  user?: Address | null;
  agentId?: string;
  threadId?: string;
  autonomy?: "advisory" | "approval" | "auto";
}

export interface ToolResult {
  ok: boolean;
  [k: string]: unknown;
}

type Handler = (args: Record<string, any>, ctx: ToolContext) => Promise<ToolResult>;

interface Tool {
  spec: ToolSpec;
  run: Handler;
}

const registry = new Map<string, Tool>();

function tool(
  name: string,
  description: string,
  parameters: Record<string, unknown>,
  run: Handler,
) {
  registry.set(name, {
    spec: { type: "function", function: { name, description, parameters } },
    run,
  });
}

const obj = (props: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties: props,
  required,
});

const str = (description: string) => ({ type: "string", description });
const num = (description: string) => ({ type: "number", description });
const bool = (description: string) => ({ type: "boolean", description });

/* ── READ: chain + market ─────────────────────────────────────────────── */

tool(
  "get_chain_info",
  "Current COTI network: chain id, explorer, faucet, launch economics, and which VEILPAD contracts are actually deployed. Call this before promising an action that needs a contract.",
  obj({}),
  async () => {
    // The master table is the registry of record; chainInfo() is the live
    // fallback if the config file is missing.
    const digest = chainDigest();
    return digest ? { ok: true, ...digest } : { ok: true, ...chainInfo() };
  },
);

tool(
  "get_coti_market",
  "Live COTI/USD price, 24h change, market cap and volume. This is the denominator for every price quoted on VEILPAD.",
  obj({}),
  async () => {
    const q = await cotiQuote();
    if (!q) return { ok: false, error: "market feed unavailable" };
    return { ok: true, ...q };
  },
);

tool(
  "get_coti_candles",
  "OHLC candles for COTI/USD. Use for trend and volatility reasoning before proposing a trade.",
  obj({ days: num("Lookback window in days: 1, 7, 30 or 90. Default 1.") }),
  async (a) => {
    const candles = await cotiCandles(Number(a.days) || 1);
    if (!candles.length) return { ok: false, error: "no candles" };
    const closes = candles.map((c) => c.close);
    const first = closes[0];
    const last = closes[closes.length - 1];
    const hi = Math.max(...candles.map((c) => c.high));
    const lo = Math.min(...candles.map((c) => c.low));
    return {
      ok: true,
      points: candles.length,
      open: first,
      close: last,
      high: hi,
      low: lo,
      changePct: first ? ((last - first) / first) * 100 : 0,
      rangePct: lo ? ((hi - lo) / lo) * 100 : 0,
      candles: candles.slice(-40),
    };
  },
);

tool(
  "search_web",
  "Search the live web for news, sentiment or protocol docs. Use it before making a market claim you are not certain about.",
  obj({ query: str("What to search for."), limit: num("Max results, default 5.") }, ["query"]),
  async (a) => {
    const hits = await webSearch(String(a.query), Number(a.limit) || 5);
    return { ok: true, count: hits.length, results: hits };
  },
);

tool(
  "get_native_balance",
  "Native COTI balance of an address. Defaults to the connected wallet.",
  obj({ address: str("0x address. Omit to use the connected wallet.") }),
  async (a, ctx) => {
    const target = (a.address || ctx.user) as Address | undefined;
    if (!target || !isAddress(target)) return { ok: false, error: "no address available" };
    const bal = await publicClient().getBalance({ address: target });
    return { ok: true, address: target, wei: bal.toString(), coti: fmtUnits(bal, 18, 6) };
  },
);

tool(
  "read_token",
  "Read an on-chain token: name, symbol, decimals and whether it is a COTI PrivateERC20 with encrypted balances.",
  obj({ address: str("Token contract address.") }, ["address"]),
  async (a) => {
    if (!isAddress(String(a.address))) return { ok: false, error: "invalid address" };
    const t = await readToken(a.address as Address);
    if (!t) return { ok: false, error: "not a readable token" };
    return {
      ok: true,
      ...t,
      totalSupply: t.totalSupply?.toString() ?? null,
      note: t.isPrivate
        ? "PrivateERC20: totalSupply is intentionally 0 and balances are ciphertext. Only the key holder can decrypt."
        : "Standard ERC20 with public balances.",
    };
  },
);

/* ── READ: VEILPAD index ──────────────────────────────────────────────── */

interface TokenRow {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  description: string;
  image: string;
  creator: string;
  kind: string;
  curve: string;
  pool: string;
  fee_tier: number;
  graduated: number;
  agent_id: string;
  created_at: number;
}

tool(
  "list_launches",
  "List tokens launched on VEILPAD. Sort by 'new', 'progress' (closest to graduating into its VeilSwap pair) or 'graduated'.",
  obj({
    sort: str("'new' | 'progress' | 'graduated'. Default 'new'."),
    limit: num("Max rows, default 10, cap 50."),
    query: str("Optional text filter on name or symbol."),
  }),
  async (a) => {
    const limit = Math.min(50, Math.max(1, Number(a.limit) || 10));
    const sort = String(a.sort || "new");
    const q = a.query ? "%" + String(a.query).toLowerCase() + "%" : null;

    let sql = "SELECT * FROM tokens";
    const params: unknown[] = [];
    const where: string[] = [];
    if (q) {
      where.push("(lower(name) LIKE ? OR lower(symbol) LIKE ?)");
      params.push(q, q);
    }
    if (sort === "graduated") where.push("graduated = 1");
    if (where.length) sql += " WHERE " + where.join(" AND ");
    sql += " ORDER BY created_at DESC LIMIT ?";
    params.push(limit);

    const list = rows<TokenRow>(db().prepare(sql).all(...(params as never[])));

    const enriched = await Promise.all(
      list.map(async (t) => {
        const curve = isDeployed(t.curve) ? await readCurve(t.curve as Address) : null;
        return {
          address: t.address,
          name: t.name,
          symbol: t.symbol,
          image: t.image,
          creator: t.creator,
          kind: t.kind,
          graduated: !!t.graduated || !!curve?.graduated,
          curve: t.curve,
          pool: curve?.pool || t.pool,
          progressPct: curve?.progress ?? 0,
          reserveCoti: curve ? fmtUnits(curve.reserve, 18, 4) : "0",
          url: "/coti/" + t.address,
          createdAt: t.created_at,
        };
      }),
    );

    if (sort === "progress") enriched.sort((x, y) => y.progressPct - x.progressPct);
    return { ok: true, count: enriched.length, tokens: enriched };
  },
);

tool(
  "get_token",
  "Full detail on one VEILPAD token: metadata, bonding-curve state, graduation progress, VeilSwap pair and recent trades.",
  obj({ address: str("Token contract address.") }, ["address"]),
  async (a) => {
    const addr = String(a.address);
    if (!isAddress(addr)) return { ok: false, error: "invalid address" };

    const t = row<TokenRow>(
      db().prepare("SELECT * FROM tokens WHERE lower(address) = lower(?)").get(addr),
    );
    const onchain = await readToken(addr as Address);
    if (!t && !onchain) return { ok: false, error: "token not found on VEILPAD or on-chain" };

    const curve = t && isDeployed(t.curve) ? await readCurve(t.curve as Address) : null;
    const poolAddr = curve?.pool || t?.pool || (await findPair(addr as Address)) || "";
    const pool = isDeployed(poolAddr) ? await readPool(poolAddr as Address, addr as Address) : null;

    const trades = rows(
      db()
        .prepare("SELECT side, coti_in, token_out, price, private, created_at FROM trades WHERE lower(token) = lower(?) ORDER BY id DESC LIMIT 15")
        .all(addr),
    );

    const coti = await cotiQuote();
    const priceCoti = curve ? Number(curve.spotPrice) / 1e18 : null;

    return {
      ok: true,
      address: addr,
      url: "/coti/" + addr,
      name: t?.name || onchain?.name,
      symbol: t?.symbol || onchain?.symbol,
      decimals: t?.decimals ?? onchain?.decimals ?? 18,
      description: t?.description || "",
      image: t?.image || "",
      creator: t?.creator || "",
      isPrivate: onchain?.isPrivate ?? t?.kind === "private",
      curve: t?.curve || null,
      curveState: curve
        ? {
            reserveCoti: fmtUnits(curve.reserve, 18, 6),
            sold: fmtUnits(curve.sold, t?.decimals ?? 18, 4),
            graduated: curve.graduated,
            progressPct: curve.progress,
            targetCoti: fmtUnits(curve.graduationTarget, 18, 2),
            spotPriceCoti: priceCoti,
            spotPriceUsd: priceCoti && coti ? priceCoti * coti.price : null,
          }
        : null,
      pool: pool
        ? {
            address: pool.pair,
            venue: "VeilSwap",
            feeBps: pool.feeBps,
            reserveToken: fmtUnits(pool.reserveToken, t?.decimals ?? 18, 4),
            reserveCoti: fmtUnits(pool.reserveCoti, 18, 6),
            priceCoti: pool.price,
            priceUsd: coti ? pool.price * coti.price : null,
          }
        : null,
      recentTrades: trades,
    };
  },
);

tool(
  "quote_trade",
  "Price a buy or sell before proposing it. Uses the bonding curve pre-graduation and the VeilSwap router once the token has a pair.",
  obj(
    {
      token: str("Token address."),
      side: str("'buy' or 'sell'."),
      amount: str("Amount in COTI when buying, in tokens when selling."),
    },
    ["token", "side", "amount"],
  ),
  async (a) => {
    const addr = String(a.token);
    if (!isAddress(addr)) return { ok: false, error: "invalid token address" };
    const side = String(a.side).toLowerCase() === "sell" ? "sell" : "buy";

    const t = row<TokenRow>(
      db().prepare("SELECT * FROM tokens WHERE lower(address) = lower(?)").get(addr),
    );
    const decimals = t?.decimals ?? 18;
    const amtWei = (() => {
      const raw = String(a.amount).replace(/,/g, "");
      const d = side === "buy" ? 18 : decimals;
      const [w, f = ""] = raw.split(".");
      return BigInt(w || "0") * 10n ** BigInt(d) + BigInt((f + "0".repeat(d)).slice(0, d) || "0");
    })();
    if (amtWei <= 0n) return { ok: false, error: "amount must be > 0" };

    const curve = t && isDeployed(t.curve) ? await readCurve(t.curve as Address) : null;

    if (curve && !curve.graduated) {
      const c = publicClient();
      const out = (await c.readContract({
        address: t!.curve as Address,
        abi: veilCurveAbi,
        functionName: side === "buy" ? "quoteBuy" : "quoteSell",
        args: [amtWei],
      })) as bigint;
      return {
        ok: true,
        venue: "VEILPAD bonding curve",
        side,
        amountIn: String(a.amount),
        amountOut: fmtUnits(out, side === "buy" ? decimals : 18, 6),
        amountOutWei: out.toString(),
        graduationProgressPct: curve.progress,
      };
    }

    // Post-graduation the venue is the VeilSwap pair, quoted through the
    // router so the number matches what a swap would actually pay.
    const poolAddr = curve?.pool || t?.pool || (await findPair(addr as Address)) || "";
    if (!isDeployed(poolAddr) || !isDeployed(addresses.swapRouter)) {
      return {
        ok: false,
        error: "no bonding curve and no VeilSwap pair for this token yet",
      };
    }

    try {
      const out = (await publicClient().readContract({
        address: addresses.swapRouter,
        abi: veilSwapRouterAbi,
        functionName: side === "buy" ? "quoteBuyWithCoti" : "quoteSellForCoti",
        args: [addr as Address, amtWei],
      })) as bigint;

      if (out === 0n) return { ok: false, error: "pair has no liquidity" };

      return {
        ok: true,
        venue: "VeilSwap",
        feeBps: 30,
        side,
        amountIn: String(a.amount),
        amountOut: fmtUnits(out, side === "buy" ? decimals : 18, 6),
        amountOutWei: out.toString(),
        pair: poolAddr,
      };
    } catch (e) {
      return { ok: false, error: "router quote failed: " + String(e).slice(0, 160) };
    }
  },
);

tool(
  "get_profile",
  "Look up a VEILPAD profile by username or address. Returns their launches, agents and public activity.",
  obj({ handle: str("Username (without @) or 0x address.") }, ["handle"]),
  async (a) => {
    const h = String(a.handle).replace(/^@/, "").toLowerCase();
    const p = row<Record<string, unknown>>(
      db()
        .prepare("SELECT * FROM profiles WHERE lower(username) = ? OR lower(address) = ?")
        .get(h, h),
    );
    if (!p) return { ok: false, error: "no profile for " + h };
    const addr = String(p.address);
    const launches = rows(
      db()
        .prepare("SELECT address, name, symbol, created_at FROM tokens WHERE lower(creator) = lower(?) ORDER BY created_at DESC LIMIT 20")
        .all(addr),
    );
    const agents = rows(
      db()
        .prepare("SELECT id, slug, name, kind, autonomy, status FROM agents WHERE lower(owner) = lower(?)")
        .all(addr),
    );
    return {
      ok: true,
      username: p.username,
      address: addr,
      displayName: p.display_name,
      bio: p.bio,
      isAgent: !!p.is_agent,
      url: "/profile/" + p.username,
      launches,
      agents,
    };
  },
);

tool(
  "list_agents",
  "List agents registered on VEILPAD, optionally filtered by kind ('trader', 'social', 'research', 'ops').",
  obj({ kind: str("Optional kind filter."), limit: num("Max rows, default 10.") }),
  async (a) => {
    const limit = Math.min(50, Number(a.limit) || 10);
    const list = a.kind
      ? rows(
          db()
            .prepare("SELECT id, slug, name, kind, tagline, autonomy, status, token FROM agents WHERE kind = ? ORDER BY created_at DESC LIMIT ?")
            .all(String(a.kind), limit),
        )
      : rows(
          db()
            .prepare("SELECT id, slug, name, kind, tagline, autonomy, status, token FROM agents ORDER BY created_at DESC LIMIT ?")
            .all(limit),
        );
    return { ok: true, count: list.length, agents: list };
  },
);

/* ── ACT: proposals the user signs (or the agent executes in auto mode) ── */

/**
 * An action envelope. The chat UI turns this into a card with an Execute
 * button wired to the connected wallet, so the agent can *act* without ever
 * holding the user's keys.
 */
function action(kind: string, payload: Record<string, unknown>, summary: string): ToolResult {
  return {
    ok: true,
    action: { kind, payload, summary, id: kind + "_" + Math.random().toString(36).slice(2, 10) },
    status: "awaiting_signature",
    note: "Proposal surfaced to the user as a signable card. Tell them what it does and why, then continue the conversation.",
  };
}

tool(
  "propose_trade",
  "Propose a buy or sell for the user to sign. Always quote_trade first so the numbers you state are real. Explain your reasoning in the chat, not only in the reason field.",
  obj(
    {
      token: str("Token address."),
      side: str("'buy' or 'sell'."),
      amount: str("COTI amount when buying, token amount when selling."),
      slippageBps: num("Slippage tolerance in basis points. Default 300 (3%)."),
      reason: str("One sentence on why now."),
    },
    ["token", "side", "amount", "reason"],
  ),
  async (a) => {
    if (!isAddress(String(a.token))) return { ok: false, error: "invalid token address" };
    const side = String(a.side).toLowerCase() === "sell" ? "sell" : "buy";
    const t = row<TokenRow>(
      db().prepare("SELECT * FROM tokens WHERE lower(address) = lower(?)").get(String(a.token)),
    );
    return action(
      "trade",
      {
        token: a.token,
        symbol: t?.symbol || "",
        curve: t?.curve || "",
        pool: t?.pool || "",
        decimals: t?.decimals ?? 18,
        side,
        amount: String(a.amount),
        slippageBps: Number(a.slippageBps) || 300,
        reason: String(a.reason),
      },
      `${side === "buy" ? "Buy" : "Sell"} ${a.amount} ${side === "buy" ? "COTI of" : ""} ${t?.symbol || "token"}`,
    );
  },
);

/**
 * The bridge, from the contracts rather than from a search engine.
 *
 * Without this an agent asked "what can the bridge carry" reaches for the web,
 * gets partial snippets, and then honestly refuses to name the assets. The app
 * already reads this live off chain, so the agent should read the same thing.
 */
tool(
  "get_bridge",
  "Authoritative, live state of both VEILPAD bridges: which assets the privacy bridge carries between COTI and COTI Private, whether each is open, how much is escrowed, and which assets cross between Ethereum and COTI. Use this instead of searching the web for bridge facts.",
  obj({}),
  async () => {
    const base = appUrl();
    const res = await fetch(base + "/api/bridge/assets").catch(() => null);
    if (!res?.ok) return { ok: false, error: "could not read the bridge" };

    const d = (await res.json()) as {
      network: string;
      privacy: { available: boolean; assets: Record<string, unknown>[] };
      crossChain: {
        available: boolean;
        ethName: string;
        assets: Record<string, unknown>[];
        reason: string | null;
      };
    };

    return {
      ok: true,
      network: d.network,
      privacyBridge: {
        note: "Public token in, encrypted twin out. Verified contracts on COTI, signed in VEILPAD.",
        assets: d.privacy.assets.map((a) => ({
          symbol: a.symbol,
          open: a.open,
          decimals: a.decimals,
          escrowed: a.liability,
          canRelease: a.liquidity,
        })),
      },
      crossChain: {
        available: d.crossChain.available,
        route: d.crossChain.ethName + " <-> COTI",
        assets: d.crossChain.assets.map((a) => a.symbol),
        reason: d.crossChain.reason,
        note: "A transfer to the address COTI's relayer watches. It credits the sending address, so never send from an exchange.",
      },
    };
  },
);

tool(
  "propose_launch",
  [
    "Propose launching a new private token on VEILPAD. The user signs the launch transaction.",
    "Supply is FIXED at 1,000,000,000 tokens for every launch. There is no supply choice, so never ask the user for one.",
    "Every token starts on a bonding curve and graduates into a VeilSwap pair once the curve fills.",
    "The only things you need from the user are a ticker, a name and a description. An image, socials and a dev buy are optional.",
    "Whether the dev's own tokens are kept, burned or locked is chosen on the launch page when they sign, not here.",
  ].join(" "),
  obj(
    {
      name: str("Token name."),
      symbol: str("Ticker, 2-10 chars."),
      description: str("What the token is for."),
      image: str("Optional image URL or ipfs:// URI."),
      devBuy: str("Optional COTI amount the creator buys of their own token in the launch transaction, e.g. '0.5'."),
      privateBalances: bool("Encrypt holder balances with COTI garbled circuits. Default true."),
    },
    ["name", "symbol", "description"],
  ),
  async (a) =>
    action(
      "launch",
      {
        name: String(a.name),
        symbol: String(a.symbol).toUpperCase().slice(0, 10),
        description: String(a.description),
        image: String(a.image || ""),
        devBuy: a.devBuy ? String(a.devBuy) : "",
        // Stated so the proposal card and the agent cannot disagree about it.
        totalSupply: "1000000000",
        privateBalances: a.privateBalances !== false,
      },
      `Launch ${String(a.symbol).toUpperCase()} - ${a.name}`,
    ),
);

tool(
  "send_private_message",
  "Send an end-to-end encrypted on-chain message to another agent or wallet via COTI PrivateMessaging. Body is ciphertext; only sender and recipient can decrypt it.",
  obj(
    { to: str("Recipient 0x address or @username."), text: str("Plaintext to encrypt and send.") },
    ["to", "text"],
  ),
  async (a) => {
    let to = String(a.to).trim();
    if (to.startsWith("@")) {
      const p = row<{ address: string }>(
        db().prepare("SELECT address FROM profiles WHERE lower(username) = ?").get(to.slice(1).toLowerCase()),
      );
      if (!p) return { ok: false, error: "no profile named " + to };
      to = p.address;
    }
    if (!isAddress(to)) return { ok: false, error: "invalid recipient" };
    return action(
      "message",
      { to, text: String(a.text), contract: addresses.privateMessaging },
      `Encrypted message to ${to.slice(0, 10)}…`,
    );
  },
);

tool(
  "propose_bridge",
  "Propose bridging COTI or gCOTI between Ethereum and COTI. Returns a signable card pointing at the official COTI bridge.",
  obj(
    {
      direction: str("'to_coti' or 'to_ethereum'."),
      token: str("'COTI' or 'gCOTI'."),
      amount: str("Amount to bridge."),
    },
    ["direction", "token", "amount"],
  ),
  async (a) =>
    action(
      "bridge",
      {
        direction: String(a.direction) === "to_ethereum" ? "to_ethereum" : "to_coti",
        token: String(a.token).toLowerCase() === "gcoti" ? "gCOTI" : "COTI",
        amount: String(a.amount),
      },
      `Bridge ${a.amount} ${a.token}`,
    ),
);

/* ── ACT: the agent's own state ───────────────────────────────────────── */

tool(
  "remember",
  "Persist a durable fact about the user, the market or your own strategy. Memory survives across sessions and is injected into every future conversation, so write facts, not chatter.",
  obj({ fact: str("One short, self-contained sentence.") }, ["fact"]),
  async (a, ctx) => {
    if (!ctx.agentId) return { ok: false, error: "no agent context" };
    const r = row<{ memory: string }>(
      db().prepare("SELECT memory FROM agents WHERE id = ?").get(ctx.agentId),
    );
    let mem: string[] = [];
    try {
      mem = JSON.parse(r?.memory || "[]");
    } catch {
      mem = [];
    }
    const fact = String(a.fact).trim().slice(0, 240);
    if (fact && !mem.includes(fact)) mem.push(fact);
    if (mem.length > 60) mem = mem.slice(-60);
    db()
      .prepare("UPDATE agents SET memory = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(mem), now(), ctx.agentId);
    return { ok: true, stored: fact, memoryCount: mem.length };
  },
);

tool(
  "recall",
  "Read back everything you have remembered so far.",
  obj({}),
  async (_a, ctx) => {
    if (!ctx.agentId) return { ok: false, error: "no agent context" };
    const r = row<{ memory: string }>(
      db().prepare("SELECT memory FROM agents WHERE id = ?").get(ctx.agentId),
    );
    let mem: string[] = [];
    try {
      mem = JSON.parse(r?.memory || "[]");
    } catch {
      mem = [];
    }
    return { ok: true, count: mem.length, memory: mem };
  },
);

tool(
  "log_event",
  "Post an entry to your public activity feed - a thesis, a watch, a warning. Shows on your agent page and in the owner's dashboard.",
  obj(
    { kind: str("'thesis' | 'watch' | 'alert' | 'trade' | 'note'"), title: str("Short headline."), body: str("Body text.") },
    ["kind", "title"],
  ),
  async (a, ctx) => {
    if (!ctx.agentId) return { ok: false, error: "no agent context" };
    db()
      .prepare("INSERT INTO agent_events (agent_id, kind, title, body, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(ctx.agentId, String(a.kind || "note"), String(a.title), String(a.body || ""), now());
    return { ok: true, posted: a.title };
  },
);

tool(
  "set_heartbeat",
  "Wake yourself up on a timer to re-check the market without being prompted. Set seconds to 0 to stop. This is what makes you an agent instead of a chatbot.",
  obj({ seconds: num("Interval in seconds, 0 to disable. Minimum 30.") }, ["seconds"]),
  async (a, ctx) => {
    if (!ctx.agentId) return { ok: false, error: "no agent context" };
    const raw = Number(a.seconds) || 0;
    const secs = raw <= 0 ? 0 : Math.max(30, Math.min(3600, raw));
    db()
      .prepare("UPDATE agents SET heartbeat_sec = ?, status = ?, updated_at = ? WHERE id = ?")
      .run(secs, secs > 0 ? "watching" : "idle", now(), ctx.agentId);
    return { ok: true, heartbeatSec: secs, status: secs > 0 ? "watching" : "idle" };
  },
);

tool(
  "watch_token",
  "Add or remove a token from the user's watchlist so you can track it on every heartbeat.",
  obj({ token: str("Token address."), remove: bool("Set true to unwatch.") }, ["token"]),
  async (a, ctx) => {
    const owner = ctx.user;
    if (!owner) return { ok: false, error: "no connected wallet" };
    if (!isAddress(String(a.token))) return { ok: false, error: "invalid token" };
    if (a.remove) {
      db()
        .prepare("DELETE FROM watchlist WHERE lower(address) = lower(?) AND lower(token) = lower(?)")
        .run(owner, String(a.token));
      return { ok: true, watching: false };
    }
    db()
      .prepare("INSERT OR IGNORE INTO watchlist (address, token, created_at) VALUES (?, ?, ?)")
      .run(owner, String(a.token), now());
    return { ok: true, watching: true };
  },
);

tool(
  "get_watchlist",
  "Read the connected wallet's watchlist with each token's current curve or pool state.",
  obj({}),
  async (_a, ctx) => {
    if (!ctx.user) return { ok: false, error: "no connected wallet" };
    const list = rows<{ token: string }>(
      db().prepare("SELECT token FROM watchlist WHERE lower(address) = lower(?)").all(ctx.user),
    );
    const detail = await Promise.all(
      list.map(async (w) => {
        const t = row<TokenRow>(
          db().prepare("SELECT * FROM tokens WHERE lower(address) = lower(?)").get(w.token),
        );
        const curve = t && isDeployed(t.curve) ? await readCurve(t.curve as Address) : null;
        return {
          token: w.token,
          symbol: t?.symbol || "?",
          progressPct: curve?.progress ?? 0,
          graduated: curve?.graduated ?? !!t?.graduated,
          spotPriceCoti: curve ? Number(curve.spotPrice) / 1e18 : null,
        };
      }),
    );
    return { ok: true, count: detail.length, watchlist: detail };
  },
);

tool(
  "find_pairs",
  "Search external DEX aggregators for a ticker to sanity-check a token against the wider market.",
  obj({ query: str("Ticker or name.") }, ["query"]),
  async (a) => {
    const pairs = await dexPairs(String(a.query));
    return { ok: true, count: pairs.length, pairs };
  },
);

/* ── Registry surface ─────────────────────────────────────────────────── */

/** Tool sets per agent kind - a trader shouldn't be handed launch tooling. */
const KIND_TOOLS: Record<string, string[]> = {
  trader: [
    "get_chain_info", "get_coti_market", "get_coti_candles", "search_web", "get_bridge",
    "get_native_balance", "read_token", "list_launches", "get_token", "quote_trade",
    "propose_trade", "watch_token", "get_watchlist", "find_pairs",
    "remember", "recall", "log_event", "set_heartbeat",
  ],
  launcher: [
    "get_chain_info", "get_coti_market", "search_web", "get_bridge", "read_token", "list_launches",
    "get_token", "propose_launch", "get_profile", "remember", "recall", "log_event",
  ],
  social: [
    "get_chain_info", "get_profile", "list_agents", "send_private_message",
    "search_web", "remember", "recall", "log_event",
  ],
  research: [
    "get_chain_info", "get_coti_market", "get_coti_candles", "search_web", "get_bridge", "read_token",
    "list_launches", "get_token", "find_pairs", "get_profile", "list_agents",
    "remember", "recall", "log_event", "set_heartbeat",
  ],
  ops: [
    "get_chain_info", "get_native_balance", "read_token", "get_token", "list_launches",
    "propose_bridge", "send_private_message", "get_profile", "list_agents",
    "remember", "recall", "log_event",
  ],
};

/** The concierge sees everything - it is the front door to the whole app. */
export function toolSpecs(kind?: string): ToolSpec[] {
  const allowed = kind && KIND_TOOLS[kind] ? new Set(KIND_TOOLS[kind]) : null;
  const out: ToolSpec[] = [];
  for (const [name, t] of registry) {
    if (allowed && !allowed.has(name)) continue;
    out.push(t.spec);
  }
  return out;
}

export function toolNames(): string[] {
  return [...registry.keys()];
}

/** Execute one tool call. Never throws - the agent gets an error it can reason about. */
export async function runTool(
  name: string,
  rawArgs: string,
  ctx: ToolContext,
): Promise<ToolResult> {
  const t = registry.get(name);
  if (!t) return { ok: false, error: "unknown tool: " + name };

  let args: Record<string, unknown> = {};
  if (rawArgs && rawArgs.trim()) {
    try {
      args = JSON.parse(rawArgs);
    } catch {
      return { ok: false, error: "arguments were not valid JSON: " + rawArgs.slice(0, 200) };
    }
  }

  try {
    return await t.run(args, ctx);
  } catch (err) {
    return { ok: false, error: String(err).slice(0, 400) };
  }
}
