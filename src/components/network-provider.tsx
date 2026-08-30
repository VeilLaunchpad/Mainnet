"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePublicClient } from "wagmi";
import {
  DEFAULT_NETWORK,
  NETWORK_COOKIE,
  chainByNetwork,
  isNetworkName,
  type CotiNetworkName,
} from "@/lib/chain";
import { addressesFor, type DevoxAddresses } from "@/lib/addresses";

/**
 * Which DEVOXPAD you are looking at.
 *
 * The app is one product deployed on two chains, so the network is a choice a
 * person makes at runtime rather than something baked into the build. Holding
 * it in context means a page reads `useNetwork()` instead of a module constant,
 * and the whole tree re-renders against the other chain's contracts when the
 * choice changes.
 *
 * The value is mirrored into a cookie because the server needs it too: API
 * routes, the indexer and server-rendered pages all resolve the same network
 * from the same request.
 */

interface NetworkContextValue {
  net: CotiNetworkName;
  setNet: (net: CotiNetworkName) => void;
  /** The hostname decided it. Switching in place is not available here. */
  pinned: boolean;
  /** Nobody has chosen yet, so the apex asks before assuming.  */
  needsChoice: boolean;
  /** Records the answer without a reload, for the chooser. */
  choose: (net: CotiNetworkName) => void;
  chain: (typeof chainByNetwork)[CotiNetworkName];
  addresses: DevoxAddresses;
  isMainnet: boolean;
  /** False until the stored preference has been read, so nothing flashes. */
  ready: boolean;
}

const NetworkContext = createContext<NetworkContextValue | null>(null);

const STORAGE_KEY = "devoxpad.network";

export function NetworkProvider({
  initial,
  pinned = false,
  needsChoice = false,
  children,
}: {
  initial?: CotiNetworkName;
  pinned?: boolean;
  needsChoice?: boolean;
  children: ReactNode;
}) {
  /**
   * Starts from what the server already resolved for this request, so the first
   * client render matches the HTML exactly. Reading localStorage here instead
   * would hydrate against a different network and React would discard the tree.
   */
  const [net, setNetState] = useState<CotiNetworkName>(initial ?? DEFAULT_NETWORK);
  const [ready, setReady] = useState(false);
  const [unanswered, setUnanswered] = useState(needsChoice);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      // Storage can be disabled entirely; the cookie still carries the choice.
    }
    // A pinned host is not negotiable, so a stored preference is ignored there.
    if (!pinned && isNetworkName(stored)) {
      setUnanswered(false);
      if (stored !== net) {
        setNetState(stored);
        writeCookie(stored);
      }
    }
    setReady(true);
    // Runs once: this is the initial reconciliation, not a subscription.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Answers the question without a reload: the page is already on this network. */
  const choose = useCallback((next: CotiNetworkName) => {
    setUnanswered(false);
    setNetState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Non-fatal: the cookie below is what the server actually reads.
    }
    writeCookie(next);
  }, []);

  const setNet = useCallback((next: CotiNetworkName) => {
    setUnanswered(false);
    setNetState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Non-fatal: the cookie below is what the server actually reads.
    }
    writeCookie(next);
  }, []);

  const value = useMemo<NetworkContextValue>(
    () => ({
      net,
      setNet,
      chain: chainByNetwork[net],
      addresses: addressesFor(net),
      isMainnet: net === "mainnet",
      ready,
      pinned,
      needsChoice: unanswered,
      choose,
    }),
    [net, setNet, ready, pinned, unanswered, choose],
  );

  return <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>;
}

export function useNetwork(): NetworkContextValue {
  const ctx = useContext(NetworkContext);
  if (ctx) return ctx;

  /**
   * A component rendered outside the provider still needs an answer. Falling
   * back to the deployment default keeps it working rather than crashing the
   * page, and `ready: false` marks the value as not-yet-chosen.
   */
  return {
    net: DEFAULT_NETWORK,
    setNet: () => {},
    chain: chainByNetwork[DEFAULT_NETWORK],
    addresses: addressesFor(DEFAULT_NETWORK),
    isMainnet: DEFAULT_NETWORK === "mainnet",
    ready: false,
    pinned: false,
    needsChoice: false,
    choose: () => {},
  };
}

/**
 * A year, path-wide, lax. Lax still travels on ordinary navigation, which is
 * what matters here, and the value is a public preference rather than anything
 * worth protecting.
 */
function writeCookie(net: CotiNetworkName) {
  try {
    document.cookie = `${NETWORK_COOKIE}=${net}; path=/; max-age=31536000; samesite=lax`;
  } catch {
    // Server-rendered or storage-blocked; the state above is still correct.
  }
}

/**
 * A read client bound to the selected network.
 *
 * `usePublicClient()` with no argument returns a client for wagmi's *first*
 * configured chain when no wallet is connected, and that is COTI testnet. Every
 * page that paired it with addresses from `useNetwork()` was therefore reading
 * mainnet contracts over a testnet RPC - which does not error, it just finds no
 * code and reports nothing there. That is what turned a staking page with three
 * live pools into "No pools yet".
 *
 * Passing the chain id explicitly is the whole fix, and it belongs here so no
 * page has to remember it.
 */
export function useNetworkClient() {
  const { chain } = useNetwork();
  return usePublicClient({ chainId: chain.id });
}

/** Appends the network to an API path, so a fetch never depends on the cookie. */
export function withNetwork(path: string, net: CotiNetworkName): string {
  return path + (path.includes("?") ? "&" : "?") + "network=" + net;
}
