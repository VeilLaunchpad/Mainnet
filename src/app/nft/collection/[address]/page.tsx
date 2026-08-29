"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import type { Address } from "viem";
import { formatEther, parseEther } from "viem";
import { useAccount, useWriteContract } from "wagmi";
import { Contract } from "@coti-io/coti-ethers";
import { Section, Stat, Badge, Empty, Skeleton, Progress } from "@/components/ui";
import { Spinner } from "@/components/busy";
import { useResult } from "@/components/result-modal";
import { useNetwork, useNetworkClient } from "@/components/network-provider";
import { ConnectButton } from "@/components/connect-button";
import { useCotiSession } from "@/lib/coti-client";
import { veilNFTDropAbi, veilNFTEditionsAbi, veilNFTMarketAbi } from "@/lib/nft-abis";
import { addressesFor } from "@/lib/addresses";
import { explorerAddress } from "@/lib/chain";
import { shortAddr, fmtUnits } from "@/lib/format";
import { PreviewArt, priceLabel, NATIVE, type Collection } from "@/components/nft/shared";

/**
 * One collection: mint it, unlock what you own, and list it.
 *
 * The unlock is the part worth reading. `tokenURI` on a drop does not return a
 * URL - it returns a ciphertext that the contract sealed to the current owner's
 * key when the token last moved. Decrypting happens here, in the browser, with
 * a key derived from the user's own signature. The server never sees it, and
 * neither does the creator.
 *
 * Which is why "Unlock" asks for a signature the first time and then feels
 * instant: the AES key is cached per account per network, and the same key
 * opens every private thing in VEILPAD.
 */

type OwnedDrop = { tokenId: bigint; secret?: string };

