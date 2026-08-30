"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { AgentChat } from "./agent-chat";

const SUGGESTIONS = [
  "What can I actually do here?",
  "Show me launches closest to graduating",
  "How does COTI keep my balance private?",
  "Help me launch a token in one go",
];

/**
 * DEVOX, the house concierge, docked on every page.
 *
 * Deliberately always-present: the whole product is agent-first, so the agent
 * should never be more than one click away from whatever the user is doing.
 */
export function AgentDock() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const path = usePathname();

  useEffect(() => setMounted(true), []);
  useEffect(() => setOpen(false), [path]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The dedicated agent pages already host a full-size chat.
  if (!mounted || path.startsWith("/agents/")) return null;

  return (
    <>
      {open && (
        <div className="animate-rise fixed bottom-20 right-4 z-50 flex h-[560px] max-h-[76dvh] w-[min(410px,calc(100vw-2rem))] flex-col rounded-2xl border border-white/10 bg-ink-900/95 p-3 shadow-2xl backdrop-blur-2xl">
          <div className="mb-2 flex shrink-0 items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-mint-400 shadow-[0_0_8px] shadow-mint-400/70" />
              <span className="text-[13px] font-semibold">DEVOX</span>
              <span className="text-[11px] text-white/35">concierge</span>
            </div>
            <button onClick={() => setOpen(false)} className="text-white/40 transition hover:text-white">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <AgentChat agentSlug="devox" agentName="DEVOX" suggestions={SUGGESTIONS} compact className="min-h-0 flex-1" />
        </div>
      )}

      <button
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-5 right-4 z-50 flex items-center gap-2 rounded-full bg-gradient-to-r from-devox-500 to-cy-500 px-4 py-3 text-[13px] font-semibold text-white shadow-lg shadow-devox-500/25 transition hover:brightness-110"
      >
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
          <path
            d="M8 1.5 2 5v4.4c0 3.5 2.6 5.5 6 6.1 3.4-.6 6-2.6 6-6.1V5L8 1.5Z"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        </svg>
        {open ? "Close" : "Ask DEVOX"}
      </button>
    </>
  );
}
