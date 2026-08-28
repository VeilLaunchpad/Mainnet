"use client";

import { useState, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { wagmiConfig } from "@/lib/wagmi";
import { BusyProvider } from "./busy";
import { ResultProvider } from "./result-modal";
import { NetworkProvider } from "./network-provider";
import type { CotiNetworkName } from "@/lib/chain";

export function Providers({
  children,
  network,
  pinned = false,
  needsChoice = false,
}: {
  children: ReactNode;
  /** Resolved on the server from the request, so the first render matches. */
  network?: CotiNetworkName;
  /** The hostname decided it, so switching means going to the other host. */
  pinned?: boolean;
  /** Nobody has said which network yet, so the apex should ask. */
  needsChoice?: boolean;
}) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 20_000, refetchOnWindowFocus: false, retry: 1 } },
      }),
  );

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={client}>
        <NetworkProvider initial={network} pinned={pinned} needsChoice={needsChoice}>
          <BusyProvider>
            <ResultProvider>{children}</ResultProvider>
          </BusyProvider>
        </NetworkProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
