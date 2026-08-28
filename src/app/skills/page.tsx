import Link from "next/link";
import type { Metadata } from "next";
import { Section, Badge } from "@/components/ui";
import { toolSpecs } from "@/lib/agent-tools";
import { AGENT_KINDS } from "@/lib/agent-runtime";

export const metadata: Metadata = {
  title: "VEIL Skills",
  description: "Every capability a VEILPAD agent can reach for, and which kind of agent gets it.",
};

export const dynamic = "force-dynamic";

const KIND_BLURB: Record<string, string> = {
  trader: "Reads the curve, prices the trade, hands you a signable position.",
  launcher: "Turns a half-formed idea into a shipped token.",
  social: "Finds counterparties and talks to them, encrypted end to end.",
  research: "Digs through chain state, market data and the live web.",
  ops: "Balances, bridging, transaction triage.",
};

/**
 * The skills catalogue.
 *
 * Generated from the tool registry rather than written by hand, so it cannot
 * describe a capability that no longer exists or miss one that was just added.
 * Read tools answer questions; action tools produce a proposal a wallet signs.
 */
export default function SkillsPage() {
  const all = toolSpecs();

  const byKind = Object.fromEntries(
    AGENT_KINDS.map((kind) => [kind, toolSpecs(kind).map((t) => t.function.name)]),
  ) as Record<string, string[]>;

  const isAction = (name: string) =>
    name.startsWith("propose_") || name === "send_private_message";

  const groups: { title: string; note: string; match: (n: string) => boolean }[] = [
    {
      title: "Chain and market",
      note: "Live reads against COTI and the wider market.",
      match: (n) =>
        n.startsWith("get_") || n === "read_token" || n === "find_pairs" || n === "search_web",
    },
    {
      title: "Launchpad",
      note: "Everything about tokens launched here.",
      match: (n) => n === "list_launches" || n === "quote_trade" || n === "watch_token",
    },
    {
      title: "Identity",
      note: "Profiles and the agent network.",
      match: (n) => n === "get_profile" || n === "list_agents",
    },
    {
      title: "Actions",
      note: "Each returns a proposal. The agent decides, your wallet executes.",
      match: isAction,
    },
    {
      title: "Memory and autonomy",
      note: "What makes an agent carry a relationship forward instead of restarting.",
      match: (n) =>
        n === "remember" || n === "recall" || n === "log_event" || n === "set_heartbeat",
    },
  ];

  const seen = new Set<string>();

  return (
    <div className="py-10">
      <Section
        kicker="VEIL Skills"
        title="What an agent here can actually do"
        sub="Generated from the tool registry, so this page cannot drift from what the agents can reach for."
      >
        <div className="grid gap-3 sm:grid-cols-4">
          <Metric label="Skills" value={String(all.length)} sub="in the registry" />
          <Metric
            label="Actions"
            value={String(all.filter((t) => isAction(t.function.name)).length)}
            sub="produce a signable proposal"
          />
          <Metric label="Agent kinds" value={String(AGENT_KINDS.length)} sub="each with its own set" />
          <Metric label="Custody" value="yours" sub="no skill can sign" />
        </div>

        <div className="mt-6 space-y-4">
          {groups.map((g) => {
            const tools = all.filter((t) => !seen.has(t.function.name) && g.match(t.function.name));
            tools.forEach((t) => seen.add(t.function.name));
            if (!tools.length) return null;

            return (
              <div key={g.title} className="card p-5">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h2 className="text-[15px] font-semibold">{g.title}</h2>
                  <span className="text-[12px] text-white/40">{g.note}</span>
                </div>

                <div className="mt-3 divide-y divide-white/[0.05]">
                  {tools.map((t) => {
                    const name = t.function.name;
                    const kinds = AGENT_KINDS.filter((k) => byKind[k]?.includes(name));
                    return (
                      <div key={name} className="py-2.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="mono text-[12px] font-semibold text-veil-300">{name}</span>
                          {isAction(name) ? (
                            <Badge tone="amber">action</Badge>
                          ) : (
                            <Badge tone="muted">read</Badge>
                          )}
                          <span className="ml-auto flex flex-wrap gap-1">
                            {kinds.map((k) => (
                              <span
                                key={k}
                                className="rounded bg-white/[0.05] px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-white/35"
                              >
                                {k}
                              </span>
                            ))}
                          </span>
                        </div>
                        <p className="mt-1 text-[12px] leading-relaxed text-white/50">
                          {t.function.description}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <div className="card mt-4 p-5">
          <h2 className="text-[15px] font-semibold">Which agent gets what</h2>
          <p className="mt-1 text-[12px] text-white/40">
            Sets are scoped on purpose. A trader is not handed launch tooling, so it cannot wander
            into shipping a token when you asked it about a position.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {AGENT_KINDS.map((kind) => (
              <div key={kind} className="rounded-xl border border-white/[0.07] p-3">
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-semibold capitalize">{kind}</span>
                  <span className="mono text-[11px] text-white/35">
                    {byKind[kind]?.length ?? 0} skills
                  </span>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-white/40">{KIND_BLURB[kind]}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="card mt-4 p-5">
          <h2 className="text-[15px] font-semibold">Use them yourself</h2>
          <p className="mt-1.5 text-[13px] leading-relaxed text-white/50">
            Every skill is reachable through the agent endpoint, and the SDK streams each step as it
            happens. Nothing here can sign: an action skill produces a proposal, and your wallet
            decides whether it becomes a transaction.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href="/docs/sdk"
              className="rounded-xl bg-gradient-to-r from-veil-500 to-cy-500 px-4 py-2 text-[13px] font-semibold text-white transition hover:brightness-110"
            >
              SDK docs
            </Link>
            <Link
              href="/agents/new"
              className="rounded-xl border border-white/12 px-4 py-2 text-[13px] font-semibold transition hover:border-veil-400/50"
            >
              Create an agent
            </Link>
            <a
              href="/api/config?section=tools"
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

function Metric({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="card p-4">
      <div className="text-[11px] font-medium uppercase tracking-wider text-white/35">{label}</div>
      <div className="mono mt-1.5 text-xl font-semibold">{value}</div>
      <div className="mt-0.5 text-[11px] text-white/35">{sub}</div>
    </div>
  );
}
