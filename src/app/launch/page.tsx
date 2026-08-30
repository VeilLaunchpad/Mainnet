"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAccount, useBalance, useWriteContract } from "wagmi";
import { parseEther, decodeEventLog, formatEther, type Address, type Hex } from "viem";
import { Section, Badge, Avatar, Progress } from "@/components/ui";
import { AgentChat } from "@/components/agent-chat";
import { PriceText } from "@/components/price-chart";
import { devoxFactoryAbi } from "@/lib/abis";
import { isDeployed } from "@/lib/addresses";
import { useNetwork, useNetworkClient } from "@/components/network-provider";
import { explorerTx, explorerAddress } from "@/lib/chain";
import { fmtNum, slugify } from "@/lib/format";
import { mineVanitySalt, randomSalt, VANITY_SUFFIX } from "@/lib/vanity";

type Allocation = "keep" | "burn" | "lock";
const ALLOC_ENUM: Record<Allocation, number> = { keep: 0, burn: 1, lock: 2 };

interface Economics {
  launchFee: bigint;
  totalSupply: bigint;
  curveSupply: bigint;
  poolSupply: bigint;
  graduationTarget: bigint;
  virtualCoti: bigint;
}

export default function LaunchPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-[1400px] px-4 py-16" />}>
      <LaunchInner />
    </Suspense>
  );
}

/**
 * The launch form.
 *
 * One confirmation does the whole thing: deploy the curve, deploy the token at
 * an address mined to end in 8888, buy on the creator's behalf, and then keep,
 * burn or lock that allocation. Splitting it into several transactions would
 * leave windows where a creator could take delivery and simply not burn.
 *
 * Total supply is fixed at one billion for every launch, so there is no supply
 * field to get wrong and nothing a creator can mint later.
 */
