"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Address } from "viem";
import { getContractAddress, parseEther, parseUnits, toHex, isAddress } from "viem";
import { useAccount, useWriteContract } from "wagmi";
import { Contract } from "@coti-io/coti-ethers";
import { Section, Badge, Stat } from "@/components/ui";
import { Spinner } from "@/components/busy";
import { useResult } from "@/components/result-modal";
import { useNetwork, useNetworkClient } from "@/components/network-provider";
import { ConnectButton } from "@/components/connect-button";
import { useCotiSession } from "@/lib/coti-client";
import {
  devoxNFTFactoryAbi,
  devoxNFTEditionsFactoryAbi,
  devoxNFTDropAbi,
  devoxNFTEditionsAbi,
  devoxNFTStakingAbi,
} from "@/lib/nft-abis";
import { erc20Abi } from "@/lib/abis";
import { addressesFor, isDeployed } from "@/lib/addresses";
import { NATIVE } from "@/components/nft/shared";

/**
 * The Studio: launch a collection.
 *
 * Two formats, and the difference is real rather than cosmetic. A scheduled
 * drop is a fixed run of unique tokens with a start time - the candy machine.
 * An open collection is a set of editions the creator keeps adding to, each
 * mintable by many people at once.
 *
 * Two launch methods, and this difference is the interesting one. SOLO is the
 * plain case: the NFT is the whole product. PAIRED deposits a token budget up
 * front, in the same flow, and opens a staking pool against it - so holders
 * earn while they hold, and the yield is backed by tokens already escrowed
 * rather than promised. The budget goes in before the collection opens, which
 * is what makes it a guarantee instead of a roadmap.
 *
 * The address is mined here, in the browser, before anything is deployed. That
 * is the same CREATE2 trick every DEVOXPAD token launch uses, and it is why a
 * collection can carry an 8888 address that a copycat cannot fake.
 */

type Format = "drop" | "editions";
type Method = "solo" | "paired";
type Trait = { trait_type: string; value: string };

const SUFFIX = "8888";

