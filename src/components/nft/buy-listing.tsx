"use client";

import { useState } from "react";
import { formatUnits, type Address } from "viem";
import { useAccount, useWriteContract } from "wagmi";
import { Spinner } from "@/components/busy";
import { useResult, readable } from "@/components/result-modal";
import { useNetwork, useNetworkClient } from "@/components/network-provider";
import { confirmTx } from "@/lib/confirm-tx";
import { ensureAllowance } from "@/lib/allowance";
import { buyListing, NATIVE_PAY } from "@/lib/nft-market";

/**
 * Buying a listing.
 *
 * The marketplace has had a working `buy` since it was deployed and the app
 * never called it: listings could be created and looked at, and that was all.
 * A price with no way to pay it is a shop window, so this is the door.
 *
 * The price is sent exactly as listed. `buy` reverts with WrongPayment on any
 * other amount, and it re-checks ownership and approval at execution - so a
 * listing whose seller has since moved the token fails here rather than moving
 * somebody else's NFT.
 */
export function BuyListing({
  listing,
  onBought,
  className,
}: {
  listing: {
    id: number | bigint;
    tokenId: string | bigint;
    price: string | bigint;
    seller: string;
    payToken?: string;
    live?: boolean;
    reason?: string;
  };
  onBought?: () => void;
  className?: string;
}) {
  const { addresses } = useNetwork();
  const { address } = useAccount();
  const publicClient = useNetworkClient();
  const { writeContractAsync } = useWriteContract();
  const result = useResult();

  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");

  const price = BigInt(listing.price);
  const payToken = (listing.payToken || NATIVE_PAY) as Address;
  const isNative = payToken.toLowerCase() === NATIVE_PAY;
  // The marketplace accepts any ERC-20, so calling every price COTI would
  // misstate the currency on a third-party listing - and the button would ask
  // for one thing while the transaction pulled another.
  const unit = isNative ? "COTI" : "tokens";
  const mine = !!address && address.toLowerCase() === listing.seller.toLowerCase();
  const fillable = listing.live !== false;

  async function go() {
    if (!address) {
      result.show({ ok: false, title: "Connect a wallet", detail: "You need one to buy." });
      return;
    }
    setBusy(true);
    try {
      // An ERC-20 listing has to be approved before the marketplace can pull
      // the payment. A native one is paid with the transaction itself.
      if (!isNative) {
        setStep("Approving the payment");
        await ensureAllowance({
          publicClient,
          writeContractAsync: writeContractAsync as never,
          owner: address as Address,
          token: payToken,
          spender: addresses.nftMarket,
          amount: price,
        });
      }

      setStep("Buying");
      const hash = await buyListing({
        client: publicClient,
        writeContractAsync: writeContractAsync as never,
        confirm: (h) => confirmTx(publicClient, h),
        market: addresses.nftMarket,
        id: BigInt(listing.id),
        payToken,
        price,
      });

      result.show({
        ok: true,
        title: "Bought",
        detail:
          "#" +
          listing.tokenId +
          " is yours for " +
          formatUnits(price, 18) +
          " " +
          unit +
          ". If this collection seals its metadata, it has been re-sealed to your key - open the collection page and unlock it there.",
        txHash: hash,
      });
      onBought?.();
    } catch (e) {
      result.show({
        ok: false,
        title: "Could not buy it",
        detail: readable(e),
      });
    } finally {
      setBusy(false);
      setStep("");
    }
  }

  // A dead listing is reported before whose it is: "your listing" on something
  // nobody could fill tells the seller the wrong thing about why it is quiet.
  if (!fillable) {
    return (
      <span className={"text-[10px] text-white/30 " + (className || "")}>
        {listing.reason || "cannot be filled right now"}
      </span>
    );
  }

  if (mine) {
    // Buying your own listing is possible on chain and pointless off it: you
    // would pay the marketplace fee to get your own token back.
    return (
      <span className={"text-[10px] text-white/30 " + (className || "")}>your listing</span>
    );
  }

  return (
    <button
      onClick={go}
      disabled={busy}
      className={
        "rounded-lg bg-gradient-to-r from-devox-500 to-cy-500 px-3 py-1.5 text-[12px] font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 " +
        (className || "")
      }
    >
      {busy ? (
        <span className="inline-flex items-center gap-1.5">
          <Spinner /> {step || "Buying"}…
        </span>
      ) : (
        "Buy for " + formatUnits(price, 18) + " " + unit
      )}
    </button>
  );
}
