import { NextRequest } from "next/server";
import {
  botConfigured,
  linksForAddress,
  redeemLinkCode,
  unlinkChat,
  sendMessage,
  chatActivity,
} from "@/lib/telegram";
import { isAddress, shortAddr } from "@/lib/format";
import { appUrl } from "@/lib/app-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BOT = // Still @VeilPadBot: a bot's @username can only be changed in BotFather, by
// hand. The display name, description and command list are all DEVOXPAD
// already - the handle is the one piece the API cannot rebrand. Flip the env
// var the moment the username is changed there.
  process.env.NEXT_PUBLIC_TELEGRAM_BOT || "VeilPadBot";
const APP = appUrl();

/** Which chats an address has linked, and what they have been up to. */
export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address") || "";
  if (!isAddress(address)) {
    return Response.json({ error: "address required" }, { status: 400 });
  }

  const links = linksForAddress(address).map((l) => ({
    chatId: l.chat_id,
    username: l.username,
    firstName: l.first_name,
    agent: l.agent,
    linkedAt: l.linked_at,
  }));

  return Response.json({
    configured: botConfigured(),
    bot: BOT,
    botUrl: "https://t.me/" + BOT,
    links,
    activity: chatActivity(address, 20),
  });
}

/**
 * Redeems the code the bot handed out.
 *
 * The code proves control of the chat; the connected wallet proves control of
 * the address. Neither alone is enough, which is what keeps someone from
 * linking a chat to an address they do not hold.
 */
export async function POST(req: NextRequest) {
  const b = (await req.json().catch(() => ({}))) as Record<string, string>;
  const address = String(b.address || "");
  const code = String(b.code || "");

  if (!isAddress(address)) return Response.json({ error: "connect a wallet first" }, { status: 400 });
  if (!code.trim()) return Response.json({ error: "paste the code from the bot" }, { status: 400 });

  const link = redeemLinkCode(code, address);
  if (!link) {
    return Response.json(
      { error: "That code is wrong, already used, or older than fifteen minutes." },
      { status: 400 },
    );
  }

  await sendMessage(
    link.chat_id,
    "<b>Linked</b>\n\nThis chat now speaks for <code>" +
      shortAddr(address, 6) +
      "</code>.\n\nTry /balance, /launches, or just ask me something.\n\n" +
      "<i>I still never hold a key and never sign. Anything that moves value opens at " +
      APP +
      " for your wallet to confirm.</i>",
  );

  return Response.json({ ok: true, chatId: link.chat_id, username: link.username });
}

export async function DELETE(req: NextRequest) {
  const chatId = req.nextUrl.searchParams.get("chatId") || "";
  if (!chatId) return Response.json({ error: "chatId required" }, { status: 400 });

  unlinkChat(chatId);
  await sendMessage(chatId, "This chat was unlinked from the site. Run /link to connect again.");

  return Response.json({ ok: true });
}
