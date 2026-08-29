"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
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
          <VeilMark />
          <span className="text-[15px] font-bold tracking-tight">
            VEIL<span className="text-veil-400">PAD</span>
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
            className="hidden rounded-xl border border-veil-400/30 bg-veil-500/10 px-3.5 py-2 text-[13px] font-semibold text-veil-300 transition hover:bg-veil-500/20 sm:block"
          >
            Launch
          </Link>
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
            { href: "/skills", label: "VEIL Skills" },
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

export function VeilMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className="shrink-0">
      <defs>
        <linearGradient id="vm" x1="0" y1="0" x2="24" y2="24">
          <stop stopColor="#a78bfa" />
          <stop offset="1" stopColor="#22d3ee" />
        </linearGradient>
      </defs>
      <path d="M12 2 3 7v6.2C3 18.4 6.9 21.4 12 22.5c5.1-1.1 9-4.1 9-9.3V7l-9-5Z" stroke="url(#vm)" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M8.4 12.2 11 14.8l4.6-5.2" stroke="url(#vm)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
