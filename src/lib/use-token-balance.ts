"use client";

import { useCallback, useEffect, useState } from "react";
import { Contract } from "ethers";
import { encodeFunctionData, type Address, type PublicClient } from "viem";
import { erc20Abi, privateErc20Abi } from "./abis";
import type { CotiSession } from "./coti-client";

/**
 * Reads what the wallet actually holds of a token, public or encrypted.
 *
 * The two kinds cannot be read the same way, and guessing wrong is not a
 * cosmetic error: a COTI PrivateERC20 returns `balanceOf` as a two-word
 * ciphertext struct, so decoding it as a plain uint256 silently yields the high
 * word - a huge, arbitrary number that looks like a balance. The shape of the
 * returned data is the honest signal, so it is what decides here:
 *
 *   64 bytes  a ciphertext; only the holder's AES key turns it into a number
 *   32 bytes  an ordinary uint256
 *   anything  not a readable token balance, reported as unknown rather than 0
 *
 * Unknown is deliberately not zero. An address with no contract answers `0x`,
 * and showing that as "balance 0.0" would tell someone their tokens are gone.
 */
export interface TokenBalance {
  /** The exact amount, or null while unknown, sealed, or unreadable. */
  raw: bigint | null;
  /** True when the token stores balances as ciphertext. */
  encrypted: boolean;
  /** Encrypted and not yet decrypted for this viewer. */
  sealed: boolean;
  loading: boolean;
  revealing: boolean;
  error: string | null;
  /**
   * Decrypts an encrypted balance locally.
   *
   * Free once the COTI key exists for this address and network. Creating that
   * key the first time is a signature AND an on-chain transaction, so this does
   * not promise "one signature, no gas" the way the rest of the app used to.
   */
  reveal: () => Promise<void>;
  refresh: () => void;
}

interface CotiController {
  session: CotiSession | null;
  unlock: () => Promise<CotiSession | null>;
  error?: string | null;
}

export function useTokenBalance(
  token: Address | undefined,
  owner: Address | undefined,
  publicClient: PublicClient | undefined,
  coti: CotiController,
): TokenBalance {
  const [raw, setRaw] = useState<bigint | null>(null);
  const [encrypted, setEncrypted] = useState(false);
  const [sealed, setSealed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!token || !owner || !publicClient) {
      setRaw(null);
      setEncrypted(false);
      setSealed(false);
      setError(null);
      return;
    }

    let alive = true;
    setLoading(true);
    setError(null);
    setRaw(null);

    (async () => {
      try {
        // A raw call, because the byte length is the thing being measured and
        // a decoding read would throw it away before it could be looked at.
        const res = await publicClient.call({
          to: token,
          data: encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [owner] }),
        });
        if (!alive) return;

        const hex = (res.data || "0x") as string;
        const bytes = (hex.length - 2) / 2;

        if (bytes === 64) {
          setEncrypted(true);
          setSealed(true);
          setRaw(null);
        } else if (bytes === 32) {
          setEncrypted(false);
          setSealed(false);
          setRaw(BigInt(hex));
        } else {
          setEncrypted(false);
          setSealed(false);
          setRaw(null);
          setError("This address did not answer with a balance.");
        }
      } catch (e) {
        if (!alive) return;
        setRaw(null);
        setError(String((e as Error).message || e).slice(0, 140));
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [token, owner, publicClient, nonce]);

  const reveal = useCallback(async () => {
    if (!token || !owner || !encrypted) return;
    setRevealing(true);
    setError(null);
    try {
      const session = coti.session || (await coti.unlock());
      if (!session) throw new Error(coti.error || "Could not unlock your COTI key.");

      const c = new Contract(token, privateErc20Abi as never, session.signer);
      const r = await c["balanceOf(address)"](owner);
      // Named fields. `decryptValue256` wants the struct, not the array ethers
      // hands back, and reading the array positionally is how a balance turns
      // into a plausible wrong number.
      const ct = { ciphertextHigh: r[0], ciphertextLow: r[1] };
      const clear = await session.signer.decryptValue256(ct as never);
      setRaw(BigInt(clear.toString()));
      setSealed(false);
    } catch (e) {
      setError(String((e as Error).message || e).slice(0, 140));
    } finally {
      setRevealing(false);
    }
  }, [token, owner, encrypted, coti]);

  return { raw, encrypted, sealed, loading, revealing, error, reveal, refresh };
}

/**
 * A percentage of a balance, computed on the integer.
 *
 * Going through a float here is how "Max" ends up one wei over what the wallet
 * holds and the trade reverts on a balance check. Integer arithmetic on the
 * raw amount cannot drift, and 100% returns the balance itself untouched.
 */
export function percentOf(raw: bigint, percent: number): bigint {
  if (percent >= 100) return raw;
  return (raw * BigInt(Math.round(percent))) / 100n;
}
