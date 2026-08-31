"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { PrivacySwitch } from "./privacy-switch";
import { ConnectButton } from "./connect-button";
import { NetworkSwitch } from "./network-switch";

/**
 * The primary surface, in the order someone actually moves through it: find a
 * token, trade it, make it private, bring value in, then the agent side and
 * your own account.
 *
 * Names say what the page does. "DeFi" and "Trade" were categories, not
 * actions, and left people guessing which one held the swap.
 */
/*
 * Thirteen destinations in one row is not a navigation, it is a list.
 *
 * At that width every label had to shrink until nothing was scannable and the
 * controls on the right had no room left - the privacy toggle was wrapping
 * onto two lines. So the bar now carries the five surfaces people actually
 * arrive for, and the rest live one click away, grouped by what they are for.
 * Nothing was removed: the mobile sheet still lists all of it, and every
 * route is still a route.
 */
const PRIMARY = [
  { href: "/launchpad", label: "Launchpad" },
  { href: "/swap", label: "Swap" },
  { href: "/nft", label: "NFT" },
  { href: "/stake", label: "Stake" },
  { href: "/desk", label: "Desk" },
];

const MORE: { group: string; items: { href: string; label: string; hint: string }[] }[] = [
  {
    group: "Markets",
    items: [
      { href: "/explore", label: "Explore", hint: "Every token and pool" },
      { href: "/portal", label: "Portal", hint: "Wrap into the private twin" },
      { href: "/bridge", label: "Bridge", hint: "Move value onto COTI" },
    ],
  },
  {
    group: "Holdings",
    items: [
      { href: "/dashboard", label: "Dashboard", hint: "What you hold" },
      { href: "/lock", label: "Lock", hint: "Time-locked positions" },
      { href: "/treasury", label: "Treasury", hint: "What backs the rewards" },
    ],
  },
  {
    group: "Agents",
    items: [
      { href: "/agents", label: "Agents", hint: "The roster" },
      { href: "/messages", label: "Messages", hint: "Encrypted, wallet to wallet" },
    ],
  },
];

const LINKS = [
  ...PRIMARY,
  ...MORE.flatMap((g) => g.items.map((i) => ({ href: i.href, label: i.label }))),
];

