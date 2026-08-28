import { NextRequest } from "next/server";
import { parseUnits, formatUnits, type Address } from "viem";
import { publicClient } from "@/lib/rpc";
import { networkFrom } from "@/lib/network";
import type { CotiNetworkName } from "@/lib/chain";
import { privacyAsset, bridgeAbiFor, crossChain } from "@/lib/coti-bridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Pricing a crossing.
 *
 * The privacy bridge quotes its own fee and hands back the oracle timestamps
 * that quote was computed against. Those stamps go straight back into the
 * transaction, and the contract reverts unless they still match, which is how
 * it refuses to charge a price the user never agreed to. The practical
 * consequence is that a quote is only valid until the oracle next ticks, so
 * this route is cheap to call and the client re-quotes right before sending.
 *
 * Fees are always paid in native COTI, even for an ERC20 asset, because the
 * contract converts through the price oracle rather than skimming the token.
 */

interface Body {
  mode?: string;
  asset?: string;
  direction?: string;
  amount?: string;
  fromChainId?: number;
  toChainId?: number;
}

export async function POST(req: NextRequest) {
  const b = (await req.json().catch(() => ({}))) as Body;
  const net = networkFrom(req);

  const mode = (b.mode || "privacy").toLowerCase();
  if (mode === "crosschain") return crossChainQuote(b, net);

  const direction = (b.direction || "deposit").toLowerCase() === "withdraw" ? "withdraw" : "deposit";
  const asset = privacyAsset(String(b.asset || "COTI"), net);

  if (!asset) {
    return Response.json(
      {
        ok: false,
        error: "unsupported-asset",
        message:
          "COTI operates a privacy bridge for COTI, gCOTI, WETH, WBTC, USDT, USDC.e and WADA. Nothing else has a bridge to route through.",
      },
      { status: 400 },
    );
  }

  let amount: bigint;
  try {
    amount = parseUnits(String(b.amount || "0"), asset.decimals);
  } catch {
    return Response.json({ ok: false, error: "bad-amount" }, { status: 400 });
  }
  if (amount <= 0n) return Response.json({ ok: false, error: "bad-amount" }, { status: 400 });

  const c = publicClient();
  const abi = bridgeAbiFor(asset);
  const fn = direction === "deposit" ? "estimateDepositFee" : "estimateWithdrawFee";

  let quote: readonly bigint[];
  try {
    quote = (await c.readContract({
      address: asset.bridge,
      abi,
      functionName: fn,
      args: [amount],
    } as never)) as readonly bigint[];
  } catch (e) {
    // A revert here is nearly always the oracle refusing to price the pair.
    return Response.json(
      {
        ok: false,
        error: "quote-failed",
        message:
          "COTI's price oracle would not quote this route just now. That is the bridge declining, not VEILPAD.",
        detail: String((e as Error).message || e).slice(0, 200),
      },
      { status: 502 },
    );
  }

  const fee = quote[0];

  // The native bridge quotes against COTI alone and returns three values; the
  // ERC20 bridges quote against COTI and the token, and return four. Both
  // deposit calls take two stamps, so the native one repeats its single stamp.
  const cotiStamp = quote[1];
  const tokenStamp = asset.native ? quote[1] : quote[2];

  /**
   * Where the fee lands differs by asset and it changes what the user gets.
   * Native COTI is charged out of the amount sent, so the twin minted is
   * smaller than the amount. An ERC20 is charged separately in COTI, so the
   * full token amount crosses untouched.
   */
  const feeFromAmount = asset.native;
  const receives = feeFromAmount ? amount - fee : amount;

  if (receives <= 0n) {
    return Response.json({
      ok: false,
      error: "amount-below-fee",
      message: "The fee is larger than the amount, so nothing would arrive.",
      fee: formatUnits(fee, 18),
    });
  }

  return Response.json({
    ok: true,
    route: "coti-privacy-bridge",
    venue: "COTI Privacy Bridge",
    network: net,
    inApp: true,
    direction,
    asset: {
      key: asset.key,
      symbol: asset.symbol,
      decimals: asset.decimals,
      native: asset.native,
      bridge: asset.bridge,
      token: asset.token,
      privateToken: asset.privateToken,
    },
    amount: formatUnits(amount, asset.decimals),
    amountWei: amount.toString(),
    receives: formatUnits(receives, asset.decimals),
    receivesWei: receives.toString(),
    fee: formatUnits(fee, 18),
    feeWei: fee.toString(),
    feeToken: "COTI",
    feeFromAmount,

    /** Passed straight back into the write call. */
    oracle: {
      cotiTimestamp: cotiStamp.toString(),
      tokenTimestamp: tokenStamp.toString(),
      /**
       * The contract compares these for equality, so the quote is void the
       * instant COTI's oracle publishes again.
       */
      bindsExactly: true,
    },

    /** Exactly what the wallet has to do, in order. */
    steps:
      direction === "deposit"
        ? asset.native
          ? [{ kind: "deposit", note: "Send COTI, receive its private twin. The fee comes out of what you send." }]
          : [
              { kind: "approve", token: asset.token, spender: asset.bridge, amount: amount.toString() },
              { kind: "deposit", note: "The fee is paid in COTI alongside the token." },
            ]
        : [
            { kind: "approve", token: asset.privateToken, spender: asset.bridge, amount: amount.toString() },
            {
              kind: "withdraw",
              note: asset.native
                ? "Burn the private twin, receive COTI. The fee comes out of the amount."
                : "Burn the private twin, receive the public token. The fee is paid in COTI.",
            },
          ],

    /** What to send as msg.value. */
    value: asset.native
      ? direction === "deposit"
        ? amount.toString()
        : "0"
      : fee.toString(),
  });
}

/**
 * Ethereum and back.
 *
 * There is no contract on either side. COTI's bridge sends the token to a
 * recipient address its relayer watches, then credits the same address on the
 * far chain. That is a plain transfer, so VEILPAD can build and send it in
 * app, and the only thing it must never do is guess the recipient.
 */
function crossChainQuote(b: Body, net: CotiNetworkName) {
  const cc = crossChain(net);
  const key = String(b.asset || "COTI");
  const asset = cc.assets.find((a) => a.key.toLowerCase() === key.toLowerCase());

  if (!asset) {
    return Response.json({
      ok: false,
      route: "unavailable",
      network: net,
      message:
        cc.assets.length === 0
          ? "COTI does not publish recipient addresses for its testnet routes, and a recipient address is the one field that cannot be guessed. Use the privacy bridge, which is fully on chain here."
          : `COTI's cross-chain bridge carries COTI and gCOTI only. It has no route for ${key}.`,
    });
  }

  const toCoti = Number(b.toChainId) === cc.cotiChainId;

  return Response.json({
    ok: true,
    route: "coti-cross-chain",
    venue: "COTI Bridge",
    network: net,
    inApp: true,
    direction: toCoti ? "eth_to_coti" : "coti_to_eth",
    asset: { key: asset.key, symbol: asset.symbol, decimals: asset.decimals },
    /** The transfer VEILPAD builds for you to sign here. */
    transfer: {
      chainId: toCoti ? cc.ethChainId : cc.cotiChainId,
      token: toCoti ? asset.ethToken : asset.cotiToken,
      recipient: toCoti ? asset.ethRecipient : asset.cotiRecipient,
      native: !toCoti && asset.cotiToken === null,
    },
    /**
     * Neither side takes a destination argument, so the relayer credits the
     * sending address. Sending from an exchange account would deliver to an
     * address nobody controls.
     */
    creditsSender: true,
    settlement: "COTI's relayer credits the far chain, usually within a few minutes.",
  });
}
