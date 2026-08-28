"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAccount, useBalance, useSendTransaction } from "wagmi";
import { parseEther, type Address } from "viem";
import { Contract } from "@coti-io/coti-ethers";
import QRCode from "qrcode";
import { Badge, Avatar, Skeleton } from "./ui";
import { privateErc20Abi } from "@/lib/abis";
import { useCotiSession } from "@/lib/coti-client";
import { fmtNum, fmtUnits, parseUnits, shortAddr, isAddress } from "@/lib/format";
import { explorerTx, explorerAddress } from "@/lib/chain";
import { useNetwork, useNetworkClient } from "./network-provider";

interface Holding {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  kind: "native" | "private" | "public";
  /** Null until the AES key has been unlocked for a private token. */
  balance: string | null;
  source: "launch" | "portal";
}

/**
 * The wallet, as it appears inside the dashboard.
 *
 * Native COTI behaves like any EVM balance. Everything under Private is a COTI
 * PrivateERC20, whose balance is ciphertext in contract storage: this panel can
 * only show a number after the AES key has been derived in the browser, and it
 * says so rather than displaying a misleading zero.
 */
export function WalletPanel() {
  const { chain } = useNetwork();
  const { address } = useAccount();
  const publicClient = useNetworkClient();
  const { data: native } = useBalance({
    address,
    query: { enabled: !!address, refetchInterval: 15_000 },
  });
  const coti = useCotiSession(address);

  const [view, setView] = useState<"assets" | "send" | "receive">("assets");
  const [holdings, setHoldings] = useState<Holding[] | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!address) return setHoldings(null);

    const [tokensRes, portalRes] = await Promise.all([
      fetch("/api/tokens?limit=50").then((r) => r.json()).catch(() => ({ tokens: [] })),
      fetch("/api/portal").then((r) => r.json()).catch(() => ({ pairs: [] })),
    ]);

    setHoldings([
      {
        address: "native",
        symbol: "COTI",
        name: chain.name,
        decimals: 18,
        kind: "native",
        balance: null,
        source: "launch",
      },
      ...(tokensRes.tokens || []).map((t: Record<string, unknown>) => ({
        address: String(t.address),
        symbol: String(t.symbol),
        name: String(t.name),
        decimals: Number(t.decimals) || 18,
        kind: t.kind === "private" ? ("private" as const) : ("public" as const),
        balance: null,
        source: "launch" as const,
      })),
      ...(portalRes.pairs || []).map((p: Record<string, unknown>) => ({
        address: String(p.twin),
        symbol: String(p.twinSymbol),
        name: "Private " + String(p.symbol),
        decimals: Number(p.decimals) || 18,
        kind: "private" as const,
        balance: null,
        source: "portal" as const,
      })),
    ]);
  }, [address]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Decrypts every private holding locally. One signature covers all of them. */
  const reveal = useCallback(async () => {
    if (!address || !holdings) return;
    setRevealing(true);
    setErr(null);
    try {
      const session = coti.session || (await coti.unlock());
      if (!session) throw new Error(coti.error || "Could not unlock your COTI key.");

      const next = await Promise.all(
        holdings.map(async (h) => {
          if (h.kind !== "private") return h;
          try {
            const c = new Contract(h.address, privateErc20Abi as never, session.signer);
            const ct = await c["balanceOf(address)"](address);
            const clear = await session.signer.decryptValue256(ct);
            return { ...h, balance: fmtUnits(BigInt(clear.toString()), h.decimals, 6) };
          } catch {
            return { ...h, balance: "?" };
          }
        }),
      );
      setHoldings(next);
    } catch (e) {
      setErr(String((e as Error).message || e).slice(0, 200));
    } finally {
      setRevealing(false);
    }
  }, [address, holdings, coti]);

  // Public balances need no key, so they load on their own.
  useEffect(() => {
    if (!address || !publicClient || !holdings) return;
    const pending = holdings.filter((h) => h.kind === "public" && h.balance === null);
    if (!pending.length) return;

    let alive = true;
    (async () => {
      const updates = new Map<string, string>();
      for (const h of pending) {
        try {
          const bal = (await publicClient.readContract({
            address: h.address as Address,
            abi: privateErc20Abi,
            functionName: "balanceOf",
            args: [address],
          })) as bigint;
          updates.set(h.address, fmtUnits(bal, h.decimals, 6));
        } catch {
          updates.set(h.address, "0");
        }
      }
      if (!alive) return;
      setHoldings((cur) =>
        cur
          ? cur.map((h) => (updates.has(h.address) ? { ...h, balance: updates.get(h.address)! } : h))
          : cur,
      );
    })();
    return () => {
      alive = false;
    };
  }, [address, publicClient, holdings]);

  const unlocked = holdings?.some((h) => h.kind === "private" && h.balance !== null) ?? false;

  if (!address) {
    return (
      <div className="card flex flex-col items-center justify-center px-6 py-20 text-center">
        <h3 className="text-[15px] font-semibold">Connect a wallet</h3>
        <p className="mt-1.5 max-w-sm text-[13px] text-white/45">
          Nothing here is readable without your key, and your key comes from your wallet.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex rounded-xl border border-white/10 bg-white/[0.03] p-1">
        {(["assets", "send", "receive"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={
              "flex-1 rounded-lg py-2 text-[13px] font-semibold capitalize transition " +
              (view === v ? "bg-white/[0.09] text-white" : "text-white/45 hover:text-white")
            }
          >
            {v}
          </button>
        ))}
      </div>

      {err && (
        <p className="rounded-xl border border-rose-400/25 bg-rose-400/[0.06] px-3.5 py-2.5 text-[12px] text-rose-300">
          {err}
        </p>
      )}

      {view === "assets" && (
        <Assets
          coti={coti}
          holdings={holdings}
          native={native ? fmtNum(Number(native.formatted), 6) : "0"}
          unlocked={unlocked}
          revealing={revealing}
          onReveal={reveal}
          onForget={() => {
            coti.forget();
            void load();
          }}
        />
      )}
      {view === "send" && <Send holdings={holdings} onSent={load} setErr={setErr} />}
      {view === "receive" && <Receive address={address} />}
    </div>
  );
}

