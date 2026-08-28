"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { BrowserProvider, Contract, type JsonRpcSigner } from "@coti-io/coti-ethers";
import { generateRSAKeyPair, recoverUserKey } from "@coti-io/coti-sdk-typescript";
import { accountOnboardAbi } from "./abis";
import { chainByNetwork, DEFAULT_NETWORK, type CotiNetworkName } from "./chain";
import { addressesFor } from "./addresses";
import { useNetwork } from "@/components/network-provider";

/**
 * COTI privacy handshake, browser side.
 *
 * Reading your own encrypted state needs an AES key only you can derive. Your
 * wallet signs a freshly generated RSA public key, the on-chain onboarding
 * contract returns the AES key sealed to it, and the SDK unwraps it locally.
 * The key never leaves this browser: not to our server, not to anyone.
 *
 * The onboarding is implemented here rather than through the SDK helper because
 * that helper catches every failure and rethrows a bare "unable to onboard
 * user", discarding the cause. A user staring at a generic error has no way
 * forward, so this version keeps the real reason and checks the obvious
 * preconditions first.
 */


/** Gas is generous on purpose: onboarding is an MPC operation. */
const ONBOARD_GAS = 12_000_000n;

/**
 * The AES key is per account *and* per network: each chain runs its own MPC
 * network and its own AccountOnboard, so the key derived on one does not
 * decrypt the other's ciphertext. Sharing a cache entry between them is the
 * worst failure mode in this codebase - the wrong key does not throw, it
 * returns a plausible number for a balance that is not yours.
 */
function keyStore(address: string, net: CotiNetworkName) {
  return "veilpad.aes." + net + "." + address.toLowerCase();
}

/** Keys cached before the app had two networks. They were all testnet. */
function legacyKeyStore(address: string) {
  return "veilpad.aes." + address.toLowerCase();
}

export function readCachedAes(
  address?: string | null,
  net: CotiNetworkName = DEFAULT_NETWORK,
): string | null {
  if (!address) return null;
  try {
    const hit = localStorage.getItem(keyStore(address, net));
    if (hit) return hit;

    // One-time migration, so an existing testnet user is not asked to onboard
    // again. Mainnet deliberately gets no fallback: the old entry cannot have
    // been a mainnet key.
    if (net !== "testnet") return null;
    const legacy = localStorage.getItem(legacyKeyStore(address));
    if (legacy) {
      localStorage.setItem(keyStore(address, "testnet"), legacy);
      localStorage.removeItem(legacyKeyStore(address));
    }
    return legacy;
  } catch {
    return null;
  }
}

export function clearCachedAes(address: string, net: CotiNetworkName = DEFAULT_NETWORK) {
  try {
    localStorage.removeItem(keyStore(address, net));
    if (net === "testnet") localStorage.removeItem(legacyKeyStore(address));
  } catch {
    /* private mode */
  }
}

export interface CotiSession {
  signer: JsonRpcSigner;
  aesKey: string;
  address: string;
}

export type UnlockStage =
  | "idle"
  | "checking"
  | "signing"
  | "onboarding"
  | "recovering"
  | "ready"
  | "error";

/** Anything with an EIP-1193 `request`, which is what a wallet exposes. */
export interface Eip1193 {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}

/**
 * Finds the wallet provider actually in use.
 *
 * `window.ethereum` is the wrong answer when more than one wallet is installed:
 * whichever extension loaded last owns that property, which may not be the one
 * the user connected with. The connector's own provider is authoritative, so it
 * is preferred and `window.ethereum` is only the fallback.
 */
export async function walletProvider(connectorProvider?: unknown): Promise<Eip1193> {
  if (connectorProvider && typeof (connectorProvider as Eip1193).request === "function") {
    return connectorProvider as Eip1193;
  }

  const injected = (globalThis as { ethereum?: Eip1193 & { providers?: Eip1193[] } }).ethereum;
  if (!injected) {
    throw new Error("No wallet found in this browser. Install MetaMask to use COTI privacy.");
  }

  // Some wallets expose the list rather than replacing the property outright.
  if (Array.isArray(injected.providers) && injected.providers.length) {
    return injected.providers[0];
  }
  return injected;
}

export interface UnlockOptions {
  /** The provider wagmi is connected through. Strongly preferred. */
  connectorProvider?: unknown;
  onStage?: (stage: UnlockStage, detail?: string) => void;
  /** Which chain to onboard against. Defaults to the deployment default. */
  net?: CotiNetworkName;
}

/**
 * Derives, or recovers, the AES key for an address.
 *
 * Safe to call repeatedly: a cached key short-circuits before any signature
 * prompt, and re-onboarding an account that is already onboarded returns the
 * same key rather than failing.
 */
