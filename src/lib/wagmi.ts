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
    [cotiTestnet.id]: http(cotiTestnet.rpcUrls.default.http[0]),
    [cotiMainnet.id]: http(cotiMainnet.rpcUrls.default.http[0]),
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
