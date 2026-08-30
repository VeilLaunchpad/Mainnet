"use client";

import { useState } from "react";
import { formatEther, type Address } from "viem";
import { useAccount, useWriteContract } from "wagmi";
import { Spinner } from "@/components/busy";
import { useResult } from "@/components/result-modal";
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
  const isNative = payToken === NATIVE_PAY;
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
          formatEther(price) +
          " COTI. On a sealed collection its metadata is re-sealed to your key on transfer, so unlock it to read what only the holder can.",
        txHash: hash,
      });
      onBought?.();
    } catch (e) {
      result.show({
        ok: false,
        title: "Could not buy it",
        detail: String((e as Error).message || e).slice(0, 240),
      });
    } finally {
      setBusy(false);
      setStep("");
    }
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
      disabled={busy || !fillable}
      title={fillable ? undefined : listing.reason || "This listing cannot be filled right now."}
      className={
        "rounded-lg bg-gradient-to-r from-devox-500 to-cy-500 px-3 py-1.5 text-[12px] font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 " +
        (className || "")
      }
    >
      {busy ? (
        <span className="inline-flex items-center gap-1.5">
          <Spinner /> {step || "Buying"}…
        </span>
      ) : fillable ? (
        "Buy for " + formatEther(price) + " COTI"
      ) : (
        "Not fillable"
      )}
    </button>
  );
}
