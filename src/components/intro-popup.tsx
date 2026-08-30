"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Portal, useLockScroll } from "./portal";

/**
 * A one-time explanation of what a page is for.
 *
 * The dismissal lives in `localStorage` on purpose. It survives reloads and
 * new tabs, which is what makes "don't show again" mean something, and it is
 * wiped when someone clears their site data, which is what makes the promise
 * honest: this is a preference on this browser, not an account setting we
 * store about them.
 *
 * The key carries a version. Rewriting the copy for a page that has genuinely
 * changed should be allowed to reach people who dismissed the old version, and
 * bumping the version is how that happens.
 */

export interface IntroPoint {
  icon: string;
  title: string;
  body: string;
}

export function IntroPopup({
  id,
  version = 1,
  title,
  lead,
  points,
  footer,
}: {
  id: string;
  version?: number;
  title: ReactNode;
  lead: string;
  points: IntroPoint[];
  footer?: string;
}) {
  const key = `devox.intro.${id}.v${version}`;

  // Never render on the server: the answer depends on this browser's storage,
  // and guessing would flash the popup at people who dismissed it.
  const [decided, setDecided] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(key) === "1";
    } catch {
      // Private mode or blocked storage: show it, and let OK close it for now.
    }
    setOpen(!dismissed);
    setDecided(true);
  }, [key]);

  function close(forever: boolean) {
    if (forever) {
      try {
        localStorage.setItem(key, "1");
      } catch {
        /* nothing to persist to; closing still works for this visit */
      }
    }
    setOpen(false);
  }

  useLockScroll(open);

  if (!decided || !open) return null;

  // Portaled for the same reason the wallet picker is: a dialog rendered inside
  // page content is at the mercy of any ancestor with a filter or a transform,
  // which would quietly stop `fixed` meaning the viewport.
  return (
    <Portal>
      <div
        role="dialog"
        aria-modal="true"
        className="fixed inset-0 z-[80] grid place-items-center overflow-y-auto bg-ink-950/75 p-4 backdrop-blur-md"
      >
        <div className="animate-rise my-auto w-full max-w-lg overflow-hidden rounded-2xl border border-white/12 bg-ink-900 shadow-2xl shadow-black/70">
        <div className="border-b border-white/[0.07] px-6 py-5">
          <h2 className="text-[18px] font-bold">{title}</h2>
          <p className="mt-1.5 text-[13px] leading-relaxed text-white/50">{lead}</p>
        </div>

        <div className="space-y-3 px-6 py-5">
          {points.map((p) => (
            <div key={p.title} className="flex gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-white/[0.05] text-[15px]">
                {p.icon}
              </span>
              <div className="min-w-0">
                <div className="text-[13px] font-semibold">{p.title}</div>
                <div className="mt-0.5 text-[12px] leading-relaxed text-white/45">{p.body}</div>
              </div>
            </div>
          ))}

          {footer && (
            <p className="border-t border-white/[0.06] pt-3 text-[11px] leading-relaxed text-white/30">
              {footer}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2 px-6 pb-6 sm:flex-row-reverse">
          <button
            onClick={() => close(false)}
            className="rounded-xl bg-gradient-to-r from-devox-500 to-cy-500 px-5 py-2.5 text-[13px] font-semibold text-white transition hover:brightness-110 sm:flex-1"
          >
            OK
          </button>
          <button
            onClick={() => close(true)}
            className="rounded-xl border border-white/12 px-5 py-2.5 text-[13px] font-medium text-white/55 transition hover:border-white/25 hover:text-white sm:flex-1"
          >
            Don&apos;t show this again
          </button>
        </div>

          <p className="px-6 pb-5 text-center text-[10px] text-white/25">
            Kept in this browser only. Clearing your site data brings it back.
          </p>
        </div>
      </div>
    </Portal>
  );
}
