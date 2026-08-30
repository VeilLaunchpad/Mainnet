import { createPublicClient, http, fallback, type Address, type PublicClient } from "viem";
import {
  chainByNetwork,
  DEFAULT_NETWORK,
  ACTIVE_NETWORK,
  type CotiNetworkName,
} from "./chain";
import {
  erc20Abi,
  privateErc20Abi,
  devoxCurveAbi,
  devoxSwapPairAbi,
  devoxSwapFactoryAbi,
  devoxPortalAbi,
} from "./abis";
import { addresses, addressesFor, isDeployed } from "./addresses";

const clients = new Map<CotiNetworkName, PublicClient>();

/** Shared read client. `fallback` keeps reads alive if one RPC hiccups. */
export function publicClient(net: CotiNetworkName = ACTIVE_NETWORK): PublicClient {
  const hit = clients.get(net);
  if (hit) return hit;
  const chain = chainByNetwork[net];
  const c = createPublicClient({
    chain,
    transport: fallback(chain.rpcUrls.default.http.map((u) => http(u, { timeout: 15_000 }))),
    batch: { multicall: true },
  }) as PublicClient;
  clients.set(net, c);
  return c;
}

export async function nativeBalance(addr: Address, net?: CotiNetworkName) {
  return publicClient(net).getBalance({ address: addr });
}

export interface TokenOnChain {
  address: Address;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: bigint | null;
  isPrivate: boolean;
}

/**
 * Reads token metadata. A COTI PrivateERC20 answers name/symbol/decimals just
 * like a public one, but `totalSupply` deliberately returns 0 (aggregate
 * supply is withheld for privacy) - so a 0 supply is a signal, not an error.
 */
export async function readToken(address: Address, net?: CotiNetworkName): Promise<TokenOnChain | null> {
  const c = publicClient(net);
  try {
    const [name, symbol, decimals, totalSupply] = await Promise.all([
      c.readContract({ address, abi: erc20Abi, functionName: "name" }),
      c.readContract({ address, abi: erc20Abi, functionName: "symbol" }),
      c.readContract({ address, abi: erc20Abi, functionName: "decimals" }),
      c.readContract({ address, abi: erc20Abi, functionName: "totalSupply" }).catch(() => null),
    ]);
    let isPrivate = false;
    try {
      await c.readContract({ address, abi: privateErc20Abi, functionName: "publicAmountsEnabled" });
      isPrivate = true;
    } catch {
      isPrivate = false;
    }
    return {
      address,
      name: name as string,
      symbol: symbol as string,
      decimals: Number(decimals),
      totalSupply: totalSupply as bigint | null,
      isPrivate,
    };
  } catch {
    return null;
  }
}

export interface CurveState {
  token: Address;
  reserve: bigint;
  sold: bigint;
  spotPrice: bigint;
  graduationTarget: bigint;
  graduated: boolean;
  pool: Address;
  progress: number;
}

export async function readCurve(curve: Address, net?: CotiNetworkName): Promise<CurveState | null> {
  if (!isDeployed(curve)) return null;
  const c = publicClient(net);
  try {
    const [token, reserve, sold, spotPrice, graduationTarget, graduated, pool] = await Promise.all([
      c.readContract({ address: curve, abi: devoxCurveAbi, functionName: "token" }),
      c.readContract({ address: curve, abi: devoxCurveAbi, functionName: "reserve" }),
      c.readContract({ address: curve, abi: devoxCurveAbi, functionName: "sold" }),
      c.readContract({ address: curve, abi: devoxCurveAbi, functionName: "spotPrice" }),
      c.readContract({ address: curve, abi: devoxCurveAbi, functionName: "graduationTarget" }),
      c.readContract({ address: curve, abi: devoxCurveAbi, functionName: "graduated" }),
      c.readContract({ address: curve, abi: devoxCurveAbi, functionName: "pool" }),
    ]);
    const target = graduationTarget as bigint;
    const res = reserve as bigint;
    return {
      token: token as Address,
      reserve: res,
      sold: sold as bigint,
      spotPrice: spotPrice as bigint,
      graduationTarget: target,
      graduated: graduated as boolean,
      pool: pool as Address,
      progress: target > 0n ? Math.min(100, Number((res * 10000n) / target) / 100) : 0,
    };
  } catch {
    return null;
  }
}

