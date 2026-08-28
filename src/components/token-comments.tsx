"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAccount, useSignMessage } from "wagmi";
import { Contract } from "@coti-io/coti-ethers";
import { Avatar, Badge, Skeleton } from "./ui";
import { privateMessagingAbi } from "@/lib/abis";
import { isDeployed } from "@/lib/addresses";
import { useNetwork } from "./network-provider";
import { useCotiSession } from "@/lib/coti-client";
import { shortAddr, timeAgo, isAddress } from "@/lib/format";
import { commentDigest } from "@/lib/comment-digest";
import { explorerTx } from "@/lib/chain";
import { sendPrivateMessage, messageTooLong, MAX_MESSAGE_BYTES } from "@/lib/private-message";

interface Comment {
  id: number;
  author: string;
  profile: { username: string; avatar: string } | null;
  body: string;
  private: boolean;
  txHash: string;
  createdAt: number;
}

/**
 * The token's comment thread, which doubles as its private channel.
 *
 * A public comment is signed by the author's wallet and stored in the index, so
 * nobody can post as somebody else. A private one is encrypted in the browser
 * and sent to the creator through COTI PrivateMessaging: the thread records
 * that it happened and its transaction, and the body exists only as ciphertext
 * that the two of them can open.
 *
 * The distinction is stated in the interface rather than hidden, because a
 * comment box that quietly publishes what someone believed was private would be
 * the worst possible failure here.
 */
