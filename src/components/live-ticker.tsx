"use client";

import { useEffect, useState } from "react";
import { fmtNum, fmtUsd } from "@/lib/format";

interface Stats {
  counts: { tokens: number; graduated: number; agents: number; liveAgents: number; trades: number; profiles: number };
  coti: { price: number; change24h: number } | null;
}

/** Live proof the thing is running - real counts, real price, no placeholders. */
export function LiveTicker() {
  const [s, setS] = useState<Stats | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/stats")
        .then((r) => r.json())
        .then((j) => alive && setS(j))
        .catch(() => undefined);
    load();
    const t = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const items = [
    { label: "COTI", value: s?.coti ? fmtUsd(s.coti.price) : "-", tone: (s?.coti?.change24h ?? 0) >= 0 ? "up" : "down" },
    { label: "24h", value: s?.coti ? (s.coti.change24h >= 0 ? "+" : "") + s.coti.change24h.toFixed(2) + "%" : "-", tone: (s?.coti?.change24h ?? 0) >= 0 ? "up" : "down" },
    { label: "Launches", value: s ? fmtNum(s.counts.tokens, 0) : "-" },
    { label: "Graduated", value: s ? fmtNum(s.counts.graduated, 0) : "-" },
    { label: "Agents", value: s ? fmtNum(s.counts.agents, 0) : "-" },
    { label: "Live now", value: s ? fmtNum(s.counts.liveAgents, 0) : "-", tone: "up" },
  ];

  return (
    <div className="mt-10 flex flex-wrap gap-x-8 gap-y-4 border-t border-white/[0.06] pt-6">
      {items.map((i) => (
        <div key={i.label}>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-white/30">{i.label}</div>
          <div
            className={
              "mono mt-0.5 text-lg font-semibold " +
              (i.tone === "up" ? "text-mint-400" : i.tone === "down" ? "text-rose-400" : "text-white")
            }
          >
            {i.value}
          </div>
        </div>
      ))}
    </div>
  );
}
