import type { Address } from "viem";
import { publicClient } from "@/lib/rpc";
import { erc20Abi } from "@/lib/abis";
import { networkFrom } from "@/lib/network";
import type { CotiNetworkName } from "@/lib/chain";
import { fmtUnits } from "@/lib/format";
import {
  privacyAssets,
  bridgeAbiFor,
  crossChain,
  type PrivacyBridgeAsset,
} from "@/lib/coti-bridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What the privacy bridge will actually accept right now.
 *
 * Every field is read off the deployed contract rather than copied from a
 * table, because a bridge that is paused, disabled or out of liquidity looks
 * identical to a healthy one until the transaction reverts. Reading it here
 * lets the UI grey out the route before someone signs.
 */

interface AssetStatus {
  key: string;
  symbol: string;
  name: string;
  decimals: number;
  oracleSymbol: string;
  bridge: Address;
  token: Address | null;
  privateToken: Address;
  native: boolean;
  blurb: string;
  open: boolean;
  depositEnabled: boolean;
  paused: boolean;
  minDeposit: string;
  maxDeposit: string;
  minWithdraw: string;
  maxWithdraw: string;
  /** Public tokens escrowed behind the private twins. */
  liability: string;
  /** What the bridge can actually pay out on a withdrawal today. */
  liquidity: string | null;
  note: string | null;
}

/** A `bigint` that may be missing, rendered without pretending it is zero. */
function units(v: unknown, decimals: number): string {
  return typeof v === "bigint" ? fmtUnits(v, decimals, decimals > 8 ? 6 : decimals) : "-";
}

/**
 * The contracts set their ceilings to `type(uint256).max` when there is no
 * cap. Printing that as a number is noise, so it becomes an explicit absence.
 */
const UINT256_MAX = (1n << 256n) - 1n;

function cap(v: unknown, decimals: number): string {
  if (typeof v !== "bigint" || v === UINT256_MAX) return "";
  return units(v, decimals);
}

async function statusOf(asset: PrivacyBridgeAsset, net: CotiNetworkName): Promise<AssetStatus> {
  const c = publicClient(net);
  const abi = bridgeAbiFor(asset);
  const at = (functionName: string) =>
    c
      .readContract({ address: asset.bridge, abi, functionName } as never)
      .catch(() => null);

  const [enabled, paused, minD, maxD, minW, maxW, liability] = await Promise.all([
    at("isDepositEnabled"),
    at("paused"),
    at("minDepositAmount"),
    at("maxDepositAmount"),
    at("minWithdrawAmount"),
    at("maxWithdrawAmount"),
    at("totalUserLiability"),
  ]);

  // Withdrawals pay out of what the bridge holds, so an empty bridge cannot
  // honour one however healthy its flags look.
  let liquidity: bigint | null = null;
  try {
    liquidity = asset.native
      ? await c.getBalance({ address: asset.bridge })
      : ((await c.readContract({
          address: asset.token as Address,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [asset.bridge],
        })) as bigint);
  } catch {
    liquidity = null;
  }

  const isPaused = paused === true;
  const isEnabled = enabled !== false;

  return {
    key: asset.key,
    symbol: asset.symbol,
    name: asset.name,
    decimals: asset.decimals,
    oracleSymbol: asset.oracleSymbol,
    bridge: asset.bridge,
    token: asset.token,
    privateToken: asset.privateToken,
    native: asset.native,
    blurb: asset.blurb,
    open: isEnabled && !isPaused,
    depositEnabled: isEnabled,
    paused: isPaused,
    minDeposit: units(minD, asset.decimals),
    maxDeposit: cap(maxD, asset.decimals),
    minWithdraw: units(minW, asset.decimals),
    maxWithdraw: cap(maxW, asset.decimals),
    liability: units(liability, asset.decimals),
    liquidity: liquidity === null ? null : units(liquidity, asset.decimals),
    note: isPaused
      ? "COTI has paused this bridge."
      : !isEnabled
        ? "COTI has disabled deposits on this bridge. Withdrawals still work."
        : null,
  };
}

export async function GET(req: Request) {
  const net = networkFrom(req);
  const assets = privacyAssets(net);

  const statuses = await Promise.all(assets.map((a) => statusOf(a, net).catch(() => null)));
  const list = statuses.filter((s): s is AssetStatus => s !== null);

  const cc = crossChain(net);

  return Response.json({
    network: net,
    /** Public token in, private twin out. Runs entirely inside VEILPAD. */
    privacy: {
      available: list.length > 0,
      assets: list,
      reason:
        list.length > 0
          ? null
          : "The privacy bridge addresses for this network have not been verified on chain, so VEILPAD will not route through them.",
    },
    /**
     * Ethereum and back. A transfer to a recipient COTI's relayer watches, so
     * the recipient travels with each asset: it is the whole protocol, and the
     * client needs it to build the transaction.
     */
    crossChain: {
      available: cc.assets.length > 0,
      ethChainId: cc.ethChainId,
      ethName: cc.ethName,
      cotiChainId: cc.cotiChainId,
      assets: cc.assets.map((a) => ({
        key: a.key,
        symbol: a.symbol,
        decimals: a.decimals,
        ethToken: a.ethToken,
        ethRecipient: a.ethRecipient,
        cotiToken: a.cotiToken,
        cotiRecipient: a.cotiRecipient,
      })),
      reason:
        cc.assets.length > 0
          ? null
          : "No verified recipient addresses for this network, and a recipient address is the one field that must never be guessed.",
    },
  });
}