export function Nav() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [more, setMore] = useState(false);

  // The grouped menu shows as active when you are on one of its pages, so the
  // bar never looks like it has forgotten where you are.
  const moreActive = MORE.some((g) =>
    g.items.some((i) => path === i.href || path.startsWith(i.href + "/")),
  );

  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-ink-950/70 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-3 px-4 sm:gap-6 sm:px-6">
        <Link href="/" className="group flex shrink-0 items-center gap-2.5">
          <DevoxMark />
          <span className="text-[15px] font-bold tracking-tight">
            DEVOX<span className="text-devox-400">PAD</span>
          </span>
        </Link>

        <nav className="hidden flex-1 items-center gap-0.5 lg:flex">
          {PRIMARY.map((l) => {
            const active = path === l.href || path.startsWith(l.href + "/");
            return (
              <Link
                key={l.href}
                href={l.href}
                className={
                  "rounded-lg px-3 py-1.5 text-[13px] transition " +
                  (active ? "bg-white/[0.08] text-white" : "text-white/55 hover:text-white")
                }
              >
                {l.label}
              </Link>
            );
          })}

          {/* Hover and focus both open it, so it works for a pointer and for a
              keyboard without needing a click to commit. */}
          <div
            className="relative"
            onMouseEnter={() => setMore(true)}
            onMouseLeave={() => setMore(false)}
          >
            <button
              onClick={() => setMore((v) => !v)}
              onFocus={() => setMore(true)}
              aria-expanded={more}
              className={
                "flex items-center gap-1 rounded-lg px-3 py-1.5 text-[13px] transition " +
                (moreActive ? "bg-white/[0.08] text-white" : "text-white/55 hover:text-white")
              }
            >
              More
              <svg width="9" height="9" viewBox="0 0 10 10" fill="none"
                className={"transition " + (more ? "rotate-180" : "")}>
                <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </button>

            {more && (
              <div className="absolute left-0 top-full z-50 w-[520px] pt-2">
                <div className="panel grid grid-cols-3 gap-1 p-2">
                  {MORE.map((g) => (
                    <div key={g.group}>
                      <div className="px-2.5 pb-1 pt-2 text-[10px] font-medium uppercase tracking-[0.16em] text-white/30">
                        {g.group}
                      </div>
                      {g.items.map((i) => {
                        const active = path === i.href || path.startsWith(i.href + "/");
                        return (
                          <Link
                            key={i.href}
                            href={i.href}
                            onClick={() => setMore(false)}
                            className={
                              "block rounded-lg px-2.5 py-2 transition " +
                              (active ? "bg-white/[0.08]" : "hover:bg-white/[0.05]")
                            }
                          >
                            <div className="text-[13px] text-white">{i.label}</div>
                            <div className="mt-0.5 text-[11px] leading-snug text-white/40">
                              {i.hint}
                            </div>
                          </Link>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </nav>

        <div className="ml-auto flex min-w-0 items-center gap-2">
          <Link
            href="/docs"
            className={
              "hidden rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition xl:block " +
              (path.startsWith("/docs") ? "text-white" : "text-white/45 hover:text-white")
            }
          >
            Docs
          </Link>
          <Link
            href="/launch"
            className="hidden rounded-xl border border-devox-400/30 bg-devox-500/10 px-3.5 py-2 text-[13px] font-semibold text-devox-300 transition hover:bg-devox-500/20 sm:block"
          >
            Launch
          </Link>
          {/* Five controls do not fit across 390px. At that width the wallet
              address was wrapping onto a second line and pushing the menu
              button off the edge, so these two move into the sheet - where
              they get a label and more room than they had up here. */}
          <div className="hidden items-center gap-2 md:flex">
            <PrivacySwitch />
            <NetworkSwitch />
          </div>
          <ConnectButton />
          <button
            onClick={() => setOpen((v) => !v)}
            className="btn-frosted shrink-0 p-2 lg:hidden"
            aria-label="Menu"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      {open && (
        <nav className="animate-rise border-t border-white/5 px-4 pb-3 pt-2 lg:hidden">
          {/* The two controls the bar could not hold, given room and a name. */}
          <div className="mb-2 flex items-center gap-2 border-b border-white/[0.06] pb-3 md:hidden">
            <PrivacySwitch />
            <NetworkSwitch />
          </div>
          {[
            ...LINKS,
            { href: "/launch", label: "Launch a token" },
            { href: "/skills", label: "DEVOX Skills" },
            { href: "/docs", label: "Docs" },
            { href: "/status", label: "Status" },
          ].map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className="block rounded-lg px-3 py-2.5 text-sm text-white/70 transition hover:bg-white/5"
            >
              {l.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}

/**
 * The wordmark's glyph, and the same shape the token carries.
 *
 * It is drawn inline rather than loaded from /devox-token.svg because this
 * renders in the header of every page: an <img> would be a second request on
 * first paint and would flash empty until it lands. The geometry is the token
 * mark scaled to a 24-unit box - hexagon shell, an X, and the sealed centre -
 * so the two cannot drift apart in shape, only in file.
 *
 * The shield-and-tick it replaced was VEILPAD's, and read as "verified" rather
 * than as a brand.
 */
export function DevoxMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className="shrink-0">
      <defs>
        <linearGradient id="dvm" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
          <stop stopColor="#8f99ff" />
          <stop offset="1" stopColor="#00e5ff" />
        </linearGradient>
      </defs>
      {/* the shell: public, and the part you always see */}
      <path
        d="M12 1.6 21.5 7v10L12 22.4 2.5 17V7Z"
        stroke="url(#dvm)"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      {/* the X */}
      <g stroke="url(#dvm)" strokeWidth="2.1" strokeLinecap="round">
        <path d="M8.6 8.4 15.4 15.2" />
        <path d="M15.4 8.4 8.6 15.2" />
      </g>
      {/* the seal, where the strokes cross */}
      <circle cx="12" cy="11.8" r="2.1" fill="#050c22" />
      <circle cx="12" cy="11.8" r="1.05" fill="#00e5ff" />
    </svg>
  );
}