function LaunchInner() {
  const { addresses } = useNetwork();
  const router = useRouter();
  const params = useSearchParams();
  const { address } = useAccount();
  const publicClient = useNetworkClient();
  const { writeContractAsync } = useWriteContract();
  const { data: native } = useBalance({ address, query: { enabled: !!address } });

  const agentSlug = params.get("agent") || "";

  // The form, in the order it is filled in.
  const [symbol, setSymbol] = useState("");
  const [image, setImage] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [socials, setSocials] = useState({ x: "", telegram: "", website: "" });
  const [devBuy, setDevBuy] = useState("");
  const [allocation, setAllocation] = useState<Allocation>("keep");
  const [burnPercent, setBurnPercent] = useState(50);
  const [lockDays, setLockDays] = useState(30);
  const [privateBalances, setPrivateBalances] = useState(true);

  const [uploading, setUploading] = useState(false);
  const [econ, setEcon] = useState<Economics | null>(null);
  const [agent, setAgent] = useState<{ name: string; tagline: string; id: string } | null>(null);

  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [mined, setMined] = useState<{ address: string; attempts: number; ms: number } | null>(null);
  const [tx, setTx] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const factoryReady = isDeployed(addresses.devoxFactory);
  const devBuyWei = devBuy && Number(devBuy) > 0 ? parseEther(devBuy) : 0n;

  useEffect(() => {
    if (!publicClient || !factoryReady) return;
    const read = (fn: string) =>
      publicClient.readContract({
        address: addresses.devoxFactory,
        abi: devoxFactoryAbi,
        functionName: fn as never,
      }) as Promise<bigint>;

    Promise.all([
      read("launchFee"),
      read("totalSupplyPerLaunch"),
      read("curveSupply"),
      read("poolSupply"),
      read("graduationTarget"),
      read("virtualCoti"),
    ])
      .then(([launchFee, totalSupply, curveSupply, poolSupply, graduationTarget, virtualCoti]) =>
        setEcon({ launchFee, totalSupply, curveSupply, poolSupply, graduationTarget, virtualCoti }),
      )
      .catch(() => setEcon(null));
  }, [publicClient, factoryReady]);

  // Arriving from an agent page pre-fills the launch as that agent's token.
  useEffect(() => {
    if (!agentSlug) return;
    fetch("/api/agents/" + agentSlug)
      .then((r) => r.json())
      .then((j) => {
        if (!j.agent) return;
        setAgent({ name: j.agent.name, tagline: j.agent.tagline, id: j.agent.id });
        setSymbol((v) => v || j.agent.name.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8));
        setName((v) => v || j.agent.name);
        setDescription((v) => v || j.agent.tagline);
        if (j.agent.avatar) setImage((v) => v || j.agent.avatar);
      })
      .catch(() => undefined);
  }, [agentSlug]);

  async function upload(file: File) {
    setUploading(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const j = await res.json();
      if (!j.url) throw new Error(j.error || "upload failed");
      setImage(j.url);
    } catch (e) {
      setErr(String((e as Error).message || e));
    } finally {
      setUploading(false);
    }
  }

  const metadataURI = useMemo(
    () => JSON.stringify({ description, image, socials }),
    [description, image, socials],
  );

  const ready =
    factoryReady &&
    !!address &&
    symbol.trim().length >= 2 &&
    name.trim().length >= 2 &&
    (allocation === "keep" || devBuyWei > 0n);

  const totalCost = econ ? econ.launchFee + devBuyWei : devBuyWei;

  async function launch() {
    if (!address || !publicClient || !econ) return setErr("Connect a wallet first.");
    if (!ready) return setErr("Fill in the ticker and name first.");

    setBusy(true);
    setErr(null);
    setTx(null);
    setMined(null);

    try {
      // 1. Fix the curve address, because the token's constructor references it.
      setStep("Reserving the curve address");
      const curveSalt = randomSalt();
      const curveAddress = (await publicClient.readContract({
        address: addresses.devoxFactory,
        abi: devoxFactoryAbi,
        functionName: "predictCurve",
        args: [address, curveSalt],
      })) as Address;

      // 2. Mine a token salt whose CREATE2 address ends in 8888.
      setStep("Mining an address ending in " + VANITY_SUFFIX);
      const [deployerAddress, initCodeHash] = (await Promise.all([
        publicClient.readContract({
          address: addresses.devoxFactory,
          abi: devoxFactoryAbi,
          functionName: "deployerFor",
          args: [privateBalances],
        }),
        publicClient.readContract({
          address: addresses.devoxFactory,
          abi: devoxFactoryAbi,
          functionName: "tokenInitCodeHash",
          args: [privateBalances, name, symbol.toUpperCase(), metadataURI, address, curveAddress],
        }),
      ])) as [Address, Hex];

      const result = await mineVanitySalt(deployerAddress, initCodeHash, {
        onProgress: (n) => setStep("Mining " + VANITY_SUFFIX + ", " + n.toLocaleString("en-US") + " tried"),
      });
      setMined({ address: result.address, attempts: result.attempts, ms: result.ms });

      // 3. One confirmation for all of it.
      setStep("Confirm in your wallet");
      const hash = await writeContractAsync({
        address: addresses.devoxFactory,
        abi: devoxFactoryAbi,
        functionName: "launch",
        args: [
          {
            name,
            symbol: symbol.toUpperCase(),
            metadataURI,
            privateBalances,
            agentId: ("0x" + "0".repeat(64)) as Hex,
            curveSalt,
            tokenSalt: result.salt,
            devBuy: devBuyWei,
            allocation: ALLOC_ENUM[allocation],
            burnPercent: allocation === "burn" ? burnPercent : 0,
            lockDays: allocation === "lock" ? lockDays : 0,
          },
        ],
        value: econ.launchFee + devBuyWei,
        gas: 30_000_000n,
      });

      setTx(hash);
      setStep("Waiting for the chain");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      let token: Address | null = null;
      let curve: Address | null = null;
      for (const log of receipt.logs) {
        try {
          const parsed = decodeEventLog({ abi: devoxFactoryAbi, data: log.data, topics: log.topics });
          if (parsed.eventName === "Launched") {
            const a = parsed.args as unknown as { token: Address; curve: Address };
            token = a.token;
            curve = a.curve;
            break;
          }
        } catch {
          /* not our event */
        }
      }
      if (!token) throw new Error("Launch confirmed but no Launched event was in the receipt.");

      setStep("Indexing");
      await fetch("/api/tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          address: token,
          name,
          symbol: symbol.toUpperCase(),
          decimals: 18,
          description,
          image,
          creator: address,
          kind: privateBalances ? "private" : "public",
          curve,
          txHash: hash,
          links: socials,
          agentId: agent?.id || "",
        }),
      });

      // Verification is a courtesy, not a gate: a launch that fails to verify
      // is still a working launch, so this never blocks the redirect.
      setStep("Submitting source for verification");
      await Promise.all([
        fetch("/api/verify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ address: token, contract: "DevoxToken" }),
        }).catch(() => undefined),
        curve
          ? fetch("/api/verify", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ address: curve, contract: "DevoxCurve" }),
            }).catch(() => undefined)
          : Promise.resolve(),
      ]);

      if (agent && agentSlug) {
        await fetch("/api/agents/" + agentSlug, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token }),
        }).catch(() => undefined);
      }

      router.push("/coti/" + token);
    } catch (e) {
      setErr(String((e as Error).message || e).slice(0, 260));
      setBusy(false);
      setStep("");
    }
  }

  return (
    <div className="py-10">
      <Section
        kicker="Launch"
        title="Ship a private token"
        sub="Fixed supply of one billion. One confirmation deploys the curve and the token, buys your allocation, and does what you chose with it."
      >
        <div className="grid gap-3 lg:grid-cols-5">
          <div className="space-y-3 lg:col-span-3">
            {agent && (
              <div className="card border-cy-400/25 bg-cy-500/[0.05] p-4">
                <Badge tone="cy">tokenizing an agent</Badge>
                <p className="mt-2 text-[12px] leading-relaxed text-white/60">
                  Bound to <span className="font-semibold text-white">{agent.name}</span>. The token
                  address is written back to the agent when this confirms.
                </p>
              </div>
            )}

            <Identity
              symbol={symbol}
              setSymbol={setSymbol}
              image={image}
              setImage={setImage}
              uploading={uploading}
              onUpload={upload}
              name={name}
              setName={setName}
              description={description}
              setDescription={setDescription}
              socials={socials}
              setSocials={setSocials}
            />

            <DevBuy
              devBuy={devBuy}
              setDevBuy={setDevBuy}
              balance={native ? Number(native.formatted) : 0}
              econ={econ}
            />

            <AllocationPicker
              allocation={allocation}
              setAllocation={setAllocation}
              burnPercent={burnPercent}
              setBurnPercent={setBurnPercent}
              lockDays={lockDays}
              setLockDays={setLockDays}
              hasDevBuy={devBuyWei > 0n}
            />

            <Privacy value={privateBalances} onChange={setPrivateBalances} />
          </div>

          <div className="space-y-3 lg:col-span-2">
            <Preview
              symbol={symbol}
              name={name}
              description={description}
              image={image}
              socials={socials}
              privateBalances={privateBalances}
              devBuy={devBuy}
              allocation={allocation}
              burnPercent={burnPercent}
              lockDays={lockDays}
              econ={econ}
            />

            <Confirm
              ready={ready}
              busy={busy}
              step={step}
              symbol={symbol}
              totalCost={totalCost}
              econ={econ}
              devBuyWei={devBuyWei}
              factoryReady={factoryReady}
              hasWallet={!!address}
              mined={mined}
              tx={tx}
              err={err}
              onLaunch={launch}
            />

            <div className="card flex h-[420px] flex-col p-4">
              <div className="mb-2 flex items-center gap-2">
                <span className="size-2 rounded-full bg-amber-400 shadow-[0_0_8px] shadow-amber-400/70" />
                <h2 className="text-[15px] font-semibold">FORGE can name it</h2>
              </div>
              <AgentChat
                agentSlug="forge"
                agentName="FORGE"
                compact
                className="min-h-0 flex-1"
                suggestions={[
                  "A token for people who ship at 3am",
                  "Three tickers for an agent-run coffee cartel",
                  "Should I burn or lock my dev buy?",
                ]}
              />
            </div>
          </div>
        </div>
      </Section>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="text-[12px] font-semibold text-white/70">
        {label}
        {hint && <span className="ml-1.5 font-normal text-white/30">{hint}</span>}
      </label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

const input =
  "w-full rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5 text-[14px] outline-none transition placeholder:text-white/20 focus:border-devox-400/50";

function Identity({
  symbol,
  setSymbol,
  image,
  setImage,
  uploading,
  onUpload,
  name,
  setName,
  description,
  setDescription,
  socials,
  setSocials,
}: {
  symbol: string;
  setSymbol: (v: string) => void;
  image: string;
  setImage: (v: string) => void;
  uploading: boolean;
  onUpload: (f: File) => void;
  name: string;
  setName: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  socials: { x: string; telegram: string; website: string };
  setSocials: (v: { x: string; telegram: string; website: string }) => void;
}) {
  return (
    <div className="card space-y-4 p-5">
      <div className="flex items-center gap-2">
        <Step n={1} />
        <h2 className="text-[15px] font-semibold">Identity</h2>
      </div>

      <Field label="Ticker" hint="2 to 10 characters, uppercase">
        <input
          value={symbol}
          onChange={(e) => setSymbol(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
          placeholder="GG"
          maxLength={10}
          className={"mono " + input + " text-[16px]"}
        />
      </Field>

      <Field label="Logo">
        <div className="flex items-center gap-3">
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt="" className="size-14 rounded-xl border border-white/10 object-cover" />
          ) : (
            <Avatar seed={symbol || "?"} size={56} rounded="rounded-xl" />
          )}
          <label className="cursor-pointer rounded-xl border border-white/10 px-3.5 py-2 text-[12px] font-medium text-white/65 transition hover:border-devox-400/40">
            {uploading ? "Pinning to IPFS..." : image ? "Replace" : "Upload image"}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])}
            />
          </label>
          {image && (
            <button onClick={() => setImage("")} className="text-[12px] text-white/35 hover:text-rose-400">
              remove
            </button>
          )}
        </div>
      </Field>

      <Field label="Name">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Good Game"
          maxLength={40}
          className={input}
        />
      </Field>

      <Field label="Description">
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          maxLength={500}
          placeholder="What is this for, and who is it for?"
          className={"resize-none leading-relaxed " + input + " text-[13px]"}
        />
      </Field>

      <Field label="Socials" hint="optional, shown on the token page">
        <div className="space-y-2">
          {(
            [
              ["x", "x.com/yourhandle"],
              ["telegram", "t.me/yourgroup"],
              ["website", "yoursite.xyz"],
            ] as const
          ).map(([key, placeholder]) => (
            <div key={key} className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 focus-within:border-devox-400/50">
              <span className="w-[62px] shrink-0 text-[11px] capitalize text-white/35">{key}</span>
              <input
                value={socials[key]}
                onChange={(e) => setSocials({ ...socials, [key]: e.target.value })}
                placeholder={placeholder}
                className="w-full bg-transparent py-2 text-[13px] outline-none placeholder:text-white/20"
              />
            </div>
          ))}
        </div>
      </Field>
    </div>
  );
}