export interface PoolState {
  pair: Address;
  token0: Address;
  token1: Address;
  reserve0: bigint;
  reserve1: bigint;
  /** Reserves oriented to the launch token, not to address ordering. */
  reserveToken: bigint;
  reserveCoti: bigint;
  totalSupply: bigint;
  feeBps: number;
  /** COTI per whole token. */
  price: number;
}

/**
 * Reads a DevoxSwap pair.
 *
 * Note what is *not* here: no `balanceOf` call. A pair's reserves live in its
 * own storage precisely because a COTI PrivateERC20 answers `balanceOf` with a
 * ciphertext handle, so a Uniswap-style balance-derived reserve would be
 * meaningless. These numbers are the pair's own books.
 */
export async function readPool(
  pair: Address,
  token?: Address,
  net?: CotiNetworkName,
): Promise<PoolState | null> {
  if (!isDeployed(pair)) return null;
  const c = publicClient(net);
  try {
    const [reserves, token0, token1, totalSupply] = await Promise.all([
      c.readContract({ address: pair, abi: devoxSwapPairAbi, functionName: "getReserves" }),
      c.readContract({ address: pair, abi: devoxSwapPairAbi, functionName: "token0" }),
      c.readContract({ address: pair, abi: devoxSwapPairAbi, functionName: "token1" }),
      c.readContract({ address: pair, abi: devoxSwapPairAbi, functionName: "totalSupply" }),
    ]);

    const [r0, r1] = reserves as readonly [bigint, bigint];
    const t0 = token0 as Address;
    const t1 = token1 as Address;

    const wcoti = addressesFor(net ?? DEFAULT_NETWORK).wcoti;
    const launchToken = token ?? (t0.toLowerCase() === wcoti.toLowerCase() ? t1 : t0);
    const tokenIsZero = launchToken.toLowerCase() === t0.toLowerCase();
    const reserveToken = tokenIsZero ? r0 : r1;
    const reserveCoti = tokenIsZero ? r1 : r0;

    return {
      pair,
      token0: t0,
      token1: t1,
      reserve0: r0,
      reserve1: r1,
      reserveToken,
      reserveCoti,
      totalSupply: totalSupply as bigint,
      feeBps: 30,
      price: reserveToken > 0n ? Number(reserveCoti) / Number(reserveToken) : 0,
    };
  } catch {
    return null;
  }
}

/** Finds the pair for a launch token, if one exists. */
export async function findPair(token: Address, net?: CotiNetworkName): Promise<Address | null> {
  const a = addressesFor(net ?? DEFAULT_NETWORK);
  if (!isDeployed(a.swapFactory) || !isDeployed(a.wcoti)) return null;
  try {
    const pair = (await publicClient(net).readContract({
      address: a.swapFactory,
      abi: devoxSwapFactoryAbi,
      functionName: "getPair",
      args: [token, a.wcoti],
    })) as Address;
    return isDeployed(pair) ? pair : null;
  } catch {
    return null;
  }
}

/**
 * Chain summary for the agents.
 *
 * Only *deployed* contracts are listed. Sending a wall of zero addresses would
 * burn prompt budget to tell the model nothing, and the models are metered per
 * minute - every token in the context is a token not available for reasoning.
 */
export const chainInfo = (net: CotiNetworkName = DEFAULT_NETWORK) => {
  const deployed: Record<string, string> = {};
  const missing: string[] = [];
  for (const [name, addr] of Object.entries(addressesFor(net))) {
    if (isDeployed(addr)) deployed[name] = addr;
    else missing.push(name);
  }
  const chain = chainByNetwork[net];
  return {
    network: net,
    chainId: chain.id,
    name: chain.name,
    explorer: chain.blockExplorers.default.url,
    deployed,
    notDeployed: missing,
  };
};