export default function StudioPage() {
  const router = useRouter();
  const { net } = useNetwork();
  const client = useNetworkClient();
  const { address: me } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const result = useResult();
  const a = useMemo(() => addressesFor(net), [net]);
  const coti = useCotiSession(me);

  const [format, setFormat] = useState<Format>("drop");
  const [method, setMethod] = useState<Method>("solo");

  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [description, setDescription] = useState("");
  const [image, setImage] = useState("");
  const [traits, setTraits] = useState<Trait[]>([{ trait_type: "", value: "" }]);

  const [supply, setSupply] = useState("1000");
  const [price, setPrice] = useState("0");
  const [maxPerWallet, setMaxPerWallet] = useState("10");
  const [publicStart, setPublicStart] = useState("");
  const [secret, setSecret] = useState("");

  const [rewardToken, setRewardToken] = useState("");
  const [rewardPerYear, setRewardPerYear] = useState("500");
  const [budget, setBudget] = useState("100000");

  const [mining, setMining] = useState(false);
  const [mined, setMined] = useState<{ salt: `0x${string}`; address: Address; tries: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const factory = format === "drop" ? a.nftFactory : a.nftEditionsFactory;
  const ready = isDeployed(factory);

  const freeMint = price === "0" || price === "";

  /* ── mine an 8888 address, locally ───────────────────────────────────── */
  const mine = async () => {
    if (!me || !client) return;
    if (!name || !symbol) {
      result.show({ ok: false, title: "Name it first", detail: "The address depends on the name and symbol, so those have to be set before mining." });
      return;
    }

    setMining(true);
    setMined(null);
    try {
      // The init-code hash comes from the factory so the salt is mined against
      // exactly the bytecode that will be deployed. Change any field afterwards
      // and the hash changes, which is why mining is the last step before launch.
      const initCodeHash =
        format === "drop"
          ? ((await client.readContract({
              address: factory,
              abi: devoxNFTFactoryAbi,
              functionName: "dropInitCodeHash",
              args: [dropParams(), me],
            })) as `0x${string}`)
          : ((await client.readContract({
              address: factory,
              abi: devoxNFTEditionsFactoryAbi,
              functionName: "editionsInitCodeHash",
              args: [{ name, symbol, previewURI: image }, me],
            })) as `0x${string}`);

      let tries = 0;
      let seed = BigInt(toHex(crypto.getRandomValues(new Uint8Array(16))));
      const began = Date.now();

      for (;;) {
        const salt = ("0x" + seed.toString(16).padStart(64, "0")) as `0x${string}`;
        const addr = create2(factory, salt, initCodeHash);
        tries += 1;
        seed += 1n;
        if (addr.toLowerCase().endsWith(SUFFIX)) {
          setMined({ salt, address: addr as Address, tries });
          break;
        }
        // Yield to the browser so the tab stays alive during the search.
        if (tries % 5000 === 0) {
          await new Promise((r) => setTimeout(r, 0));
          if (Date.now() - began > 90_000) throw new Error("mining took too long, try again");
        }
      }
    } catch (e) {
      result.show({ ok: false, title: "Could not mine an address", detail: String((e as Error).message || e) });
    } finally {
      setMining(false);
    }
  };

  function dropParams() {
    return {
      name,
      symbol,
      previewURI: image,
      maxSupply: BigInt(supply || "0"),
      mintPrice: freeMint ? 0n : parseEther(price),
      payToken: NATIVE,
      maxPerWallet: BigInt(maxPerWallet || "0"),
      presaleStart: 0n,
      publicStart: publicStart ? BigInt(Math.floor(new Date(publicStart).getTime() / 1000)) : 0n,
    };
  }

  /* ── launch ──────────────────────────────────────────────────────────── */
  const launch = async () => {
    if (!me || !client || !mined) return;
    if (!secret.trim()) {
      result.show({
        ok: false,
        title: "The private half is empty",
        detail:
          "This is what only a holder can read after minting. A drop cannot open without it — the contract refuses to mint until it is set.",
      });
      return;
    }

    try {
      // 1. Pin the public metadata, so the grid has something to render.
      setBusy("Pinning the public metadata");
      let previewURI = image;
      const cleanTraits = traits.filter((t) => t.trait_type && t.value);
      if (name && (description || cleanTraits.length > 0)) {
        const res = await fetch("/api/nft/metadata", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name, description, image, attributes: cleanTraits }),
        }).then((r) => r.json());
        if (res.url) previewURI = res.url;
      }

      // The mined salt is only valid for the exact arguments it was mined
      // against, so if pinning changed the preview URI the address moves.
      // Re-mining silently would hand the user a different address than the one
      // they were shown, so this refuses instead.
      if (previewURI !== image) {
        setImage(previewURI);
        setMined(null);
        setBusy(null);
        result.show({
          ok: false,
          title: "Metadata pinned — mine once more",
          detail:
            "The preview URI is part of what the address is derived from, and pinning just changed it. Press Mine again and the address you see will be the address you get.",
        });
        return;
      }

      // 2. Deploy at the mined address.
      setBusy("Deploying the collection");
      const fee = (await client.readContract({
        address: factory,
        abi: format === "drop" ? devoxNFTFactoryAbi : devoxNFTEditionsFactoryAbi,
        functionName: "launchFee",
      })) as bigint;

      const deployHash =
        format === "drop"
          ? await writeContractAsync({
              address: factory,
              abi: devoxNFTFactoryAbi,
              functionName: "createDrop",
              args: [mined.salt, dropParams(), mined.address],
              value: fee,
              gas: 6_000_000n,
            })
          : await writeContractAsync({
              address: factory,
              abi: devoxNFTEditionsFactoryAbi,
              functionName: "createEditions",
              args: [mined.salt, { name, symbol, previewURI }, mined.address],
              value: fee,
              gas: 6_000_000n,
            });

      await waitForCode(mined.address);

      // 3. Seal the private half, encrypted in this browser under the
      //    creator's own key. The plaintext never leaves the tab.
      setBusy("Encrypting the private metadata");
      const session = coti.session ?? (await coti.unlock());
      if (!session) throw new Error("a COTI key is needed to encrypt the private metadata");

      if (format === "drop") {
        const c = new Contract(mined.address, devoxNFTDropAbi as never, session.signer);
        const selector = c.interface.getFunction("setSecret")!.selector;
        const enc = await session.signer.encryptValue(secret, mined.address, selector);
        await (await c.setSecret(enc, { gasLimit: 12_000_000 })).wait();
      } else {
        const c = new Contract(mined.address, devoxNFTEditionsAbi as never, session.signer);
        const selector = c.interface.getFunction("createEdition")!.selector;
        const enc = await session.signer.encryptValue(secret, mined.address, selector);
        await (
          await c.createEdition(
            BigInt(supply || "0"),
            freeMint ? 0n : parseEther(price),
            NATIVE,
            BigInt(maxPerWallet || "0"),
            0n,
            0n,
            previewURI,
            enc,
            { gasLimit: 12_000_000 },
          )
        ).wait();
      }

      // 4. Pair it, if that is the chosen method.
      if (method === "paired") {
        if (!isAddress(rewardToken)) throw new Error("the reward token address is not valid");
        setBusy("Escrowing the reward budget");

        const decimals = (await client
          .readContract({ address: rewardToken as Address, abi: erc20Abi, functionName: "decimals" })
          .catch(() => 18)) as number;

        const budgetWei = parseUnits(budget || "0", decimals);
        const perYearWei = parseUnits(rewardPerYear || "0", decimals);

        await writeContractAsync({
          address: rewardToken as Address,
          abi: erc20Abi,
          functionName: "approve",
          args: [a.nftStaking, budgetWei],
          gas: 200_000n,
        });
        await new Promise((r) => setTimeout(r, 2500));

        setBusy("Opening the staking pool");
        await writeContractAsync({
          address: a.nftStaking,
          abi: devoxNFTStakingAbi,
          functionName: "openPool",
          args: [mined.address, rewardToken as Address, perYearWei, 0n, budgetWei],
          gas: 1_000_000n,
        });
      }

      result.show({
        ok: true,
        title: "Launched",
        detail:
          name +
          " is live at " +
          mined.address +
          (method === "paired" ? ", paired and earning." : "."),
        txHash: deployHash,
      });
      router.push("/nft/collection/" + mined.address);
    } catch (e) {
      result.show({ ok: false, title: "Launch failed", detail: String((e as Error).message || e) });
    } finally {
      setBusy(null);
    }
  };

  async function waitForCode(addr: Address) {
    for (let i = 0; i < 40; i++) {
      const code = await client!.getBytecode({ address: addr }).catch(() => undefined);
      if (code && code !== "0x") return;
      await new Promise((r) => setTimeout(r, 1500));
    }
    throw new Error("the collection did not appear on chain");
  }

  /* ── render ──────────────────────────────────────────────────────────── */
  if (!ready) {
    return (
      <Section title="Studio">
        <div className="card p-6 text-[13px] text-white/45">
          The {format === "drop" ? "drop" : "open collection"} factory is not deployed on {net} yet.
        </div>
      </Section>
    );
  }

  return (
    <Section
      kicker="Studio"
      title="Launch a collection"
      sub="Two formats, two launch methods, and an address you mine yourself. The public preview is pinned to IPFS; the private half is encrypted in this browser and only a holder can open it."
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          {/* format */}
          <div className="card p-5">
            <Label>Format</Label>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <Choice
                on={format === "drop"}
                onClick={() => setFormat("drop")}
                title="Scheduled drop"
                body="A fixed run of unique tokens with a start time and a per-wallet cap. The candy machine."
                tag="ERC-721 · private"
              />
              <Choice
                on={format === "editions"}
                onClick={() => setFormat("editions")}
                title="Open collection"
                body="Editions you keep adding to, each mintable by many people. Supply can stay open-ended."
                tag="ERC-1155 · private"
              />
            </div>
          </div>

          {/* identity */}
          <div className="card space-y-4 p-5">
            <Label>Identity</Label>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name" value={name} onChange={setName} placeholder="Night Market" />
              <Field label="Symbol" value={symbol} onChange={setSymbol} placeholder="NGHT" />
            </div>
            <Field
              label="Description"
              value={description}
              onChange={setDescription}
              placeholder="What this collection is"
              area
            />
            <Field
              label="Image URL"
              value={image}
              onChange={setImage}
              placeholder="https://… or ipfs://…"
              hint="The public face. Shown on every card, readable by anyone — that is intentional."
            />

            <div>
              <Label>Traits</Label>
              <div className="mt-2 space-y-2">
                {traits.map((t, i) => (
                  <div key={i} className="flex gap-2">
                    <input
                      value={t.trait_type}
                      onChange={(e) =>
                        setTraits((p) => p.map((x, j) => (j === i ? { ...x, trait_type: e.target.value } : x)))
                      }
                      placeholder="Trait"
                      className="w-1/2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[13px] outline-none focus:border-devox-400/40"
                    />
                    <input
                      value={t.value}
                      onChange={(e) =>
                        setTraits((p) => p.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))
                      }
                      placeholder="Value"
                      className="w-1/2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[13px] outline-none focus:border-devox-400/40"
                    />
                    <button
                      onClick={() => setTraits((p) => p.filter((_, j) => j !== i))}
                      className="rounded-xl border border-white/10 px-3 text-white/40 transition hover:text-white/70"
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => setTraits((p) => [...p, { trait_type: "", value: "" }])}
                  className="text-[12px] font-medium text-devox-300 hover:text-devox-200"
                >
                  + add a trait
                </button>
              </div>
            </div>
          </div>

          {/* supply and price */}
          <div className="card space-y-4 p-5">
            <Label>Supply and price</Label>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field
                label={format === "drop" ? "Max supply" : "Edition supply"}
                value={supply}
                onChange={setSupply}
                placeholder="1000"
                hint={format === "editions" ? "0 means open-ended" : undefined}
              />
              <Field
                label="Mint price (COTI)"
                value={price}
                onChange={setPrice}
                placeholder="0"
                hint={freeMint ? "Free mint" : undefined}
              />
              <Field label="Max per wallet" value={maxPerWallet} onChange={setMaxPerWallet} placeholder="10" hint="0 = no cap" />
            </div>
            {format === "drop" && (
              <div>
                <Label>Public mint opens</Label>
                <input
                  type="datetime-local"
                  value={publicStart}
                  onChange={(e) => setPublicStart(e.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[13px] outline-none focus:border-devox-400/40"
                />
                <p className="mt-1 text-[11px] text-white/30">Leave empty to open immediately.</p>
              </div>
            )}
          </div>

          {/* the private half */}
          <div className="card space-y-3 p-5">
            <div className="flex items-center gap-2">
              <Label>The private half</Label>
              <Badge tone="devox">Encrypted</Badge>
            </div>
            <textarea
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              rows={3}
              placeholder="An unlock link, a key, the real art — whatever only a holder should see"
              className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[13px] outline-none focus:border-devox-400/40"
            />
            <p className="text-[12px] text-white/40">
              Encrypted in this browser under your key, validated by COTI&apos;s MPC network, and
              re-sealed to each holder on mint and on every transfer. We never see it, and neither
              do you once it is set — you keep the plaintext, the chain keeps a ciphertext.
            </p>
          </div>

          {/* launch method */}
          <div className="card p-5">
            <Label>Launch method</Label>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <Choice
                on={method === "solo"}
                onClick={() => setMethod("solo")}
                title="Solo"
                body="The collection stands alone. Holders own the art and its sealed metadata, and nothing else."
                tag="No rewards"
              />
              <Choice
                on={method === "paired"}
                onClick={() => setMethod("paired")}
                title="Paired with a token"
                body="Deposit a reward budget now and open a staking pool against it. Holders stake and earn a fixed APY, backed by tokens already escrowed."
                tag="Novel liquidity pairing"
              />
            </div>

            {method === "paired" && (
              <div className="mt-4 space-y-3 rounded-xl border border-mint-400/15 bg-mint-400/[0.03] p-4">
                <Field
                  label="Reward token address"
                  value={rewardToken}
                  onChange={setRewardToken}
                  placeholder={a.devoxToken}
                  hint="$DEVOX, or any ERC-20 you hold. Paste the address."
                />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Reward per NFT per year" value={rewardPerYear} onChange={setRewardPerYear} placeholder="500" />
                  <Field
                    label="Total budget to escrow"
                    value={budget}
                    onChange={setBudget}
                    placeholder="100000"
                    hint="Transferred to the pool at launch"
                  />
                </div>
                <p className="text-[12px] text-white/40">
                  The budget moves before the pool opens. That is what makes the yield real: it is
                  paid from tokens already held by the staking contract, not from a promise to fund
                  it later. When the budget runs out, rewards stop — the pool says how long it has.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* ── the launch rail ─────────────────────────────────────────── */}
        <div className="space-y-4 lg:sticky lg:top-32 lg:self-start">
          <div className="card space-y-4 p-5">
            <Label>Address</Label>
            {mined ? (
              <div>
                <div className="mono break-all text-[13px] font-semibold text-devox-200">
                  {mined.address}
                </div>
                <div className="mt-1 text-[11px] text-white/35">
                  mined after {mined.tries.toLocaleString()} tries · ends in {SUFFIX}
                </div>
              </div>
            ) : (
              <p className="text-[12px] text-white/40">
                Every DEVOXPAD launch ends in {SUFFIX}. The salt is searched in this browser and
                checked on chain, so the address you see is the address you get.
              </p>
            )}
            <button
              onClick={mine}
              disabled={mining || !me}
              className="w-full rounded-xl border border-white/10 bg-white/[0.05] py-2.5 text-[13px] font-semibold transition hover:bg-white/[0.09] disabled:opacity-40"
            >
              {mining ? <Spinner /> : mined ? "Mine another" : "Mine an address"}
            </button>
          </div>

          <div className="card space-y-3 p-5">
            {!me ? (
              <>
                <p className="text-[13px] text-white/45">Connect a wallet to launch.</p>
                <ConnectButton />
              </>
            ) : (
              <>
                <div className="space-y-1.5 text-[12px] text-white/40">
                  <Row k="Format" v={format === "drop" ? "Scheduled drop" : "Open collection"} />
                  <Row k="Supply" v={supply === "0" ? "Open-ended" : Number(supply || 0).toLocaleString()} />
                  <Row k="Price" v={freeMint ? "Free mint" : price + " COTI"} />
                  <Row k="Method" v={method === "solo" ? "Solo" : "Paired"} />
                  {method === "paired" && <Row k="Escrow" v={budget + " tokens"} />}
                </div>
                <button
                  onClick={launch}
                  disabled={!mined || !!busy}
                  className="w-full rounded-xl bg-gradient-to-r from-devox-500 to-cy-500 py-2.5 text-[14px] font-semibold text-white transition hover:brightness-110 disabled:opacity-40"
                >
                  {busy ? <Spinner /> : mined ? "Launch" : "Mine an address first"}
                </button>
                {busy && <p className="text-center text-[12px] text-white/45">{busy}…</p>}
              </>
            )}
          </div>
        </div>
      </div>
    </Section>
  );
}

/* ── small pieces ──────────────────────────────────────────────────────── */

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/35">{children}</div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between">
      <span>{k}</span>
      <span className="mono text-white/70">{v}</span>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  hint,
  area,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
  area?: boolean;
}) {
  return (
    <div>
      <Label>{label}</Label>
      {area ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={2}
          className="mt-1.5 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[13px] outline-none focus:border-devox-400/40"
        />
      ) : (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="mono mt-1.5 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[13px] outline-none focus:border-devox-400/40"
        />
      )}
      {hint && <p className="mt-1 text-[11px] text-white/30">{hint}</p>}
    </div>
  );
}

function Choice({
  on,
  onClick,
  title,
  body,
  tag,
}: {
  on: boolean;
  onClick: () => void;
  title: string;
  body: string;
  tag: string;
}) {
  return (
    <button
      onClick={onClick}
      className={
        "rounded-xl border p-4 text-left transition " +
        (on ? "border-devox-400/40 bg-devox-500/[0.07]" : "border-white/10 hover:border-white/20")
      }
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[14px] font-semibold">{title}</span>
        {on && <span className="text-devox-300">●</span>}
      </div>
      <p className="mt-1 text-[12px] leading-relaxed text-white/45">{body}</p>
      <div className="mono mt-2 text-[10px] uppercase tracking-wider text-white/25">{tag}</div>
    </button>
  );
}

/** viem's own CREATE2, so the address mined here matches the factory exactly. */
function create2(factory: Address, salt: `0x${string}`, initCodeHash: `0x${string}`): string {
  return getContractAddress({ opcode: "CREATE2", from: factory, salt, bytecodeHash: initCodeHash });
}
