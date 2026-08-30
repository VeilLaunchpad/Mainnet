"use client";

import { useEffect, useRef, useState } from "react";
import { isAddress, shortAddr } from "@/lib/format";

/**
 * A recipient box that takes a DEVOXPAD handle or a raw address.
 *
 * Handles are how people actually refer to each other, but they are also a
 * layer of indirection in front of something unforgiving: a message encrypted
 * to the wrong key cannot be read by anyone, including the sender. So the
 * resolved address is always shown before sending, and an unresolved handle
 * is refused rather than guessed at.
 *
 * There is deliberately no check that the recipient has "used COTI" before.
 * An earlier version blocked those sends on the theory that sealing a message
 * needs the recipient's key to already exist. Tested on chain, it does not: a
 * message to an address with no onboarding record, and to a contract, both
 * confirm. Any address can be written to.
 */

export interface Resolved {
  address: string;
  username: string;
  displayName: string;
  avatar: string;
  isAgent: boolean;
}


export function RecipientField({
  value,
  onChange,
  onResolved,
  label = "To",
  placeholder = "@handle or 0x…",
}: {
  value: string;
  onChange: (v: string) => void;
  onResolved: (r: Resolved | null) => void;
  label?: string;
  placeholder?: string;
}) {
  const [resolved, setResolved] = useState<Resolved | null>(null);
  const [suggestions, setSuggestions] = useState<Resolved[]>([]);
  const [looking, setLooking] = useState(false);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  useEffect(() => {
    const q = value.trim();
    if (!q) {
      setResolved(null);
      setSuggestions([]);
      onResolved(null);
      return;
    }

    let dead = false;
    setLooking(true);

    const t = setTimeout(() => {
      fetch("/api/profile/resolve?q=" + encodeURIComponent(q))
        .then((r) => r.json())
        .then((j) => {
          if (dead) return;
          setResolved(j.resolved ?? null);
          setSuggestions(j.suggestions ?? []);
          onResolved(j.resolved ?? null);
          if ((j.suggestions ?? []).length) setOpen(true);
        })
        .catch(() => {
          if (dead) return;
          setResolved(null);
          onResolved(null);
        })
        .finally(() => !dead && setLooking(false));
    }, 260);

    return () => {
      dead = true;
      clearTimeout(t);
    };
    // onResolved is a setter from the parent and stable in practice; including
    // it would re-run this on every parent render and cancel the lookup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const typedAddress = isAddress(value.trim());
  const unknownHandle = !!value.trim() && !typedAddress && !resolved && !looking;

  function pick(r: Resolved) {
    onChange("@" + r.username);
    setResolved(r);
    onResolved(r);
    setOpen(false);
  }

  return (
    <div className="relative" ref={wrap}>
      <label className="mt-3 block text-[11px] font-semibold text-white/60">{label}</label>

      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => suggestions.length && setOpen(true)}
        placeholder={placeholder}
        className={
          "mono mt-1 w-full rounded-xl border bg-white/[0.03] px-3 py-2.5 text-[12px] outline-none transition placeholder:text-white/20 " +
          (unknownHandle
            ? "border-rose-400/40 focus:border-rose-400/60"
            : resolved
              ? "border-mint-400/35 focus:border-mint-400/55"
              : "border-white/10 focus:border-devox-400/50")
        }
      />

      {/* What will actually be sent to, stated before it is. */}
      {resolved && (
        <div className="mt-1.5 flex items-center gap-2 rounded-lg border border-mint-400/20 bg-mint-400/[0.05] px-2.5 py-1.5">
          <Avatar r={resolved} />
          <span className="min-w-0 flex-1 truncate text-[11px] text-white/70">
            {resolved.username ? (
              <>
                <span className="font-semibold text-mint-400">@{resolved.username}</span>
                {resolved.displayName && <span className="text-white/40"> · {resolved.displayName}</span>}
              </>
            ) : (
              <span className="text-white/50">no handle claimed</span>
            )}
          </span>
          <span className="mono shrink-0 text-[10px] text-white/40">
            {shortAddr(resolved.address)}
          </span>
        </div>
      )}

      {unknownHandle && (
        <p className="mt-1.5 text-[11px] text-rose-300">
          No DEVOXPAD handle by that name. Check the spelling or paste an address.
        </p>
      )}

      {looking && !resolved && (
        <p className="mt-1.5 text-[11px] text-white/30">Looking up that handle…</p>
      )}

      {open && suggestions.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1.5 overflow-hidden rounded-xl border border-white/12 bg-[#0e1018] p-1.5 shadow-2xl shadow-black/60">
          {suggestions.map((s) => (
            <button
              key={s.address}
              type="button"
              onClick={() => pick(s)}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition hover:bg-white/[0.05]"
            >
              <Avatar r={s} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-medium text-white/85">
                  @{s.username}
                  {s.isAgent && <span className="ml-1.5 text-[10px] text-devox-400">agent</span>}
                </span>
                <span className="mono block truncate text-[10px] text-white/35">
                  {shortAddr(s.address)}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Avatar({ r }: { r: Resolved }) {
  if (r.avatar) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={r.avatar} alt="" className="size-5 shrink-0 rounded-full object-cover" />;
  }
  return (
    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-devox-500/20 text-[9px] font-bold text-devox-300">
      {(r.username || r.address).slice(0, 2).toUpperCase()}
    </span>
  );
}
