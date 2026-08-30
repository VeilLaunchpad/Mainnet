"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Badge, Skeleton } from "./ui";
import { timeAgo } from "@/lib/format";

interface ChatLink {
  chatId: string;
  username: string;
  firstName: string;
  agent: string;
  linkedAt: number;
}

interface Activity {
  kind: string;
  title: string;
  detail: string;
  created_at: number;
}

interface Payload {
  configured: boolean;
  bot: string;
  botUrl: string;
  links: ChatLink[];
  activity: Activity[];
}

/**
 * Linking a Telegram chat to this wallet.
 *
 * Two proofs are required and neither is enough alone: the code proves control
 * of the chat, and the connected wallet proves control of the address. That is
 * what stops someone linking a chat to an address they do not hold.
 *
 * What linking grants is narrow, and the panel says so rather than leaving it
 * to be assumed: the bot can read that address. It cannot sign, and it never
 * holds a key.
 */
export function TelegramPanel({ address }: { address?: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!address) return setData(null);
    fetch("/api/telegram/link?address=" + address)
      .then((r) => r.json())
      .then((j) => setData(j.error ? null : j))
      .catch(() => setData(null));
  }, [address]);

  useEffect(() => {
    load();
    const t = setInterval(load, 20_000);
    return () => clearInterval(t);
  }, [load]);

  async function redeem() {
    if (!address) return setErr("Connect a wallet first.");
    if (!code.trim()) return setErr("Paste the code the bot gave you.");

    setBusy(true);
    setErr(null);
    setDone(null);
    try {
      const res = await fetch("/api/telegram/link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address, code: code.trim() }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "could not link");

      setDone("Linked" + (j.username ? " to @" + j.username : "") + ".");
      setCode("");
      load();
    } catch (e) {
      setErr(String((e as Error).message || e).slice(0, 180));
    } finally {
      setBusy(false);
    }
  }

  async function unlink(chatId: string) {
    await fetch("/api/telegram/link?chatId=" + chatId, { method: "DELETE" }).catch(() => undefined);
    load();
  }

  if (!address) {
    return (
      <div className="card flex flex-col items-center justify-center px-6 py-20 text-center">
        <h3 className="text-[15px] font-semibold">Connect a wallet</h3>
        <p className="mt-1.5 max-w-sm text-[13px] text-white/45">
          Linking needs an address to link to.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <div className="space-y-3">
        <div className="card p-5">
          <div className="flex items-center gap-2.5">
            <span className="flex size-9 items-center justify-center rounded-full bg-cy-500/15 text-cy-300">
              <TelegramIcon />
            </span>
            <div>
              <h2 className="text-[15px] font-semibold">Telegram</h2>
              <p className="text-[11px] text-white/40">
                {data?.configured === false ? "Not configured on this deployment" : "Talk to your agents from a chat"}
              </p>
            </div>
          </div>

          {!data ? (
            <Skeleton className="mt-4 h-24" />
          ) : data.links.length > 0 ? (
            <div className="mt-4 space-y-2">
              {data.links.map((l) => (
                <div
                  key={l.chatId}
                  className="flex items-center gap-3 rounded-xl border border-mint-400/25 bg-mint-400/[0.05] p-3"
                >
                  <span className="size-2 shrink-0 rounded-full bg-mint-400" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold">
                      {l.username ? "@" + l.username : l.firstName || "Chat " + l.chatId}
                    </div>
                    <div className="text-[11px] text-white/40">
                      linked {timeAgo(l.linkedAt)} ago, talking to {l.agent.toUpperCase()}
                    </div>
                  </div>
                  <button
                    onClick={() => unlink(l.chatId)}
                    className="shrink-0 rounded-lg border border-white/10 px-2.5 py-1 text-[11px] text-white/50 transition hover:border-rose-400/40 hover:text-rose-300"
                  >
                    Unlink
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-4">
              <ol className="space-y-2.5">
                {[
                  <>
                    Open{" "}
                    <a
                      href={data.botUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-cy-300 hover:underline"
                    >
                      @{data.bot}
                    </a>{" "}
                    and send <span className="mono text-white/70">/link</span>
                  </>,
                  <>The bot replies with an eight-character code</>,
                  <>Paste it below while this wallet is connected</>,
                ].map((step, i) => (
                  <li key={i} className="flex gap-2.5 text-[13px] leading-relaxed text-white/60">
                    <span className="mono mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border border-white/10 text-[10px] text-devox-400">
                      {i + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>

              <div className="mt-4 flex gap-2">
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="A1B2C3D4"
                  maxLength={12}
                  onKeyDown={(e) => e.key === "Enter" && !busy && redeem()}
                  className="mono min-w-0 flex-1 rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5 text-[15px] tracking-[0.2em] outline-none transition placeholder:text-white/20 focus:border-cy-400/50"
                />
                <button
                  onClick={redeem}
                  disabled={busy || !code.trim()}
                  className="shrink-0 rounded-xl bg-gradient-to-r from-devox-500 to-cy-500 px-4 py-2.5 text-[13px] font-semibold text-white transition hover:brightness-110 disabled:opacity-40"
                >
                  {busy ? "Linking..." : "Link"}
                </button>
              </div>
            </div>
          )}

          {err && <p className="mt-3 text-[12px] leading-relaxed text-rose-300">{err}</p>}
          {done && <p className="mt-3 text-[12px] text-mint-400">{done}</p>}
        </div>

        <div className="card p-5">
          <h3 className="text-[13px] font-semibold">What the bot can and cannot do</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-mint-400/20 bg-mint-400/[0.04] p-3">
              <div className="text-[12px] font-semibold text-mint-400">It can</div>
              <ul className="mt-1.5 space-y-1 text-[11px] leading-relaxed text-white/50">
                <li>Run the same agents that run here</li>
                <li>Read the chain, the launchpad and your history</li>
                <li>Prepare a trade or a launch for you to sign</li>
                <li>Record everything it does into this dashboard</li>
              </ul>
            </div>
            <div className="rounded-xl border border-rose-400/20 bg-rose-400/[0.04] p-3">
              <div className="text-[12px] font-semibold text-rose-400">It cannot</div>
              <ul className="mt-1.5 space-y-1 text-[11px] leading-relaxed text-white/50">
                <li>Hold a key or sign anything</li>
                <li>Read a private balance, which needs your browser key</li>
                <li>Move value without your wallet confirming it</li>
              </ul>
            </div>
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-white/30">
            A bot that could sign would be a custodial wallet in a chat window. Anything that moves
            value opens here for your own wallet to confirm.
          </p>
        </div>
      </div>

      <div className="space-y-3">
        <div className="card p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-[13px] font-semibold">From Telegram</h3>
            <span className="text-[10px] text-white/25">recorded against this wallet</span>
          </div>

          {!data ? (
            <Skeleton className="mt-3 h-32" />
          ) : data.activity.length === 0 ? (
            <p className="py-12 text-center text-[13px] text-white/30">
              Nothing yet. Anything you do in the chat shows up here.
            </p>
          ) : (
            <div className="mt-3 divide-y divide-white/[0.05]">
              {data.activity.map((a, i) => (
                <div key={i} className="flex items-start gap-2.5 py-2.5">
                  <Badge tone={a.kind === "telegram_chat" ? "devox" : "muted"}>
                    {a.kind.replace("telegram_", "")}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px] text-white/75">{a.title}</div>
                    <div className="truncate text-[11px] text-white/35">{a.detail}</div>
                  </div>
                  <span className="mono shrink-0 text-[10px] text-white/25">
                    {timeAgo(a.created_at)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card p-4">
          <h3 className="text-[13px] font-semibold">Your own agent, running without you</h3>
          <p className="mt-1.5 text-[12px] leading-relaxed text-white/45">
            An agent you create runs on DEVOXPAD infrastructure, not in this tab. Turn on its
            heartbeat and it keeps watching after you close the browser, posting to its feed and
            reaching you in Telegram when something actually changes.
          </p>
          <Link
            href="/agents/new"
            className="mt-3 block rounded-xl border border-devox-400/30 bg-devox-500/10 px-4 py-2.5 text-center text-[13px] font-semibold text-devox-300 transition hover:bg-devox-500/20"
          >
            Create an agent
          </Link>
        </div>
      </div>
    </div>
  );
}

function TelegramIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
      <path
        d="M2.5 9.3 17 3.4c.7-.3 1.4.3 1.2 1L15.9 16c-.2.8-1 1-1.6.6l-3.8-2.8-1.9 1.8c-.3.3-.7.2-.8-.2l-1.4-4.5-3.9-1.2c-.6-.2-.6-1 0-1.2Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="m8.2 11.2 7.4-6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
