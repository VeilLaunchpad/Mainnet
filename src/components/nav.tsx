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
const LINKS = [
  { href: "/launchpad", label: "Launchpad" },
  { href: "/swap", label: "Swap" },
  { href: "/explore", label: "Explore" },
  { href: "/desk", label: "Desk" },
  { href: "/stake", label: "Stake" },
  { href: "/nft", label: "NFT" },
  { href: "/treasury", label: "Treasury" },
  { href: "/lock", label: "Lock" },
  { href: "/portal", label: "Portal" },
  { href: "/bridge", label: "Bridge" },
  { href: "/agents", label: "Agents" },
  { href: "/messages", label: "Messages" },
  { href: "/dashboard", label: "Dashboard" },
];

export function Nav() {
  const path = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-ink-950/70 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-6 px-4 sm:px-6">
        <Link href="/" className="group flex items-center gap-2.5">
          <DevoxMark />
          <span className="text-[15px] font-bold tracking-tight">
            DEVOX<span className="text-devox-400">PAD</span>
          </span>
        </Link>

        <nav className="hidden flex-1 items-center gap-1 lg:flex">
          {LINKS.map((l) => {
            const active = path === l.href || path.startsWith(l.href + "/");
            return (
              <Link
                key={l.href}
                href={l.href}
                className={
                  "rounded-lg px-3 py-1.5 text-[13px] font-medium transition " +
                  (active ? "bg-white/[0.07] text-white" : "text-white/55 hover:text-white")
                }
              >
                {l.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
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
          <PrivacySwitch />
          <NetworkSwitch />
          <ConnectButton />
          <button
            onClick={() => setOpen((v) => !v)}
            className="rounded-lg border border-white/10 p-2 lg:hidden"
            aria-label="Menu"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      {open && (
        <nav className="animate-rise border-t border-white/5 px-4 py-2 lg:hidden">
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
