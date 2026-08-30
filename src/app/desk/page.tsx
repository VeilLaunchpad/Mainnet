"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { Section, Badge, Skeleton, Progress, Avatar } from "@/components/ui";
import { AgentChat } from "@/components/agent-chat";
import { fmtUsd, fmtNum, shortAddr } from "@/lib/format";
import { PriceText } from "@/components/price-chart";
import { IntroPopup } from "@/components/intro-popup";

interface Row {
  address: string; name: string; symbol: string; image: string;
  progressPct: number; graduated: boolean; spotPriceCoti: number | null; reserveCoti: string;
}

export default function TradePage() {
  const { address } = useAccount();
  const [tokens, setTokens] = useState<Row[] | null>(null);
  const [coti, setCoti] = useState<{ price: number; change24h: number } | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => {
      fetch("/api/tokens?limit=12&sort=progress")
        .then((r) => r.json())
        .then((j) => alive && setTokens(j.tokens || []))
        .catch(() => alive && setTokens([]));
      fetch("/api/stats")
        .then((r) => r.json())
        .then((j) => alive && setCoti(j.coti))
        .catch(() => undefined);
    };
    load();
    const t = setInterval(load, 25_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  return (
    <div className="py-8">
      <IntroPopup
        id="desk"
        title={
          <>
            The <span className="text-grad">Desk</span>
          </>
        }
        lead="This is where you trade with your own hands. Agents are the other floor."
        points={[
          {
            icon: "🖐",
            title: "You are the one trading",
            body: "Nothing here acts on its own. Every buy and sell is yours, quoted live and signed by your wallet.",
          },
          {
            icon: "🕶",
            title: "Your size stays yours",
            body: "Private token balances are ciphertext on COTI, so nobody can read your position or copy it.",
          },
          {
            icon: "📈",
            title: "Curve first, pool after",
            body: "A new token trades on its bonding curve until the curve fills, then graduates into a DevoxSwap pair.",
          },
          {
            icon: "🤖",
            title: "Want it done for you instead?",
            body: "The Agents floor is where you hand a brief to something that watches the market while you are away.",
          },
        ]}
        footer="One signature per action. Nothing is held on your behalf at any point."
      />

      <Section
        kicker="Private trading desk"
        title="SHADE trades a position nobody can size"
        sub="Balances are ciphertext on-chain, so what you are holding does not show up on an explorer. The trades themselves do: the transaction, your address and the COTI amount are public like any other. What is hidden is the position behind them, not the act of trading."
      >
        <div className="grid gap-3 lg:grid-cols-3">
          <div className="card flex h-[calc(100dvh-250px)] min-h-[560px] flex-col p-4 lg:col-span-2">
            <div className="mb-3 flex items-center gap-2.5 border-b border-white/[0.06] pb-3">
              <Avatar seed="SHADE" size={36} />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[15px] font-semibold">SHADE</span>
                  <Badge tone="mint">trader</Badge>
                </div>
                <div className="text-[11px] text-white/35">
                  Reads the curve, sizes the position, hands you something to sign.
                </div>
              </div>
              {coti && (
                <div className="text-right">
                  <div className="mono text-[15px] font-semibold">{fmtUsd(coti.price)}</div>
                  <div
                    className={
                      "mono text-[11px] " + (coti.change24h >= 0 ? "text-mint-400" : "text-rose-400")
                    }
                  >
                    {coti.change24h >= 0 ? "+" : ""}
                    {coti.change24h.toFixed(2)}% 24h
                  </div>
                </div>
              )}
            </div>

            <AgentChat
              agentSlug="shade"
              agentName="SHADE"
              className="min-h-0 flex-1"
              suggestions={[
                "What is closest to graduating and is it worth a position?",
                "Read the COTI trend and tell me if now is a bad time to buy anything",
                "Watch the top three launches and wake me if one moves",
                "Explain how my position stays private if my fill is a public event",
              ]}
            />
          </div>

          <div className="space-y-3">
            <div className="card p-4">
              <h2 className="text-[13px] font-semibold">Closest to graduation</h2>
              <p className="mt-1 text-[11px] text-white/35">
                The curve fills, then its whole reserve seeds a DevoxSwap pair.
              </p>

              <div className="mt-3 space-y-2">
                {tokens === null ? (
                  Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14" />)
                ) : tokens.length === 0 ? (
                  <p className="py-6 text-center text-[12px] text-white/30">
                    Nothing launched yet.{" "}
                    <Link href="/launch" className="text-cy-300 hover:underline">
                      Launch one →
                    </Link>
                  </p>
                ) : (
                  tokens.map((t) => (
                    <Link
                      key={t.address}
                      href={"/coti/" + t.address}
                      className="block rounded-xl border border-white/[0.07] p-2.5 transition hover:border-devox-400/40"
                    >
                      <div className="flex items-center gap-2.5">
                        <Avatar src={t.image} seed={t.symbol} size={28} rounded="rounded-lg" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate text-[13px] font-semibold">{t.symbol}</span>
                            {t.graduated && <Badge tone="mint">pool</Badge>}
                          </div>
                          <div className="mono text-[10px] text-white/30">
                            {t.spotPriceCoti ? (
                              <>
                                <PriceText value={t.spotPriceCoti} /> COTI
                              </>
                            ) : (
                              shortAddr(t.address)
                            )}
                          </div>
                        </div>
                        <span className="mono shrink-0 text-[11px] text-white/45">
                          {t.progressPct.toFixed(0)}%
                        </span>
                      </div>
                      {!t.graduated && (
                        <div className="mt-2">
                          <Progress pct={t.progressPct} />
                        </div>
                      )}
                    </Link>
                  ))
                )}
              </div>
            </div>

            <div className="card p-4">
              <h2 className="text-[13px] font-semibold">Why this is private</h2>
              <ul className="mt-2.5 space-y-2 text-[12px] leading-relaxed text-white/45">
                <li className="flex gap-2">
                  <span className="mt-[7px] size-1 shrink-0 rounded-full bg-cy-400/70" />
                  <span>
                    Your token balance is a ciphertext in contract storage. Only your AES key turns it
                    into a number.
                  </span>
                </li>
                <li className="flex gap-2">
                  <span className="mt-[7px] size-1 shrink-0 rounded-full bg-cy-400/70" />
                  <span>
                    A <span className="mono">Transfer</span> event proves something moved. It does not
                    say how much.
                  </span>
                </li>
                <li className="flex gap-2">
                  <span className="mt-[7px] size-1 shrink-0 rounded-full bg-cy-400/70" />
                  <span>
                    <span className="mono">totalSupply</span> returns zero by design - there is no
                    aggregate to divide your holding into.
                  </span>
                </li>
              </ul>
              {!address && (
                <p className="mt-3 rounded-lg border border-amber-400/20 bg-amber-400/[0.05] px-2.5 py-2 text-[11px] text-amber-300/80">
                  Connect a wallet to let SHADE read your balance and hand you signable positions.
                </p>
              )}
            </div>
          </div>
        </div>
      </Section>
    </div>
  );
}
