"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

/**
 * A select that behaves like a select.
 *
 * Native `<select>` cannot carry an icon, a subtitle or a disabled reason, and
 * the bridge needs all three: a route that COTI does not operate has to be
 * visible and unpickable rather than quietly missing, otherwise the form looks
 * broken instead of honest.
 */

export interface SelectOption {
  value: string;
  label: string;
  sub?: string;
  icon?: ReactNode;
  disabled?: boolean;
  /** Shown when the option is disabled, so the reason travels with it. */
  disabledNote?: string;
}

export function SelectMenu({
  label,
  value,
  options,
  placeholder = "Select",
  onChange,
  searchable = false,
  searchPlaceholder = "Search…",
  disabled = false,
}: {
  label: string;
  value: string | null;
  options: SelectOption[];
  placeholder?: string;
  onChange: (value: string) => void;
  searchable?: boolean;
  searchPlaceholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrap = useRef<HTMLDivElement>(null);

  // Clicking anywhere else should close it, including on another dropdown.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const selected = options.find((o) => o.value === value) ?? null;

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) => o.label.toLowerCase().includes(q) || (o.sub ?? "").toLowerCase().includes(q),
    );
  }, [options, query]);

  const isDisabled = disabled || options.length === 0;

  return (
    <div className="relative" ref={wrap}>
      <label className="mb-1.5 block text-[11px] font-medium text-white/40">{label}</label>

      <button
        type="button"
        disabled={isDisabled}
        onClick={() => setOpen((v) => !v)}
        className={
          "flex w-full items-center gap-2.5 rounded-xl border px-3.5 py-3 text-left transition " +
          (isDisabled
            ? "cursor-not-allowed border-white/[0.06] bg-white/[0.02] opacity-50"
            : open
              ? "border-veil-400/50 bg-white/[0.04]"
              : "border-white/10 bg-white/[0.03] hover:border-white/20")
        }
      >
        {selected?.icon && <span className="shrink-0">{selected.icon}</span>}
        <span className="min-w-0 flex-1">
          <span
            className={
              "block truncate text-[14px] " +
              (selected ? "font-semibold text-white/90" : "text-white/35")
            }
          >
            {selected ? selected.label : placeholder}
          </span>
          {selected?.sub && (
            <span className="block truncate text-[11px] text-white/35">{selected.sub}</span>
          )}
        </span>
        <Chevron open={open} />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1.5 overflow-hidden rounded-xl border border-white/12 bg-[#0e1018] shadow-2xl shadow-black/60">
          {searchable && (
            <div className="flex items-center gap-2 border-b border-white/[0.07] px-3 py-2.5">
              <SearchIcon />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={searchPlaceholder}
                className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-white/25"
              />
            </div>
          )}

          <div className="max-h-[260px] overflow-y-auto p-1.5">
            {shown.length === 0 ? (
              <p className="px-3 py-6 text-center text-[12px] text-white/30">Nothing matches.</p>
            ) : (
              shown.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  disabled={o.disabled}
                  onClick={() => {
                    if (o.disabled) return;
                    onChange(o.value);
                    setOpen(false);
                  }}
                  className={
                    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-left transition " +
                    (o.disabled
                      ? "cursor-not-allowed opacity-35"
                      : o.value === value
                        ? "bg-veil-500/12"
                        : "hover:bg-white/[0.05]")
                  }
                >
                  {o.icon && <span className="shrink-0">{o.icon}</span>}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-white/85">
                      {o.label}
                    </span>
                    {(o.disabled ? o.disabledNote : o.sub) && (
                      <span className="block truncate text-[11px] text-white/35">
                        {o.disabled ? o.disabledNote : o.sub}
                      </span>
                    )}
                  </span>
                  {o.value === value && !o.disabled && <Check />}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      className={"shrink-0 text-white/35 transition-transform " + (open ? "rotate-180" : "")}
    >
      <path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Check() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="shrink-0 text-veil-300">
      <path d="m3.5 8.5 3 3 6-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="shrink-0 text-white/30">
      <circle cx="7" cy="7" r="4.25" stroke="currentColor" strokeWidth="1.5" />
      <path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
