"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { formatEther } from "viem";
import { useAccount } from "wagmi";
import { Section, Stat, Badge, Empty, Skeleton, Avatar } from "@/components/ui";
import { Spinner } from "@/components/busy";
import { useResult } from "@/components/result-modal";
import { useNetwork } from "@/components/network-provider";
import { ConnectButton } from "@/components/connect-button";
import { shortAddr } from "@/lib/format";
import { CollectionCard, type Collection } from "@/components/nft/shared";

/**
 * My profile.
 *
 * The handle is the same one VEILPAD already uses - claiming a username here
 * claims it everywhere, and somebody who already has one sees it rather than
 * being asked again. One wallet, one identity, across the token side and the
 * NFT side.
 */

interface Listing {
  id: number;
  collection: string;
  tokenId: string;
  seller: string;
  price: string;
  live: boolean;
  reason: string;
}

interface Profile {
  username?: string;
  display_name?: string;
  avatar?: string;
}

export default function ProfilePage() {
  const { net } = useNetwork();
  const { address: me } = useAccount();
  const result = useResult();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [handle, setHandle] = useState("");
  const [saving, setSaving] = useState(false);

  const [collections, setCollections] = useState<Collection[] | null>(null);
  const [listings, setListings] = useState<Listing[]>([]);

  const loadProfile = useCallback(() => {
    if (!me) return;
    fetch("/api/profile?address=" + me)
      .then((r) => r.json())
      .then((d) => {
        setProfile(d.profile ?? null);
        if (d.profile?.username) setHandle(d.profile.username);
      })
      .catch(() => {});
  }, [me]);

  useEffect(loadProfile, [loadProfile]);

  useEffect(() => {
    let alive = true;
    setCollections(null);
    Promise.all([
      fetch("/api/nft/collections?limit=200").then((r) => r.json()),
      fetch("/api/nft/listings?limit=200").then((r) => r.json()),
    ])
      .then(([c, l]) => {
        if (!alive) return;
        setCollections(c.collections ?? []);
        setListings(l.listings ?? []);
      })
      .catch(() => alive && setCollections([]));
    return () => {
      alive = false;
    };
  }, [net]);

  const mineCollections = useMemo(
    () => (collections && me ? collections.filter((c) => c.creator.toLowerCase() === me.toLowerCase()) : []),
    [collections, me],
  );
  const myListings = useMemo(
    () => (me ? listings.filter((l) => l.seller.toLowerCase() === me.toLowerCase()) : []),
    [listings, me],
  );

  const claim = async () => {
    if (!me) return;
    setSaving(true);
    try {
      const res = await fetch("/api/profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: me, username: handle }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "could not save");
      result.show({
        ok: true,
        title: profile?.username ? "Handle updated" : "Handle claimed",
        detail: "@" + handle + " now points at this wallet, across all of VEILPAD.",
      });
      loadProfile();
    } catch (e) {
      result.show({ ok: false, title: "Could not save", detail: String((e as Error).message || e) });
    } finally {
      setSaving(false);
    }
  };

  if (!me) {
    return (
      <Section title="Profile">
        <div className="card flex flex-col items-start gap-3 p-6">
          <p className="text-[13px] text-white/45">
            Connect a wallet to see what you have launched, listed and collected.
          </p>
          <ConnectButton />
        </div>
      </Section>
    );
  }

  return (
    <>
      <Section>
        <div className="card p-5">
          <div className="flex flex-wrap items-center gap-4">
            <Avatar seed={me} size={56} src={profile?.avatar} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xl font-bold">
                  {profile?.username ? "@" + profile.username : shortAddr(me, 6)}
                </span>
                {profile?.username && <Badge tone="veil">VEILPAD handle</Badge>}
              </div>
              <div className="mono mt-1 text-[11px] text-white/35">{me}</div>
            </div>
          </div>

          <div className="mt-5 border-t border-white/[0.06] pt-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/35">
              {profile?.username ? "Change your handle" : "Claim a handle"}
            </div>
            <p className="mt-1 text-[12px] text-white/40">
              One handle for the whole of VEILPAD — the launchpad, the desk, and here.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <input
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
                placeholder="yourname"
                className="mono w-56 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[13px] outline-none focus:border-veil-400/40"
              />
              <button
                onClick={claim}
                disabled={saving || handle.length < 3}
                className="rounded-xl bg-gradient-to-r from-veil-500 to-cy-500 px-4 py-2 text-[13px] font-semibold text-white transition hover:brightness-110 disabled:opacity-40"
              >
                {saving ? <Spinner /> : profile?.username ? "Update" : "Claim"}
              </button>
            </div>
          </div>
        </div>
      </Section>

      <Section className="mt-6">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Launched" value={collections ? mineCollections.length : "—"} />
          <Stat label="Listed" value={myListings.filter((l) => l.live).length} />
          <Stat
            label="Asking, total"
            value={
              myListings
                .filter((l) => l.live)
                .reduce((a, l) => a + Number(formatEther(BigInt(l.price))), 0)
                .toFixed(2) + " COTI"
            }
          />
        </div>
      </Section>

      <Section className="mt-8" title="Collections you launched">
        {collections === null ? (
          <Skeleton className="h-40 w-full" />
        ) : mineCollections.length === 0 ? (
          <Empty
            title="Nothing launched yet"
            body="The Studio deploys a collection at an address you mine yourself, with the metadata sealed to holders."
            action={{ href: "/nft/studio", label: "Open the Studio" }}
          />
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {mineCollections.map((c) => (
              <CollectionCard key={c.address} c={c} />
            ))}
          </div>
        )}
      </Section>

      <Section className="mt-8" title="Your listings">
        {myListings.length === 0 ? (
          <Empty title="Nothing listed" body="Open a collection you hold and list a token from there." />
        ) : (
          <div className="card divide-y divide-white/[0.06]">
            {myListings.map((l) => (
              <Link
                key={l.id}
                href={"/nft/collection/" + l.collection}
                className="flex flex-wrap items-center gap-3 px-4 py-3 transition hover:bg-white/[0.03]"
              >
                <span className="mono text-[13px] font-semibold">#{l.tokenId}</span>
                <span className="mono text-[11px] text-white/35">{shortAddr(l.collection)}</span>
                <span className="mono text-[13px] text-white/70">
                  {Number(formatEther(BigInt(l.price))).toLocaleString(undefined, {
                    maximumFractionDigits: 4,
                  })}{" "}
                  COTI
                </span>
                <span className="ml-auto">
                  {l.live ? (
                    <Badge tone="mint">live</Badge>
                  ) : (
                    <Badge tone="muted">{l.reason || "inactive"}</Badge>
                  )}
                </span>
              </Link>
            ))}
          </div>
        )}
      </Section>
    </>
  );
}
