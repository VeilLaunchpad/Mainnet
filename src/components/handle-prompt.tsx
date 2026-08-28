"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import { Avatar } from "./ui";
import { slugify, shortAddr } from "@/lib/format";

const DISMISS_KEY = "veilpad.handle.dismissed";

/**
 * Asks a newly connected wallet to claim a handle.
 *
 * Appears once a wallet is connected and the index has no profile for it. The
 * dismissal is remembered per address, so declining is a real choice rather
 * than something the app asks again on every page. There is no way to make this
 * mandatory, and it should not be: an address is a perfectly good identity.
 */
export function HandlePrompt() {
  const { address, isConnected } = useAccount();
  const router = useRouter();
  const path = usePathname();

  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [taken, setTaken] = useState<boolean | null>(null);

  const dismissed = useCallback(
    (who: string) => {
      try {
        return localStorage.getItem(DISMISS_KEY + "." + who.toLowerCase()) === "1";
      } catch {
        return false;
      }
    },
    [],
  );

  // The setup page is where someone goes to do this deliberately, so nagging
  // them there would be absurd.
  useEffect(() => {
    if (!isConnected || !address || path.startsWith("/profile/setup")) return setOpen(false);
    if (dismissed(address)) return setOpen(false);

    let alive = true;
    fetch("/api/profile?address=" + address)
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        setOpen(!j?.profile?.username);
      })
      .catch(() => undefined);

    return () => {
      alive = false;
    };
  }, [address, isConnected, path, dismissed]);

  // Live availability, so the answer arrives before the submit rather than after.
  useEffect(() => {
    const handle = slugify(username);
    if (handle.length < 3) return setTaken(null);
    let alive = true;
    const timer = setTimeout(() => {
      fetch("/api/profile/" + handle)
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (!alive) return;
          const owner = j?.profile?.address as string | undefined;
          setTaken(!!owner && owner.toLowerCase() !== address?.toLowerCase());
        })
        .catch(() => alive && setTaken(false));
    }, 350);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [username, address]);

  function later() {
    try {
      if (address) localStorage.setItem(DISMISS_KEY + "." + address.toLowerCase(), "1");
    } catch {
      /* private mode: it will ask again next session, which is fine */
    }
    setOpen(false);
  }

  /**
   * Claimed addresses are remembered in this browser too.
   *
   * The dialog decides whether to show by reading the profile back. The read
   * was being served stale, so a successful claim looked like no claim at all
   * and the prompt returned. The cache header is the real fix; this makes the
   * dialog independent of it either way, because it already knows what it just
   * did.
   */
  function rememberClaimed(addr: string) {
    try {
      localStorage.setItem(DISMISS_KEY + "." + addr.toLowerCase(), "1");
    } catch {
      /* private mode: the profile read still settles it next load */
    }
  }

  async function claim() {
    if (!address) return;
    const handle = slugify(username);
    if (handle.length < 3) return setErr("At least three characters.");

    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address, username: handle, displayName }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "could not claim that handle");

      rememberClaimed(address);
      setOpen(false);
      router.push(j.url);
      // The new handle should appear immediately in the nav and anywhere else
      // reading it, rather than after the next navigation.
      router.refresh();
    } catch (e) {
      setErr(String((e as Error).message || e).slice(0, 160));
    } finally {
      setBusy(false);
    }
  }

  if (!open || !address) return null;

  const handle = slugify(username);
  const valid = handle.length >= 3 && taken !== true;

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 p-4 backdrop-blur-sm sm:items-center">
      <div className="animate-rise w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-ink-900 shadow-2xl">
        <div className="relative h-20 bg-gradient-to-br from-veil-500/40 via-veil-600/20 to-cy-500/30">
          <button
            onClick={later}
            aria-label="Close"
            className="absolute right-3 top-3 text-white/50 transition hover:text-white"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="px-5 pb-5">
          <div className="-mt-8 flex items-end gap-3">
            <Avatar seed={handle || address} size={56} rounded="rounded-2xl" />
            <div className="pb-1">
              <div className="mono text-[11px] text-white/40">{shortAddr(address, 6)}</div>
            </div>
          </div>

          <h2 className="mt-3 text-xl font-bold tracking-tight">Claim your handle</h2>
          <p className="mt-1.5 text-[13px] leading-relaxed text-white/50">
            People can send to <span className="mono text-veil-300">@you</span> instead of pasting an
            address, and agents can reach you by name. Your launches link back to it.
          </p>

          <label className="mt-4 block text-[12px] font-semibold text-white/70">Handle</label>
          <div className="mt-1.5 flex items-center rounded-xl border border-white/10 bg-white/[0.03] px-3.5 focus-within:border-veil-400/50">
            <span className="mono text-[15px] text-white/30">@</span>
            <input
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="nightshift"
              maxLength={32}
              onKeyDown={(e) => {
                if (e.key === "Enter" && valid && !busy) void claim();
              }}
              className="mono w-full bg-transparent py-2.5 text-[15px] outline-none placeholder:text-white/20"
            />
            {handle.length >= 3 && (
              <span
                className={
                  "shrink-0 text-[11px] font-semibold " +
                  (taken === true ? "text-rose-400" : taken === false ? "text-mint-400" : "text-white/30")
                }
              >
                {taken === true ? "taken" : taken === false ? "available" : "checking"}
              </span>
            )}
          </div>
          {handle && (
            <div className="mono mt-1.5 text-[11px] text-white/30">/profile/{handle}</div>
          )}

          <label className="mt-3 block text-[12px] font-semibold text-white/70">
            Display name <span className="font-normal text-white/30">optional</span>
          </label>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={48}
            placeholder="Night Shift"
            className="mt-1.5 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5 text-[14px] outline-none transition placeholder:text-white/20 focus:border-veil-400/50"
          />

          {err && <p className="mt-2.5 text-[12px] text-rose-300">{err}</p>}

          <button
            onClick={claim}
            disabled={busy || !valid}
            className="mt-4 w-full rounded-xl bg-gradient-to-r from-veil-500 to-cy-500 py-3 text-[14px] font-semibold text-white transition hover:brightness-110 disabled:opacity-40"
          >
            {busy ? "Claiming…" : "Claim @" + (handle || "handle")}
          </button>

          <button
            onClick={later}
            className="mt-2 w-full rounded-xl py-2.5 text-[13px] font-medium text-white/45 transition hover:text-white"
          >
            I will do it later
          </button>

          <p className="mt-3 text-center text-[10px] leading-relaxed text-white/25">
            Free, no transaction, and you can change it whenever you like. Everything works without
            one; an address is a perfectly good identity.
          </p>
        </div>
      </div>
    </div>
  );
}
