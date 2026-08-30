"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { useIsMutating } from "@tanstack/react-query";

/**
 * One place that answers "is anything happening right now".
 *
 * Three sources feed it and none of them needed a per-button change:
 *
 *  - Every wallet action. wagmi runs its writes through TanStack Query, so
 *    `useIsMutating` sees each `writeContractAsync`, `switchChain` and
 *    `connect` in the entire app without a single call site knowing about it.
 *  - Every internal navigation, caught from the click rather than from each
 *    link, so menus and buttons that route are covered too.
 *  - Anything wrapped in `run()`, for work that is neither of those, such as
 *    a fetch or an upload.
 *
 * Nothing shows for the first fraction of a second. Most navigations finish
 * faster than that, and a spinner that flashes on every click reads as jank
 * rather than as feedback.
 */

const SHOW_AFTER_MS = 180;

/** A stuck flag is worse than no flag, so navigation gives up on its own. */
const NAV_GIVE_UP_MS = 12_000;

interface BusyApi {
  /** Wrap an async action so the overlay covers it. */
  run: <T>(label: string, fn: () => Promise<T>) => Promise<T>;
  /** Drive the overlay manually when `run` does not fit. */
  set: (label: string | null) => void;
  label: string | null;
}

const Ctx = createContext<BusyApi>({
  run: (_l, fn) => fn(),
  set: () => undefined,
  label: null,
});

export function useBusy() {
  return useContext(Ctx);
}

export function BusyProvider({ children }: { children: ReactNode }) {
  const [manual, setManual] = useState<string | null>(null);
  const depth = useRef(0);

  /**
   * Nested calls are counted rather than overwritten. An approve inside a
   * bridge would otherwise clear the overlay the moment it finished, while
   * the transfer it exists to enable was still running.
   */
  const run = useCallback(async <T,>(label: string, fn: () => Promise<T>): Promise<T> => {
    depth.current += 1;
    setManual(label);
    try {
      return await fn();
    } finally {
      depth.current -= 1;
      if (depth.current <= 0) {
        depth.current = 0;
        setManual(null);
      }
    }
  }, []);

  const api = useMemo<BusyApi>(
    () => ({ run, set: setManual, label: manual }),
    [run, manual],
  );

  return (
    <Ctx.Provider value={api}>
      {children}
      <BusyOverlay manual={manual} />
    </Ctx.Provider>
  );
}

/* ------------------------------------------------------------------ */

function BusyOverlay({ manual }: { manual: string | null }) {
  const navigating = useNavigating();
  const mutating = useIsMutating() > 0;

  const label = manual ?? (mutating ? "Confirm in your wallet" : navigating ? "Loading" : null);
  const visible = useDelayed(label !== null, SHOW_AFTER_MS);

  if (!visible || !label) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-[95] flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]"
    >
      <div className="animate-rise flex items-center gap-3.5 rounded-2xl border border-white/10 bg-ink-900 px-5 py-4 shadow-2xl shadow-black/60">
        <Spinner />
        <div>
          <div className="text-[14px] font-semibold">{label}</div>
          <div className="text-[11px] text-white/35">
            {mutating && !manual ? "Your wallet is waiting for you" : "One moment"}
          </div>
        </div>
      </div>
    </div>
  );
}

export function Spinner({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className="shrink-0 animate-spin text-devox-400"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.18" strokeWidth="3" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

/* ------------------------------------------------------------------ */

/**
 * Catching navigation from the click means every link is covered, including
 * ones inside menus and cards that were never told about this.
 */
function useNavigating() {
  const pathname = usePathname();
  const [navigating, setNavigating] = useState(false);

  // Arriving is the only reliable signal that a navigation finished.
  useEffect(() => {
    setNavigating(false);
  }, [pathname]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      // A modified click opens a tab and never navigates this document.
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
        return;

      const a = (e.target as HTMLElement | null)?.closest?.("a");
      if (!a) return;

      const href = a.getAttribute("href");
      if (!href || !href.startsWith("/")) return;
      if (a.getAttribute("target") === "_blank") return;
      if (a.hasAttribute("download")) return;

      // Same page, or only a fragment of it, is not a navigation.
      if (href === pathname || href.startsWith("#")) return;

      setNavigating(true);
    }

    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [pathname]);

  useEffect(() => {
    if (!navigating) return;
    const t = setTimeout(() => setNavigating(false), NAV_GIVE_UP_MS);
    return () => clearTimeout(t);
  }, [navigating]);

  return navigating;
}

/** True only once `on` has stayed true for `ms`, so brief work stays silent. */
function useDelayed(on: boolean, ms: number) {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (!on) {
      setShown(false);
      return;
    }
    const t = setTimeout(() => setShown(true), ms);
    return () => clearTimeout(t);
  }, [on, ms]);

  return shown;
}
