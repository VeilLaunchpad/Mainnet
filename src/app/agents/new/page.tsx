"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import { Section, Badge } from "@/components/ui";
import { slugify } from "@/lib/format";

const KINDS = [
  { key: "trader", label: "Trader", body: "Watches the curve, forms a thesis, hands you signable positions. Strategy stays encrypted." },
  { key: "launcher", label: "Launcher", body: "Turns an idea into a shipped token: name, ticker, copy, transaction." },
  { key: "social", label: "Social", body: "Finds counterparties and negotiates over end-to-end encrypted on-chain messages." },
  { key: "research", label: "Research", body: "Digs through chain state, market data and the live web. Separates verified from inferred." },
  { key: "ops", label: "Ops", body: "Balances, bridging, transaction triage. Pedantic about addresses on purpose." },
];

const AUTONOMY = [
  { key: "advisory", label: "Advisory", body: "Reads and recommends. Proposes a transaction only when you ask." },
  { key: "approval", label: "Approval", body: "Proposes freely as signable cards. You sign. It never holds keys." },
  { key: "auto", label: "Auto", body: "Acts within its limits and reports every action. Needs a server signer." },
];

export default function NewAgentPage() {
  const router = useRouter();
  const { address } = useAccount();

  const [name, setName] = useState("");
  const [kind, setKind] = useState("trader");
  const [autonomy, setAutonomy] = useState("approval");
  /** Private by default. Publishing should be a decision, not an oversight. */
  const [visibility, setVisibility] = useState("private");
  const [tagline, setTagline] = useState("");
  const [persona, setPersona] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const slug = slugify(name);

  async function create() {
    if (!name.trim()) return setErr("Give it a name.");
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, slug, kind, autonomy, visibility, tagline, persona, owner: address || "" }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "could not create");
      router.push(j.url);
    } catch (e) {
      setErr(String((e as Error).message || e));
      setBusy(false);
    }
  }

  return (
    <div className="py-10">
      <Section
        kicker="New agent"
        title="Give it a brief. It does the rest."
        sub="The brief becomes its standing instruction - it shapes every conversation, not just the first one."
      >
        <div className="grid gap-3 lg:grid-cols-3">
          <div className="space-y-3 lg:col-span-2">
            <div className="card p-5">
              <label className="text-[12px] font-semibold text-white/70">Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="NOCTURNE"
                maxLength={32}
                className="mt-1.5 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5 text-[15px] outline-none transition placeholder:text-white/20 focus:border-devox-400/50"
              />
              {slug && <div className="mono mt-1.5 text-[11px] text-white/30">/agents/{slug}</div>}

              <label className="mt-4 block text-[12px] font-semibold text-white/70">Tagline</label>
              <input
                value={tagline}
                onChange={(e) => setTagline(e.target.value)}
                placeholder="Trades the night shift so you do not have to."
                maxLength={110}
                className="mt-1.5 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5 text-[14px] outline-none transition placeholder:text-white/20 focus:border-devox-400/50"
              />

              <label className="mt-4 block text-[12px] font-semibold text-white/70">
                Standing brief
                <span className="ml-1.5 font-normal text-white/30">
                  how it should think, what it cares about, what it must never do
                </span>
              </label>
              <textarea
                value={persona}
                onChange={(e) => setPersona(e.target.value)}
                rows={6}
                placeholder="Only touch launches past 40% on the curve. Never size above 5 COTI without asking. Tell me when a thesis is invalidated, not just when it works."
                className="mt-1.5 w-full resize-none rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5 text-[13px] leading-relaxed outline-none transition placeholder:text-white/20 focus:border-devox-400/50"
              />
            </div>

            <div className="card p-5">
              <h3 className="text-[13px] font-semibold">Kind</h3>
              <p className="mt-1 text-[11px] text-white/35">
                Decides which tools it gets. A trader does not get launch tooling.
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {KINDS.map((k) => (
                  <button
                    key={k.key}
                    onClick={() => setKind(k.key)}
                    className={
                      "rounded-xl border p-3 text-left transition " +
                      (kind === k.key
                        ? "border-devox-400/50 bg-devox-500/[0.09]"
                        : "border-white/10 hover:border-white/25")
                    }
                  >
                    <div className="text-[13px] font-semibold">{k.label}</div>
                    <div className="mt-0.5 text-[11px] leading-relaxed text-white/40">{k.body}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="card p-5">
              <h3 className="text-[13px] font-semibold">Who can see it</h3>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {[
                  {
                    key: "private",
                    label: "Private",
                    body: "Only this wallet. It will not appear on the agents page or in anyone else's list.",
                  },
                  {
                    key: "public",
                    label: "Public",
                    body: "Listed on the agents page for everyone. You still own it and only you can edit it.",
                  },
                ].map((v) => (
                  <button
                    key={v.key}
                    onClick={() => setVisibility(v.key)}
                    className={
                      "rounded-xl border p-3 text-left transition " +
                      (visibility === v.key
                        ? "border-devox-400/50 bg-devox-500/[0.09]"
                        : "border-white/10 hover:border-white/25")
                    }
                  >
                    <div className="text-[13px] font-semibold">{v.label}</div>
                    <div className="mt-0.5 text-[11px] leading-relaxed text-white/40">{v.body}</div>
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-white/30">
                You can change this later from the agent&apos;s own page.
              </p>
            </div>

            <div className="card p-5">
              <h3 className="text-[13px] font-semibold">Autonomy</h3>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                {AUTONOMY.map((k) => (
                  <button
                    key={k.key}
                    onClick={() => setAutonomy(k.key)}
                    className={
                      "rounded-xl border p-3 text-left transition " +
                      (autonomy === k.key
                        ? "border-cy-400/50 bg-cy-500/[0.09]"
                        : "border-white/10 hover:border-white/25")
                    }
                  >
                    <div className="text-[13px] font-semibold">{k.label}</div>
                    <div className="mt-0.5 text-[11px] leading-relaxed text-white/40">{k.body}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="card p-5">
              <h3 className="text-[13px] font-semibold">What you get</h3>
              <ul className="mt-3 space-y-2.5 text-[12px] leading-relaxed text-white/50">
                {[
                  "A page at /agents/" + (slug || "your-agent"),
                  "Durable memory that survives every session",
                  "Real tools: chain reads, market data, live web search",
                  "Signable action cards - it proposes, you sign",
                  "An optional heartbeat so it speaks first",
                ].map((f) => (
                  <li key={f} className="flex gap-2">
                    <span className="mt-[7px] size-1 shrink-0 rounded-full bg-devox-400/70" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </div>

            {!address && (
              <div className="card border-amber-400/25 bg-amber-400/[0.05] p-4">
                <Badge tone="amber">No wallet</Badge>
                <p className="mt-2 text-[12px] leading-relaxed text-white/55">
                  You can create it without connecting, but it will not be tied to you and you will not
                  be able to tokenize it.
                </p>
              </div>
            )}

            <button
              onClick={create}
              disabled={busy || !name.trim()}
              className="w-full rounded-xl bg-gradient-to-r from-devox-500 to-cy-500 py-3 text-[14px] font-semibold text-white transition hover:brightness-110 disabled:opacity-40"
            >
              {busy ? "Creating…" : "Create agent"}
            </button>
            {err && <div className="text-[12px] text-rose-300">{err}</div>}
          </div>
        </div>
      </Section>
    </div>
  );
}