export interface ChainTrade {
  venue: "curve" | "devoxswap";
  side: "buy" | "sell";
  trader: Address;
  cotiAmount: bigint;
  tokenAmount: bigint;
  price: number;
  txHash: string;
  blockNumber: bigint;
  time: number;
}

/**
 * Both caches are keyed by chain id as well as by hash or height.
 *
 * Block 9,000,000 exists on both networks and is a different block with a
 * different timestamp on each, so a bare height would hand mainnet a testnet
 * time and quietly mis-date the whole trade history. The client already knows
 * which chain it is on, so the scope comes from it rather than from a
 * parameter every caller would have to remember to pass.
 */
const blockTimeCache = new Map<string, number>();
const txSenderCache = new Map<string, Address>();

function scope(client: PublicClient): string {
  return (client.chain?.id ?? 0) + ":";
}

/**
 * Who actually made the trade.
 *
 * Event fields name whoever touched the contract, which for a routed swap is
 * the router: it has to receive the WCOTI itself before unwrapping it back to
 * the user. The transaction sender is the human who signed, so that is the
 * attribution the history shows.
 */
async function txSenders(client: PublicClient, hashes: string[]): Promise<Map<string, Address>> {
  const out = new Map<string, Address>();
  const missing: string[] = [];

  const at = scope(client);
  for (const h of hashes) {
    const key = h.toLowerCase();
    const hit = txSenderCache.get(at + key);
    if (hit) out.set(key, hit);
    else if (!missing.includes(key)) missing.push(key);
  }

  const fetched = await Promise.all(
    missing.map((h) => client.getTransaction({ hash: h as `0x${string}` }).catch(() => null)),
  );

  fetched.forEach((tx, i) => {
    if (!tx?.from) return;
    txSenderCache.set(at + missing[i], tx.from);
    out.set(missing[i], tx.from);
  });

  return out;
}

async function blockTimes(client: PublicClient, blocks: bigint[]): Promise<Map<bigint, number>> {
  const out = new Map<bigint, number>();
  const missing: bigint[] = [];

  const at = scope(client);
  for (const b of blocks) {
    const hit = blockTimeCache.get(at + b.toString());
    if (hit) out.set(b, hit);
    else if (!missing.includes(b)) missing.push(b);
  }

  const fetched = await Promise.all(
    missing.map((b) => client.getBlock({ blockNumber: b }).catch(() => null)),
  );

  fetched.forEach((block, i) => {
    if (!block) return;
    const ms = Number(block.timestamp) * 1000;
    blockTimeCache.set(at + missing[i].toString(), ms);
    out.set(missing[i], ms);
  });

  return out;
}

/**
 * Trade history straight from the chain.
 *
 * The off-chain index only knows about fills that went through this app. Reading
 * `Traded` off the curve and `Swap` off the pair means the history is complete
 * no matter where a trade originated - a script, another front end, or an agent
 * acting on its own. The chain is the record; the database is a convenience.
 */
