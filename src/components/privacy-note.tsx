"use client";

import { usePrivacy } from "./privacy-provider";

/**
 * What privacy this particular action actually gets.
 *
 * Every surface that can be private renders one of these, because "privacy is
 * on" is a global claim and a user is about to take a specific action. The two
 * lists are deliberately both present: a component that only listed what is
 * hidden would read as a guarantee it cannot make.
 */
export function PrivacyNote({
  hidden,
  visible,
  /** Set when this surface has no private option at all, whatever the switch says. */
  unavailable,
}: {
  hidden: string[];
  visible: string[];
  unavailable?: string;
}) {
  const { on } = usePrivacy();

  if (unavailable) {
    return (
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-3.5 py-2.5">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-white/35">
          Privacy
        </div>
        <p className="mt-1 text-[12px] leading-relaxed text-white/45">{unavailable}</p>
      </div>
    );
  }

  const covered = on ? hidden : [];
  const exposed = on ? visible : [...hidden, ...visible];

  return (
    <div
      className={
        "rounded-xl border px-3.5 py-2.5 " +
        (on ? "border-mint-400/20 bg-mint-400/[0.04]" : "border-white/[0.08] bg-white/[0.02]")
      }
    >
      <div className="flex items-center gap-2">
        <span
          className={
            "text-[11px] font-semibold uppercase tracking-wider " +
            (on ? "text-mint-400" : "text-white/35")
          }
        >
          {on ? "Privacy on" : "Privacy off"}
        </span>
      </div>

      {covered.length > 0 && (
        <p className="mt-1.5 text-[12px] leading-relaxed text-mint-200/70">
          Encrypted: {covered.join(", ")}.
        </p>
      )}

      <p className="mt-1 text-[12px] leading-relaxed text-white/45">
        Public: {exposed.join(", ")}.
      </p>
    </div>
  );
}
