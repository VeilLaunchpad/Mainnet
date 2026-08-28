import Link from "next/link";
import { VeilMark } from "./nav";
import { chainByNetwork } from "@/lib/chain";
import { serverNetwork } from "@/lib/server-network";

export async function Footer() {
  const net = await serverNetwork();
  const chain = chainByNetwork[net];
  return (
    <footer className="mt-24 border-t border-white/[0.06]">
      <div className="mx-auto grid max-w-[1400px] gap-8 px-4 py-12 sm:px-6 md:grid-cols-3 lg:grid-cols-5">
        <div>
          <div className="flex items-center gap-2">
            <VeilMark size={18} />
            <span className="text-sm font-bold">
              VEIL<span className="text-veil-400">PAD</span>
            </span>
          </div>
          <p className="mt-3 max-w-xs text-[13px] leading-relaxed text-white/45">
            The agentic privacy superapp on COTI. Launch it, trade it, message it, bridge it - with
            balances that stay yours.
          </p>

          <a
            href="https://x.com/LaunchOnVeil"
            target="_blank"
            rel="noreferrer"
            className="mt-4 inline-flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-[12px] font-medium text-white/60 transition hover:border-cy-400/45 hover:text-white"
          >
            <XMark />
            @LaunchOnVeil
          </a>
        </div>

        <FooterCol
          title="Build"
          links={[
            { href: "/launch", label: "Launch a token" },
            { href: "/agents/new", label: "Create an agent" },
            { href: "/launchpad", label: "Browse launches" },
            { href: "/desk", label: "Private desk" },
            { href: "/swap", label: "Swap" },
            { href: "/portal", label: "Privacy portal" },
          ]}
        />
        <FooterCol
          title="Network"
          links={[
            { href: "/status", label: "Network status" },
            { href: "/veil-contracts", label: "Contracts" },
            { href: "/faucet", label: "Testnet faucet" },
            { href: "/bridge", label: "VEIL Bridge" },
            { href: "/skills", label: "VEIL Skills" },
            { href: "/portal", label: "Privacy portal" },
            {
              href: chain.blockExplorers.default.url,
              label: "CotiScan",
              external: true,
            },
          ]}
        />
        <FooterCol
          title="Developers"
          links={[
            { href: "/docs", label: "Documentation" },
            { href: "/docs/sdk", label: "SDK" },
            { href: "/docs/api", label: "API reference" },
            { href: "/docs/indexer", label: "Indexer" },
            { href: "/veil-contracts", label: "Contract addresses" },
          ]}
        />
        <FooterCol
          title="App"
          links={[
            { href: "/dashboard", label: "Dashboard" },
            { href: "/messages", label: "Encrypted inbox" },
            { href: "/legal/fees", label: "Fees" },
            { href: "/docs/faq", label: "FAQ" },
            { href: "/about", label: "How it works" },
          ]}
        />
      </div>

      <div className="border-t border-white/[0.06] px-4 py-5 sm:px-6">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-3 text-[11px] text-white/35">
          <span>
            Running on {chain.name} · chain {chain.id} · {net}
          </span>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="mono">Balances encrypted with COTI garbled circuits</span>
            <a
              href={chain.blockExplorers.default.url}
              target="_blank"
              rel="noreferrer"
              className="transition hover:text-white/60"
            >
              Block explorer
            </a>
            <a
              href="https://x.com/LaunchOnVeil"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 transition hover:text-white/60"
            >
              <XMark />
              @LaunchOnVeil
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}

/** The X logo, drawn rather than fetched so the footer pulls in no assets. */
function XMark() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function FooterCol({
  title,
  links,
}: {
  title: string;
  links: { href: string; label: string; external?: boolean }[];
}) {
  return (
    <div>
      <h4 className="text-[11px] font-semibold uppercase tracking-wider text-white/35">{title}</h4>
      <ul className="mt-3 space-y-2">
        {links.map((l) => (
          <li key={l.label}>
            {l.external ? (
              <a href={l.href} target="_blank" rel="noreferrer" className="text-[13px] text-white/60 transition hover:text-veil-300">
                {l.label}
              </a>
            ) : (
              <Link href={l.href} className="text-[13px] text-white/60 transition hover:text-veil-300">
                {l.label}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
