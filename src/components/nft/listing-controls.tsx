"use client";

import { useEffect, useState } from "react";
import { formatUnits, parseUnits, type Address } from "viem";
import { useAccount, useWriteContract } from "wagmi";
import { Spinner } from "@/components/busy";
import { useResult, readable } from "@/components/result-modal";
import { useNetwork, useNetworkClient } from "@/components/network-provider";
import { confirmTx } from "@/lib/confirm-tx";
import {
  clearStaleListing,
  delistListing,
  marketCanClearStale,
  marketCanReprice,
  repriceListing,
  ListingTakenDownError,
  NATIVE_PAY,
} from "@/lib/nft-market";

/**
 * What a seller can do with a listing they already made.
 *
 * The app could create listings and nothing else: no way to take one down, and
 * no way to change the price - which made a price permanent, since `list()`
 * refuses a token that is already listed. A seller who mistyped a number had no
 * route back at all.
 *
 * Three rules hold everywhere in here, because each one covers a way an
 * interface can lie:
 *
 *  - Refresh after every attempt, not only after a successful one. A failed
 *    reprice can still have changed the chain, and a row left showing the old
 *    price would be the app asserting something untrue.
 *  - Never offer a button that is certain to revert. A listing whose seller no
 *    longer holds the token cannot be repriced or delisted by anyone, so it is
 *    offered the one thing that does work instead.
 *  - Say what actually happened. Half a reprice is not "nothing changed".
 */

export interface ManagedListing {
  id: number | bigint;
  collection: string;
  tokenId: string | bigint;
  price: string | bigint;
  /** Absent means native COTI. */
  payToken?: string;
  /** The recorded seller. When it is not the viewer, nothing here will work. */
  seller?: string;
  /** False when the contract says the listing could not be filled right now. */
  live?: boolean;
  reason?: string;
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
  const [busy, setBusy] = useState<null | "delist" | "price" | "clear">(null);
  const [step, setStep] = useState("");
  const [inPlace, setInPlace] = useState<boolean | null>(null);
  const [canClear, setCanClear] = useState(false);

  const id = BigInt(listing.id);
  const currentPrice = BigInt(listing.price);
  const payToken = (listing.payToken || NATIVE_PAY) as Address;

  // Only a native listing is denominated in COTI. Calling an ERC-20 price
  // "COTI" would misstate both the currency and, at other decimals, the amount.
  const isNative = payToken.toLowerCase() === NATIVE_PAY;
  const unit = isNative ? "COTI" : "tokens";

  /**
   * Whether this listing is the viewer's to manage.
   *
   * `listingOf` answers for the token, not for the caller, so a token
   * transferred while listed shows its previous owner's listing. Every button
   * here requires `msg.sender == l.seller`, so without this check the new
   * holder would be offered controls that all revert - and no way forward,
   * because the List button is hidden while a listing exists.
   */
  const mine = !listing.seller || (!!address && address.toLowerCase() === listing.seller.toLowerCase());
  const stale = listing.live === false;

  useEffect(() => {
    let alive = true;
    void Promise.all([
      marketCanReprice(publicClient, addresses.nftMarket),
      marketCanClearStale(publicClient, addresses.nftMarket),
    ]).then(([reprice, clear]) => {
      if (!alive) return;
      setInPlace(reprice);
      setCanClear(clear);
    });
    return () => {
      alive = false;
    };
  }, [publicClient, addresses.nftMarket]);

  const confirm = (hash: `0x${string}`) => confirmTx(publicClient, hash);

