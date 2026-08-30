import type { PublicClient } from "viem";

/**
 * Waits for a transaction and refuses to call a revert a success.
 *
 * `waitForTransactionReceipt` resolves for a reverted transaction exactly as it
 * does for a mined one - the outcome lives in `receipt.status`, and every call
 * site here used to discard it. The result was an interface that reported
 * "Confirmed" for a sell that reverted on chain, and wrote the trade into the
 * user's history. Being told a trade succeeded when it did not is worse than
 * being told nothing.
 *
 * The missing-client case is deliberately an error rather than a silent pass.
 * `await publicClient?.wait…` looks like it waits and does nothing at all when
 * the client is undefined, which is the same false success by another route.
 */
export async function confirmTx(
  publicClient: PublicClient | undefined,
  hash: `0x${string}`,
): Promise<void> {
  if (!publicClient) {
    throw new Error(
      "Sent, but this browser could not reach the chain to confirm it. Check " +
        hash.slice(0, 12) +
        "… on the explorer before assuming it went through.",
    );
  }

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error("The transaction reverted on chain. Nothing moved, and the gas is spent.");
  }
}
