import { NextRequest } from "next/server";
import type { Address } from "viem";
import { isAddress } from "@/lib/format";
import {
  faucetStatus,
  checkEligibility,
  sendClaim,
  recentClaims,
  FAUCET_AMOUNT,
} from "@/lib/faucet";
import { networkFrom } from "@/lib/network";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Handing out testnet COTI.
 *
 * This endpoint signs with the project's treasury key, so it is the one place
 * in the app that spends money without a user's wallet approving it. The limits
 * live in `lib/faucet` and are checked again inside `sendClaim`, not only here,
 * because a guard that only exists at the edge is a guard that eventually gets
 * bypassed by a second caller.
 */

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address");
  const net = networkFrom(req);
  const status = await faucetStatus(net);

  return Response.json({
    ...status,
    you: address && isAddress(address) ? checkEligibility(address) : null,
    recent: recentClaims(6, net).map((c) => ({
      address: c.address,
      amount: c.amount,
      txHash: c.tx_hash,
      at: c.created_at,
    })),
  });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { address?: string };
  const address = String(body.address || "");

  if (!isAddress(address)) {
    return Response.json({ ok: false, reason: "Connect a wallet first." }, { status: 400 });
  }

  const result = await sendClaim(address as Address, networkFrom(req));

  return Response.json(
    { ...result, amount: result.amount ?? FAUCET_AMOUNT },
    // A refusal is an answer, not a server fault, so it is not a 500.
    { status: result.ok ? 200 : 400 },
  );
}
