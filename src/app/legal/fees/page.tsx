import Link from "next/link";
import type { Metadata } from "next";
import { masterTable } from "@/lib/master";
import { Badge } from "@/components/ui";
import { chainByNetwork } from "@/lib/chain";
import { serverNetwork } from "@/lib/server-network";

export const metadata: Metadata = {
  title: "Fees",
  description: "Every fee DEVOXPAD charges, read from the deployed contracts.",
};

export const dynamic = "force-dynamic";

interface FeeBlock {
  currency: string;
  launch: { amount: string; unit: string; paidTo: string; when: string; contract: string };
  curveTrade: { bps: number; percent: number; paidTo: string; when: string; note: string };
  swap: { bps: number; percent: number; paidTo: string; when: string; note: string };
  portal: { bps: number; percent: number; paidTo: string; when: string; note: string };
  profileClaim: { amount: string; unit: string; paidTo: string };
  agentRegistration: { amount: string; unit: string; paidTo: string };
  messaging: { amount: string; unit: string; note: string };
  graduation: { amount: string; unit: string; note: string };
  notCharged: string[];
  gasNotes: string[];
}

/**
 * The fee schedule.
 *
 * Every number here is read off the deployed contracts by
 * `contracts/scripts/fees.ts` and written into the master table, so this page
 * cannot drift from what the chain actually charges. If a value looks wrong,
 * the contract is the thing to check, not this file.
 */