function Step({ n }: { n: number }) {
  return (
    <span className="mono flex size-5 items-center justify-center rounded-md border border-devox-400/30 bg-devox-500/10 text-[10px] font-semibold text-devox-300">
      {n}
    </span>
  );
}

function DevBuy({
  devBuy,
  setDevBuy,
  balance,
  econ,
}: {
  devBuy: string;
  setDevBuy: (v: string) => void;
  balance: number;
  econ: Economics | null;
}) {
  const spend = Number(devBuy) || 0;
  const share = econ && spend > 0 ? estimateShare(spend, econ) : null;

  return (
    <div className="card space-y-3 p-5">
      <div className="flex items-center gap-2">
        <Step n={2} />
        <h2 className="text-[15px] font-semibold">Dev buy</h2>
        <span className="ml-auto text-[11px] text-white/30">optional</span>
      </div>

      <p className="text-[12px] leading-relaxed text-white/45">
        Buy your own allocation in the same transaction, at the very first price on the curve.
        Everyone can see you did it, and how much, because the buy is a public event.
      </p>

      <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5 focus-within:border-devox-400/50">
        <input
          value={devBuy}
          onChange={(e) => setDevBuy(e.target.value.replace(/[^0-9.]/g, ""))}
          placeholder="0.0"
          inputMode="decimal"
          className="mono min-w-0 flex-1 bg-transparent text-lg outline-none placeholder:text-white/20"
        />
        <span className="shrink-0 text-[13px] font-semibold text-white/50">COTI</span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {["0.1", "0.25", "0.5", "1"].map((v) => (
          <button
            key={v}
            onClick={() => setDevBuy(v)}
            className={
              "rounded-lg border px-2.5 py-1 text-[11px] transition " +
              (devBuy === v
                ? "border-devox-400/50 bg-devox-500/12 text-devox-300"
                : "border-white/10 text-white/45 hover:text-white")
            }
          >
            {v}
          </button>
        ))}
        <button
          onClick={() => setDevBuy("")}
          className="rounded-lg border border-white/10 px-2.5 py-1 text-[11px] text-white/45 transition hover:text-white"
        >
          none
        </button>
        {balance > 0 && (
          <span className="ml-auto text-[10px] text-white/25">
            balance {fmtNum(balance, 3)} COTI
          </span>
        )}
      </div>

      {share && (
        <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
          <div className="flex items-baseline justify-between text-[12px]">
            <span className="text-white/40">You would receive</span>
            <span className="mono font-semibold text-white/80">
              {fmtNum(share.tokens, 0)} tokens
            </span>
          </div>
          <div className="mt-1 flex items-baseline justify-between text-[12px]">
            <span className="text-white/40">Share of total supply</span>
            <span className="mono font-semibold text-devox-300">{share.percent.toFixed(2)}%</span>
          </div>
          <div className="mt-2">
            <Progress pct={share.percent} />
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-white/25">
            An estimate from the curve formula. The transaction quotes the contract itself, so a
            buyer landing before you would shift this.
          </p>
        </div>
      )}
    </div>
  );
}

