"use client";

import { useState } from "react";
import { usePrivacy } from "./privacy-provider";

/**
 * The switch itself, and the sentence that keeps it honest.
 *
 * A padlock with no explanation invites the reading "everything I do is now
 * invisible", which is not true on any chain. So the control carries a short,
 * specific statement of what it covers and what it does not, rather than a
 * reassuring icon.
 */
export function PrivacySwitch({ compact = false }: { compact?: boolean }) {
  const { on, toggle, ready } = usePrivacy();
  const [open, setOpen] = useState(false);

  if (!ready) return <div className="h-8 w-[92px]" />;

  return (
    <div className="relative">
      <button
        onClick={toggle}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        aria-pressed={on}
        title={on ? "Privacy on" : "Privacy off"}
        className={
          "group flex items-center gap-2 rounded-xl border px-2.5 py-1.5 text-[12px] font-semibold transition " +
          (on
            ? "border-mint-400/40 bg-mint-400/10 text-mint-400 hover:bg-mint-400/15"
            : "border-white/12 bg-white/[0.03] text-white/45 hover:text-white/70")
        }
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" className="shrink-0">
          {on ? (
            <>
              <rect x="3" y="7" width="10" height="6.5" rx="1.6" stroke="currentColor" strokeWidth="1.5" />
              <path d="M5.4 7V5.2a2.6 2.6 0 0 1 5.2 0V7" stroke="currentColor" strokeWidth="1.5" />
            </>
          ) : (
            <>
              <rect x="3" y="7" width="10" height="6.5" rx="1.6" stroke="currentColor" strokeWidth="1.5" />
              <path d="M5.4 7V5.2a2.6 2.6 0 0 1 4.6-1.7" stroke="currentColor" strokeWidth="1.5" />
            </>
          )}
        </svg>
        {compact ? (on ? "On" : "Off") : on ? "Privacy on" : "Privacy off"}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-[310px] rounded-xl border border-white/10 bg-ink-850 p-3.5 text-left shadow-2xl">
          <div className="text-[12px] font-semibold text-white/85">
            {on ? "Every choice defaults to private" : "Choices default to public"}
          </div>
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-white/50">
            {on
              ? "Tokens you launch get encrypted balances, staking prefers the private twin, and NFT metadata is sealed to the holder."
              : "Tokens you launch will have public balances. NFT metadata stays sealed regardless — that is not optional."}
          </p>
          <div className="mt-2.5 border-t border-white/[0.07] pt-2.5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-white/35">
              Always visible, either way
            </div>
            <p className="mt-1 text-[11.5px] leading-relaxed text-white/45">
              That a transaction happened, which address sent it, and the COTI moved through a
              public pool. No switch can hide those — on any chain.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
