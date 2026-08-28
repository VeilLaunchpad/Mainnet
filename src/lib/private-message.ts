import { Contract } from "@coti-io/coti-ethers";
import { privateMessagingAbi } from "./abis";
import { addresses } from "./addresses";

/**
 * Sending one encrypted message, at any length.
 *
 * COTI's PrivateMessaging stores a message as chunks of encrypted cells. A cell
 * is a ctUint64, so it carries 8 bytes, and the contract rejects any chunk with
 * more than three of them. That makes 24 bytes the most a single `sendMessage`
 * can hold, which is far shorter than anything a person actually types.
 *
 * Both callers previously encrypted the whole string in one go and passed it
 * straight to `sendMessage`. That works only for a message that happens to land
 * on exactly the right size, and fails everywhere else, which is why a short
 * comment could be rejected while a different short comment went through.
 *
 * So the split happens here, once, and every caller gets the same behaviour.
 */

/** A cell holds a ctUint64, so eight bytes of plaintext. */
const BYTES_PER_CELL = 8;

/** The contract rejects a chunk with more cells than this. */
const CELLS_PER_CHUNK = 3;

/** 24 bytes per chunk. */
const BYTES_PER_CHUNK = BYTES_PER_CELL * CELLS_PER_CHUNK;

/** And at most 64 chunks per message, so 1536 bytes in total. */
const MAX_CHUNKS = 64;

export const MAX_MESSAGE_BYTES = BYTES_PER_CHUNK * MAX_CHUNKS;

/**
 * Splits on byte boundaries, not character ones.
 *
 * The contract counts bytes, and a multi-byte character split across two chunks
 * would decrypt into a broken sequence. Encoding first and cutting the buffer
 * keeps every chunk independently valid.
 */
export function chunkPlaintext(text: string): string[] {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length === 0) return [];

  const decoder = new TextDecoder();
  const out: string[] = [];

  for (let i = 0; i < bytes.length; i += BYTES_PER_CHUNK) {
    out.push(decoder.decode(bytes.slice(i, i + BYTES_PER_CHUNK)));
  }
  return out;
}

export function messageTooLong(text: string): boolean {
  return new TextEncoder().encode(text).length > MAX_MESSAGE_BYTES;
}

interface CotiSigner {
  encryptValue: (
    plaintext: string,
    contractAddress: string,
    functionSelector: string,
  ) => Promise<unknown>;
}

/**
 * Encrypts and sends, choosing the right call for the length.
 *
 * A single chunk goes through `sendMessage`; anything longer goes through
 * `sendMultipartMessage`, which is exactly why that second function exists.
 */
export async function sendPrivateMessage(
  signer: CotiSigner,
  to: string,
  text: string,
  contractAddress: string = addresses.privateMessaging,
): Promise<{ hash: string; chunks: number }> {
  const pieces = chunkPlaintext(text);
  if (pieces.length === 0) throw new Error("Nothing to send.");
  if (pieces.length > MAX_CHUNKS) {
    throw new Error(
      `That message is too long. The limit is ${MAX_MESSAGE_BYTES} bytes, about ${MAX_MESSAGE_BYTES} characters of plain English.`,
    );
  }

  const messaging = new Contract(contractAddress, privateMessagingAbi as never, signer as never);

  // Each function has its own selector, and the signature is bound to it, so
  // the chunks must be encrypted for the call that will actually carry them.
  const single = pieces.length === 1;
  const fn = single ? "sendMessage" : "sendMultipartMessage";
  const selector = messaging.interface.getFunction(fn)!.selector;

  const encrypted = [];
  for (const piece of pieces) {
    encrypted.push(await signer.encryptValue(piece, contractAddress, selector));
  }

  const tx = single
    ? await messaging.sendMessage(to, encrypted[0], { gasLimit: 8_000_000n })
    : await messaging.sendMultipartMessage(to, encrypted, { gasLimit: 12_000_000n });

  await tx.wait();
  return { hash: tx.hash as string, chunks: pieces.length };
}
