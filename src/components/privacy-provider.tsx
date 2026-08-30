"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

/**
 * One switch that makes every choice the private one.
 *
 * The setting is a default, not a spell, and the difference matters enough to
 * encode it here rather than leave it to each page. On COTI these things can
 * genuinely be hidden:
 *
 *   balances        a PrivateERC20 answers balanceOf with a ciphertext
 *   NFT metadata    sealed to the holder's key, re-sealed on transfer
 *   messages        end-to-end, garbled-circuit encrypted
 *   a holding       wrapped through the portal into its private twin
 *
 * And these cannot, on any chain, by anyone:
 *
 *   that a transaction happened at all
 *   which address sent it and which contract it touched
 *   the COTI amount moved through a public AMM pool
 *
 * So the toggle turns on every privacy that exists and the interface says,
 * per action, what is actually covered. Claiming a switch hides a public swap
 * would be a lie somebody could be hurt by, so every surface that uses this
 * also renders what stays visible.
 */

interface PrivacyApi {
  /** True when the user wants the private option everywhere it exists. */
  on: boolean;
  set: (v: boolean) => void;
  toggle: () => void;
  /** False until the stored preference has been read, to avoid a flash. */
  ready: boolean;
}

const KEY = "devoxpad.privacy";

const Ctx = createContext<PrivacyApi>({
  on: true,
  set: () => undefined,
  toggle: () => undefined,
  ready: false,
});

export function usePrivacy() {
  return useContext(Ctx);
}

export function PrivacyProvider({ children }: { children: ReactNode }) {
  // Private by default. This is a privacy product; the safe default is the one
  // that hides more, and somebody who wants a plain public token can say so.
  const [on, setOn] = useState(true);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved !== null) setOn(saved === "1");
    } catch {
      // A browser with storage blocked still gets the safe default.
    }
    setReady(true);
  }, []);

  const set = (v: boolean) => {
    setOn(v);
    try {
      localStorage.setItem(KEY, v ? "1" : "0");
    } catch {
      // Not persisting is survivable; silently failing to apply it is not, and
      // the state above has already been set.
    }
  };

  return (
    <Ctx.Provider value={{ on, set, toggle: () => set(!on), ready }}>{children}</Ctx.Provider>
  );
}
