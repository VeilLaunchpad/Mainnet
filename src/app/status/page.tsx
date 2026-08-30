"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Section, Badge, Skeleton, Stat } from "@/components/ui";
import { fmtNum, shortAddr, timeAgo } from "@/lib/format";
import { explorerAddress } from "@/lib/chain";
import { useNetwork } from "@/components/network-provider";

interface Service {
  name: string;
  ok: boolean;
  detail: string;
}

interface Status {
  ok: boolean;
  network: string;
  chainId: number;
  head: number;
  indexed: number;
  lag: number;
  rpcLatencyMs: number;
  mode: string;
  services: Service[];
  counts: Record<string, number>;
  responseMs: number;
  updatedAt: number;
}

/**
 * Indexer status.
 *
 * DEVOXPAD reads chain events on demand rather than running a background
 * crawler, so lag is zero by construction. That is stated openly rather than
 * dressed up as a sync percentage, and the numbers that can genuinely fail
 * (RPC reachability, the local index, the model pool) are the ones shown.
 */
/** A fixed strip, so the bar chart has a shape before any check has run. */
const SLOTS = Array.from({ length: 40 });

function Key({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={"size-1.5 rounded-[1px] " + className} />
      {label}
    </span>
  );
}

export default function StatusPage() {
  const { net } = useNetwork();
  const [status, setStatus] = useState<Status | null>(null);
  const [history, setHistory] = useState<{ at: number; ok: boolean; ms: number }[]>([]);
  const uptime = history.length
    ? (history.filter((h) => h.ok).length / history.length) * 100
    : 0;
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    const started = Date.now();
    fetch("/api/indexer/status")
      .then((r) => r.json())
      .then((j: Status) => {
        setStatus(j);
        setError(false);
        setHistory((h) => [...h.slice(-59), { at: Date.now(), ok: j.ok, ms: Date.now() - started }]);
      })
      .catch(() => {
        setError(true);
        setHistory((h) => [...h.slice(-59), { at: Date.now(), ok: false, ms: Date.now() - started }]);
      });
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [load]);

  const up = status?.ok && !error;

  return (
    <div className="py-10">
      <Section
        kicker="Status"
        title="Indexer and services"
        sub="Live health of everything DEVOXPAD reads from. Refreshes every fifteen seconds."
      >
        <div className="card flex flex-wrap items-center gap-4 p-5">
          <span
            className={
              "flex size-11 items-center justify-center rounded-full " +
              (up ? "bg-mint-400/15" : "bg-rose-400/15")
            }
          >
            <span
              className={
                "size-3 rounded-full " +
                (up ? "animate-pulse-slow bg-mint-400 shadow-[0_0_10px] shadow-mint-400/70" : "bg-rose-400")
              }
            />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-bold">
              {up ? "All systems operational" : error ? "Status unavailable" : "Degraded"}
            </h2>
            <p className="mt-0.5 text-[13px] text-white/45">
              {status
                ? status.mode + ", " + status.network + ", chain " + status.chainId
                : "Checking…"}
            </p>
          </div>
          {status && (
            <div className="text-right">
              <div className="mono text-[13px] text-white/70">{status.responseMs} ms</div>
              <div className="text-[11px] text-white/30">last check {timeAgo(status.updatedAt)} ago</div>
            </div>
          )}
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-4">
          <Stat label="Head block" value={status ? fmtNum(status.head, 0) : "..."} sub="from the RPC" />
          <Stat
            label="Indexed to"
            value={status ? fmtNum(status.indexed, 0) : "..."}
            sub="events read on demand"
          />
          <Stat
            label="Lag"
            value={status ? status.lag + " blocks" : "..."}
            sub={status && status.lag === 0 ? "no crawler to fall behind" : "behind head"}
            tone={status && status.lag === 0 ? "up" : "down"}
          />
          <Stat
            label="RPC latency"
            value={status ? status.rpcLatencyMs + " ms" : "..."}
            sub="round trip to COTI"
          />
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-3">
          <div className="card p-4 lg:col-span-2">
            <h3 className="text-[15px] font-semibold">Services</h3>
            {!status ? (
              <div className="mt-3 space-y-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-11" />
                ))}
              </div>
            ) : (
              <div className="mt-3 divide-y divide-white/[0.05]">
                {status.services.map((s) => (
                  <div key={s.name} className="flex items-center gap-3 py-2.5">
                    <span
                      className={
                        "size-2 shrink-0 rounded-full " + (s.ok ? "bg-mint-400" : "bg-rose-400")
                      }
                    />
                    <span className="mono w-[150px] shrink-0 text-[12px] text-white/80">{s.name}</span>
                    <span className="mono min-w-0 flex-1 truncate text-[11px] text-white/40">
                      {s.detail.startsWith("0x") ? (
                        <a
                          href={explorerAddress(s.detail, net)}
                          target="_blank"
                          rel="noreferrer"
                          className="transition hover:text-cy-300"
                        >
                          {shortAddr(s.detail, 8)}
                        </a>
                      ) : (
                        s.detail
                      )}
                    </span>
                    <Badge tone={s.ok ? "mint" : "rose"}>{s.ok ? "ok" : "down"}</Badge>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-3">
            <div className="card p-4">
              <h3 className="text-[15px] font-semibold">Indexed</h3>
              {!status ? (
                <Skeleton className="mt-3 h-32" />
              ) : (
                <dl className="mt-3 divide-y divide-white/[0.05]">
                  {Object.entries(status.counts).map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between py-1.5 text-[12px]">
                      <dt className="capitalize text-white/40">{k}</dt>
                      <dd className="mono text-white/75">{fmtNum(v, 0)}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>

            <div className="card p-4">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-[15px] font-semibold">Recent checks</h3>
                <span className={"text-[12px] font-semibold " + (uptime >= 99 ? "text-mint-400" : uptime >= 90 ? "text-amber-400" : "text-rose-400")}>
                  {history.length ? uptime.toFixed(2) + " % ok" : "no data"}
                </span>
              </div>

              {/*
                Uniform-height bars, coloured by outcome. Height used to encode
                response time, which made a healthy-but-slow check look like a
                partial failure. Colour says whether it worked; the tooltip
                carries the timing for anyone who wants it.
              */}
              <div className="mt-3 flex h-9 items-stretch gap-[3px]">
                {SLOTS.map((_, i) => {
                  const h = history[history.length - SLOTS.length + i];
                  return (
                    <span
                      key={i}
                      title={
                        h
                          ? new Date(h.at).toLocaleTimeString() +
                            " · " +
                            (h.ok ? "ok" : "failed") +
                            " · " +
                            h.ms +
                            "ms"
                          : "no check yet"
                      }
                      className={
                        "flex-1 rounded-[2px] transition-colors " +
                        (!h
                          ? "bg-white/[0.05]"
                          : !h.ok
                            ? "bg-rose-400"
                            : h.ms > 1200
                              ? "bg-amber-400"
                              : "bg-mint-400")
                      }
                    />
                  );
                })}
              </div>

              <div className="mt-1.5 flex items-center justify-between text-[10px] text-white/30">
                <span>{history.length ? "oldest" : "waiting"}</span>
                <span className="flex items-center gap-2.5">
                  <Key className="bg-mint-400" label="ok" />
                  <Key className="bg-amber-400" label="slow" />
                  <Key className="bg-rose-400" label="failed" />
                </span>
                <span>now</span>
              </div>

              <p className="mt-2 text-[10px] leading-relaxed text-white/25">
                Live from this browser since the page opened. There is no stored history, so a
                reload starts the strip again.
              </p>
            </div>
          </div>
        </div>

        <div className="card mt-3 p-5">
          <h3 className="text-[15px] font-semibold">How the indexer works</h3>
          <p className="mt-2 text-[13px] leading-relaxed text-white/55">
            There is no background crawler and no separate database of chain history. When you open a
            token page, the server reads its <span className="mono text-cy-300">Traded</span> and{" "}
            <span className="mono text-cy-300">Swap</span> events straight from the RPC and merges
            them with the small amount the local index holds: launch metadata, profiles, agent
            memory, comments.
          </p>
          <p className="mt-2 text-[13px] leading-relaxed text-white/55">
            That means history is complete no matter where a trade originated, and there is no
            reorg-handling or replay backlog to get wrong. The trade-off is a read that costs an RPC
            round trip rather than a database lookup, which is why latency is shown above.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href="/docs/indexer"
              className="rounded-xl border border-white/12 px-4 py-2 text-[13px] font-semibold transition hover:border-devox-400/50"
            >
              Indexer API docs
            </Link>
            <a
              href="/api/indexer/status"
              className="rounded-xl border border-white/12 px-4 py-2 text-[13px] font-semibold transition hover:border-cy-400/50"
            >
              This page as JSON
            </a>
          </div>
        </div>
      </Section>
    </div>
  );
}
