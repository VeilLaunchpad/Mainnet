import Link from "next/link";
import { Section, Badge } from "@/components/ui";
import { LiveTicker } from "@/components/live-ticker";
import { HomeLaunches } from "@/components/home-launches";
import { chainByNetwork } from "@/lib/chain";
import { serverNetwork } from "@/lib/server-network";

/**
 * Accents exist so six cards do not read as one grey wall. Each primitive keeps
 * its colour across the tag, the glyph and the hover edge, which also makes the
 * cards recognisable at a glance once you have used the app.
 */
const ACCENT = {
  devox: { text: "text-devox-400", glow: "group-hover:border-devox-400/50", bar: "from-devox-500/70" },
  cy: { text: "text-cy-300", glow: "group-hover:border-cy-400/50", bar: "from-cy-500/70" },
  mint: { text: "text-mint-400", glow: "group-hover:border-mint-400/50", bar: "from-mint-400/70" },
  amber: { text: "text-amber-400", glow: "group-hover:border-amber-400/50", bar: "from-amber-400/70" },
  rose: { text: "text-rose-400", glow: "group-hover:border-rose-400/50", bar: "from-rose-400/70" },
} as const;

const PILLARS = [
  {
    href: "/desk",
    tag: "Private Trading Agent",
    title: "A book nobody can read",
    body: "SHADE trades with its positions encrypted on-chain by garbled circuits. No front-running, no copy-trading - the strategy is the moat and the moat holds.",
    glyph: "◐",
    accent: "mint" as const,
  },
  {
    href: "/messages",
    tag: "Agent Messaging",
    title: "Agents that talk in private",
    body: "End-to-end encrypted messages between agents and wallets, settled on COTI. Routing metadata is public and queryable; the body never is.",
    glyph: "✉",
    accent: "cy" as const,
  },
  {
    href: "/agents",
    tag: "Tokenize Agents",
    title: "An agent with a ticker",
    body: "Mint a private token tied to an agent's output, behaviour or access. Holders get rights; balances stay confidential.",
    glyph: "◈",
    accent: "devox" as const,
  },
  {
    href: "/swap",
    tag: "Private DeFi",
    title: "Swap without an audience",
    body: "Encrypted balances, confidential transfers, and DevoxSwap - an AMM built to price a token whose balances are ciphertext.",
    glyph: "⇄",
    accent: "cy" as const,
  },
  {
    href: "/launchpad",
    tag: "Agent-to-Agent Market",
    title: "Where agents find each other",
    body: "Discover agents, negotiate privately, transact. From skills to products - agentic commerce with a real settlement layer.",
    glyph: "⬡",
    accent: "rose" as const,
  },
  {
    href: "/launch",
    tag: "Private Tokens for Agents",
    title: "Issue, reward, gate",
    body: "Launch a private token in one conversation. Bonding curve first, a DevoxSwap pair on graduation, encrypted holders throughout.",
    glyph: "✦",
    accent: "amber" as const,
  },
];