function stageLabel(stage: string, detail?: string | null) {
  if (detail) return detail;
  if (stage === "checking") return "Checking your wallet...";
  if (stage === "signing") return "Sign in your wallet...";
  if (stage === "onboarding") return "Registering your key...";
  if (stage === "recovering") return "Unwrapping the key...";
  return "Decrypting...";
}

function Assets({
  coti,
  holdings,
  native,
  unlocked,
  revealing,
  onReveal,
  onForget,
}: {
  coti: { stage: string; detail: string | null; error: string | null };
  holdings: Holding[] | null;
  native: string;
  unlocked: boolean;
  revealing: boolean;
  onReveal: () => void;
  onForget: () => void;
}) {
  const { net } = useNetwork();
  if (!holdings) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-16" />
        ))}
      </div>
    );
  }

  const privates = holdings.filter((h) => h.kind === "private");

  return (
    <div className="space-y-3">
      <div className="card divide-y divide-white/[0.05]">
        {holdings.map((h) => {
          const value = h.kind === "native" ? native : h.balance;
          const hidden = h.kind === "private" && value === null;
          return (
            <div key={h.address} className="flex items-center gap-3 px-4 py-3">
              <span className="relative">
                <Avatar seed={h.symbol} size={34} rounded="rounded-full" />
                {h.kind === "private" && (
                  <span className="absolute -bottom-0.5 -right-0.5 flex size-3.5 items-center justify-center rounded-full bg-veil-500 text-white">
                    <Lock small />
                  </span>
                )}
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-[14px] font-semibold">{h.symbol}</span>
                  {h.kind === "private" && <Badge tone="veil">encrypted</Badge>}
                  {h.source === "portal" && <Badge tone="cy">portal</Badge>}
                </div>
                <div className="truncate text-[11px] text-white/35">{h.name}</div>
              </div>

              <div className="text-right">
                <div className="mono text-[14px] font-semibold">
                  {hidden ? <span className="text-white/25">••••••</span> : (value ?? "...")}
                </div>
                {h.address !== "native" && (
                  <a
                    href={explorerAddress(h.address, net)}
                    target="_blank"
                    rel="noreferrer"
                    className="mono text-[10px] text-white/25 transition hover:text-cy-300"
                  >
                    {shortAddr(h.address, 4)}
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {privates.length > 0 && (
        <div className="card flex flex-wrap items-center gap-3 p-4">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold">
              {unlocked ? "Private balances unlocked" : "Private balances are ciphertext"}
            </div>
            <p className="mt-0.5 text-[12px] leading-relaxed text-white/45">
              {unlocked
                ? "Decrypted locally. Nothing left this browser, and the numbers above exist nowhere on our server."
                : "One signature derives your AES key and decrypts every private holding at once. The key is cached here and never sent anywhere."}
            </p>
          </div>
          {unlocked ? (
            <button
              onClick={onForget}
              className="shrink-0 rounded-xl border border-white/12 px-4 py-2 text-[13px] font-semibold text-white/70 transition hover:border-rose-400/40 hover:text-rose-300"
            >
              Forget key
            </button>
          ) : (
            <button
              onClick={onReveal}
              disabled={revealing}
              className="shrink-0 rounded-xl bg-gradient-to-r from-veil-500 to-cy-500 px-4 py-2 text-[13px] font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
            >
              {revealing ? stageLabel(coti.stage, coti.detail) : "Unlock balances"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Send({
  holdings,
  onSent,
  setErr,
}: {
  holdings: Holding[] | null;
  onSent: () => void;
  setErr: (v: string | null) => void;
}) {
  const { net } = useNetwork();
  const { address } = useAccount();
  const publicClient = useNetworkClient();
  const { sendTransactionAsync } = useSendTransaction();
  const coti = useCotiSession(address);

  const [asset, setAsset] = useState("native");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [tx, setTx] = useState<string | null>(null);
  const [resolved, setResolved] = useState<string | null>(null);

  const selected = holdings?.find((h) => h.address === asset) ?? null;

  // A handle is friendlier than an address, so resolve @name through the index.
  useEffect(() => {
    const handle = to.trim().replace(/^@/, "");
    if (!handle || isAddress(to.trim())) return setResolved(null);
    let alive = true;
    const timer = setTimeout(() => {
      fetch("/api/profile/" + encodeURIComponent(handle))
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => alive && setResolved(j?.profile?.address ?? null))
        .catch(() => alive && setResolved(null));
    }, 300);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [to]);

  const destination = isAddress(to.trim()) ? to.trim() : resolved;

  async function submit() {
    setErr(null);
    if (!address) return setErr("Connect a wallet first.");
    if (!destination) return setErr("Enter a 0x address or a claimed @handle.");
    if (!amount || Number(amount) <= 0) return setErr("Enter an amount.");
    if (!selected) return setErr("Pick an asset.");

    setBusy(true);
    setTx(null);
    try {
      if (selected.kind === "native") {
        setStep("Sending…");
        const hash = await sendTransactionAsync({
          to: destination as Address,
          value: parseEther(amount),
        });
        setTx(hash);
        await publicClient?.waitForTransactionReceipt({ hash });
      } else {
        // A private transfer moves an encrypted amount, so it goes through the
        // COTI signer rather than a plain contract write.
        const session = coti.session || (await coti.unlock());
        if (!session) throw new Error("Could not unlock your COTI key.");

        setStep("Encrypting and sending…");
        const c = new Contract(selected.address, privateErc20Abi as never, session.signer);
        const value = parseUnits(amount, selected.decimals);
        const sent = await c["transfer(address,uint256)"](destination, value, {
          gasLimit: 12_000_000n,
        });
        setTx(sent.hash);
        await sent.wait();
      }

      setAmount("");
      setTo("");
      onSent();
    } catch (e) {
      setErr(String((e as Error).message || e).slice(0, 220));
    } finally {
      setBusy(false);
      setStep("");
    }
  }

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <div className="card p-5">
        <label className="text-[12px] font-semibold text-white/70">Asset</label>
        <select
          value={asset}
          onChange={(e) => setAsset(e.target.value)}
          className="mt-1.5 w-full rounded-xl border border-white/10 bg-ink-850 px-3.5 py-2.5 text-[13px] outline-none focus:border-veil-400/50"
        >
          {(holdings ?? []).map((h) => (
            <option key={h.address} value={h.address}>
              {h.symbol}
              {h.kind === "private" ? " (encrypted)" : ""}
            </option>
          ))}
        </select>

        <label className="mt-4 block text-[12px] font-semibold text-white/70">To</label>
        <input
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="0x address or @handle"
          className="mono mt-1.5 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5 text-[13px] outline-none transition placeholder:text-white/20 focus:border-veil-400/50"
        />
        {resolved && (
          <div className="mono mt-1.5 text-[11px] text-mint-400">
            resolves to {shortAddr(resolved, 8)}
          </div>
        )}
        {to.trim() && !destination && (
          <div className="mt-1.5 text-[11px] text-amber-300/80">
            Not an address, and no profile claims that handle.
          </div>
        )}

        <label className="mt-4 block text-[12px] font-semibold text-white/70">Amount</label>
        <div className="mt-1.5 flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5 focus-within:border-veil-400/50">
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            placeholder="0.0"
            inputMode="decimal"
            className="mono min-w-0 flex-1 bg-transparent text-lg outline-none placeholder:text-white/20"
          />
          <span className="shrink-0 text-[13px] font-semibold text-white/50">{selected?.symbol}</span>
        </div>

        <button
          onClick={submit}
          disabled={busy || !amount || !destination}
          className="mt-5 w-full rounded-xl bg-gradient-to-r from-veil-500 to-cy-500 py-3 text-[14px] font-semibold text-white transition hover:brightness-110 disabled:opacity-40"
        >
          {busy ? step || "Sending…" : "Send " + (selected?.symbol ?? "")}
        </button>

        {tx && (
          <a
            href={explorerTx(tx, net)}
            target="_blank"
            rel="noreferrer"
            className="mono mt-2 block truncate text-center text-[11px] text-cy-300 hover:underline"
          >
            {tx.slice(0, 22)}
          </a>
        )}
      </div>

      <div className="card p-5">
        <h3 className="text-[13px] font-semibold">What the chain will show</h3>
        {selected?.kind === "private" ? (
          <>
            <p className="mt-2 text-[13px] leading-relaxed text-white/50">
              A private transfer emits an event naming you and the recipient, and nothing else. The
              amount is encrypted in transit and lands as ciphertext in their balance.
            </p>
            <ul className="mt-3 space-y-1.5 text-[12px] leading-relaxed text-white/45">
              <li className="flex gap-2">
                <span className="mt-[7px] size-1 shrink-0 rounded-full bg-amber-400/70" />
                <span>Public: that a transfer happened, from whom, to whom, and when.</span>
              </li>
              <li className="flex gap-2">
                <span className="mt-[7px] size-1 shrink-0 rounded-full bg-mint-400/70" />
                <span>Private: the amount, and both balances afterwards.</span>
              </li>
            </ul>
            <p className="mt-3 text-[11px] leading-relaxed text-white/30">
              MPC operations are gas-hungry, so a private transfer costs far more than a native one.
            </p>
          </>
        ) : (
          <>
            <p className="mt-2 text-[13px] leading-relaxed text-white/50">
              Native COTI is a transparent balance, exactly like ether on any EVM chain. Sender,
              recipient and amount are all public.
            </p>
            <p className="mt-3 text-[12px] leading-relaxed text-white/45">
              To move value without publishing the amount, portal it into privacy first and send the
              twin instead.
            </p>
            <Link
              href="/portal"
              className="mt-3 inline-block rounded-xl border border-veil-400/30 bg-veil-500/10 px-4 py-2 text-[13px] font-semibold text-veil-300 transition hover:bg-veil-500/20"
            >
              Open the portal
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

function Receive({ address }: { address: string }) {
  const { net } = useNetwork();
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    QRCode.toDataURL(address, {
      width: 220,
      margin: 1,
      color: { dark: "#e8e8f0", light: "#00000000" },
      errorCorrectionLevel: "M",
    })
      .then(setQr)
      .catch(() => setQr(null));
  }, [address]);

  function copy() {
    navigator.clipboard.writeText(address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  }

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <div className="card flex flex-col items-center p-6 text-center">
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          {qr ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr} alt="Your address as a QR code" width={220} height={220} />
          ) : (
            <Skeleton className="size-[220px]" />
          )}
        </div>

        <div className="mono mt-4 max-w-full break-all text-[12px] leading-relaxed text-white/70">
          {address}
        </div>

        <div className="mt-3 flex gap-2">
          <button
            onClick={copy}
            className="rounded-xl bg-gradient-to-r from-veil-500 to-cy-500 px-4 py-2 text-[13px] font-semibold text-white transition hover:brightness-110"
          >
            {copied ? "Copied" : "Copy address"}
          </button>
          <a
            href={explorerAddress(address, net)}
            target="_blank"
            rel="noreferrer"
            className="rounded-xl border border-white/12 px-4 py-2 text-[13px] font-semibold text-white/70 transition hover:border-veil-400/50 hover:text-white"
          >
            Block explorer
          </a>
        </div>
      </div>

      <div className="card p-5">
        <h3 className="text-[13px] font-semibold">One address, both sides</h3>
        <p className="mt-2 text-[13px] leading-relaxed text-white/50">
          The same address receives native COTI and every private token. There is no separate
          shielded address to manage: privacy lives in the token contract, not in a second identity.
        </p>

        <h3 className="mt-5 text-[13px] font-semibold">Before someone sends you a private token</h3>
        <ul className="mt-2 space-y-1.5 text-[12px] leading-relaxed text-white/45">
          <li className="flex gap-2">
            <span className="mt-[7px] size-1 shrink-0 rounded-full bg-veil-400/70" />
            <span>
              You do not need to do anything first. The transfer lands whether or not you have ever
              derived your key.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="mt-[7px] size-1 shrink-0 rounded-full bg-veil-400/70" />
            <span>
              To read the balance afterwards you unlock once, here, and the number is decrypted in
              your browser.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="mt-[7px] size-1 shrink-0 rounded-full bg-amber-400/70" />
            <span>
              Keep a little native COTI for gas. Reading is free, but moving a private balance is an
              MPC operation and costs more than an ordinary transfer.
            </span>
          </li>
        </ul>

        <p className="mt-5 text-[11px] leading-relaxed text-white/30">
          Claim a handle on your profile and people can send to @you instead of pasting this.
        </p>
      </div>
    </div>
  );
}

function Lock({ small }: { small?: boolean }) {
  const s = small ? 9 : 14;
  return (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none">
      <rect x="3" y="7" width="10" height="7" rx="1.8" stroke="currentColor" strokeWidth="1.6" />
      <path d="M5.4 7V5.2a2.6 2.6 0 0 1 5.2 0V7" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}