export default async function FeesPage() {
  const net = await serverNetwork();
  const chain = chainByNetwork[net];
  const table = masterTable();
  const fees = table?.fees as unknown as FeeBlock | undefined;

  if (!fees) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-20 text-center sm:px-6">
        <h1 className="text-2xl font-bold">Fees</h1>
        <p className="mt-2 text-[14px] text-white/45">
          The fee schedule is generated from the deployed contracts and is not available on this
          network yet.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-devox-400">
        Legal
      </div>
      <h1 className="text-3xl font-bold tracking-tight">Fees</h1>
      <p className="mt-2 text-[15px] leading-relaxed text-white/50">
        Every number on this page is read directly from the contracts deployed on {chain.name}.
        Nothing here is a policy statement that a contract might quietly contradict.
      </p>

      <section className="mt-10">
        <h2 className="text-xl font-semibold tracking-tight">Protocol fees</h2>
        <div className="mt-4 overflow-x-auto rounded-xl border border-white/[0.08]">
          <table className="w-full min-w-[540px] text-left text-[13px]">
            <thead>
              <tr className="border-b border-white/[0.08] bg-white/[0.02]">
                {["Action", "Fee", "Paid to", "When"].map((h) => (
                  <th
                    key={h}
                    className="px-3.5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-white/40"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <FeeRow
                action="Launch a token"
                fee={fees.launch.amount + " " + fees.launch.unit}
                paidTo={fees.launch.paidTo}
                when={fees.launch.when}
              />
              <FeeRow
                action="Trade on a bonding curve"
                fee={fees.curveTrade.percent + "%"}
                paidTo={fees.curveTrade.paidTo}
                when={fees.curveTrade.when}
              />
              <FeeRow
                action="Swap on DevoxSwap"
                fee={fees.swap.percent + "%"}
                paidTo={fees.swap.paidTo}
                when={fees.swap.when}
              />
              <FeeRow
                action="Portal in or out"
                fee="0%"
                paidTo="nobody"
                when={fees.portal.when}
              />
              <FeeRow
                action="Graduate a launch"
                fee={fees.graduation.amount + " " + fees.graduation.unit}
                paidTo="nobody"
                when="once, when the curve fills"
              />
              <FeeRow
                action="Claim a handle"
                fee={fees.profileClaim.amount + " " + fees.profileClaim.unit}
                paidTo={fees.profileClaim.paidTo}
                when="once"
              />
              <FeeRow
                action="Register an agent"
                fee={fees.agentRegistration.amount + " " + fees.agentRegistration.unit}
                paidTo={fees.agentRegistration.paidTo}
                when="once"
              />
              <FeeRow
                action="Send an encrypted message"
                fee={fees.messaging.amount + " " + fees.messaging.unit}
                paidTo="nobody"
                when="never"
              />
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-xl font-semibold tracking-tight">The three that matter</h2>

        <div className="mt-4 space-y-3">
          <Detail
            title="1% on the bonding curve"
            badge="to the creator"
            tone="devox"
            body={fees.curveTrade.note}
            extra="Charged on the way in and on the way out. A creator can sweep what has accrued at any time, and graduation pays out whatever is outstanding before it seeds the pair."
          />
          <Detail
            title={fees.swap.percent + "% on every swap"}
            badge="to liquidity providers"
            tone="cy"
            body={fees.swap.note}
            extra="The protocol takes no cut of this. It is the standard constant-product fee, kept inside the pair rather than skimmed out of it."
          />
          <Detail
            title="Nothing to cross the portal"
            badge="no fee"
            tone="mint"
            body={fees.portal.note}
            extra="Wrapping and unwrapping are one to one, in both directions, forever. Value that crossed into privacy can always come back out."
          />
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-xl font-semibold tracking-tight">What is never charged</h2>
        <ul className="mt-3 space-y-1.5">
          {fees.notCharged.map((n) => (
            <li key={n} className="flex gap-2.5 text-[14px] leading-[1.7] text-white/65">
              <span className="mt-[9px] size-1 shrink-0 rounded-full bg-mint-400/70" />
              <span>{n}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-10">
        <h2 className="text-xl font-semibold tracking-tight">Gas is separate</h2>
        <p className="mt-2 text-[14px] leading-[1.7] text-white/65">
          Protocol fees are not the whole cost. COTI charges gas like any EVM chain, and MPC
          operations on encrypted balances cost considerably more than ordinary storage writes.
          Budget for it.
        </p>
        <ul className="mt-3 space-y-1.5">
          {fees.gasNotes.map((n) => (
            <li key={n} className="flex gap-2.5 text-[14px] leading-[1.7] text-white/65">
              <span className="mt-[9px] size-1 shrink-0 rounded-full bg-amber-400/70" />
              <span>{n}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-10 rounded-xl border border-white/[0.08] bg-white/[0.02] p-5">
        <h2 className="text-[15px] font-semibold">Can these change?</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-white/55">
          The launch fee, the handle fee and the agent registration fee are owner-tunable on the
          factory and the registries, because what makes sense on a testnet with a ten-COTI faucet is
          not what makes sense on mainnet. The curve fee and the swap fee are compiled into the
          contracts and cannot be changed on a deployed curve or pair.
        </p>
        <p className="mt-2 text-[13px] leading-relaxed text-white/55">
          A curve you already bought into keeps the parameters it was deployed with. Retuning the
          factory affects future launches only.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href="/docs/contracts"
            className="rounded-xl border border-white/12 px-4 py-2 text-[13px] font-semibold transition hover:border-devox-400/50"
          >
            Contracts
          </Link>
          <a
            href="/api/config?section=fees"
            className="rounded-xl border border-white/12 px-4 py-2 text-[13px] font-semibold transition hover:border-cy-400/50"
          >
            This page as JSON
          </a>
        </div>
      </section>

      <p className="mt-8 text-[11px] leading-relaxed text-white/25">
        Generated from {chain.name}, chain {chain.id}. Run{" "}
        <span className="mono">npm run contracts:fees</span> to regenerate after changing anything on
        chain.
      </p>
    </div>
  );
}

function FeeRow({
  action,
  fee,
  paidTo,
  when,
}: {
  action: string;
  fee: string;
  paidTo: string;
  when: string;
}) {
  const free = fee.startsWith("0") && !fee.startsWith("0.0") ? true : Number(fee.replace(/[^0-9.]/g, "")) === 0;
  return (
    <tr className="border-b border-white/[0.05] last:border-0">
      <td className="px-3.5 py-2.5 align-top font-medium text-white/80">{action}</td>
      <td className={"mono px-3.5 py-2.5 align-top " + (free ? "text-mint-400" : "text-white/80")}>
        {free ? "free" : fee}
      </td>
      <td className="px-3.5 py-2.5 align-top text-white/55">{paidTo}</td>
      <td className="px-3.5 py-2.5 align-top leading-relaxed text-white/45">{when}</td>
    </tr>
  );
}

function Detail({
  title,
  badge,
  tone,
  body,
  extra,
}: {
  title: string;
  badge: string;
  tone: "devox" | "cy" | "mint";
  body: string;
  extra: string;
}) {
  return (
    <div className="rounded-xl border border-white/[0.08] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[15px] font-semibold">{title}</h3>
        <Badge tone={tone}>{badge}</Badge>
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-white/55">{body}</p>
      <p className="mt-1.5 text-[13px] leading-relaxed text-white/45">{extra}</p>
    </div>
  );
}
