import { createWalletClient, http, parseEther, formatEther, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { DEFAULT_NETWORK, chainByNetwork, type CotiNetworkName } from "./chain";
import { publicClient } from "./rpc";
import { db, row, now } from "./db";

/**
 * The testnet faucet.
 *
 * COTI's own faucet lives behind a Discord server, which is a wall between
 * someone who wants to try VEILPAD and actually trying it. This hands out a
 * small amount from the project's own treasury so the first launch can happen
 * in the same tab as everything else.
 *
 * The treasury is genuinely small, so the limits here are not decoration. Every
 * claim is one address, once per cooldown, and the balance is checked against a
 * reserve so the wallet can always pay for its own gas.
 *
 * It is testnet only, and that is enforced here rather than left to the UI.
 * The same treasury key holds real COTI on mainnet, so a faucet that followed
 * the selected network would hand out money the moment someone switched. The
 * refusal is deliberate and says so.
 */

/**
 * How much a claim is worth.
 *
 * Sized against what a real test session costs rather than a round number:
 *
 *   launch fee              0.01   COTI
 *   a dev buy worth making  0.05
 *   a few curve trades      0.05
 *   gas for ~20 transactions 0.004  (gas is 0.0065 gwei here, so it is noise)
 *   ------------------------------
 *   a full session          ~0.12  COTI
 *
 * A quarter of a COTI is therefore about two full sessions, and the treasury
 * stretches to roughly forty claims. The privacy bridge is deliberately out of
 * reach: its fee floor is 10 COTI, which no faucet of this size can cover.
 */
export const FAUCET_AMOUNT = process.env.FAUCET_AMOUNT_COTI || "0.25";

/** Kept back so the treasury can always pay gas to send the next claim. */
const RESERVE = parseEther("0.3");

/** One claim per address per day. */
export const COOLDOWN_MS = 24 * 60 * 60_000;

function ensureTable() {
  db().exec(`
    CREATE TABLE IF NOT EXISTS faucet_claims (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      address    TEXT NOT NULL,
      amount     TEXT NOT NULL,
      tx_hash    TEXT NOT NULL DEFAULT '',
      status     TEXT NOT NULL DEFAULT 'sent',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_faucet_addr ON faucet_claims(address, id DESC);
  `);
}

function treasuryAccount() {
  const pk = process.env.DEPLOYER_PRIVATE_KEY;
  if (!pk) return null;
  return privateKeyToAccount((pk.startsWith("0x") ? pk : "0x" + pk) as `0x${string}`);
}

export const faucetConfigured = () => treasuryAccount() !== null;

export interface FaucetStatus {
  configured: boolean;
  amount: string;
  cooldownHours: number;
  treasury: Address | null;
  balance: string;
  /** How many claims the treasury can still cover after the reserve. */
  remaining: number;
  open: boolean;
  reason: string | null;
  claimedTotal: number;
}

export async function faucetStatus(
  net: CotiNetworkName = DEFAULT_NETWORK,
): Promise<FaucetStatus> {
  ensureTable();
  const account = treasuryAccount();

  // Every row is a testnet claim, because the faucet only runs there. Counting
  // them on the mainnet response would report activity for a faucet that has
  // never handed out a thing on that chain.
  const claimedTotal =
    net === "mainnet"
      ? 0
      : (row<{ n: number }>(db().prepare("SELECT COUNT(*) AS n FROM faucet_claims").get()) ?? { n: 0 })
          .n;

  if (net === "mainnet") {
    return {
      configured: false,
      amount: FAUCET_AMOUNT,
      cooldownHours: COOLDOWN_MS / 3_600_000,
      treasury: null,
      balance: "0",
      remaining: 0,
      open: false,
      reason:
        "The faucet only funds VEILPAD Testnet. Mainnet COTI has to be bought or bridged - nobody gives it away.",
      claimedTotal,
    };
  }

  if (!account) {
    return {
      configured: false,
      amount: FAUCET_AMOUNT,
      cooldownHours: COOLDOWN_MS / 3_600_000,
      treasury: null,
      balance: "0",
      remaining: 0,
      open: false,
      reason: "No treasury key is configured on this deployment.",
      claimedTotal,
    };
  }

  const balance = await publicClient(net)
    .getBalance({ address: account.address })
    .catch(() => 0n);

  const each = parseEther(FAUCET_AMOUNT);
  const spendable = balance > RESERVE ? balance - RESERVE : 0n;
  const remaining = Number(spendable / each);

  return {
    configured: true,
    amount: FAUCET_AMOUNT,
    cooldownHours: COOLDOWN_MS / 3_600_000,
    treasury: account.address,
    balance: formatEther(balance),
    remaining,
    open: remaining > 0,
    reason:
      remaining > 0
        ? null
        : "The faucet treasury is empty. COTI's own faucet is the fallback until it is topped up.",
    claimedTotal,
  };
}

export interface Eligibility {
  eligible: boolean;
  reason: string | null;
  /** When they may claim again, if they are in cooldown. */
  nextAt: number | null;
  lastTx: string | null;
}

export function checkEligibility(address: string): Eligibility {
  ensureTable();

  const last = row<{ created_at: number; tx_hash: string }>(
    db()
      .prepare(
        "SELECT created_at, tx_hash FROM faucet_claims WHERE lower(address) = lower(?) ORDER BY id DESC LIMIT 1",
      )
      .get(address),
  );

  if (!last) return { eligible: true, reason: null, nextAt: null, lastTx: null };

  const elapsed = now() - last.created_at;
  if (elapsed < COOLDOWN_MS) {
    const hours = Math.ceil((COOLDOWN_MS - elapsed) / 3_600_000);
    return {
      eligible: false,
      reason: `This address already claimed. Try again in about ${hours} hour${hours === 1 ? "" : "s"}.`,
      nextAt: last.created_at + COOLDOWN_MS,
      lastTx: last.tx_hash || null,
    };
  }

  return { eligible: true, reason: null, nextAt: null, lastTx: last.tx_hash || null };
}

export interface ClaimResult {
  ok: boolean;
  txHash?: string;
  amount?: string;
  reason?: string;
}

export async function sendClaim(
  to: Address,
  net: CotiNetworkName = DEFAULT_NETWORK,
): Promise<ClaimResult> {
  if (net === "mainnet") {
    return {
      ok: false,
      reason:
        "The faucet only funds VEILPAD Testnet. Switch networks if you want test COTI.",
    } as ClaimResult;
  }
  const activeChain = chainByNetwork[net];
  ensureTable();

  const account = treasuryAccount();
  if (!account) return { ok: false, reason: "No treasury key is configured." };

  const status = await faucetStatus();
  if (!status.open) return { ok: false, reason: status.reason ?? "The faucet is closed." };

  const eligibility = checkEligibility(to);
  if (!eligibility.eligible) return { ok: false, reason: eligibility.reason ?? "Not eligible." };

  const wallet = createWalletClient({
    account,
    chain: activeChain,
    transport: http(activeChain.rpcUrls.default.http[0]),
  });

  try {
    // Gas is set explicitly rather than estimated: COTI's RPC rejects an
    // estimate against the pending block, and a plain transfer is always
    // 21000 anyway.
    const txHash = await wallet.sendTransaction({
      to,
      value: parseEther(FAUCET_AMOUNT),
      gas: 21_000n,
    });

    db()
      .prepare(
        "INSERT INTO faucet_claims (address, amount, tx_hash, status, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(to, FAUCET_AMOUNT, txHash, "sent", now());

    return { ok: true, txHash, amount: FAUCET_AMOUNT };
  } catch (err) {
    const raw = String((err as Error)?.message ?? err);
    return {
      ok: false,
      reason: /insufficient funds/i.test(raw)
        ? "The faucet treasury ran dry between the check and the send."
        : raw.slice(0, 180),
    };
  }
}

/** Recent claims, for the faucet page. Addresses are public on chain anyway. */
/**
 * Recent claims, and only ever the ones that could exist on this network.
 *
 * The faucet is testnet only, so every row in this table is a testnet claim.
 * Returning them unfiltered put testnet transaction hashes and recipient
 * addresses on the mainnet surface, next to a message saying the faucet does
 * not run there - history from a chain the reader is not looking at, which is
 * both wrong and confusing.
 *
 * Mainnet gets an empty list because an empty list is the truth.
 */
export function recentClaims(limit = 8, net: CotiNetworkName = DEFAULT_NETWORK) {
  if (net === "mainnet") return [];

  ensureTable();
  return db()
    .prepare(
      "SELECT address, amount, tx_hash, created_at FROM faucet_claims ORDER BY id DESC LIMIT ?",
    )
    .all(limit) as { address: string; amount: string; tx_hash: string; created_at: number }[];
}
