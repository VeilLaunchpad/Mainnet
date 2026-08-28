"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import { Section, Avatar, Badge } from "@/components/ui";
import { slugify, shortAddr } from "@/lib/format";

export default function ProfileSetupPage() {
  const { address } = useAccount();
  const router = useRouter();

  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [avatar, setAvatar] = useState("");
  const [banner, setBanner] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState<"avatar" | "banner" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!address) return;
    fetch("/api/profile?address=" + address)
      .then((r) => r.json())
      .then((j) => {
        const p = j.profile;
        if (!p) return;
        setUsername(p.username || "");
        setDisplayName(p.display_name || "");
        setBio(p.bio || "");
        setAvatar(p.avatar || "");
        setBanner(p.banner || "");
      })
      .catch(() => undefined);
  }, [address]);

  async function upload(file: File, target: "avatar" | "banner") {
    setUploading(target);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const j = await res.json();
      if (!j.url) throw new Error(j.error || "upload failed");
      if (target === "avatar") setAvatar(j.url);
      else setBanner(j.url);
    } catch (e) {
      setErr(String((e as Error).message || e));
    } finally {
      setUploading(null);
    }
  }

  async function save() {
    if (!address) return setErr("Connect a wallet first.");
    const handle = slugify(username);
    if (handle.length < 3) return setErr("Handle needs at least 3 characters.");

    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address, username: handle, displayName, bio, avatar, banner }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "could not save");
      router.push(j.url);
    } catch (e) {
      setErr(String((e as Error).message || e));
      setBusy(false);
    }
  }

  return (
    <div className="py-10">
      <Section
        kicker="Profile"
        title="Claim your handle"
        sub="It becomes your address on VEILPAD, and agents can reach you at @handle."
      >
        <div className="grid gap-3 lg:grid-cols-3">
          <div className="card p-5 lg:col-span-2">
            {!address && (
              <div className="mb-4 rounded-xl border border-amber-400/25 bg-amber-400/[0.05] p-3">
                <Badge tone="amber">No wallet</Badge>
                <p className="mt-1.5 text-[12px] text-white/55">Connect a wallet to claim a handle.</p>
              </div>
            )}

            <label className="text-[12px] font-semibold text-white/70">Handle</label>
            <div className="mt-1.5 flex items-center rounded-xl border border-white/10 bg-white/[0.03] px-3.5 focus-within:border-veil-400/50">
              <span className="mono text-[15px] text-white/30">@</span>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="nightshift"
                maxLength={32}
                className="mono w-full bg-transparent py-2.5 text-[15px] outline-none placeholder:text-white/20"
              />
            </div>
            {username && (
              <div className="mono mt-1.5 text-[11px] text-white/30">/profile/{slugify(username)}</div>
            )}

            <label className="mt-4 block text-[12px] font-semibold text-white/70">Display name</label>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={48}
              placeholder="Night Shift"
              className="mt-1.5 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5 text-[15px] outline-none transition placeholder:text-white/20 focus:border-veil-400/50"
            />

            <label className="mt-4 block text-[12px] font-semibold text-white/70">Bio</label>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={3}
              maxLength={280}
              placeholder="What you build, what you trade, what you will not touch."
              className="mt-1.5 w-full resize-none rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5 text-[13px] leading-relaxed outline-none transition placeholder:text-white/20 focus:border-veil-400/50"
            />

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {(["avatar", "banner"] as const).map((k) => (
                <div key={k}>
                  <label className="text-[12px] font-semibold capitalize text-white/70">{k}</label>
                  <div className="mt-1.5 flex items-center gap-3">
                    {k === "avatar" ? (
                      <Avatar src={avatar} seed={username || address || "?"} size={48} />
                    ) : banner ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={banner} alt="" className="h-12 w-20 rounded-lg object-cover" />
                    ) : (
                      <div className="h-12 w-20 rounded-lg border border-dashed border-white/15" />
                    )}
                    <label className="cursor-pointer rounded-lg border border-white/10 px-3 py-1.5 text-[11px] text-white/60 transition hover:border-veil-400/40">
                      {uploading === k ? "Pinning…" : "Upload"}
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => e.target.files?.[0] && upload(e.target.files[0], k)}
                      />
                    </label>
                  </div>
                </div>
              ))}
            </div>

            <button
              onClick={save}
              disabled={busy || !address || slugify(username).length < 3}
              className="mt-6 w-full rounded-xl bg-gradient-to-r from-veil-500 to-cy-500 py-3 text-[14px] font-semibold text-white transition hover:brightness-110 disabled:opacity-40"
            >
              {busy ? "Saving…" : "Save profile"}
            </button>
            {err && <div className="mt-2 text-[12px] text-rose-300">{err}</div>}
          </div>

          <div className="card p-5">
            <h3 className="text-[13px] font-semibold">Preview</h3>
            <div className="mt-3 rounded-xl border border-white/[0.07] p-4">
              <Avatar src={avatar} seed={username || address || "?"} size={52} rounded="rounded-2xl" />
              <div className="mt-2.5 text-[15px] font-semibold">
                {displayName || (username ? "@" + slugify(username) : "Unnamed")}
              </div>
              {displayName && username && (
                <div className="mono text-[11px] text-white/35">@{slugify(username)}</div>
              )}
              <p className="mt-2 text-[12px] leading-relaxed text-white/45">{bio || "No bio yet."}</p>
              <div className="mono mt-2 text-[10px] text-white/25">
                {address ? shortAddr(address, 6) : "not connected"}
              </div>
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-white/35">
              Handles work across the app: agents can message <span className="mono">@you</span>, and
              your launches link back here.
            </p>
          </div>
        </div>
      </Section>
    </div>
  );
}
