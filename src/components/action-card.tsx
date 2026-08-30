"use client";

import { useState } from "react";
import Link from "next/link";
import { useAccount, useWriteContract } from "wagmi";
import { parseEther, type Address } from "viem";
import { mineVanitySalt, randomSalt } from "@/lib/vanity";
import { devoxCurveAbi, devoxFactoryAbi, erc20Abi, privateMessagingAbi } from "@/lib/abis";
import { isDeployed } from "@/lib/addresses";
import { useNetwork, useNetworkClient } from "./network-provider";
import { explorerTx } from "@/lib/chain";
import { parseUnits } from "@/lib/format";
import { openCotiSession } from "@/lib/coti-client";
import type { AgentAction } from "@/lib/use-agent-chat";
import { Contract } from "@coti-io/coti-ethers";
import { ensureAllowance } from "@/lib/allowance";

/**
 * A proposal the agent made, rendered as something the user signs.
 *
 * This is the custody boundary: the agent decides and explains, the wallet
 * executes. Nothing here can move funds without an explicit signature.
 */
export function ActionCard({
  action,
  onUpdate,
}: {
  action: AgentAction;
  onUpdate: (id: string, patch: Partial<AgentAction>) => void;
}) {
  const { net, addresses } = useNetwork();
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const publicClient = useNetworkClient();
  const [busy, setBusy] = useState(false);

  const p = action.payload || {};
  const state = action.state || "pending";

  async function runTrade(): Promise<`0x${string}`> {
    const curve = p.curve as Address;
    if (!isDeployed(curve)) throw new Error("This token has no bonding curve deployed yet.");

    if (p.side === "buy") {
      return writeContractAsync({
        address: curve,
        abi: devoxCurveAbi,
        functionName: "buy",
        args: [0n],
        value: parseEther(String(p.amount)),
      });
    }

    const amount = parseUnits(String(p.amount), Number(p.decimals) || 18);

    // An agent proposal should not cost more confirmations than doing the same
    // thing by hand on the desk.
    await ensureAllowance({
      publicClient,
      writeContractAsync,
      owner: address as Address,
      token: p.token as Address,
      spender: curve,
      amount,
    });
    return writeContractAsync({
      address: curve,
      abi: devoxCurveAbi,
      functionName: "sell",
      args: [amount, 0n],
    });
  }

  /**
   * An agent-proposed launch runs the same path a manual one does: the address
   * is mined in the browser first, so a token FORGE ships is indistinguishable
   * from one you filled in by hand, 8888 suffix included.
   */
  async function runLaunch(): Promise<`0x${string}`> {
    if (!address || !publicClient) throw new Error("no wallet");
    if (!isDeployed(addresses.devoxFactory)) {
      throw new Error("DEVOXPAD factory is not deployed on this network yet.");
    }

    const name = String(p.name);
    const symbol = String(p.symbol).toUpperCase();
    const privateBalances = p.privateBalances !== false;
    const metadataURI = JSON.stringify({
      description: p.description || "",
      image: p.image || "",
      socials: {},
    });

    const [launchFee, curveSalt] = [
      (await publicClient.readContract({
        address: addresses.devoxFactory,
        abi: devoxFactoryAbi,
        functionName: "launchFee",
      })) as bigint,
      randomSalt(),
    ];

    const curveAddress = (await publicClient.readContract({
      address: addresses.devoxFactory,
      abi: devoxFactoryAbi,
      functionName: "predictCurve",
      args: [address, curveSalt],
    })) as Address;

    const [deployerAddress, initCodeHash] = (await Promise.all([
      publicClient.readContract({
        address: addresses.devoxFactory,
        abi: devoxFactoryAbi,
        functionName: "deployerFor",
        args: [privateBalances],
      }),
      publicClient.readContract({
        address: addresses.devoxFactory,
        abi: devoxFactoryAbi,
        functionName: "tokenInitCodeHash",
        args: [privateBalances, name, symbol, metadataURI, address, curveAddress],
      }),
    ])) as [Address, `0x${string}`];

    onUpdate(action.id, { error: undefined });
    const mined = await mineVanitySalt(deployerAddress, initCodeHash);

    const devBuy = p.devBuy ? parseEther(String(p.devBuy)) : 0n;

    return writeContractAsync({
      address: addresses.devoxFactory,
      abi: devoxFactoryAbi,
      functionName: "launch",
      args: [
        {
          name,
          symbol,
          metadataURI,
          privateBalances,
          agentId: ("0x" + "0".repeat(64)) as `0x${string}`,
          curveSalt,
          tokenSalt: mined.salt,
          devBuy,
          allocation: 0,
          burnPercent: 0,
          lockDays: 0,
        },
      ],
      value: launchFee + devBuy,
      gas: 30_000_000n,
    });
  }

  /**
   * Encrypted send. The plaintext is encrypted in the browser against the
   * messaging contract's function selector - the server never touches it.
   */
  async function runMessage(): Promise<`0x${string}`> {
    if (!address) throw new Error("no wallet");
    const contract = (p.contract as Address) || addresses.privateMessaging;
    if (!isDeployed(contract)) throw new Error("PrivateMessaging is not configured on this network.");

    const { signer } = await openCotiSession(address);
    const messaging = new Contract(contract, privateMessagingAbi as never, signer);
    const selector = messaging.interface.getFunction("sendMessage")!.selector;
    const encrypted = await signer.encryptValue(String(p.text), contract, selector);

    const tx = await messaging.sendMessage(p.to, encrypted, { gasLimit: 8_000_000n });
    return tx.hash as `0x${string}`;
  }

  async function recordSideEffects(hash: string) {
    if (action.kind !== "trade") return;
    try {
      await fetch("/api/trades", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token: p.token,
          trader: address,
          side: p.side,
          cotiIn: p.side === "buy" ? p.amount : "0",
          tokenOut: p.side === "sell" ? p.amount : "0",
          txHash: hash,
        }),
      });
    } catch {
      /* indexing is best-effort; the chain already has the truth */
    }
  }

  async function execute() {
    if (!address) return onUpdate(action.id, { error: "Connect a wallet first." });
    setBusy(true);
    onUpdate(action.id, { state: "sent", error: undefined });

    try {
      const hash =
        action.kind === "trade"
          ? await runTrade()
          : action.kind === "launch"
            ? await runLaunch()
            : action.kind === "message"
              ? await runMessage()
              : undefined;

      if (!hash) {
        onUpdate(action.id, { state: "pending" });
        return;
      }

      onUpdate(action.id, { txHash: hash });
      await publicClient?.waitForTransactionReceipt({ hash });
      onUpdate(action.id, { state: "done" });
      void recordSideEffects(hash);
    } catch (err) {
      onUpdate(action.id, {
        state: "failed",
        error: String((err as Error).message || err).slice(0, 220),
      });
    } finally {
      setBusy(false);
    }
  }

  const tone =
    state === "done"
      ? "border-mint-400/40 bg-mint-400/[0.06]"
      : state === "failed"
        ? "border-rose-400/40 bg-rose-400/[0.06]"
        : "border-devox-400/35 bg-devox-500/[0.07]";

  if (state === "dismissed") return null;

  return (
    <div className={"mt-2.5 rounded-xl border p-3 " + tone}>
      <div className="flex items-start gap-3">
        <ActionIcon kind={action.kind} />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-white">{action.summary}</div>
          <ActionDetail kind={action.kind} payload={p} />
          {action.error && <div className="mt-1.5 text-[11px] text-rose-300">{action.error}</div>}
          {action.txHash && (
            <a
              href={explorerTx(action.txHash, net)}
              target="_blank"
              rel="noreferrer"
              className="mono mt-1.5 inline-block text-[11px] text-cy-300 hover:underline"
            >
              {action.txHash.slice(0, 14)}… ↗
            </a>
          )}
        </div>

        <div className="flex shrink-0 gap-1.5">
          {action.kind === "bridge" ? (
            <Link
              href="/bridge"
              className="rounded-lg bg-white/10 px-3 py-1.5 text-[12px] font-semibold transition hover:bg-white/15"
            >
              Open bridge
            </Link>
          ) : state === "done" ? (
            <span className="rounded-lg bg-mint-400/15 px-3 py-1.5 text-[12px] font-semibold text-mint-400">
              Confirmed
            </span>
          ) : (
            <>
              <button
                onClick={execute}
                disabled={busy || state === "sent"}
                className="rounded-lg bg-gradient-to-r from-devox-500 to-cy-500 px-3 py-1.5 text-[12px] font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
              >
                {busy || state === "sent" ? "Signing…" : state === "failed" ? "Retry" : "Execute"}
              </button>
              <button
                onClick={() => onUpdate(action.id, { state: "dismissed" })}
                className="rounded-lg border border-white/10 px-2.5 py-1.5 text-[12px] text-white/50 transition hover:text-white"
              >
                Skip
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ActionDetail({ kind, payload: p }: { kind: string; payload: Record<string, any> }) {
  const rows: [string, string][] = [];
  if (kind === "trade") {
    rows.push(["Side", String(p.side).toUpperCase()], ["Amount", String(p.amount)]);
    if (p.slippageBps) rows.push(["Max slippage", Number(p.slippageBps) / 100 + "%"]);
    if (p.reason) rows.push(["Why", String(p.reason)]);
  } else if (kind === "launch") {
    rows.push(
      ["Ticker", String(p.symbol)],
      ["Balances", p.privateBalances === false ? "Public" : "Encrypted"],
    );
  } else if (kind === "message") {
    rows.push(["To", String(p.to)], ["Body", "encrypted end-to-end"]);
  } else if (kind === "bridge") {
    rows.push(
      ["Route", String(p.direction) === "to_ethereum" ? "COTI → Ethereum" : "Ethereum → COTI"],
      ["Asset", String(p.token)],
    );
  }

  if (!rows.length) return null;
  return (
    <dl className="mt-1.5 space-y-0.5">
      {rows.map(([k, v]) => (
        <div key={k} className="flex gap-2 text-[11px]">
          <dt className="w-[74px] shrink-0 text-white/40">{k}</dt>
          <dd className="min-w-0 flex-1 truncate text-white/70">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function ActionIcon({ kind }: { kind: string }) {
  const glyph =
    kind === "trade" ? "⇄" : kind === "launch" ? "◈" : kind === "message" ? "✉" : kind === "bridge" ? "⇥" : "•";
  return (
    <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-[13px] text-devox-300">
      {glyph}
    </span>
  );
}