export async function openCotiSession(
  address: string,
  options: UnlockOptions = {},
): Promise<CotiSession> {
  const stage = options.onStage ?? (() => undefined);
  const net = options.net ?? DEFAULT_NETWORK;
  const chain = chainByNetwork[net];
  const onboardAddress = addressesFor(net).accountOnboard;

  stage("checking");
  const eth = await walletProvider(options.connectorProvider);

  // Every precondition below produces a specific message. A generic failure
  // here is the difference between a user fixing it in ten seconds and giving
  // up entirely.
  const chainIdHex = (await eth.request({ method: "eth_chainId" })) as string;
  if (parseInt(chainIdHex, 16) !== chain.id) {
    throw new Error(
      "Your wallet is on chain " +
        parseInt(chainIdHex, 16) +
        ". Switch to " +
        chain.name +
        " and try again.",
    );
  }

  const provider = new BrowserProvider(eth as never);
  const cached = readCachedAes(address, net);
  const signer = await provider.getSigner(address, cached ? { aesKey: cached } : undefined);

  if (cached) {
    stage("ready");
    return { signer, aesKey: cached, address };
  }

  const balance = await provider.getBalance(address);
  if (balance === 0n) {
    throw new Error(
      "Onboarding writes one transaction, so it needs a little " +
        chain.nativeCurrency.symbol +
        " for gas. Your balance is zero.",
    );
  }

  // ── the handshake ──────────────────────────────────────────────────────
  const { publicKey, privateKey } = generateRSAKeyPair();

  stage("signing", "Sign to prove the key is yours");
  let signedEK: string;
  try {
    signedEK = await signer.signMessage(publicKey);
  } catch (err) {
    const code = (err as { code?: number })?.code;
    if (code === 4001 || /user rejected|denied/i.test(String((err as Error).message))) {
      throw new Error("You declined the signature, so no key was derived.");
    }
    throw new Error("Could not sign the onboarding message: " + short(err));
  }

  stage("onboarding", "Registering your key on chain");
  const onboard = new Contract(onboardAddress, accountOnboardAbi as never, signer);

  let receipt: { logs?: readonly unknown[] } | null = null;
  try {
    const tx = await onboard.onboardAccount(publicKey, signedEK, { gasLimit: ONBOARD_GAS });
    receipt = await tx.wait();
  } catch (err) {
    throw new Error("The onboarding transaction failed: " + short(err));
  }

  const event = findOnboardEvent(onboard, receipt);
  if (!event) {
    throw new Error(
      "The onboarding transaction confirmed but returned no key. This usually means the onboarding contract at " +
        onboardAddress.slice(0, 10) +
        " is not the one this network uses.",
    );
  }

  stage("recovering");
  let aesKey: string;
  try {
    aesKey = recoverUserKey(privateKey, event.userKey1.substring(2), event.userKey2.substring(2));
  } catch (err) {
    throw new Error("Could not unwrap the returned key: " + short(err));
  }

  signer.setUserOnboardInfo({ aesKey, rsaKey: { publicKey, privateKey } });

  try {
    localStorage.setItem(keyStore(address, net), aesKey);
  } catch {
    /* private mode: the key lives for this session only */
  }

  stage("ready");
  return { signer, aesKey, address };
}

function findOnboardEvent(
  onboard: Contract,
  receipt: { logs?: readonly unknown[] } | null,
): { userKey1: string; userKey2: string } | null {
  for (const log of receipt?.logs ?? []) {
    try {
      const parsed = onboard.interface.parseLog(log as never);
      if (parsed?.name === "AccountOnboarded") {
        return { userKey1: parsed.args.userKey1, userKey2: parsed.args.userKey2 };
      }
    } catch {
      /* not our event */
    }
  }
  return null;
}

function short(err: unknown): string {
  const e = err as { shortMessage?: string; message?: string };
  return String(e?.shortMessage || e?.message || err).slice(0, 180);
}

/**
 * React wrapper around the handshake, with status the UI can render honestly.
 *
 * The EIP-1193 provider comes from the connector wagmi is actually using rather
 * than from `window.ethereum`, so a second wallet extension cannot quietly
 * hijack the signature prompt.
 */
export function useCotiSession(address?: string | null) {
  const { connector } = useAccount();
  const { net } = useNetwork();
  const [connectorProvider, setConnectorProvider] = useState<unknown>(null);
  const [session, setSession] = useState<CotiSession | null>(null);
  const [stage, setStage] = useState<UnlockStage>("idle");
  const [detail, setDetail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasCachedKey, setHasCachedKey] = useState(false);

  useEffect(() => {
    setSession(null);
    setStage("idle");
    setError(null);
    setDetail(null);
    setHasCachedKey(!!readCachedAes(address, net));
  }, [address, net]);

  useEffect(() => {
    let alive = true;
    connector
      ?.getProvider?.()
      .then((p) => alive && setConnectorProvider(p))
      .catch(() => alive && setConnectorProvider(null));
    return () => {
      alive = false;
    };
  }, [connector]);

  const unlock = useCallback(async () => {
    if (!address) {
      setError("Connect a wallet first.");
      setStage("error");
      return null;
    }

    setError(null);
    try {
      const s = await openCotiSession(address, {
        connectorProvider,
        net,
        onStage: (st, d) => {
          setStage(st);
          setDetail(d ?? null);
        },
      });
      setSession(s);
      setHasCachedKey(true);
      setStage("ready");
      setDetail(null);
      return s;
    } catch (err) {
      setError(String((err as Error).message || err));
      setStage("error");
      return null;
    }
  }, [address, connectorProvider, net]);

  const forget = useCallback(() => {
    if (address) clearCachedAes(address, net);
    setSession(null);
    setHasCachedKey(false);
    setStage("idle");
    setError(null);
  }, [address, net]);

  return {
    session,
    stage,
    /** Kept for call sites that only care whether a prompt is in flight. */
    status: stage === "ready" ? "ready" : stage === "error" ? "error" : stage === "idle" ? "idle" : "onboarding",
    detail,
    error,
    hasCachedKey,
    unlock,
    forget,
  };
}
