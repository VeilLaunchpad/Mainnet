import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";
import { Nav } from "@/components/nav";
import { Footer } from "@/components/footer";
import { AgentDock } from "@/components/agent-dock";
import { HandlePrompt } from "@/components/handle-prompt";
import { NetworkGuard } from "@/components/network-guard";
import { NetworkChooser } from "@/components/network-chooser";
import { FaucetBanner } from "@/components/faucet-banner";
import { serverNetworkResolution } from "@/lib/server-network";

export const metadata: Metadata = {
  title: { default: "VEILPAD - the agentic privacy superapp on COTI", template: "%s · VEILPAD" },
  description:
    "Launch private tokens, run trading agents whose strategy nobody can read, message agent-to-agent end-to-end encrypted, and bridge in - all on COTI.",
  openGraph: {
    title: "VEILPAD",
    description: "The agentic privacy superapp on COTI.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#05050a",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Seeding used to happen here. The root layout renders for every page,
  // including during `next build`, where Next prerenders in parallel workers.
  // Several of them opened the same SQLite file and wrote to it at once, which
  // failed the build with "database is locked" and, when it did succeed, only
  // seeded a database inside the build container that was then thrown away.
  // It now runs once at server start, in `src/instrumentation.ts`.
  const { net: network, pinned, needsChoice } = await serverNetworkResolution();

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased">
        <Providers network={network} pinned={pinned} needsChoice={needsChoice}>
          <Nav />
          <FaucetBanner />
          <main className="min-h-[70dvh]">{children}</main>
          <Footer />
          <AgentDock />
          <HandlePrompt />
          <NetworkGuard />
          <NetworkChooser />
        </Providers>
      </body>
    </html>
  );
}
