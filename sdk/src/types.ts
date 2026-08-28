/** Shapes returned by the VEILPAD indexer. Mirrors the REST responses exactly. */

export type Network = "testnet" | "mainnet";
export type Timeframe = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";
export type Venue = "curve" | "veilswap" | "none";
export type Side = "buy" | "sell";

export interface TokenSummary {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  description: string;
  image: string;
  creator: string;
  /** "private" means holder balances are ciphertext on chain. */
  kind: string;
  curve: string;
  pool: string;
  graduated: boolean;
  progressPct: number;
  reserveCoti: string;
  spotPriceCoti: number | null;
  createdAt: number;
}

export interface CurveState {
  address: string;
  reserveCoti: string;
  sold: string;
  graduated: boolean;
  progressPct: number;
  targetCoti: string;
  spotPriceCoti: number | null;
  spotPriceUsd: number | null;
}

export interface PoolState {
  address: string;
  venue: string;
  feeBps: number;
  reserveToken: string;
  reserveCoti: string;
  lpSupply: string;
  token0: string;
  token1: string;
  priceCoti: number;
  priceUsd: number | null;
}

export interface Trade {
  venue: Venue;
  side: Side;
  trader: string;
  coti_in: string;
  token_out: string;
  price: number;
  tx_hash: string;
  created_at: number;
  /** "chain" when read from events, "index" when only this app saw it. */
  source: string;
}

export interface TokenDetail {
  token: TokenSummary & {
    isPrivate: boolean;
    banner: string;
    feeTier: number;
    txHash: string;
    links: Record<string, string>;
    creatorProfile: { username: string; display_name: string; avatar: string } | null;
  };
  curve: CurveState | null;
  pool: PoolState | null;
  market: { cotiUsd: number; cotiChange24h: number } | null;
  trades: Trade[];
  stats: { tradeCount: number; knownTraders: number };
}

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  buys: number;
  sells: number;
}

export interface CandleResponse {
  token: string;
  timeframe: Timeframe;
  decimals: number;
  venue: Venue;
  candles: Candle[];
  spotCoti: number | null;
  spotUsd: number | null;
  cotiUsd: number | null;
  issuedSupply: number | null;
  marketCapCoti: number | null;
  marketCapUsd: number | null;
  change: { pct: number; abs: number } | null;
  stats: { trades: number; buys: number; sells: number; volumeCoti: number };
}

export interface PortalPair {
  underlying: string;
  twin: string;
  name: string;
  symbol: string;
  twinSymbol: string;
  decimals: number;
  locked: string;
  native: boolean;
}

export interface AgentSummary {
  id: string;
  slug: string;
  owner: string;
  name: string;
  kind: string;
  avatar: string;
  tagline: string;
  autonomy: "advisory" | "approval" | "auto";
  token: string;
  status: string;
  heartbeatSec: number;
  createdAt: number;
}

export interface Comment {
  id: number;
  author: string;
  profile: { username: string; avatar: string } | null;
  /** Empty when `private` is true: the body is ciphertext on chain. */
  body: string;
  private: boolean;
  txHash: string;
  createdAt: number;
}

export interface Profile {
  username: string | null;
  address: string;
  displayName: string;
  bio: string;
  avatar: string;
  banner: string;
  isAgent: boolean;
  links: Record<string, string>;
  createdAt: number;
}

/** Streamed while an agent works. `action` carries a proposal for a wallet. */
export type AgentEvent =
  | { type: "thread"; threadId: string }
  | { type: "step"; step: number }
  | { type: "text"; text: string }
  | { type: "tool_start"; name: string; args: string }
  | { type: "tool_end"; name: string; ok: boolean; result: unknown }
  | { type: "action"; action: Record<string, unknown> }
  | { type: "done"; model: string; steps: number }
  | { type: "error"; error: string };
