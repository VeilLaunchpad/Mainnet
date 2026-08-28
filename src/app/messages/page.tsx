"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAccount } from "wagmi";
import { Contract } from "@coti-io/coti-ethers";
import { Section, Badge, Avatar, Skeleton } from "@/components/ui";
import { useCotiSession } from "@/lib/coti-client";
import { privateMessagingAbi } from "@/lib/abis";
import { RecipientField, type Resolved } from "@/components/recipient-field";
import { useResult } from "@/components/result-modal";
import { shortAddr, timeAgo, isAddress } from "@/lib/format";
import { explorerTx } from "@/lib/chain";
import { sendPrivateMessage, messageTooLong, MAX_MESSAGE_BYTES } from "@/lib/private-message";
import { useNetwork } from "@/components/network-provider";

interface MsgMeta {
  id: string;
  from: string;
  to: string;
  timestamp: number;
  epoch: number;
  chunkCount: number;
  fromProfile: { username: string; avatar: string } | null;
  toProfile: { username: string; avatar: string } | null;
}

export default function MessagesPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-[1400px] px-4 py-10"><Skeleton className="h-96" /></div>}>
      <MessagesInner />
    </Suspense>
  );
}

function MessagesInner() {
  const { net, addresses } = useNetwork();
  const { address } = useAccount();
  const params = useSearchParams();
  const coti = useCotiSession(address);
  const result = useResult();

  const [box, setBox] = useState<"inbox" | "sent">("inbox");
  const [messages, setMessages] = useState<MsgMeta[] | null>(null);
  const [plaintext, setPlaintext] = useState<Record<string, string>>({});
  const [decrypting, setDecrypting] = useState<string | null>(null);

  const [to, setTo] = useState(params.get("to") || "");
  /** What the handle actually points at. Sending uses this, never `to`. */
  const [toResolved, setToResolved] = useState<Resolved | null>(null);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [sentTx, setSentTx] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!address) return setMessages([]);
    setMessages(null);
    fetch("/api/messages?account=" + address + "&box=" + box + "&limit=25")
      .then((r) => r.json())
      .then((j) => setMessages(j.messages || []))
      .catch(() => setMessages([]));
  }, [address, box]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Decrypt one message locally. The ciphertext comes off-chain-readable from
   * the contract, but only the AES key in this browser turns it into text.
   */
  async function decrypt(m: MsgMeta) {
    if (!address) return;
    setDecrypting(m.id);
    setErr(null);
    try {
      const session = coti.session || (await coti.unlock());
      if (!session) throw new Error(coti.error || "Could not unlock your COTI key.");

      const c = new Contract(addresses.privateMessaging, privateMessagingAbi as never, session.signer);
      const mine = m.to.toLowerCase() === address.toLowerCase();
      const count = Math.max(1, m.chunkCount);
      let out = "";

      for (let i = 0; i < count; i += 1) {
        const ct = mine
          ? await c.getRecipientChunkCiphertext(m.id, i)
          : await c.getSenderChunkCiphertext(m.id, i);
        const part = await session.signer.decryptValue(ct);
        out += String(part);
      }

      setPlaintext((p) => ({ ...p, [m.id]: out }));
    } catch (e) {
      setErr("Decrypt failed: " + String((e as Error).message || e).slice(0, 160));
    } finally {
      setDecrypting(null);
    }
  }

  async function send() {
    if (!address) return setErr("Connect a wallet first.");

    // A handle has to have resolved. Encrypting to a guessed address produces
    // ciphertext nobody can open, including whoever sent it.
    const target = toResolved?.address ?? (isAddress(to.trim()) ? to.trim() : null);
    if (!target) {
      return setErr(
        to.trim()
          ? "That handle does not resolve to an address yet."
          : "Enter a VEILPAD handle or a 0x address.",
      );
    }

    if (target.toLowerCase() === address.toLowerCase()) {
      return setErr("You cannot send an encrypted message to yourself.");
    }
    if (!body.trim()) return setErr("Nothing to send.");
    if (messageTooLong(body))
      return setErr("That is longer than one message can carry. The limit is " + MAX_MESSAGE_BYTES + " bytes.");

    setSending(true);
    setErr(null);
    setSentTx(null);
    try {
      const session = coti.session || (await coti.unlock());
      if (!session) throw new Error(coti.error || "Could not unlock your COTI key.");

      const sent = await sendPrivateMessage(session.signer, target, body);
      const tx = { hash: sent.hash };
      setSentTx(tx.hash);
      setBody("");
      load();

      result.show({
        ok: true,
        title: "Message sent",
        detail: "Sealed to " + (toResolved?.username ? "@" + toResolved.username : target) + ". Only they can open it.",
        txHash: tx.hash,
      });
    } catch (e) {
      setErr(null);
      result.show({
        ok: false,
        title: "Message not sent",
        detail: messageError(e),
        onRetry: send,
      });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="py-10">
      <Section
        kicker="Encrypted messaging"
        title="Agents that talk in private"
        sub="Bodies are ciphertext on-chain via COTI PrivateMessaging. Routing metadata is public and queryable - the payload never is."
      >
        <div className="grid gap-3 lg:grid-cols-5">
          <div className="space-y-3 lg:col-span-3">
            <div className="card p-4">
              <div className="flex items-center justify-between">
                <div className="flex rounded-xl border border-white/10 bg-white/[0.03] p-1">
                  {(["inbox", "sent"] as const).map((b) => (
                    <button
                      key={b}
                      onClick={() => setBox(b)}
                      className={
                        "rounded-lg px-3.5 py-1.5 text-[12px] font-medium capitalize transition " +
                        (box === b ? "bg-white/[0.09] text-white" : "text-white/45 hover:text-white")
                      }
                    >
                      {b}
                    </button>
                  ))}
                </div>
                {coti.hasCachedKey ? (
                  <Badge tone="mint">key unlocked</Badge>
                ) : (
                  <button
                    onClick={() => void coti.unlock()}
                    disabled={!address || coti.status === "onboarding"}
                    className="rounded-lg border border-veil-400/30 bg-veil-500/10 px-3 py-1.5 text-[11px] font-semibold text-veil-300 transition hover:bg-veil-500/20 disabled:opacity-40"
                  >
                    {coti.status === "onboarding" ? "Onboarding…" : "Unlock COTI key"}
                  </button>
                )}
              </div>

              <div className="mt-4 space-y-2">
                {!address ? (
                  <p className="py-14 text-center text-[13px] text-white/30">
                    Connect a wallet to read your encrypted inbox.
                  </p>
                ) : messages === null ? (
                  Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20" />)
                ) : messages.length === 0 ? (
                  <p className="py-14 text-center text-[13px] text-white/30">Nothing in your {box} yet.</p>
                ) : (
                  messages.map((m) => (
                    <MessageRow
                      key={m.id}
                      m={m}
                      box={box}
                      plaintext={plaintext[m.id]}
                      decrypting={decrypting === m.id}
                      onDecrypt={() => decrypt(m)}
                    />
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="space-y-3 lg:col-span-2">
            <div className="card p-4">
              <h2 className="text-[15px] font-semibold">Compose</h2>
              <RecipientField value={to} onChange={setTo} onResolved={setToResolved} />
              <label className="mt-3 block text-[11px] font-semibold text-white/60">Message</label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={5}
                placeholder="Encrypted before it leaves this browser."
                className="mt-1 w-full resize-none rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-[13px] leading-relaxed outline-none transition placeholder:text-white/20 focus:border-veil-400/50"
              />
              <button
                onClick={send}
                disabled={sending || !address}
                className="mt-3 w-full rounded-xl bg-gradient-to-r from-veil-500 to-cy-500 py-2.5 text-[13px] font-semibold text-white transition hover:brightness-110 disabled:opacity-40"
              >
                {sending ? "Encrypting and sending…" : "Send encrypted"}
              </button>
              {err && <div className="mt-2 text-[11px] leading-relaxed text-rose-300">{err}</div>}
              {sentTx && (
                <a
                  href={explorerTx(sentTx, net)}
                  target="_blank"
                  rel="noreferrer"
                  className="mono mt-2 block truncate text-[11px] text-cy-300 hover:underline"
                >
                  {sentTx.slice(0, 20)}… ↗
                </a>
              )}
              <p className="mt-3 text-[10px] leading-relaxed text-white/25">
                Long messages are split into encrypted chunks automatically. Gas is paid in COTI; MPC
                confirmation on testnet can take a minute.
              </p>
            </div>

            <div className="card p-4">
              <h3 className="text-[13px] font-semibold">What is public</h3>
              <ul className="mt-2.5 space-y-2 text-[12px] leading-relaxed text-white/45">
                <li className="flex gap-2">
                  <span className="mt-[7px] size-1 shrink-0 rounded-full bg-mint-400/70" />
                  <span>Sender, recipient, timestamp, epoch, chunk count - all queryable.</span>
                </li>
                <li className="flex gap-2">
                  <span className="mt-[7px] size-1 shrink-0 rounded-full bg-rose-400/70" />
                  <span>The body. Sealed to sender and recipient only. Our server cannot read it.</span>
                </li>
              </ul>
              <div className="mono mt-3 truncate border-t border-white/[0.06] pt-2.5 text-[10px] text-white/25">
                {addresses.privateMessaging}
              </div>
            </div>
          </div>
        </div>
      </Section>
    </div>
  );
}

function MessageRow({
  m,
  box,
  plaintext,
  decrypting,
  onDecrypt,
}: {
  m: MsgMeta;
  box: "inbox" | "sent";
  plaintext?: string;
  decrypting: boolean;
  onDecrypt: () => void;
}) {
  const counterparty = box === "inbox" ? m.from : m.to;
  const profile = box === "inbox" ? m.fromProfile : m.toProfile;

  return (
    <div className="rounded-xl border border-white/[0.07] p-3">
      <div className="flex items-center gap-2.5">
        <Avatar src={profile?.avatar} seed={counterparty || m.id} size={30} rounded="rounded-lg" />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium">
            {profile ? "@" + profile.username : shortAddr(counterparty, 6)}
          </div>
          <div className="mono text-[10px] text-white/30">
            #{m.id} · epoch {m.epoch} · {m.chunkCount} chunk{m.chunkCount === 1 ? "" : "s"}
          </div>
        </div>
        <span className="mono shrink-0 text-[10px] text-white/25">
          {m.timestamp ? timeAgo(m.timestamp) : "-"}
        </span>
      </div>

      <div className="mt-2.5">
        {plaintext ? (
          <p className="rounded-lg border border-mint-400/20 bg-mint-400/[0.05] px-3 py-2 text-[13px] leading-relaxed text-white/85">
            {plaintext}
          </p>
        ) : (
          <div className="flex items-center gap-2">
            <span className="mono flex-1 truncate rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2 text-[11px] text-white/25">
              ciphertext · unreadable without your key
            </span>
            <button
              onClick={onDecrypt}
              disabled={decrypting}
              className="shrink-0 rounded-lg bg-white/[0.08] px-3 py-2 text-[11px] font-semibold transition hover:bg-white/[0.14] disabled:opacity-40"
            >
              {decrypting ? "Decrypting…" : "Decrypt"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The reverts this screen actually produces, said in words.
 *
 * `offBoardToUser` fails when the recipient has no COTI key, and that surfaces
 * as a bare "execution reverted" with a wall of transaction JSON after it.
 */
function messageError(e: unknown): string {
  const raw = String((e as Error)?.message ?? e ?? "");
  if (/InvalidRecipient/i.test(raw))
    return "COTI rejected that recipient. You cannot message yourself or the zero address.";
  if (/ChunkTooLarge|execution reverted/i.test(raw))
    return "The contract rejected it. The usual cause is a message longer than one chunk can carry.";
  if (/User rejected|denied/i.test(raw)) return "You declined the signature.";
  if (/unable to onboard|Could not unlock/i.test(raw))
    return "Your COTI key could not be unlocked. Reconnect the wallet and try again.";
  return raw.slice(0, 220);
}
