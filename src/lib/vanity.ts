import { keccak256, encodePacked, getAddress, type Address, type Hex } from "viem";

/**
 * Vanity addresses for VEILPAD launches.
 *
 * Every token launched here lands on an address ending in 8888. That is not
 * decoration: it is a mark a lookalike cannot cheaply fake, so someone pasted a
 * contract address can tell at a glance whether it came from this launchpad.
 *
 * Both the curve and the token deploy with CREATE2, which makes the address a
 * pure function of (deployer, salt, init code hash). The salt is found here, in
 * the browser, and the chain only checks the result. Four hex characters means
 * 16^4 = 65,536 candidates on average, which is about a second of hashing.
 */

export const VANITY_SUFFIX = "8888";

/** The standard CREATE2 address derivation. */
export function create2Address(deployer: Address, salt: Hex, initCodeHash: Hex): Address {
  const packed = encodePacked(
    ["bytes1", "address", "bytes32", "bytes32"],
    ["0xff", deployer, salt, initCodeHash],
  );
  return getAddress(("0x" + keccak256(packed).slice(-40)) as Address);
}

export interface MineResult {
  salt: Hex;
  address: Address;
  attempts: number;
  ms: number;
}

function saltFrom(seed: bigint): Hex {
  return ("0x" + seed.toString(16).padStart(64, "0")) as Hex;
}

/**
 * Searches for a salt whose CREATE2 address ends in `suffix`.
 *
 * Runs in slices and yields to the event loop between them, so the browser stays
 * responsive and a caller can show progress instead of freezing on a spinner.
 */
export async function mineVanitySalt(
  deployer: Address,
  initCodeHash: Hex,
  options: {
    suffix?: string;
    /** Where to start counting. Randomised by default so two tabs diverge. */
    start?: bigint;
    /** Give up after this many attempts rather than hanging forever. */
    maxAttempts?: number;
    /** Attempts between yields. Higher is faster but less responsive. */
    slice?: number;
    onProgress?: (attempts: number) => void;
    signal?: AbortSignal;
  } = {},
): Promise<MineResult> {
  const suffix = (options.suffix ?? VANITY_SUFFIX).toLowerCase();
  const maxAttempts = options.maxAttempts ?? 2_000_000;
  const slice = options.slice ?? 2_000;

  const start =
    options.start ??
    BigInt("0x" + crypto.getRandomValues(new Uint32Array(4)).reduce((s, n) => s + n.toString(16).padStart(8, "0"), ""));

  const began = Date.now();
  let attempts = 0;
  let seed = start;

  while (attempts < maxAttempts) {
    if (options.signal?.aborted) throw new Error("Mining cancelled");

    for (let i = 0; i < slice; i += 1) {
      const salt = saltFrom(seed);
      const address = create2Address(deployer, salt, initCodeHash);
      attempts += 1;
      seed += 1n;

      if (address.toLowerCase().endsWith(suffix)) {
        return { salt, address, attempts, ms: Date.now() - began };
      }
    }

    options.onProgress?.(attempts);
    // Yield so the UI can paint. A microtask is not enough on the main thread.
    await new Promise((r) => setTimeout(r, 0));
  }

  throw new Error(
    "Could not find a " + suffix + " address in " + maxAttempts.toLocaleString("en-US") + " attempts",
  );
}

/** Random 32 bytes, used for the curve salt where no pattern is required. */
export function randomSalt(): Hex {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return ("0x" + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")) as Hex;
}

export function endsWithVanity(address: string, suffix = VANITY_SUFFIX): boolean {
  return address.toLowerCase().endsWith(suffix.toLowerCase());
}