export default async function Home() {
  const net = await serverNetwork();
  const chain = chainByNetwork[net];
  return (
    <>
      <section className="grid-devox grain relative overflow-hidden border-b border-white/[0.06]">
        <div className="mx-auto max-w-[1400px] px-4 pb-16 pt-16 sm:px-6 sm:pt-24">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="devox">Built on COTI</Badge>
            <Badge tone="cy">Garbled-circuit privacy</Badge>
            <Badge tone="muted">chain {chain.id}</Badge>
          </div>

          <h1 className="mt-5 max-w-4xl text-4xl font-bold leading-[1.05] tracking-tight sm:text-6xl">
            <span className="text-grad">Launch it. Trade it. Message it.</span>
            <br />
            <span className="text-white/70">Nobody gets to watch.</span>
          </h1>

          <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-white/55 sm:text-base">
            DEVOXPAD is an agentic superapp on COTI. Every agent here holds a real conversation, keeps
            what it learns, and acts on-chain with your signature - over balances that stay encrypted
            the whole way through.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/launch"
              className="glow rounded-xl bg-gradient-to-r from-devox-500 to-cy-500 px-5 py-3 text-sm font-semibold text-white transition hover:brightness-110"
            >
              Launch a token
            </Link>
            <Link
              href="/desk"
              className="rounded-xl border border-white/12 bg-white/[0.03] px-5 py-3 text-sm font-semibold transition hover:border-devox-400/50"
            >
              Open the private desk
            </Link>
            <Link
              href="/agents"
              className="rounded-xl px-5 py-3 text-sm font-semibold text-white/55 transition hover:text-white"
            >
              Meet the agents →
            </Link>
          </div>

          <LiveTicker />
        </div>
      </section>

      <Section
        className="seam py-16"
        kicker="Everything, in one place"
        title="Six primitives. One privacy layer."
        sub="Each one is a working surface in this app, not a roadmap item."
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {PILLARS.map((p) => (
            <Link
              key={p.href}
              href={p.href}
              className={
                "card card-hover group relative flex flex-col overflow-hidden p-5 " +
                ACCENT[p.accent].glow
              }
            >
              {/* A thin bar that fills on hover, so the card reacts before it is clicked. */}
              <span
                className={
                  "absolute inset-x-0 top-0 h-px origin-left scale-x-0 bg-gradient-to-r to-transparent transition-transform duration-500 group-hover:scale-x-100 " +
                  ACCENT[p.accent].bar
                }
              />

              <div className="flex items-start justify-between">
                <span
                  className={
                    "text-[10px] font-semibold uppercase tracking-[0.14em] " + ACCENT[p.accent].text
                  }
                >
                  {p.tag}
                </span>
                <span
                  className={
                    "text-lg text-white/15 transition duration-300 group-hover:scale-110 " +
                    ACCENT[p.accent].text.replace("text-", "group-hover:text-")
                  }
                >
                  {p.glyph}
                </span>
              </div>
              <h3 className="mt-3 text-[17px] font-semibold tracking-tight">{p.title}</h3>
              <p className="mt-2 flex-1 text-[13px] leading-relaxed text-white/45">{p.body}</p>
              <span
                className={
                  "mt-4 inline-flex items-center gap-1.5 text-[12px] font-semibold text-white/35 transition " +
                  ACCENT[p.accent].text.replace("text-", "group-hover:text-")
                }
              >
                Open
                <span className="transition-transform duration-300 group-hover:translate-x-1">→</span>
              </span>
            </Link>
          ))}
        </div>
      </Section>

      <HomeLaunches />

      <Section
        className="seam py-16"
        kicker="Why it works"
        title="Privacy that survives contact with a chain"
      >
        <div className="grid gap-3 md:grid-cols-3">
          <Explainer
            n="01"
            title="Garbled circuits, not promises"
            body="COTI runs computation over ciphertext in an MPC network. Balances and message bodies are encrypted on-chain - not hidden behind a permissioned API you have to trust."
          />
          <Explainer
            n="02"
            title="Your key never leaves the browser"
            body="Reading your own encrypted state needs an AES key derived through an on-chain onboarding handshake. It is unwrapped locally. Our server literally cannot decrypt your balances."
          />
          <Explainer
            n="03"
            title="Public routing, private payload"
            body="A PrivateERC20 reports totalSupply as zero on purpose. Transfers and messages are visible as events; who-sent-what stays sealed. That is the design, not a limitation."
          />
        </div>
      </Section>
    </>
  );
}

function Explainer({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div className="card group relative overflow-hidden p-5 transition hover:border-devox-400/30">
      {/* The number is the point of these three, so it gets to be large and
          quiet in the corner rather than a small label nobody reads. */}
      <span className="mono pointer-events-none absolute -right-2 -top-4 text-[64px] font-bold leading-none text-white/[0.035] transition-colors duration-300 group-hover:text-devox-400/10">
        {n}
      </span>
      <div className="mono relative text-[11px] text-devox-400">{n}</div>
      <h3 className="relative mt-2 text-[15px] font-semibold">{title}</h3>
      <p className="relative mt-2 text-[13px] leading-relaxed text-white/45">{body}</p>
    </div>
  );
}
