import Link from "next/link";
import { Section, Badge } from "@/components/ui";
import { chainByNetwork } from "@/lib/chain";
import { serverNetwork } from "@/lib/server-network";

export const metadata = { title: "How it works" };

const SKILLS = [
  ["coti-account-setup", "Create or import a wallet and derive the AES key that powers garbled-circuit encryption."],
  ["coti-starter-grant", "One-click gas funding so a fresh agent is live without a faucet run."],
  ["coti-private-messaging", "End-to-end encrypted agent-to-agent messages on-chain, auto-chunked."],
  ["coti-private-erc20", "Fungible tokens with encrypted balances. Public routing, confidential amounts."],
  ["coti-private-nft", "ERC-721 collections with confidential ownership and transfers."],
  ["coti-smart-contracts", "Full Solidity lifecycle with COTI privacy primitives baked in."],
  ["coti-transaction-tools", "Debugging, event decoding, balance management, message signing."],
];

export default async function AboutPage() {
  const net = await serverNetwork();
  const chain = chainByNetwork[net];
  return (
    <div className="py-12">
      <Section kicker="How it works" title="A privacy layer you can actually build on">
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="card p-6">
            <h2 className="text-[17px] font-semibold">Garbled circuits, not zero-knowledge</h2>
            <p className="mt-2.5 text-[13px] leading-relaxed text-white/50">
              COTI runs computation over ciphertext in a multi-party network. A contract can add two
              encrypted balances without any node learning either one. That is different from a rollup
              that hides state behind a proof, and different again from a chain that just does not
              publish data.
            </p>
            <p className="mt-2.5 text-[13px] leading-relaxed text-white/50">
              The trade-off is real and worth stating: you are trusting the network operator, the
              consensus and the precompile implementation. Solidity cannot re-prove MPC soundness
              on-chain. COTI says so in its own interface docs, and so do we.
            </p>
          </div>

          <div className="card p-6">
            <h2 className="text-[17px] font-semibold">Your key, your browser</h2>
            <p className="mt-2.5 text-[13px] leading-relaxed text-white/50">
              To read your own encrypted state you need an AES key. Your wallet signs an RSA public
              key, the on-chain onboarding contract returns the AES key sealed to it, and the SDK
              unwraps it locally. VEILPAD caches it in your browser so you sign once.
            </p>
            <p className="mt-2.5 text-[13px] leading-relaxed text-white/50">
              It never reaches our server. Every decrypt on this site - your balance, your inbox -
              happens on your machine. We could not read your messages if you asked us to.
            </p>
          </div>
        </div>

        <div className="card mt-3 p-6">
          <h2 className="text-[17px] font-semibold">What VEILPAD adds on top</h2>
          <div className="mt-4 grid gap-5 md:grid-cols-3">
            <div>
              <Badge tone="veil">Launchpad</Badge>
              <p className="mt-2 text-[13px] leading-relaxed text-white/50">
                A PrivateERC20 plus a bonding curve deploy together. The curve fills, graduates, and
                seeds a VeilSwap pair with its whole reserve, and the LP is locked in the curve.
              </p>
            </div>
            <div>
              <Badge tone="cy">Agents</Badge>
              <p className="mt-2 text-[13px] leading-relaxed text-white/50">
                Not chatbots. Durable memory, a multi-step tool loop against live chain and market
                data, signable action cards, and a heartbeat so they can speak first.
              </p>
            </div>
            <div>
              <Badge tone="mint">Custody</Badge>
              <p className="mt-2 text-[13px] leading-relaxed text-white/50">
                Agents propose; wallets execute. Nothing on this site can move your funds without a
                signature you gave for that specific transaction.
              </p>
            </div>
          </div>
        </div>

        <div className="card mt-3 p-6">
          <h2 className="text-[17px] font-semibold">Built on the COTI agent skill stack</h2>
          <p className="mt-1.5 text-[13px] text-white/45">
            These are the primitives VEILPAD sits on. Each is a real skill you can hand to your own
            agent outside this app.
          </p>
          <div className="mt-4 space-y-2">
            {SKILLS.map(([name, body]) => (
              <div key={name} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-white/[0.05] pb-2 last:border-0">
                <span className="mono text-[12px] font-medium text-veil-300">{name}</span>
                <span className="flex-1 text-[12px] leading-relaxed text-white/45">{body}</span>
              </div>
            ))}
          </div>
          <a
            href="https://github.com/coti-io/coti-skills"
            target="_blank"
            rel="noreferrer"
            className="mt-4 inline-block text-[12px] font-semibold text-cy-300 hover:underline"
          >
            github.com/coti-io/coti-skills ↗
          </a>
        </div>

        <div className="card mt-3 p-6">
          <h2 className="text-[17px] font-semibold">This deployment</h2>
          <div className="mt-3 grid gap-x-8 gap-y-2 sm:grid-cols-2">
            {[
              ["Network", chain.name + " (" + net + ")"],
              ["Chain ID", String(chain.id)],
              ["RPC", chain.rpcUrls.default.http[0]],
              ["Explorer", chain.blockExplorers.default.url],
            ].map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-3 text-[12px]">
                <span className="text-white/35">{k}</span>
                <span className="mono truncate text-white/65">{v}</span>
              </div>
            ))}
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link
              href="/launch"
              className="rounded-xl bg-gradient-to-r from-veil-500 to-cy-500 px-4 py-2.5 text-[13px] font-semibold text-white transition hover:brightness-110"
            >
              Launch something
            </Link>
            <Link
              href="/agents"
              className="rounded-xl border border-white/12 px-4 py-2.5 text-[13px] font-semibold transition hover:border-veil-400/50"
            >
              Talk to an agent
            </Link>
          </div>
        </div>
      </Section>
    </div>
  );
}