/** Constant-product curve, the same maths the contract runs. */
function estimateShare(cotiIn: number, econ: Economics) {
  const virtual = Number(formatEther(econ.virtualCoti));
  const curveSupply = Number(formatEther(econ.curveSupply));
  const total = Number(formatEther(econ.totalSupply));

  const net = cotiIn * 0.99; // the curve takes 1% on the way in
  const k = virtual * curveSupply;
  const tokens = curveSupply - k / (virtual + net);

  return { tokens, percent: total > 0 ? (tokens / total) * 100 : 0 };
}

function AllocationPicker({
  allocation,
  setAllocation,
  burnPercent,
  setBurnPercent,
  lockDays,
  setLockDays,
  hasDevBuy,
}: {
  allocation: Allocation;
  setAllocation: (v: Allocation) => void;
  burnPercent: number;
  setBurnPercent: (v: number) => void;
  lockDays: number;
  setLockDays: (v: number) => void;
  hasDevBuy: boolean;
}) {
  const options: { key: Allocation; title: string; body: string }[] = [
    {
      key: "keep",
      title: "Keep it free",
      body: "Your allocation goes straight to your wallet. Sell it whenever you like.",
    },
    {
      key: "burn",
      title: "Burn a share",
      body: "Part of it is destroyed in the same transaction. Nobody can undo it, including you.",
    },
    {
      key: "lock",
      title: "Lock it",
      body: "Held by a timelock with no early release, and the unlock date is public.",
    },
  ];

  return (
    <div className="card space-y-3 p-5">
      <div className="flex items-center gap-2">
        <Step n={3} />
        <h2 className="text-[15px] font-semibold">What happens to your allocation</h2>
      </div>

      <p className="text-[12px] leading-relaxed text-white/45">
        Applied immediately after the dev buy, inside the same transaction. There is no window where
        you could take delivery and then not do it.
      </p>

      <div className="grid gap-2 sm:grid-cols-3">
        {options.map((o) => {
          const disabled = o.key !== "keep" && !hasDevBuy;
          return (
            <button
              key={o.key}
              onClick={() => !disabled && setAllocation(o.key)}
              disabled={disabled}
              title={disabled ? "Needs a dev buy to act on" : undefined}
              className={
                "rounded-xl border p-3 text-left transition disabled:opacity-35 " +
                (allocation === o.key
                  ? "border-devox-400/50 bg-devox-500/[0.09]"
                  : "border-white/10 hover:border-white/25")
              }
            >
              <div className="text-[13px] font-semibold">{o.title}</div>
              <div className="mt-0.5 text-[11px] leading-relaxed text-white/40">{o.body}</div>
            </button>
          );
        })}
      </div>

      {allocation === "burn" && (
        <div className="rounded-xl border border-rose-400/20 bg-rose-400/[0.04] p-4">
          <div className="flex items-baseline justify-between">
            <span className="text-[12px] font-semibold text-white/70">Burn</span>
            <span className="mono text-[16px] font-semibold text-rose-300">{burnPercent}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={burnPercent}
            onChange={(e) => setBurnPercent(Number(e.target.value))}
            className="mt-2 w-full accent-rose-400"
          />
          <div className="mt-1 flex justify-between text-[10px] text-white/25">
            <span>0%</span>
            <span>50%</span>
            <span>100%</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {[25, 50, 75, 100].map((p) => (
              <button
                key={p}
                onClick={() => setBurnPercent(p)}
                className={
                  "rounded-lg border px-2.5 py-1 text-[11px] transition " +
                  (burnPercent === p
                    ? "border-rose-400/50 bg-rose-400/12 text-rose-300"
                    : "border-white/10 text-white/45 hover:text-white")
                }
              >
                {p}%
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-white/45">
            {burnPercent === 100
              ? "Everything you buy is destroyed. You keep nothing, and the supply in circulation drops by that much."
              : "The remaining " + (100 - burnPercent) + "% goes to your wallet."}
          </p>
        </div>
      )}

      {allocation === "lock" && (
        <div className="rounded-xl border border-cy-400/20 bg-cy-500/[0.04] p-4">
          <div className="flex items-baseline justify-between">
            <span className="text-[12px] font-semibold text-white/70">Locked for</span>
            <span className="mono text-[16px] font-semibold text-cy-300">{lockDays} days</span>
          </div>
          <input
            type="range"
            min={1}
            max={365}
            step={1}
            value={lockDays}
            onChange={(e) => setLockDays(Number(e.target.value))}
            className="mt-2 w-full accent-cy-400"
          />
          <div className="mt-1 flex justify-between text-[10px] text-white/25">
            <span>1 day</span>
            <span>6 months</span>
            <span>1 year</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {[7, 30, 90, 180, 365].map((d) => (
              <button
                key={d}
                onClick={() => setLockDays(d)}
                className={
                  "rounded-lg border px-2.5 py-1 text-[11px] transition " +
                  (lockDays === d
                    ? "border-cy-400/50 bg-cy-500/12 text-cy-300"
                    : "border-white/10 text-white/45 hover:text-white")
                }
              >
                {d}d
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-white/45">
            Unlocks{" "}
            <span className="text-white/70">
              {new Date(Date.now() + lockDays * 86400_000).toLocaleDateString()}
            </span>
            . The lock contract has no owner and no early-release path, so this cannot be shortened
            once it is set.
          </p>
        </div>
      )}

      {!hasDevBuy && allocation === "keep" && (
        <p className="text-[11px] leading-relaxed text-white/30">
          Burning and locking need something to act on. Add a dev buy above to enable them.
        </p>
      )}
    </div>
  );
}

function Privacy({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="card p-5">
      <button
        onClick={() => onChange(!value)}
        className="flex w-full items-start gap-3 text-left"
      >
        <span
          className={
            "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border transition " +
            (value ? "border-devox-400 bg-devox-500 text-white" : "border-white/20")
          }
        >
          {value && (
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
              <path
                d="M2 6.2 4.6 8.8 10 3.4"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </span>
        <span>
          <span className="block text-[13px] font-semibold">Encrypt holder balances</span>
          <span className="mt-0.5 block text-[11px] leading-relaxed text-white/40">
            Deploys a COTI PrivateERC20. Balances become ciphertext readable only by their owner, and
            aggregate supply is withheld. Transfers still emit public events.
          </span>
        </span>
      </button>
    </div>
  );
}

function PreviewRow({ k, v, tone }: { k: string; v: string; tone?: "rose" | "cy" }) {
  const color = tone === "rose" ? "text-rose-300" : tone === "cy" ? "text-cy-300" : "text-white/75";
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 text-[11px]">
      <dt className="shrink-0 text-white/35">{k}</dt>
      <dd className={"mono min-w-0 truncate text-right " + color}>{v}</dd>
    </div>
  );
}

function Preview({
  symbol,
  name,
  description,
  image,
  socials,
  privateBalances,
  devBuy,
  allocation,
  burnPercent,
  lockDays,
  econ,
}: {
  symbol: string;
  name: string;
  description: string;
  image: string;
  socials: { x: string; telegram: string; website: string };
  privateBalances: boolean;
  devBuy: string;
  allocation: Allocation;
  burnPercent: number;
  lockDays: number;
  econ: Economics | null;
}) {
  const spend = Number(devBuy) || 0;
  const share = econ && spend > 0 ? estimateShare(spend, econ) : null;
  const burned = share && allocation === "burn" ? (share.tokens * burnPercent) / 100 : 0;

  return (
    <div className="card overflow-hidden">
      <div className="border-b border-white/[0.06] px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/30">
        Preview
      </div>

      <div className="p-4">
        <div className="flex items-start gap-3">
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt="" className="size-12 rounded-xl object-cover" />
          ) : (
            <Avatar seed={symbol || "?"} size={48} />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[17px] font-bold tracking-tight">{symbol || "TICKER"}</span>
              <span className="truncate text-[13px] text-white/45">{name || "Token name"}</span>
            </div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {privateBalances ? (
                <Badge tone="cy">encrypted</Badge>
              ) : (
                <Badge tone="muted">public</Badge>
              )}
              <Badge tone="devox">on curve</Badge>
              <Badge tone="mint">verified</Badge>
            </div>
          </div>
        </div>

        <p className="mt-2.5 line-clamp-3 text-[12px] leading-relaxed text-white/45">
          {description || "Your description shows here."}
        </p>

        <div className="mono mt-3 truncate rounded-lg border border-dashed border-devox-400/25 bg-devox-500/[0.05] px-2.5 py-2 text-center text-[11px] text-devox-300">
          0x{"?".repeat(36)}
          <span className="font-semibold text-devox-200">{VANITY_SUFFIX}</span>
        </div>
        <p className="mt-1 text-center text-[10px] text-white/25">
          The address is mined before it is deployed
        </p>

        <dl className="mt-3 divide-y divide-white/[0.05] border-t border-white/[0.05]">
          <PreviewRow
            k="Total supply"
            v={econ ? fmtNum(Number(formatEther(econ.totalSupply)), 0) : "1,000,000,000"}
          />
          <PreviewRow
            k="On the curve"
            v={econ ? fmtNum(Number(formatEther(econ.curveSupply)), 0) : "800,000,000"}
          />
          <PreviewRow
            k="Seeds the pair"
            v={econ ? fmtNum(Number(formatEther(econ.poolSupply)), 0) : "200,000,000"}
          />
          <PreviewRow
            k="Graduates at"
            v={econ ? fmtNum(Number(formatEther(econ.graduationTarget)), 2) + " COTI" : "-"}
          />
          <PreviewRow k="Mint after launch" v="impossible" />
          {share && (
            <>
              <PreviewRow k="Your dev buy" v={spend + " COTI"} />
              <PreviewRow k="You receive" v={fmtNum(share.tokens, 0) + " " + (symbol || "tokens")} />
              <PreviewRow k="Your share" v={share.percent.toFixed(2) + "%"} />
            </>
          )}
          {burned > 0 && (
            <PreviewRow
              k="Burned forever"
              v={fmtNum(burned, 0) + " (" + burnPercent + "%)"}
              tone="rose"
            />
          )}
          {share && allocation === "lock" && (
            <PreviewRow k="Locked" v={fmtNum(share.tokens, 0) + " for " + lockDays + "d"} tone="cy" />
          )}
        </dl>

        {(socials.x || socials.telegram || socials.website) && (
          <div className="mt-3 flex flex-wrap gap-1.5 border-t border-white/[0.05] pt-3">
            {socials.x && <Badge tone="muted">x</Badge>}
            {socials.telegram && <Badge tone="muted">telegram</Badge>}
            {socials.website && <Badge tone="muted">website</Badge>}
          </div>
        )}
      </div>
    </div>
  );
}

const STEPS = [
  "Reserving the curve address",
  "Mining an address ending in " + VANITY_SUFFIX,
  "Confirm in your wallet",
  "Waiting for the chain",
  "Indexing",
  "Submitting source for verification",
];

function Confirm({
  ready,
  busy,
  step,
  symbol,
  totalCost,
  econ,
  devBuyWei,
  factoryReady,
  hasWallet,
  mined,
  tx,
  err,
  onLaunch,
}: {
  ready: boolean;
  busy: boolean;
  step: string;
  symbol: string;
  totalCost: bigint;
  econ: Economics | null;
  devBuyWei: bigint;
  factoryReady: boolean;
  hasWallet: boolean;
  mined: { address: string; attempts: number; ms: number } | null;
  tx: string | null;
  err: string | null;
  onLaunch: () => void;
}) {
  const { net } = useNetwork();
  return (
    <div className="card p-4">
      <dl className="divide-y divide-white/[0.05]">
        <PreviewRow k="Launch fee" v={econ ? formatEther(econ.launchFee) + " COTI" : "-"} />
        <PreviewRow k="Dev buy" v={devBuyWei > 0n ? formatEther(devBuyWei) + " COTI" : "none"} />
        <PreviewRow k="Total" v={formatEther(totalCost) + " COTI"} />
      </dl>

      <button
        onClick={onLaunch}
        disabled={!ready || busy}
        className="mt-3 w-full rounded-xl bg-gradient-to-r from-devox-500 to-cy-500 py-3.5 text-[14px] font-semibold text-white transition hover:brightness-110 disabled:opacity-40"
      >
        {busy ? step || "Working..." : "Launch " + (symbol || "token")}
      </button>

      <p className="mt-2 text-center text-[10px] leading-relaxed text-white/25">
        One confirmation. Deploy, buy, and burn or lock all happen in the same transaction.
      </p>

      {busy && (
        <div className="mt-3 space-y-1.5">
          {STEPS.map((label) => {
            const active = step.startsWith(label.slice(0, 12));
            return (
              <div key={label} className="flex items-center gap-2 text-[11px]">
                <span
                  className={
                    "size-1.5 shrink-0 rounded-full " +
                    (active ? "animate-pulse-slow bg-cy-400" : "bg-white/15")
                  }
                />
                <span className={active ? "text-cy-300" : "text-white/30"}>
                  {active ? step : label}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {mined && (
        <div className="mt-3 rounded-xl border border-mint-400/25 bg-mint-400/[0.05] p-3">
          <div className="text-[11px] font-semibold text-mint-400">Address mined</div>
          <div className="mono mt-1 break-all text-[11px] text-white/70">{mined.address}</div>
          <div className="mt-1 text-[10px] text-white/30">
            {mined.attempts.toLocaleString("en-US")} candidates in {mined.ms} ms
          </div>
        </div>
      )}

      {!factoryReady && (
        <p className="mt-3 rounded-lg border border-amber-400/20 bg-amber-400/[0.05] px-2.5 py-2 text-[11px] leading-relaxed text-amber-300/80">
          The DEVOXPAD factory is not deployed on this network yet.
        </p>
      )}
      {!hasWallet && (
        <p className="mt-3 text-center text-[11px] text-amber-300/70">Connect a wallet to launch.</p>
      )}
      {err && <p className="mt-3 text-[11px] leading-relaxed text-rose-300">{err}</p>}
      {tx && (
        <a
          href={explorerTx(tx, net)}
          target="_blank"
          rel="noreferrer"
          className="mono mt-3 block truncate text-center text-[11px] text-cy-300 hover:underline"
        >
          {tx.slice(0, 24)}
        </a>
      )}
    </div>
  );
}