export async function readTradeHistory(
  token: Address,
  curve?: string,
  pool?: string,
  net?: CotiNetworkName,
  lookback = 200_000n,
): Promise<ChainTrade[]> {
  const client = publicClient(net);
  const trades: ChainTrade[] = [];

  let fromBlock = 0n;
  try {
    const head = await client.getBlockNumber();
    fromBlock = head > lookback ? head - lookback : 0n;
  } catch {
    return trades;
  }

  if (isDeployed(curve || "")) {
    try {
      const logs = await client.getLogs({
        address: curve as Address,
        event: devoxCurveAbi.find((f) => f.type === "event" && f.name === "Traded") as never,
        fromBlock,
        toBlock: "latest",
      });
      for (const raw of logs) {
        const log = raw as unknown as {
          args: Record<string, unknown>;
          transactionHash: string;
          blockNumber: bigint;
        };
        const a = log.args;
        const coti = a.cotiAmount as bigint;
        const tok = a.tokenAmount as bigint;
        trades.push({
          venue: "curve",
          side: (a.isBuy as boolean) ? "buy" : "sell",
          trader: a.trader as Address,
          cotiAmount: coti,
          tokenAmount: tok,
          price: tok > 0n ? Number(coti) / Number(tok) : 0,
          txHash: log.transactionHash,
          blockNumber: log.blockNumber,
          time: 0,
        });
      }
    } catch {
      /* curve history unavailable; the pair may still have some */
    }
  }

  if (isDeployed(pool || "")) {
    try {
      const logs = await client.getLogs({
        address: pool as Address,
        event: devoxSwapPairAbi.find((f) => f.type === "event" && f.name === "Swap") as never,
        fromBlock,
        toBlock: "latest",
      });
      for (const raw of logs) {
        const log = raw as unknown as {
          args: Record<string, unknown>;
          transactionHash: string;
          blockNumber: bigint;
        };
        const a = log.args;
        const tokenIn = (a.tokenIn as Address).toLowerCase();
        const isBuy = tokenIn !== token.toLowerCase();
        const amountIn = a.amountIn as bigint;
        const amountOut = a.amountOut as bigint;
        const coti = isBuy ? amountIn : amountOut;
        const tok = isBuy ? amountOut : amountIn;
        trades.push({
          venue: "devoxswap",
          side: isBuy ? "buy" : "sell",
          // `sender` is whoever called the pair, which for a routed swap is the
          // router itself. `to` is the human the tokens actually went to.
          trader: (a.to as Address) || (a.sender as Address),
          cotiAmount: coti,
          tokenAmount: tok,
          price: tok > 0n ? Number(coti) / Number(tok) : 0,
          txHash: log.transactionHash,
          blockNumber: log.blockNumber,
          time: 0,
        });
      }
    } catch {
      /* pair history unavailable */
    }
  }

  const [times, senders] = await Promise.all([
    blockTimes(client, trades.map((t) => t.blockNumber)),
    txSenders(client, trades.map((t) => t.txHash)),
  ]);

  for (const t of trades) {
    t.time = times.get(t.blockNumber) ?? 0;
    t.trader = senders.get(t.txHash.toLowerCase()) ?? t.trader;
  }

  return trades.sort((a, b) => Number(b.blockNumber - a.blockNumber));
}

export interface PortalCrossing {
  direction: "in" | "out";
  account: Address;
  underlying: Address;
  twin: Address;
  amount: bigint;
  txHash: string;
  blockNumber: bigint;
  time: number;
}

/**
 * Portal crossings for one account, read from the contract's own events.
 *
 * Both sides are indexed on `account`, so this is a cheap filtered query rather
 * than a scan. Amounts here are public by construction: wrapping and unwrapping
 * are the two moments where a private balance touches a public one.
 */
export async function readPortalHistory(
  account: Address,
  net?: CotiNetworkName,
  lookback = 200_000n,
): Promise<PortalCrossing[]> {
  const portal = addressesFor(net ?? DEFAULT_NETWORK).portal;
  if (!isDeployed(portal)) return [];

  const client = publicClient(net);
  let fromBlock = 0n;
  try {
    const head = await client.getBlockNumber();
    fromBlock = head > lookback ? head - lookback : 0n;
  } catch {
    return [];
  }

  const out: PortalCrossing[] = [];

  for (const [name, direction] of [
    ["Wrapped", "in"],
    ["Unwrapped", "out"],
  ] as const) {
    try {
      const logs = await client.getLogs({
        address: portal,
        event: devoxPortalAbi.find((f) => f.type === "event" && f.name === name) as never,
        args: { account } as never,
        fromBlock,
        toBlock: "latest",
      });

      for (const raw of logs) {
        const log = raw as unknown as {
          args: Record<string, unknown>;
          transactionHash: string;
          blockNumber: bigint;
        };
        out.push({
          direction,
          account,
          underlying: log.args.underlying as Address,
          twin: log.args.twin as Address,
          amount: log.args.amount as bigint,
          txHash: log.transactionHash,
          blockNumber: log.blockNumber,
          time: 0,
        });
      }
    } catch {
      /* one direction failing should not lose the other */
    }
  }

  const times = await blockTimes(client, out.map((c) => c.blockNumber));
  for (const c of out) c.time = times.get(c.blockNumber) ?? 0;

  return out.sort((a, b) => Number(b.blockNumber - a.blockNumber));
}
