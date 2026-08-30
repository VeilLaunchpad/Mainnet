"use client";

import { useEffect, useState } from "react";
import { formatEther, parseEther, type Address } from "viem";
import { useAccount, useWriteContract } from "wagmi";
import { Spinner } from "@/components/busy";
import { useResult } from "@/components/result-modal";
import { useNetwork, useNetworkClient } from "@/components/network-provider";
import { confirmTx } from "@/lib/confirm-tx";
import { delistListing, marketCanReprice, repriceListing, NATIVE_PAY } from "@/lib/nft-market";

/**
 * What a seller can do with a listing they already made.
 *
 * The app could create listings and nothing else: no way to take one down, and
 * no way to change the price - which made a price permanent, since `list()`
 * refuses a token that is already listed. A seller who mistyped a number had no
 * route back at all.
 *
 * Delisting is deliberately two clicks rather than one. Nothing is lost by it
 * (the NFT never moved, and it can be listed again), but a sale disappearing
 * from a single stray tap is still worth a moment's pause.
 */

export interface ManagedListing {
  id: number | bigint;
  collection: string;
  tokenId: string | bigint;
  price: string | bigint;
  /** Absent means native COTI, which is what every listing uses today. */
  payToken?: string;
}

export function ListingControls({
  listing,
  onChanged,
  compact,
}: {
  listing: ManagedListing;
  onChanged?: () => void;
  compact?: boolean;
}) {
  const { addresses } = useNetwork();
  const { address } = useAccount();
  const publicClient = useNetworkClient();
  const { writeContractAsync } = useWriteContract();
  const result = useResult();

  const [editing, setEditing] = useState(false);
  const [price, setPrice] = useState("");
  const [confirmingDelist, setConfirmingDelist] = useState(false);
  const [busy, setBusy] = useState<null | "delist" | "price">(null);
  const [step, setStep] = useState("");
  const [inPlace, setInPlace] = useState<boolean | null>(null);

  const id = BigInt(listing.id);
  const currentPrice = BigInt(listing.price);
  const payToken = (listing.payToken || NATIVE_PAY) as Address;

  // Whether repricing costs one signature or two depends on which marketplace
  // is deployed, and a seller should know before they start rather than after
  // the first prompt.
  useEffect(() => {
    let alive = true;
    marketCanReprice(publicClient, addresses.nftMarket)
      .then((ok) => alive && setInPlace(ok))
      .catch(() => alive && setInPlace(null));
    return () => {
      alive = false;
    };
  }, [publicClient, addresses.nftMarket]);

  const confirm = (hash: `0x${string}`) => confirmTx(publicClient, hash);

  async function doDelist() {
    if (!address) return;
    setBusy("delist");
    try {
      const hash = await delistListing({
        writeContractAsync: writeContractAsync as never,
        confirm,
        market: addresses.nftMarket,
        id,
      });
      result.show({
        ok: true,
        title: "Delisted",
        detail:
          "#" +
          listing.tokenId +
          " is off the market. It never left your wallet, so nothing came back - list it again whenever you like.",
        txHash: hash,
      });
      setConfirmingDelist(false);
      onChanged?.();
    } catch (e) {
      result.show({
        ok: false,
        title: "Could not delist",
        detail: String((e as Error).message || e).slice(0, 240),
      });
    } finally {
      setBusy(null);
    }
  }

  async function doReprice() {
    if (!address) return;
    const trimmed = price.trim();
    if (!trimmed || Number(trimmed) <= 0) {
      result.show({ ok: false, title: "Set a price", detail: "Enter what you want for it, in COTI." });
      return;
    }
    let wei: bigint;
    try {
      wei = parseEther(trimmed);
    } catch {
      result.show({ ok: false, title: "Set a price", detail: "That is not a number of COTI." });
      return;
    }
    if (wei === currentPrice) {
      result.show({
        ok: false,
        title: "That is the current price",
        detail: "Nothing to change - it is already listed at " + formatEther(currentPrice) + " COTI.",
      });
      return;
    }

    setBusy("price");
    try {
      const out = await repriceListing({
        client: publicClient,
        writeContractAsync: writeContractAsync as never,
        confirm,
        market: addresses.nftMarket,
        id,
        collection: listing.collection as Address,
        tokenId: BigInt(listing.tokenId),
        payToken,
        newPrice: wei,
        onStep: setStep,
      });
      result.show({
        ok: true,
        title: "Price updated",
        detail:
          "#" +
          listing.tokenId +
          " is now " +
          trimmed +
          " COTI, was " +
          formatEther(currentPrice) +
          "." +
          (out.inPlace
            ? ""
            : " This marketplace has no reprice, so it was relisted - the listing has a new id."),
        txHash: out.hash,
      });
      setEditing(false);
      setPrice("");
      onChanged?.();
    } catch (e) {
      result.show({
        ok: false,
        title: "Could not change the price",
        detail: String((e as Error).message || e).slice(0, 240),
      });
    } finally {
      setBusy(null);
      setStep("");
    }
  }

  const btn =
    "rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-40";

  if (editing) {
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <input
          autoFocus
          value={price}
          onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ""))}
          placeholder={formatEther(currentPrice)}
          inputMode="decimal"
          className="mono w-28 rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1 text-[12px] outline-none focus:border-devox-400/50"
        />
        <span className="text-[11px] text-white/35">COTI</span>
        <button
          onClick={doReprice}
          disabled={busy !== null}
          className={btn + " border-mint-400/30 bg-mint-400/10 text-mint-300 hover:bg-mint-400/20"}
        >
          {busy === "price" ? <Spinner /> : "Save"}
        </button>
        <button
          onClick={() => {
            setEditing(false);
            setPrice("");
          }}
          disabled={busy !== null}
          className={btn + " border-white/10 text-white/50 hover:bg-white/[0.06]"}
        >
          Cancel
        </button>
        {busy === "price" && step && (
          <span className="w-full text-[10px] text-white/40">{step}…</span>
        )}
        {busy === null && inPlace === false && (
          <span className="w-full text-[10px] text-white/30">
            This marketplace has no reprice, so it takes two signatures: down, then up again.
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={() => {
          setEditing(true);
          setPrice(formatEther(currentPrice));
          setConfirmingDelist(false);
        }}
        disabled={busy !== null}
        className={btn + " border-devox-400/30 bg-devox-500/10 text-devox-200 hover:bg-devox-500/20"}
      >
        {compact ? "Price" : "Edit price"}
      </button>

      {confirmingDelist ? (
        <>
          <button
            onClick={doDelist}
            disabled={busy !== null}
            className={btn + " border-rose-400/40 bg-rose-400/15 text-rose-200 hover:bg-rose-400/25"}
          >
            {busy === "delist" ? <Spinner /> : "Confirm"}
          </button>
          <button
            onClick={() => setConfirmingDelist(false)}
            disabled={busy !== null}
            className={btn + " border-white/10 text-white/50 hover:bg-white/[0.06]"}
          >
            Keep
          </button>
        </>
      ) : (
        <button
          onClick={() => setConfirmingDelist(true)}
          disabled={busy !== null}
          className={btn + " border-white/10 text-white/60 hover:bg-white/[0.06]"}
        >
          Delist
        </button>
      )}
    </div>
  );
}
