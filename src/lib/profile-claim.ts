/**
 * The message a wallet signs to prove a handle claim is theirs.
 *
 * Shared by the client that signs it and the route that verifies it, because
 * the two must agree byte for byte - a signature over a slightly different
 * string simply fails to recover, and debugging that from either side alone is
 * miserable. It lives here rather than in the route because a Next route file
 * may only export its handlers.
 *
 * The username and timestamp are inside the message on purpose: a captured
 * signature cannot be replayed to claim a different handle, and it stops
 * working once the window closes.
 */
export function claimMessage(address: string, username: string, issuedAt: number): string {
  return [
    "DEVOXPAD profile claim",
    "address: " + address.toLowerCase(),
    "username: " + username,
    "issued: " + issuedAt,
  ].join("\n");
}

/** Signatures older than this are refused, so a leaked one stops working. */
export const CLAIM_WINDOW_MS = 10 * 60 * 1000;
