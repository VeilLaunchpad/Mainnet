/**
 * The exact string a commenter signs.
 *
 * Kept in one place so the client and the verifier cannot drift: if they ever
 * disagreed by a single character, every signature would fail to verify and
 * the cause would be invisible.
 */
export function commentDigest(token: string, body: string, nonce: number): string {
  return (
    "DEVOXPAD comment\n" +
    "token: " +
    token.toLowerCase() +
    "\n" +
    "nonce: " +
    nonce +
    "\n" +
    "body: " +
    body
  );
}
