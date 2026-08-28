import type { Address, PublicClient } from "viem";
import { erc20Abi } from "./abis";

/**
 * Ask for an approval only when the chain actually needs one.
 *
 * Every flow here used to sign the same three transactions: reset the allowance
 * to zero, set it to the amount, then do the thing. That is three wallet popups
 * for one action, every single time, including when the allowance already
 * covered it.
 *
 * Reading the allowance first removes both approvals in the common case. The
 * reset survives for the one situation that genuinely requires it: a COTI
 * PrivateERC20 rejects a non-zero to non-zero change, so a partial allowance
 * has to be cleared before it can be raised.
 *
 * What cannot be removed is the first approval on a token you have never traded.
 * ERC-20 has no way to approve and act atomically, so that one is the chain's
 * rule, not a choice this app makes.
 */

/**
 * wagmi types its write function against a generic union of every configured
 * chain and ABI. Restating that here would either not match, because a function
 * accepting less cannot stand in for one accepting more, or drag the whole
 * generic surface into this file for no benefit. The seam is deliberately loose
 * and the call sites remain fully typed by wagmi itself.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type WriteContract = (args: any) => Promise<`0x${string}`>;

export interface EnsureAllowanceArgs {
  publicClient: PublicClient | undefined;
  writeContractAsync: WriteContract;
  owner: Address;
  token: Address;
  spender: Address;
  amount: bigint;
  /** Surfaces what is happening, since a wallet popup with no context is worse. */
  onStep?: (label: string) => void;
  /**
   * Approve far more than this one action needs, so the next one needs no
   * approval at all.
   *
   * Only for VEILPAD's own contracts. ERC-20 cannot approve and act in a single
   * transaction, so the first time you touch a spender there will always be two
   * wallet prompts - that is the chain's rule. What is avoidable is paying that
   * cost again on every subsequent stake, which is what a per-amount approval
   * does.
   *
   * It is deliberately a large finite number rather than an infinite one. An
   * unlimited approval that outlives the app is the standing risk people are
   * right to dislike, and the ceiling here is already more than any pool can
   * hold, so it buys the convenience without the open-ended exposure.
   */
  headroom?: bigint;
}

export async function ensureAllowance({
  publicClient,
  writeContractAsync,
  owner,
  token,
  spender,
  amount,
  onStep,
  headroom,
}: EnsureAllowanceArgs): Promise<{ approvals: number }> {
  let current = 0n;
  try {
    current = (await publicClient?.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "allowance",
      args: [owner, spender],
    })) as bigint;
  } catch {
    // An unreadable allowance is treated as zero: approving again is safe,
    // whereas skipping an approval that was needed is not.
    current = 0n;
  }

  if (current >= amount) return { approvals: 0 };

  // Approve the headroom when one is offered, but never less than the action
  // actually needs.
  const target = headroom && headroom > amount ? headroom : amount;

  let approvals = 0;

  if (current > 0n) {
    onStep?.("Clearing the old allowance");
    await writeContractAsync({
      address: token,
      abi: erc20Abi,
      functionName: "approve",
      args: [spender, 0n],
      gas: 6_000_000n,
    }).catch(() => undefined);
    approvals += 1;
  }

  onStep?.("Approving once");
  const hash = await writeContractAsync({
    address: token,
    abi: erc20Abi,
    functionName: "approve",
    args: [spender, target],
    gas: 6_000_000n,
  });
  approvals += 1;

  await publicClient?.waitForTransactionReceipt({ hash });
  return { approvals };
}