  /** Every path ends here, so the screen always agrees with the chain. */
  function finish() {
    setBusy(null);
    setStep("");
    onChanged?.();
  }

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
    } catch (e) {
      result.show({ ok: false, title: "Could not delist", detail: readable(e) });
    } finally {
      finish();
    }
  }

  async function doClear() {
    if (!address) return;
    setBusy("clear");
    try {
      const hash = await clearStaleListing({
        writeContractAsync: writeContractAsync as never,
        confirm,
        market: addresses.nftMarket,
        id,
      });
      result.show({
        ok: true,
        title: "Old listing cleared",
        detail:
          "That listing belonged to a previous holder and could never have been filled. #" +
          listing.tokenId +
          " is free to list now.",
        txHash: hash,
      });
    } catch (e) {
      result.show({ ok: false, title: "Could not clear it", detail: readable(e) });
    } finally {
      finish();
    }
  }

  async function doReprice() {
    if (!address) return;
    const trimmed = price.trim();
    if (!trimmed || Number(trimmed) <= 0) {
      result.show({ ok: false, title: "Set a price", detail: "Enter what you want for it." });
      return;
    }
    let wei: bigint;
    try {
      wei = parseUnits(trimmed, 18);
    } catch {
      result.show({ ok: false, title: "Set a price", detail: "That is not a number." });
      return;
    }
    if (wei === currentPrice) {
      result.show({
        ok: false,
        title: "That is the current price",
        detail: "It is already listed at " + formatUnits(currentPrice, 18) + " " + unit + ".",
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
          " " +
          unit +
          ", was " +
          formatUnits(currentPrice, 18) +
          "." +
          (out.inPlace ? "" : " This marketplace has no reprice, so it was relisted under a new id."),
        txHash: out.hash,
      });
      setEditing(false);
      setPrice("");
    } catch (e) {
      // Half-done is its own outcome. Saying "could not change the price"
      // here would tell a seller their listing is untouched while it is down.
      if (e instanceof ListingTakenDownError) {
        result.show({
          ok: false,
          title: "Your listing is down, and the new one was not made",
          detail: e.message,
          txHash: e.delistHash,
        });
      } else {
        result.show({ ok: false, title: "Could not change the price", detail: readable(e) });
      }
    } finally {
      finish();
    }
  }

  const btn =
    "rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-40";

  // Somebody else's leftover listing. Nothing here is theirs to change, and
  // clearing it is the only move that the contract will accept.
  if (!mine) {
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        {stale && canClear ? (
          <>
            <button
              onClick={doClear}
              disabled={busy !== null}
              className={btn + " border-amber-400/30 bg-amber-400/10 text-amber-200 hover:bg-amber-400/20"}
            >
              {busy === "clear" ? <Spinner /> : "Clear old listing"}
            </button>
            <span className="text-[10px] text-white/30">
              left by a previous holder - it can never be filled
            </span>
          </>
        ) : (
          <span className="text-[10px] text-white/30">
            listed by a previous holder{stale ? "" : ", and still theirs to change"}
          </span>
        )}
      </div>
    );
  }

  if (editing) {
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <input
          autoFocus
          value={price}
          onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ""))}
          placeholder={formatUnits(currentPrice, 18)}
          inputMode="decimal"
          className="mono w-28 rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1 text-[12px] outline-none focus:border-devox-400/50"
        />
        <span className="text-[11px] text-white/35">{unit}</span>
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
        {busy === "price" && step && <span className="w-full text-[10px] text-white/40">{step}…</span>}
        {busy === null && inPlace === false && (
          <span className="w-full text-[10px] text-amber-200/60">
            This marketplace has no reprice, so it takes two signatures - the listing comes down
            first. If you decline the second, it stays down until you list again.
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {/* Both of these re-check ownership on chain, so on a listing the
          contract already calls dead they would revert - and a reprice would
          revert only after the delist half had landed. */}
      {!stale && (
        <button
          onClick={() => {
            setEditing(true);
            setPrice(formatUnits(currentPrice, 18));
            setConfirmingDelist(false);
          }}
          disabled={busy !== null}
          className={btn + " border-devox-400/30 bg-devox-500/10 text-devox-200 hover:bg-devox-500/20"}
        >
          {compact ? "Price" : "Edit price"}
        </button>
      )}

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

      {stale && (
        <span className="w-full text-[10px] text-amber-200/60">
          {listing.reason || "This listing cannot be filled"} - delisting still works, repricing
          does not.
        </span>
      )}
    </div>
  );
}
