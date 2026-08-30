"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { explorerTx, ethExplorerTx } from "@/lib/chain";
import { Spinner } from "./busy";
import { useNetwork } from "./network-provider";

/**
 * The end of every action, said out loud.
 *
 * A transaction that succeeds silently and one that fails silently look
 * identical from the user's side: nothing happens. So every flow finishes
 * here, with what happened, the hash to check it against, and a way forward.
 * Failure keeps the retry closure alive so trying again does not mean filling
 * the form in a second time.
 */

export interface ResultSpec {
  ok: boolean;
  title: string;
  detail?: string;
  /** Transaction hash, when the action reached the chain. */
  txHash?: string;
  /** True when the hash belongs to the Ethereum side rather than COTI. */
  onEth?: boolean;
  /** Offered as RETRY on failure. Left out means the failure is not retryable. */
  onRetry?: () => void | Promise<void>;
}

interface ResultApi {
  show: (spec: ResultSpec) => void;
  /** Wrap an action so its success, failure and retry are all handled. */
  report: <T>(
    label: { success: string; failure?: string },
    run: () => Promise<T & { hash?: string }>,
  ) => Promise<void>;
}

const Ctx = createContext<ResultApi>({ show: () => undefined, report: async () => undefined });

export function useResult() {
  return useContext(Ctx);
}

export function ResultProvider({ children }: { children: ReactNode }) {
  const { net } = useNetwork();
  const [spec, setSpec] = useState<ResultSpec | null>(null);
  const [retrying, setRetrying] = useState(false);

  const show = useCallback((s: ResultSpec) => {
    setRetrying(false);
    setSpec(s);
  }, []);

  /**
   * The common shape: run it, announce it, and make the same call the retry.
   * Defining the retry as the identical closure is what stops a retry drifting
   * from the thing that actually failed.
   */
  const report = useCallback<ResultApi["report"]>(
    async (label, run) => {
      const attempt = async () => {
        try {
          const out = await run();
          show({
            ok: true,
            title: label.success,
            txHash: (out as { hash?: string })?.hash,
          });
        } catch (e) {
          show({
            ok: false,
            title: label.failure ?? "That did not go through",
            detail: readable(e),
            onRetry: attempt,
          });
        }
      };
      await attempt();
    },
    [show],
  );

  const api = useMemo<ResultApi>(() => ({ show, report }), [show, report]);

  async function retry() {
    if (!spec?.onRetry) return;
    setRetrying(true);
    try {
      await spec.onRetry();
    } finally {
      setRetrying(false);
    }
  }

  return (
    <Ctx.Provider value={api}>
      {children}

      {spec && (
        <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="animate-rise w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-ink-900 shadow-2xl">
            <div className="flex items-start gap-3 px-5 pt-5">
              <span
                className={
                  "flex size-10 shrink-0 items-center justify-center rounded-full " +
                  (spec.ok ? "bg-mint-400/15 text-mint-400" : "bg-rose-400/15 text-rose-400")
                }
              >
                {spec.ok ? <TickIcon /> : <CrossIcon />}
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-[15px] font-semibold">{spec.title}</h2>
                {spec.detail && (
                  <p className="mt-1 break-words text-[12px] leading-relaxed text-white/50">
                    {spec.detail}
                  </p>
                )}
              </div>
            </div>

            {spec.txHash ? (
              <a
                href={spec.onEth ? ethExplorerTx(spec.txHash, net) : explorerTx(spec.txHash, net)}
                target="_blank"
                rel="noreferrer"
                className="mx-5 mt-4 flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5 transition hover:border-cy-400/40"
              >
                <span className="text-[11px] text-white/40">Transaction</span>
                <span className="mono text-[11px] text-cy-300">
                  {spec.txHash.slice(0, 10)}…{spec.txHash.slice(-8)}
                </span>
              </a>
            ) : (
              <p className="mx-5 mt-4 rounded-xl border border-white/[0.07] px-3.5 py-2.5 text-[11px] text-white/30">
                {spec.ok
                  ? "No transaction was needed for this."
                  : "Nothing was sent, so nothing was spent."}
              </p>
            )}

            <div className="flex gap-2 px-5 pb-5 pt-4">
              {!spec.ok && spec.onRetry && (
                <button
                  onClick={retry}
                  disabled={retrying}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-white/12 py-2.5 text-[13px] font-semibold text-white/75 transition hover:border-white/25 hover:text-white disabled:opacity-50"
                >
                  {retrying ? <Spinner size={14} /> : <RetryIcon />}
                  {retrying ? "Retrying" : "Retry"}
                </button>
              )}
              <button
                onClick={() => setSpec(null)}
                className={
                  "flex-1 rounded-xl py-2.5 text-[13px] font-semibold text-white transition hover:brightness-110 " +
                  (spec.ok
                    ? "bg-gradient-to-r from-devox-500 to-cy-500"
                    : "border border-white/12 hover:border-white/25")
                }
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}

/**
 * Wallet and contract errors arrive as walls of hex. The ones people actually
 * hit are worth saying in words; everything else is trimmed rather than hidden,
 * because a truncated real error still beats a made-up friendly one.
 */
export function readable(e: unknown): string {
  const raw = String((e as Error)?.message ?? e ?? "");

  if (/User rejected|User denied|denied transaction/i.test(raw))
    return "You declined the signature in your wallet.";
  if (/insufficient funds/i.test(raw))
    return "Not enough balance on that chain to cover the amount and its gas.";
  if (/OracleTimestampMismatch/i.test(raw))
    return "COTI's price oracle updated while you were signing, so the quote expired. Retry uses a fresh one.";
  if (/InsufficientBridgeLiquidity/i.test(raw))
    return "The bridge does not hold enough of that token to release right now.";
  if (/InvalidRecipient/i.test(raw))
    return "That recipient is not valid. You cannot message yourself or the zero address.";
  if (/nonce too low|already known|replacement transaction/i.test(raw))
    return "That transaction was already submitted. Check your history before sending it again.";
  if (/-32603|internal error/i.test(raw) && /gas/i.test(raw))
    return "The wallet could not estimate gas for this call, which usually means it would revert.";

  return raw.slice(0, 240);
}

function TickIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
      <path d="m4.5 10.5 3.5 3.5 7.5-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CrossIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
      <path d="M5.5 5.5l9 9m0-9-9 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function RetryIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path d="M13.5 8a5.5 5.5 0 1 1-1.7-3.97" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M13.5 2v3.2h-3.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
