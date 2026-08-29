"use client";

import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { mainnet, sepolia } from "viem/chains";
import { cotiMainnet, cotiTestnet } from "./chain";

/**
 * Injected-only on purpose: COTI onboarding needs the wallet to sign an RSA
 * public key for the AES handshake, and MetaMask-class injected providers are
 * the path that actually works today.
 */
/**
 * Browser reads go through our own origin, not straight to COTI.
 *
 * COTI's mainnet RPC answers with `Access-Control-Allow-Origin` sent twice,
 * which a browser reads as the single invalid value "*, *" and blocks. Every
 * read from the page therefore failed while the identical call from a script
 * succeeded - the symptom was pages showing "nothing here" instead of an error.
 *
 * `/api/rpc/<network>` forwards to the same node from the server, where CORS
 * does not apply. If COTI fixes the header this can go back to a direct URL;
 * until then this is what makes the app work in a browser at all.
 */
const proxied = (net: "mainnet" | "testnet") => "/api/rpc/" + net;

export const wagmiConfig = createConfig({
  // Ethereum is here because the cross-chain bridge signs its outbound leg
  // there. Without it wagmi cannot switch the wallet and the transfer
  // would have to happen on someone else's site again.
  chains: [cotiTestnet, cotiMainnet, sepolia, mainnet],
  connectors: [injected({ shimDisconnect: true })],

  /**
   * EIP-6963 discovery. Default true in wagmi, stated explicitly because the
   * wallet picker depends on it: each extension announces itself with a name
   * and an icon instead of the old free-for-all over `window.ethereum`, which
   * is what lets someone with three wallets installed choose between them.
   */
  multiInjectedProviderDiscovery: true,
  transports: {
    [cotiTestnet.id]: http(proxied("testnet")),
    [cotiMainnet.id]: http(proxied("mainnet")),
    [sepolia.id]: http(),
    [mainnet.id]: http(),
  },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