export default function CollectionPage() {
  const params = useParams<{ address: string }>();
  const address = (params.address ?? "") as Address;

  const { net } = useNetwork();
  const client = useNetworkClient();
  const { address: me } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const result = useResult();
  const a = useMemo(() => addressesFor(net), [net]);

  const coti = useCotiSession(me);

  const [c, setC] = useState<Collection | null>(null);
  const [missing, setMissing] = useState(false);
  const [qty, setQty] = useState(1);
  const [minting, setMinting] = useState(false);
  const [gate, setGate] = useState<{ open: boolean; reason: string } | null>(null);

  const [owned, setOwned] = useState<OwnedDrop[] | null>(null);
  const [unlocking, setUnlocking] = useState<string | null>(null);

  // Open collections: which edition is selected, and how many I hold.
  const [editionId, setEditionId] = useState(1);
  const [editions, setEditions] = useState<
    { id: number; maxSupply: bigint; minted: bigint; price: bigint; payToken: Address }[]
  >([]);
  const [myCopies, setMyCopies] = useState<bigint>(0n);
  const [editionSecret, setEditionSecret] = useState<string | null>(null);

  /* ── load the collection ─────────────────────────────────────────────── */
  useEffect(() => {
    let alive = true;
    setC(null);
    setMissing(false);
    fetch("/api/nft/collection?address=" + address)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("not found"))))
      .then((d) => alive && setC(d.collection))
      .catch(() => alive && setMissing(true));
    return () => {
      alive = false;
    };
  }, [address, net]);

  /* ── mint gate, straight from the contract ───────────────────────────── */
  const refreshGate = useCallback(async () => {
    if (!c || !client) return;
    const who = me ?? "0x0000000000000000000000000000000000000000";
    try {
      const r =
        c.kind === "drop"
          ? await client.readContract({
              address,
              abi: veilNFTDropAbi,
              functionName: "mintState",
              args: [who as Address],
            })
          : await client.readContract({
              address,
              abi: veilNFTEditionsAbi,
              functionName: "mintState",
              args: [BigInt(editionId), who as Address],
            });
      const [open, reason] = r as unknown as [boolean, string];
      setGate({ open, reason });
    } catch {
      setGate(null);
    }
  }, [c, client, me, address, editionId]);

  useEffect(() => {
    void refreshGate();
  }, [refreshGate]);

  /* ── what I own ──────────────────────────────────────────────────────── */
  const loadOwned = useCallback(async () => {
    if (!c || !client || !me) {
      setOwned(null);
      return;
    }

    if (c.kind === "editions") {
      const bal = (await client
        .readContract({
          address,
          abi: veilNFTEditionsAbi,
          functionName: "balanceOf",
          args: [me, BigInt(editionId)],
        })
        .catch(() => 0n)) as bigint;
      setMyCopies(bal);
      return;
    }

    // A drop is ERC-721 without enumeration, so ownership has to be discovered.
    // Transfer logs are the cheap way; if the RPC refuses the range, fall back
    // to asking ownerOf directly, which is slower but always correct.
    const minted = Number(c.minted || 0);
    if (minted === 0) {
      setOwned([]);
      return;
    }

    let ids: bigint[] = [];
    try {
      const logs = await client.getLogs({
        address,
        event: {
          type: "event",
          name: "Transfer",
          inputs: [
            { name: "from", type: "address", indexed: true },
            { name: "to", type: "address", indexed: true },
            { name: "tokenId", type: "uint256", indexed: true },
          ],
        },
        fromBlock: "earliest",
        toBlock: "latest",
      });
      const holder = new Map<string, string>();
      for (const l of logs) {
        const args = l.args as { to?: string; tokenId?: bigint };
        if (args.tokenId === undefined || !args.to) continue;
        holder.set(args.tokenId.toString(), args.to.toLowerCase());
      }
      ids = [...holder.entries()]
        .filter(([, to]) => to === me.toLowerCase())
        .map(([id]) => BigInt(id));
    } catch {
      const scan = Math.min(minted, 400);
      const res = await client.multicall({
        contracts: Array.from({ length: scan }, (_, i) => ({
          address,
          abi: veilNFTDropAbi,
          functionName: "ownerOf" as const,
          args: [BigInt(i + 1)],
        })),
        allowFailure: true,
      });
      res.forEach((r, i) => {
        if (r.status === "success" && String(r.result).toLowerCase() === me.toLowerCase()) {
          ids.push(BigInt(i + 1));
        }
      });
    }

    ids.sort((x, y) => (x < y ? -1 : 1));
    setOwned(ids.map((tokenId) => ({ tokenId })));
  }, [c, client, me, address, editionId]);

  useEffect(() => {
    void loadOwned();
  }, [loadOwned]);

  /* ── editions list ───────────────────────────────────────────────────── */
  useEffect(() => {
    if (!c || c.kind !== "editions" || !client) return;
    let alive = true;
    const n = c.editionCount ?? 0;
    if (n === 0) {
      setEditions([]);
      return;
    }
    client
      .multicall({
        contracts: Array.from({ length: n }, (_, i) => ({
          address,
          abi: veilNFTEditionsAbi,
          functionName: "editions" as const,
          args: [BigInt(i + 1)],
        })),
        allowFailure: true,
      })
      .then((res) => {
        if (!alive) return;
        const out: typeof editions = [];
        res.forEach((r, i) => {
          if (r.status !== "success") return;
          const v = r.result as unknown as readonly unknown[];
          // The public getter flattens the struct, so read it positionally:
          // maxSupply, minted, price, payToken, …
          out.push({
            id: i + 1,
            maxSupply: v[0] as bigint,
            minted: v[1] as bigint,
            price: v[2] as bigint,
            payToken: v[3] as Address,
          });
        });
        setEditions(out);
      })
      .catch(() => alive && setEditions([]));
    return () => {
      alive = false;
    };
  }, [c, client, address]);

  /* ── mint ────────────────────────────────────────────────────────────── */
  const mint = async () => {
    if (!c) return;
    setMinting(true);
    try {
      const ed = editions.find((e) => e.id === editionId);
      const unit = c.kind === "drop" ? BigInt(c.mintPrice) : (ed?.price ?? 0n);
      const payToken = c.kind === "drop" ? c.payToken : (ed?.payToken ?? NATIVE);
      const value = payToken === NATIVE ? unit * BigInt(qty) : 0n;

      const hash =
        c.kind === "drop"
          ? await writeContractAsync({
              address,
              abi: veilNFTDropAbi,
              functionName: "mint",
              args: [BigInt(qty)],
              value,
              gas: 12_000_000n,
            })
          : await writeContractAsync({
              address,
              abi: veilNFTEditionsAbi,
              functionName: "mint",
              args: [BigInt(editionId), BigInt(qty)],
              value,
              gas: 12_000_000n,
            });

      result.show({
        ok: true,
        title: "Minted",
        detail:
          qty +
          (qty === 1 ? " token is" : " tokens are") +
          " yours, with the private metadata sealed to your key. Unlock it below.",
        txHash: hash,
      });
      await new Promise((r) => setTimeout(r, 2500));
      await Promise.all([loadOwned(), refreshGate()]);
      fetch("/api/nft/collection?address=" + address)
        .then((r) => r.json())
        .then((d) => setC(d.collection))
        .catch(() => {});
    } catch (e) {
      result.show({ ok: false, title: "Mint failed", detail: String((e as Error).message || e) });
    } finally {
      setMinting(false);
    }
  };

  /* ── unlock: decrypt in the browser, with the holder's own key ───────── */
  const unlock = async (tokenId?: bigint) => {
    const label = tokenId ? tokenId.toString() : "edition";
    setUnlocking(label);
    try {
      const session = coti.session ?? (await coti.unlock());
      if (!session) return;

      const c721 = new Contract(
        address,
        (c?.kind === "drop" ? veilNFTDropAbi : veilNFTEditionsAbi) as never,
        session.signer,
      );

      const ct =
        c?.kind === "drop"
          ? await c721.tokenURI(tokenId)
          : await c721.secretOf(BigInt(editionId), me);

      const clear = String(await session.signer.decryptValue(ct));

      if (c?.kind === "drop") {
        setOwned((prev) =>
          (prev ?? []).map((o) => (o.tokenId === tokenId ? { ...o, secret: clear } : o)),
        );
      } else {
        setEditionSecret(clear);
      }
    } catch (e) {
      result.show({
        ok: false,
        title: "Could not unlock",
        detail:
          "The metadata is sealed to the holder's key. " +
          String((e as Error).message || e),
      });
    } finally {
      setUnlocking(null);
    }
  };

  /* ── list on the marketplace ─────────────────────────────────────────── */
  const [listPrice, setListPrice] = useState("");
  const [listing, setListing] = useState<string | null>(null);

  const listToken = async (tokenId: bigint) => {
    if (!listPrice || Number(listPrice) <= 0) {
      result.show({ ok: false, title: "Set a price", detail: "Enter what you want for it, in COTI." });
      return;
    }
    setListing(tokenId.toString());
    try {
      const approved = (await client!.readContract({
        address,
        abi: veilNFTDropAbi,
        functionName: "isApprovedForAll",
        args: [me as Address, a.nftMarket],
      })) as boolean;

      if (!approved) {
        const h = await writeContractAsync({
          address,
          abi: veilNFTDropAbi,
          functionName: "setApprovalForAll",
          args: [a.nftMarket, true],
          gas: 1_000_000n,
        });
        result.show({
          ok: true,
          title: "Marketplace approved",
          detail: "One approval covers every token in this collection. Listing next.",
          txHash: h,
        });
        await new Promise((r) => setTimeout(r, 2500));
      }

      const hash = await writeContractAsync({
        address: a.nftMarket,
        abi: veilNFTMarketAbi,
        functionName: "list",
        args: [address, tokenId, NATIVE, parseEther(listPrice)],
        gas: 1_000_000n,
      });
      result.show({
        ok: true,
        title: "Listed",
        detail:
          "#" +
          tokenId +
          " is up at " +
          listPrice +
          " COTI. It stays in your wallet until somebody buys it.",
        txHash: hash,
      });
    } catch (e) {
      result.show({ ok: false, title: "Listing failed", detail: String((e as Error).message || e) });
    } finally {
      setListing(null);
    }
  };

  /* ── render ──────────────────────────────────────────────────────────── */
  if (missing) {
    return (
      <Section title="Not a VEILPAD collection">
        <Empty
          title="Nothing here on this network"
          body={
            "No collection at " +
            shortAddr(address) +
            " was deployed by the VEILPAD studio on " +
            net +
            ". It may live on the other network, or be a plain NFT contract."
          }
          action={{ href: "/nft", label: "Back to the marketplace" }}
        />
      </Section>
    );
  }

  if (!c) {
    return (
      <Section>
        <Skeleton className="h-52 w-full" />
      </Section>
    );
  }

  const ed = editions.find((e) => e.id === editionId);
  const unitPrice = c.kind === "drop" ? BigInt(c.mintPrice) : (ed?.price ?? 0n);
  const supplyKnown = c.kind === "drop" && c.maxSupply !== "0";
  const pct = supplyKnown ? (Number(c.minted) / Number(c.maxSupply)) * 100 : 0;

  return (
    <>
      <Section>
        <div className="card overflow-hidden">
          <div className="flex flex-col gap-5 p-5 sm:flex-row">
            <div className="size-32 shrink-0 overflow-hidden rounded-xl border border-white/10">
              <PreviewArt uri={c.previewURI} name={c.name} />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight">{c.name}</h1>
                <Badge tone={c.kind === "drop" ? "veil" : "cy"}>
                  {c.kind === "drop" ? "Scheduled drop" : "Open collection"}
                </Badge>
                {c.official && <Badge tone="veil">Official</Badge>}
                {c.paired ? <Badge tone="mint">Paired</Badge> : <Badge tone="muted">Solo</Badge>}
              </div>

              <div className="mono mt-2 flex flex-wrap items-center gap-3 text-[11px] text-white/35">
                <span>{c.symbol}</span>
                <a
                  href={explorerAddress(address, net)}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-white/60"
                >
                  {shortAddr(address, 6)} ↗
                </a>
                <span>by {shortAddr(c.creator)}</span>
              </div>

              <p className="mt-3 max-w-2xl text-[13px] text-white/45">
                The preview above is public. What you unlock after minting is a separate value,
                encrypted and re-sealed to each owner as it changes hands — nobody who does not hold
                it can read it, including the creator.
              </p>

              {supplyKnown && (
                <div className="mt-4 max-w-md">
                  <Progress
                    pct={pct}
                    label={
                      Number(c.minted).toLocaleString() +
                      " / " +
                      Number(c.maxSupply).toLocaleString() +
                      " minted"
                    }
                  />
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-px border-t border-white/[0.06] bg-white/[0.04] sm:grid-cols-4">
            {[
              ["Price", priceLabel(unitPrice.toString(), c.payToken, "COTI")],
              [
                c.kind === "drop" ? "Supply" : "Editions",
                c.kind === "drop"
                  ? c.maxSupply === "0"
                    ? "Open"
                    : Number(c.maxSupply).toLocaleString()
                  : String(c.editionCount ?? 0),
              ],
              ["Minted", Number(c.minted).toLocaleString()],
              [
                "Staking",
                c.paired ? (c.paired.apyBps / 100).toFixed(1) + "% APY" : "Not paired",
              ],
            ].map(([k, v]) => (
              <div key={k} className="bg-ink px-4 py-3">
                <div className="text-[10px] font-medium uppercase tracking-wider text-white/30">{k}</div>
                <div className="mono mt-0.5 text-[14px] font-semibold">{v}</div>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* ── mint ──────────────────────────────────────────────────────── */}
      <Section className="mt-8" title="Mint">
        <div className="card p-5">
          {c.kind === "editions" && editions.length > 0 && (
            <div className="mb-4">
              <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-white/35">
                Edition
              </div>
              <div className="flex flex-wrap gap-2">
                {editions.map((e) => (
                  <button
                    key={e.id}
                    onClick={() => setEditionId(e.id)}
                    className={
                      "rounded-lg border px-3 py-1.5 text-[12px] font-medium transition " +
                      (editionId === e.id
                        ? "border-veil-400/40 bg-veil-500/10 text-veil-200"
                        : "border-white/10 text-white/50 hover:text-white/80")
                    }
                  >
                    #{e.id} ·{" "}
                    {e.price === 0n ? "Free" : fmtUnits(e.price.toString(), 18, 4) + " COTI"} ·{" "}
                    {e.maxSupply === 0n
                      ? Number(e.minted).toLocaleString() + " minted"
                      : Number(e.minted) + "/" + Number(e.maxSupply)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {!me ? (
            <div className="flex flex-col items-start gap-3">
              <p className="text-[13px] text-white/45">
                Connect a wallet to mint. The same wallet unlocks the private metadata afterwards.
              </p>
              <ConnectButton />
            </div>
          ) : gate && !gate.open ? (
            <div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.04] px-4 py-3 text-[13px] text-amber-200/80">
              Minting is closed: {gate.reason}
            </div>
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-white/35">
                  Quantity
                </div>
                <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-1">
                  <button
                    onClick={() => setQty((q) => Math.max(1, q - 1))}
                    className="size-8 rounded-lg text-white/50 transition hover:bg-white/10 hover:text-white"
                  >
                    −
                  </button>
                  <span className="mono w-10 text-center text-[15px] font-semibold">{qty}</span>
                  <button
                    onClick={() => setQty((q) => q + 1)}
                    className="size-8 rounded-lg text-white/50 transition hover:bg-white/10 hover:text-white"
                  >
                    +
                  </button>
                </div>
              </div>

              <div>
                <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-white/35">
                  Total
                </div>
                <div className="mono text-[18px] font-semibold">
                  {unitPrice === 0n
                    ? "Free"
                    : formatEther(unitPrice * BigInt(qty)) + " COTI"}
                </div>
              </div>

              <button
                onClick={mint}
                disabled={minting}
                className="ml-auto rounded-xl bg-gradient-to-r from-veil-500 to-cy-500 px-5 py-2.5 text-[14px] font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
              >
                {minting ? <Spinner /> : "Mint"}
              </button>
            </div>
          )}
        </div>
      </Section>

      {/* ── what I hold ───────────────────────────────────────────────── */}
      <Section
        className="mt-8"
        title="Yours"
        sub="Unlock decrypts the private metadata locally, with a key derived from your own signature. It never reaches our server."
      >
        {!me ? (
          <Empty title="Connect a wallet" body="Your tokens and their sealed metadata show up here." />
        ) : c.kind === "editions" ? (
          <div className="card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-medium uppercase tracking-wider text-white/35">
                  Edition #{editionId}
                </div>
                <div className="mono mt-0.5 text-xl font-semibold">
                  {myCopies.toString()} {myCopies === 1n ? "copy" : "copies"}
                </div>
              </div>
              {myCopies > 0n && (
                <button
                  onClick={() => unlock()}
                  disabled={unlocking !== null}
                  className="rounded-xl border border-veil-400/30 bg-veil-500/10 px-4 py-2 text-[13px] font-semibold text-veil-200 transition hover:bg-veil-500/20 disabled:opacity-50"
                >
                  {unlocking ? <Spinner /> : editionSecret ? "Unlocked" : "Unlock"}
                </button>
              )}
            </div>
            {editionSecret && (
              <div className="mono mt-4 break-all rounded-xl border border-mint-400/20 bg-mint-400/[0.04] px-4 py-3 text-[13px] text-mint-200/90">
                {editionSecret}
              </div>
            )}
          </div>
        ) : owned === null ? (
          <Skeleton className="h-24 w-full" />
        ) : owned.length === 0 ? (
          <Empty title="Nothing yet" body="Mint one above, or buy from the marketplace." />
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <input
                value={listPrice}
                onChange={(e) => setListPrice(e.target.value)}
                placeholder="Price in COTI"
                inputMode="decimal"
                className="mono w-40 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[13px] outline-none focus:border-veil-400/40"
              />
              <span className="text-[12px] text-white/35">
                sets the asking price for the List buttons below
              </span>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {owned.map((o) => (
                <div key={o.tokenId.toString()} className="card p-4">
                  <div className="flex items-center justify-between">
                    <span className="mono text-[15px] font-semibold">#{o.tokenId.toString()}</span>
                    <Badge tone={o.secret ? "mint" : "muted"}>{o.secret ? "Unlocked" : "Sealed"}</Badge>
                  </div>

                  {o.secret ? (
                    <div className="mono mt-3 break-all rounded-lg border border-mint-400/20 bg-mint-400/[0.04] px-3 py-2 text-[12px] text-mint-200/90">
                      {o.secret}
                    </div>
                  ) : (
                    <p className="mt-3 text-[12px] text-white/35">
                      Encrypted on chain, sealed to your key.
                    </p>
                  )}

                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => unlock(o.tokenId)}
                      disabled={unlocking === o.tokenId.toString() || !!o.secret}
                      className="flex-1 rounded-lg border border-veil-400/30 bg-veil-500/10 px-3 py-1.5 text-[12px] font-semibold text-veil-200 transition hover:bg-veil-500/20 disabled:opacity-40"
                    >
                      {unlocking === o.tokenId.toString() ? <Spinner /> : o.secret ? "Unlocked" : "Unlock"}
                    </button>
                    <button
                      onClick={() => listToken(o.tokenId)}
                      disabled={listing === o.tokenId.toString()}
                      className="flex-1 rounded-lg border border-white/10 px-3 py-1.5 text-[12px] font-semibold text-white/70 transition hover:bg-white/[0.06] disabled:opacity-40"
                    >
                      {listing === o.tokenId.toString() ? <Spinner /> : "List"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </Section>

      {c.paired && (
        <Section className="mt-8">
          <Link
            href="/nft/stake"
            className="card flex items-center justify-between p-5 transition hover:border-white/20"
          >
            <div>
              <div className="text-[15px] font-semibold">Staking is open for this collection</div>
              <p className="mt-1 text-[13px] text-white/45">
                Paired with a token at {(c.paired.apyBps / 100).toFixed(1)}% APY, funded up front by
                the launcher. Stake yours and it earns while you hold it.
              </p>
            </div>
            <span className="shrink-0 text-[13px] font-semibold text-veil-300">Stake →</span>
          </Link>
        </Section>
      )}
    </>
  );
}
