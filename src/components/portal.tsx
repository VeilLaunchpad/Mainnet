"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Renders into `document.body`, out of whatever is above it in the tree.
 *
 * `position: fixed` is only relative to the viewport while no ancestor has
 * created a containing block. `transform`, `filter`, `perspective`,
 * `will-change` and `backdrop-filter` all create one, and the header here has
 * `backdrop-blur-xl`, so a dialog rendered inside it was being positioned and
 * clipped against the header rather than the page. It landed under the nav and
 * ran off the top of the screen.
 *
 * A portal sidesteps that entirely: the dialog leaves the header's subtree, so
 * `inset-0` means the viewport again and the backdrop blur covers the whole
 * page instead of a strip behind the nav.
 */
export function Portal({ children }: { children: ReactNode }) {
  // `document` does not exist while rendering on the server, and mounting on
  // the first client render keeps the markup identical on both sides.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) return null;
  return createPortal(children, document.body);
}

/** Stops the page scrolling underneath an open dialog. */
export function useLockScroll(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [active]);
}