export function TokenComments({
  token,
  symbol,
  creator,
}: {
  token: string;
  symbol: string;
  creator?: string;
}) {
  const { addresses } = useNetwork();
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const coti = useCotiSession(address);

  const [comments, setComments] = useState<Comment[] | null>(null);
  const [body, setBody] = useState("");
  const [mode, setMode] = useState<"public" | "private">("public");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/comments?token=" + token)
      .then((r) => r.json())
      .then((j) => setComments(j.comments ?? []))
      .catch(() => setComments([]));
  }, [token]);

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  const canGoPrivate = isAddress(creator || "") && isDeployed(addresses.privateMessaging);

  async function post() {
    setErr(null);
    if (!address) return setErr("Connect a wallet to post.");
    if (!body.trim()) return setErr("Write something first.");

    setBusy(true);
    try {
      if (mode === "public") {
        const nonce = Date.now();
        setStep("Sign to prove it is you…");
        const signature = await signMessageAsync({
          message: commentDigest(token, body.trim(), nonce),
        });

        setStep("Posting…");
        const res = await fetch("/api/comments", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            token,
            author: address,
            body: body.trim(),
            nonce,
            signature,
            private: false,
          }),
        });
        const j = await res.json();
        if (!res.ok) throw new Error(j.error || "could not post");
      } else {
        if (!canGoPrivate || !creator) {
          throw new Error("This token has no creator address to message.");
        }
        if (messageTooLong(body)) {
          throw new Error(
            "That comment is longer than one message can carry. The limit is " +
              MAX_MESSAGE_BYTES +
              " bytes.",
          );
        }

        setStep("Unlocking your key…");
        const session = coti.session || (await coti.unlock());
        if (!session) throw new Error(coti.error || "Could not unlock your COTI key.");

        setStep("Encrypting…");
        // Chunking and the choice of sendMessage vs sendMultipartMessage both
        // live in one place, so a long comment cannot fail differently here
        // than a long message does in the inbox.
        const sent = await sendPrivateMessage(
          session.signer,
          creator,
          "[" + symbol + "] " + body.trim(),
        );

        await fetch("/api/comments", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token, author: address, private: true, txHash: sent.hash }),
        });
      }

      setBody("");
      load();
    } catch (e) {
      setErr(String((e as Error).message || e).slice(0, 220));
    } finally {
      setBusy(false);
      setStep("");
    }
  }

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-semibold">Comments</h2>
        <span className="text-[10px] text-white/25">
          {comments ? comments.length : 0} on {symbol}
        </span>
      </div>

      <div className="mt-3 rounded-xl border border-white/[0.08] p-3">
        <div className="flex rounded-lg border border-white/10 bg-white/[0.03] p-0.5">
          <button
            onClick={() => setMode("public")}
            className={
              "flex-1 rounded px-3 py-1.5 text-[12px] font-semibold transition " +
              (mode === "public" ? "bg-white/[0.1] text-white" : "text-white/45 hover:text-white")
            }
          >
            Public
          </button>
          <button
            onClick={() => setMode("private")}
            disabled={!canGoPrivate}
            title={canGoPrivate ? undefined : "No creator address to message"}
            className={
              "flex-1 rounded px-3 py-1.5 text-[12px] font-semibold transition disabled:opacity-30 " +
              (mode === "private" ? "bg-veil-500/25 text-veil-200" : "text-white/45 hover:text-white")
            }
          >
            Encrypted to creator
          </button>
        </div>

        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          maxLength={1000}
          placeholder={
            mode === "public"
              ? "Say something about " + symbol + ". Signed by your wallet, visible to everyone."
              : "Encrypted before it leaves this browser. Only you and the creator can read it."
          }
          className="mt-2.5 w-full resize-none rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5 text-[13px] leading-relaxed outline-none transition placeholder:text-white/25 focus:border-veil-400/50"
        />

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            onClick={post}
            disabled={busy || !body.trim() || !address}
            className={
              "rounded-lg px-4 py-2 text-[13px] font-semibold text-white transition hover:brightness-110 disabled:opacity-40 " +
              (mode === "private"
                ? "bg-gradient-to-r from-veil-500 to-veil-600"
                : "bg-gradient-to-r from-veil-500 to-cy-500")
            }
          >
            {busy ? step || "Working…" : mode === "private" ? "Send encrypted" : "Post comment"}
          </button>

          <span className="text-[11px] text-white/35">
            {mode === "public"
              ? "Stored in the VEILPAD index and signed, so nobody can post as you."
              : "Sent through COTI PrivateMessaging. The body never touches our server."}
          </span>
        </div>

        {!address && (
          <p className="mt-2 text-[11px] text-amber-300/70">Connect a wallet to post.</p>
        )}
        {err && <p className="mt-2 text-[11px] leading-relaxed text-rose-300">{err}</p>}
      </div>

      <div className="mt-4 space-y-3">
        {comments === null ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16" />)
        ) : comments.length === 0 ? (
          <p className="py-10 text-center text-[13px] text-white/30">
            Nothing said yet. Be the first.
          </p>
        ) : (
          comments.map((c) => <CommentRow key={c.id} c={c} />)
        )}
      </div>
    </div>
  );
}

function CommentRow({ c }: { c: Comment }) {
  const { net } = useNetwork();
  const name = c.profile ? "@" + c.profile.username : shortAddr(c.author, 5);

  return (
    <div className="flex gap-2.5">
      <Avatar src={c.profile?.avatar} seed={c.author} size={30} rounded="rounded-full" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <Link
            href={"/profile/" + (c.profile?.username ?? c.author)}
            className="text-[12px] font-semibold text-white/80 transition hover:text-veil-300"
          >
            {name}
          </Link>
          {c.private && <Badge tone="veil">encrypted</Badge>}
          <span className="mono text-[10px] text-white/25">{timeAgo(c.createdAt)}</span>
        </div>

        {c.private ? (
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="mono rounded-lg border border-white/[0.07] bg-white/[0.02] px-2.5 py-1.5 text-[11px] text-white/25">
              ciphertext, readable only by the sender and the creator
            </span>
            {c.txHash && (
              <a
                href={explorerTx(c.txHash, net)}
                target="_blank"
                rel="noreferrer"
                className="mono text-[10px] text-cy-300 hover:underline"
              >
                {c.txHash.slice(0, 12)}
              </a>
            )}
          </div>
        ) : (
          <p className="mt-0.5 whitespace-pre-wrap text-[13px] leading-relaxed text-white/70">
            {c.body}
          </p>
        )}
      </div>
    </div>
  );
}
