import { NextRequest } from "next/server";
import type { Address } from "viem";
import { publicClient } from "@/lib/rpc";
import { privateMessagingAbi } from "@/lib/abis";
import { addresses, isDeployed } from "@/lib/addresses";
import { db, rows } from "@/lib/db";
import { isAddress } from "@/lib/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Inbox/outbox *metadata* only.
 *
 * This is the whole point of COTI PrivateMessaging: routing (who, when, which
 * epoch) is public and queryable, while the body is ciphertext that only the
 * sender and recipient can decrypt. Decryption happens in the browser with the
 * user's AES key - the server never sees plaintext and could not decrypt it if
 * it wanted to.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const account = sp.get("account");
  const box = sp.get("box") === "sent" ? "sent" : "inbox";
  const limit = Math.min(50, Number(sp.get("limit") || 20));

  if (!account || !isAddress(account)) {
    return Response.json({ error: "account required" }, { status: 400 });
  }
  if (!isDeployed(addresses.privateMessaging)) {
    return Response.json({ error: "PrivateMessaging contract not configured" }, { status: 503 });
  }

  const c = publicClient();
  const contract = addresses.privateMessaging;

  try {
    const total = (await c.readContract({
      address: contract,
      abi: privateMessagingAbi,
      functionName: box === "sent" ? "sentCount" : "inboxCount",
      args: [account as Address],
    })) as bigint;

    const count = Number(total);
    const offset = Math.max(0, count - limit);

    const ids =
      count === 0
        ? []
        : ((await c.readContract({
            address: contract,
            abi: privateMessagingAbi,
            functionName: box === "sent" ? "getSentPage" : "getInboxPage",
            args: [account as Address, BigInt(offset), BigInt(Math.min(limit, count))],
          })) as readonly bigint[]);

    const metas = await Promise.all(
      [...ids].reverse().map(async (id) => {
        try {
          const m = (await c.readContract({
            address: contract,
            abi: privateMessagingAbi,
            functionName: "getMessageMetadata",
            args: [id],
          })) as readonly [Address, Address, bigint, bigint, number];
          return {
            id: id.toString(),
            from: m[0],
            to: m[1],
            timestamp: Number(m[2]) * 1000,
            epoch: Number(m[3]),
            chunkCount: Number(m[4]),
            encrypted: true,
          };
        } catch {
          return { id: id.toString(), from: "", to: "", timestamp: 0, epoch: 0, chunkCount: 0, encrypted: true };
        }
      }),
    );

    const handles = rows<{ username: string; address: string; avatar: string }>(
      db().prepare("SELECT username, address, avatar FROM profiles").all(),
    );
    const byAddr = new Map(handles.map((h) => [h.address.toLowerCase(), h]));

    return Response.json({
      contract,
      account,
      box,
      total: count,
      messages: metas.map((m) => ({
        ...m,
        fromProfile: byAddr.get(m.from.toLowerCase()) || null,
        toProfile: byAddr.get(m.to.toLowerCase()) || null,
      })),
      note: "Bodies are ciphertext on-chain. Decrypt in the browser with your AES key.",
    });
  } catch (err) {
    return Response.json({ error: "read failed: " + String(err).slice(0, 200) }, { status: 502 });
  }
}
