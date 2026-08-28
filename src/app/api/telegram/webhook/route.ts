import { NextRequest } from "next/server";
import type { Address } from "viem";
import {
  botConfigured,
  callTelegram,
  esc,
  h,
  issueLinkCode,
  linkForChat,
  raw,
  recordChatActivity,
  sendMessage,
  setChatAgent,
  answerCallback,
  networkKeyboard,
  chatNetwork,
  setChatNetwork,
  unlinkChat,
  webhookSecret,
  safeEqual,
} from "@/lib/telegram";
import {
  getAgent,
  ensureThread,
  appendMessage,
  runAgentTurn,
  listAgents,
  canView,
} from "@/lib/agent-runtime";
import { db, rows } from "@/lib/db";
import { nativeBalance, readCurve } from "@/lib/rpc";
import { isDeployed } from "@/lib/addresses";
import {
  NETWORK_LABEL,
  chainByNetwork,
  isNetworkName,
  type CotiNetworkName,
} from "@/lib/chain";
import { cotiQuote } from "@/lib/market";
import { fmtUnits, fmtNum, shortAddr, isAddress } from "@/lib/format";
import { deDash } from "@/lib/text";
import { appUrl } from "@/lib/app-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The Telegram webhook.
 *
 * Everything an agent can do in the browser it can do here, with one exception
 * that is not negotiable: the bot never holds a key and never signs. Anything
 * that would move value is prepared here and handed to the web app, where the
 * user's own wallet decides whether it becomes a transaction.
 *
 * Every reply is built with the `h` template, so token names, agent taglines
 * and history lines are escaped on the way in. Telegram rejects an entire
 * message when one stray angle bracket breaks the markup, and a message that
 * never arrives is far worse than one that looks plain.
 */

interface Update {
  message?: {
    chat: { id: number; type: string };
    from?: { username?: string; first_name?: string };
    text?: string;
  };
  /** A tapped inline button, which arrives as its own kind of update. */
  callback_query?: {
    id: string;
    data?: string;
    from?: { username?: string; first_name?: string };
    message?: { message_id: number; chat: { id: number } };
  };
}

const APP = appUrl();

export async function POST(req: NextRequest) {
  if (!botConfigured()) {
    return Response.json({ ok: false, error: "bot not configured" }, { status: 503 });
  }

  // Telegram echoes back whatever secret was registered with setWebhook, which
  // is what stops anyone else posting fake updates to this endpoint.
  const presented = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!safeEqual(presented, webhookSecret())) {
    return Response.json({ ok: false }, { status: 401 });
  }

  const update = (await req.json().catch(() => ({}))) as Update;

  if (update.callback_query) {
    try {
      await handleCallback(update.callback_query);
    } catch {
      // The button must stop spinning whatever else went wrong.
      await answerCallback(update.callback_query.id).catch(() => undefined);
    }
    return Response.json({ ok: true });
  }

  const message = update.message;
  if (!message?.text) return Response.json({ ok: true });

  const chatId = String(message.chat.id);
  const text = message.text.trim();
  const username = message.from?.username ?? "";
  const firstName = message.from?.first_name ?? "";

  try {
    await handle(chatId, text, username, firstName);
  } catch (err) {
    await sendMessage(
      chatId,
      h`⚠️ <b>Something broke on my side</b>

<i>${String(err).slice(0, 200)}</i>

Try again, or /help for what I can do.`,
    );
  }

  // Telegram retries anything that is not a 200, so always acknowledge.
  return Response.json({ ok: true });
}

async function handle(chatId: string, text: string, username: string, firstName: string) {
  const [rawCommand, ...rest] = text.split(/\s+/);
  const command = rawCommand.toLowerCase().replace(/@\w+$/, "");
  const args = rest.join(" ");
  const link = linkForChat(chatId);
  const net = chatNetwork(chatId);

  switch (command) {
    case "/start":
      return start(chatId, firstName, !!link, net);
    case "/link":
      return linkCommand(chatId, username, firstName);
    case "/unlink":
      unlinkChat(chatId);
      return sendMessage(
        chatId,
        h`🚪 <b>Unlinked</b>

Nothing of yours is stored against this chat any more.

🔗 /link whenever you want to come back.`,
      );
    case "/me":
      return me(chatId, link?.address);
    case "/balance":
      return balance(chatId, net, link?.address);
    case "/launches":
      return launches(chatId, net);
    case "/network":
      return networkCommand(chatId, args, net);
    case "/switch":
      return args ? networkCommand(chatId, args, net) : switchCommand(chatId, net);
    case "/token":
      return token(chatId, args, link?.address);
    case "/bridge":
      return bridge(chatId);
    case "/agent":
      return agentCommand(chatId, args, link);
    case "/history":
      return history(chatId, link?.address);
    case "/help":
      return help(chatId);
    default:
      if (command.startsWith("/")) {
        return sendMessage(
          chatId,
          h`🤔 I do not know ${rawCommand}.

Try /help, or just type a question and I will answer it.`,
        );
      }
      return talk(chatId, text, link);
  }
}

/* ── commands ───────────────────────────────────────────────────────────── */

function start(chatId: string, firstName: string, linked: boolean, net: CotiNetworkName) {
  const hello = firstName ? h`Hey ${firstName}` : raw("Hey there");

  const walletLine = linked
    ? raw("✅ This chat is already linked to a wallet. Try /balance, or just ask me something.")
    : raw("🔗 Run /link to connect a wallet. Reading the market works without one.");

  return sendMessage(
    chatId,
    h`🕶️ <b>VEILPAD</b>
<i>The agentic privacy superapp on COTI</i>

👋 ${hello}. I carry the same agents that run on the site, and I read the chain for you right here in this chat.

⛓ <b>You are on ${NETWORK_LABEL[net]}</b>
${net === "mainnet" ? "💰 Real COTI. Launches and trades settle for value." : "🧪 Free COTI from the faucet. Nothing here is worth anything."}
👇 Tap below to switch, or use /switch any time.

<b>What I can do</b>
🚀 /launches  what is live on the launchpad
🔎 /token  price, curve and venue for any token
🌉 /bridge  what the bridge can carry right now
💰 /balance  your COTI balance
📜 /history  everything you have done
🤖 /agent  pick who you are talking to
🔄 /switch  mainnet or testnet

${walletLine}

🔐 <b>What I will never do</b>
I never hold a key and I never sign. Anything that moves value is prepared here and confirmed in your own wallet on the site.

💬 Type anything at all and the agent answers.
❓ /help for the full list.`,
    { reply_markup: networkKeyboard(net) },
  );
}

/**
 * The network, as a question with two buttons.
 *
 * `/network` says the same thing in words and takes an argument; this is the
 * tappable version, and it is the one `/start` points at. Both write to the
 * same per-chat setting.
 */
/**
 * A tapped button.
 *
 * Telegram leaves the button spinning until the callback is answered, so that
 * happens first and unconditionally - before any work that could fail. The
 * message the button is attached to is then rewritten in place rather than
 * followed by a new one, because a chat where every tap adds another card is a
 * chat nobody can read.
 */
async function handleCallback(cb: NonNullable<Update["callback_query"]>) {
  const chatId = String(cb.message?.chat.id ?? "");
  const data = cb.data ?? "";

  if (!chatId) return answerCallback(cb.id);

  if (data.startsWith("net:")) {
    const wanted = data.slice(4);
    if (!isNetworkName(wanted)) return answerCallback(cb.id, "Unknown network.");

    const current = chatNetwork(chatId);
    if (wanted === current) {
      return answerCallback(cb.id, "Already on " + NETWORK_LABEL[current] + ".");
    }

    setChatNetwork(chatId, wanted);
    await answerCallback(cb.id, "Switched to " + NETWORK_LABEL[wanted]);

    await callTelegram("editMessageText", {
      chat_id: chatId,
      message_id: cb.message?.message_id,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      text: h`${wanted === "mainnet" ? "🟢" : "🟡"} <b>${NETWORK_LABEL[wanted]}</b>

⛓ Chain ${String(chainByNetwork[wanted].id)}
🔎 ${chainByNetwork[wanted].blockExplorers.default.url}

${wanted === "mainnet" ? "💰 Real COTI. Launches, trades and staking settle for value." : "🧪 Free COTI from the faucet. Nothing here is worth anything."}

📊 /launches to see what is on this chain.`,
      reply_markup: networkKeyboard(wanted),
    });
    return;
  }

  return answerCallback(cb.id);
}

function switchCommand(chatId: string, net: CotiNetworkName) {
  return sendMessage(
    chatId,
    h`🔄 <b>Which network?</b>

You are on <b>${NETWORK_LABEL[net]}</b>, chain ${String(chainByNetwork[net].id)}.

🟢 <b>Mainnet</b> — real COTI. Launches, trades and staking settle for value.
🟡 <b>Testnet</b> — free COTI from the faucet. Nothing here is worth anything.

ℹ️ Each network has its own contracts, launches and balances. Nothing crosses between them.`,
    { reply_markup: networkKeyboard(net) },
  );
}

function help(chatId: string) {
  return sendMessage(
    chatId,
    h`❓ <b>Commands</b>

<b>👛 Wallet</b>
🔗 /link  connect a wallet to this chat
👤 /me  which wallet this chat speaks for
💰 /balance  your COTI balance
📜 /history  your recent activity
🚪 /unlink  disconnect this chat

<b>📊 Market</b>
🚀 /launches  what is live on the launchpad
🔎 /token &lt;address&gt;  price, curve and venue
🌉 /bridge  what the bridge can carry

<b>🤖 Agents</b>
/agent &lt;name&gt;  veil · shade · forge · relay · ledger · oracle

<b>⛓ Network</b>
🔄 /switch  pick mainnet or testnet, with buttons
⛓ /network  which chain you are on
🔄 /network mainnet  or  /network testnet

💬 Anything else you type goes straight to the agent.

🔐 <i>I never hold a key and never sign. Anything that moves value opens on the site for your wallet to confirm.</i>`,
  );
}

function linkCommand(chatId: string, username: string, firstName: string) {
  const existing = linkForChat(chatId);
  if (existing) {
    return sendMessage(
      chatId,
      h`✅ <b>Already linked</b>

This chat speaks for <code>${shortAddr(existing.address, 6)}</code>

🚪 Run /unlink first if you want to point it somewhere else.`,
    );
  }

  const code = issueLinkCode(chatId, username, firstName);
  return sendMessage(
    chatId,
    h`🔗 <b>Link this chat</b>

Your code is <code>${code}</code>

<b>What to do</b>
1️⃣ Open ${APP}/dashboard?tab=telegram
2️⃣ Connect your wallet
3️⃣ Paste the code

⏳ <i>Valid for 15 minutes. Linking lets me read that address and grants me nothing else.</i>`,
  );
}

function me(chatId: string, address?: string) {
  if (!address) return needsLink(chatId);
  return sendMessage(
    chatId,
    h`👤 <b>This chat speaks for</b>

<code>${address}</code>

🔗 ${APP}/profile/${address}`,
  );
}

/**
 * Reading or changing which chain this chat is on.
 *
 * Bare `/network` reports; `/network mainnet` or `/network testnet` switches.
 * The wording says what actually changes, because moving to mainnet brings real
 * money into view and should not read as a display setting.
 */
async function networkCommand(chatId: string, args: string, current: CotiNetworkName) {
  const wanted = args.trim().toLowerCase();

  if (!wanted) {
    const other = current === "mainnet" ? "testnet" : "mainnet";
    return sendMessage(
      chatId,
      h`${current === "mainnet" ? "🟢" : "🟡"} <b>${NETWORK_LABEL[current]}</b>
⛓ Chain ${String(chainByNetwork[current].id)}
🔎 ${chainByNetwork[current].blockExplorers.default.url}

🔄 Switch with <code>/network ${other}</code>

ℹ️ Each network has its own contracts, launches and balances. Nothing crosses between them.`,
    );
  }

  if (!isNetworkName(wanted)) {
    return sendMessage(
      chatId,
      h`🤔 I know <code>mainnet</code> and <code>testnet</code>, not ${args}.

Try <code>/network mainnet</code>.`,
    );
  }

  if (wanted === current) {
    return sendMessage(chatId, h`✅ Already on <b>${NETWORK_LABEL[current]}</b>.`);
  }

  setChatNetwork(chatId, wanted);
  return sendMessage(
    chatId,
    h`${wanted === "mainnet" ? "🟢" : "🟡"} Switched to <b>${NETWORK_LABEL[wanted]}</b>

⛓ Chain ${String(chainByNetwork[wanted].id)}
${wanted === "mainnet" ? "💰 Real COTI. Launches and trades settle for value." : "🧪 Free COTI from the faucet. Nothing here is worth anything."}

📊 /launches to see what is on this chain.`,
  );
}

async function balance(chatId: string, net: CotiNetworkName, address?: string) {
  if (!address) return needsLink(chatId);

  const [wei, coti] = await Promise.all([
    nativeBalance(address as Address, net).catch(() => 0n),
    cotiQuote().catch(() => null),
  ]);

  const pretty = fmtUnits(wei, 18, 6);
  const amount = Number(pretty.replace(/,/g, ""));
  const usd = coti ? "≈ $" + (amount * coti.price).toFixed(4) : "";

  return sendMessage(
    chatId,
    h`💰 <b>${pretty} COTI</b>
${usd}

🔐 <i>Private balances are ciphertext on chain. Reading one needs the AES key in your browser, which never leaves it, so I cannot show them here.</i>

👛 ${APP}/dashboard?tab=wallet`,
  );
}

async function launches(chatId: string, net: CotiNetworkName) {
  const list = rows<{ address: string; symbol: string; name: string; curve: string; graduated: number }>(
    db()
      .prepare(
        "SELECT address, symbol, name, curve, graduated FROM tokens WHERE network = ? ORDER BY created_at DESC LIMIT 8",
      )
      .all(net),
  );

  if (!list.length) {
    return sendMessage(
      chatId,
      h`🌱 Nothing launched yet. Be the first.

🚀 ${APP}/launch`,
    );
  }

  const lines = await Promise.all(
    list.map(async (t) => {
      const curve = isDeployed(t.curve) ? await readCurve(t.curve as Address, net).catch(() => null) : null;
      const pooled = t.graduated || curve?.graduated;
      const state = pooled
        ? "🏊 pooled on VeilSwap"
        : curve
          ? "📈 " + curve.progress.toFixed(1) + "% to graduation"
          : "📉 on the curve";
      return h`<b>${t.symbol}</b> ${t.name}
  ${state}
  🔗 ${APP}/coti/${t.address}`;
    }),
  );

  return sendMessage(
    chatId,
    h`🚀 <b>Launchpad</b>

${raw(lines.join("\n\n"))}`,
  );
}

async function token(chatId: string, arg: string, address?: string) {
  const target = arg.trim();
  if (!isAddress(target)) {
    return sendMessage(
      chatId,
      h`🔎 Give me a token address.

<code>/token 0x…</code>

🚀 Or browse /launches`,
    );
  }

  const res = await fetch(APP + "/api/tokens/" + target).catch(() => null);
  if (!res?.ok) {
    return sendMessage(chatId, h`🤷 I could not find a token at <code>${target}</code>`);
  }

  const d = (await res.json()) as {
    token: { symbol: string; name: string; isPrivate: boolean };
    curve: { progressPct: number; reserveCoti: string; targetCoti: string; graduated: boolean } | null;
    pool: { priceCoti: number; reserveCoti: string } | null;
    stats: { tradeCount: number };
  };

  if (address) {
    recordChatActivity(chatId, address, "telegram_read", "Checked " + d.token.symbol, "via Telegram");
  }

  const facts: string[] = [h`🏛 Venue: ${d.pool ? "VeilSwap" : "bonding curve"}`];
  if (d.pool) facts.push(h`💵 Price: ${d.pool.priceCoti.toExponential(4)} COTI`);
  if (d.curve && !d.curve.graduated) {
    facts.push(
      h`📈 Raised: ${d.curve.reserveCoti} / ${d.curve.targetCoti} COTI (${d.curve.progressPct.toFixed(1)}%)`,
    );
  }
  if (d.pool) facts.push(h`🏊 Liquidity: ${d.pool.reserveCoti} COTI`);
  facts.push(h`🔄 Fills: ${d.stats.tradeCount}`);

  return sendMessage(
    chatId,
    h`🔎 <b>${d.token.symbol}</b> ${d.token.name}
${d.token.isPrivate ? "🔐 Encrypted balances" : "👁 Public balances"}

${raw(facts.join("\n"))}

🔗 ${APP}/coti/${target}`,
  );
}

/** What the bridge will actually accept right now, read live rather than listed. */
async function bridge(chatId: string) {
  const res = await fetch(APP + "/api/bridge/assets").catch(() => null);
  if (!res?.ok) return sendMessage(chatId, h`🌉 I could not read the bridge just now.`);

  const d = (await res.json()) as {
    privacy: { available: boolean; assets: { symbol: string; open: boolean }[] };
    crossChain: {
      available: boolean;
      ethName: string;
      assets: { symbol: string }[];
      reason: string | null;
    };
  };

  const privacyLine = d.privacy.assets.map((a) => (a.open ? "✅ " : "⛔️ ") + esc(a.symbol)).join("  ");

  const cross = d.crossChain.available
    ? h`🌍 <b>${d.crossChain.ethName} ↔ COTI</b>
${d.crossChain.assets.map((a) => a.symbol).join(", ")}
<i>A transfer to the address COTI's relayer watches. It credits the sending address, so never send from an exchange.</i>`
    : h`🌍 <b>Cross chain</b>
⛔️ ${d.crossChain.reason ?? "Closed on this network"}`;

  return sendMessage(
    chatId,
    h`🌉 <b>The Bridge</b>

🔐 <b>COTI ↔ COTI Private</b>
${raw(privacyLine)}
<i>Verified contracts on COTI. Lock the public token, receive an encrypted twin.</i>

${raw(cross)}

🔗 ${APP}/bridge`,
  );
}

/**
 * Switching agents, and seeing which ones exist.
 *
 * The list is built for whoever this chat speaks for: the house agents that
 * ship with VEILPAD, plus the agents that address created. A private agent
 * belongs to its creator, so it appears here only when the chat is linked to
 * that address, and never in anyone else's list.
 */
function agentCommand(chatId: string, arg: string, link: { address: string } | null) {
  const slug = arg.trim().toLowerCase().replace(/^@/, "");

  if (!slug) {
    const visible = listAgents(link?.address);
    const house = visible.filter((a) => !a.owner);
    const mine = visible.filter(
      (a) => a.owner && link && a.owner.toLowerCase() === link.address.toLowerCase(),
    );

    const houseList = house
      .map((a) => h`• <b>${a.name}</b> <code>/agent ${a.slug}</code>
  <i>${a.tagline || a.kind}</i>`)
      .join("\n");

    const mineList = mine.length
      ? mine
          .map(
            (a) => h`• <b>${a.name}</b> <code>/agent ${a.slug}</code>
  ${a.visibility === "public" ? "🌍 public" : "🔒 private"} · ${a.kind}${
    a.heartbeat_sec > 0 ? " · ⏱ running" : ""
  }`,
          )
          .join("\n")
      : "";

    const yours = !link
      ? h`🔒 <b>Your agents</b>
Link this chat with /link and the agents you built will show up here. Nobody else can see your private ones.`
      : mine.length
        ? h`🔒 <b>Your agents</b> (${mine.length})
${raw(mineList)}`
        : h`🔒 <b>Your agents</b>
You have not built one yet. ${APP}/agents/new
<i>It runs on VEILPAD infrastructure, so it keeps working after you close this chat.</i>`;

    return sendMessage(
      chatId,
      h`🤖 <b>Agents</b>

🏛 <b>House agents</b>
${raw(houseList)}

${raw(yours)}

✨ Build your own: ${APP}/agents/new`,
    );
  }

  const agent = getAgent(slug);

  // A private agent answers the same way a missing one does, so its existence
  // is not leaked to someone who should not know about it.
  if (!agent || !canView(agent, link?.address)) {
    return sendMessage(
      chatId,
      h`🤷 There is no agent called ${slug} that you can talk to.

Run /agent to see the list.`,
    );
  }

  if (!link) return needsLink(chatId);

  setChatAgent(chatId, agent.slug);
  return sendMessage(
    chatId,
    h`🤖 Now talking to <b>${agent.name}</b>
<i>${agent.tagline || agent.kind}</i>
${agent.owner ? (agent.visibility === "public" ? "🌍 public agent" : "🔒 your private agent") : "🏛 house agent"}

💬 Just type to start.`,
  );
}

async function history(chatId: string, address?: string) {
  if (!address) return needsLink(chatId);

  const res = await fetch(APP + "/api/history?address=" + address + "&limit=8").catch(() => null);
  if (!res?.ok) return sendMessage(chatId, h`📜 I could not read your history right now.`);

  const d = (await res.json()) as {
    entries: { title: string; detail: string; venue: string }[];
    summary: { volumeCoti: number; buys: number; sells: number };
  };

  if (!d.entries.length) {
    return sendMessage(
      chatId,
      h`📜 Nothing yet. Go and do something.

🚀 ${APP}/launchpad`,
    );
  }

  const lines = d.entries.map(
    (e) => h`• <b>${e.title}</b>
  ${e.detail}`,
  );

  return sendMessage(
    chatId,
    h`📜 <b>Recent activity</b>
💱 ${fmtNum(d.summary.volumeCoti, 4)} COTI traded · 🟢 ${d.summary.buys} buys · 🔴 ${d.summary.sells} sells

${raw(lines.join("\n\n"))}

🔗 ${APP}/dashboard?tab=history`,
  );
}

/* ── talking to the agent ───────────────────────────────────────────────── */

async function talk(chatId: string, text: string, link: { address: string; agent: string } | null) {
  const agent = getAgent(link?.agent || "veil");
  if (!agent) return sendMessage(chatId, h`😴 No agent is available right now.`);

  // The turn can take seconds, so say something is happening.
  await callTelegram("sendChatAction", { chat_id: chatId, action: "typing" });

  // One thread per chat, so the agent remembers the conversation the same way
  // it does on the site.
  const threadId = ensureThread(agent.id, "tg_" + chatId, link?.address ?? "");
  appendMessage(threadId, { role: "user", content: text });

  let reply = "";
  const actions: { summary: string }[] = [];

  try {
    for await (const ev of runAgentTurn({
      agent,
      threadId,
      ctx: {
        user: (link?.address as Address) ?? null,
        agentId: agent.id,
        threadId,
        autonomy: agent.autonomy,
      },
    })) {
      if (ev.type === "text") reply += ev.text;
      if (ev.type === "action") actions.push(ev.action as { summary: string });
      if (ev.type === "error" && !reply) reply = "I hit a problem: " + ev.error;
    }
  } catch (err) {
    reply = "I hit a problem: " + String(err).slice(0, 160);
  }

  if (link?.address) {
    recordChatActivity(chatId, link.address, "telegram_chat", agent.name + " replied", text.slice(0, 80));
  }

  let out = h`🤖 <b>${agent.name}</b>

${raw(agentMarkup(reply || "I have nothing useful to add."))}`;

  if (actions.length) {
    out += h`

✍️ <b>Ready to sign</b>
${raw(actions.map((a) => "• " + esc(a.summary)).join("\n"))}

🔐 Open ${APP} to confirm in your own wallet. I never sign anything.`;
  }

  return sendMessage(chatId, out);
}

/**
 * Models answer in Markdown, which Telegram's HTML mode would render literally.
 *
 * Escaping happens first, so nothing the model wrote can inject markup, and
 * only then is a small known set of patterns promoted to real tags. Markdown
 * outside that set stays as plain text, which is the safe direction to fail in.
 */
function agentMarkup(text: string): string {
  return tablesToPre(esc(deDash(text.trim())))
    .replace(/```[a-z]*\n?([\s\S]*?)```/gi, (_m, code: string) => "<pre>" + code.trim() + "</pre>")
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/^\s{0,3}#{1,6}\s*(.+)$/gm, "<b>$1</b>")
    .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s.,!?)]|$)/g, "$1<i>$2</i>")
    .replace(/^\s*[-*]\s+/gm, "• ");
}

/**
 * Telegram has no tables, and a Markdown one arrives as a wall of pipes in a
 * proportional font, with the columns landing nowhere near each other.
 *
 * Monospace is the only alignment Telegram offers, so the table is padded to
 * its real column widths and wrapped in `<pre>`. The separator row is dropped
 * because the dashes carry no information once the pipes line up.
 */
function tablesToPre(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let block: string[] = [];

  const isRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
  const cells = (l: string) =>
    l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
  const isDivider = (l: string) => cells(l).every((c) => /^:?-{2,}:?$/.test(c));

  const flush = () => {
    if (!block.length) return;

    const rows = block.filter((l) => !isDivider(l)).map(cells);
    if (rows.length < 2) {
      out.push(...block);
      block = [];
      return;
    }

    const width = Math.max(...rows.map((r) => r.length));
    const widths = Array.from({ length: width }, (_, i) =>
      Math.max(...rows.map((r) => (r[i] ?? "").length)),
    );

    const rendered = rows.map((r) =>
      Array.from({ length: width }, (_, i) => (r[i] ?? "").padEnd(widths[i])).join("  ").trimEnd(),
    );

    out.push("<pre>" + rendered.join("\n") + "</pre>");
    block = [];
  };

  for (const line of lines) {
    if (isRow(line)) block.push(line);
    else {
      flush();
      out.push(line);
    }
  }
  flush();

  return out.join("\n");
}

function needsLink(chatId: string) {
  return sendMessage(
    chatId,
    h`🔗 <b>This chat is not linked yet</b>

Run /link and I will give you a code to paste on the site while your wallet is connected.

<i>Reading the market works without linking. Only your own wallet needs it.</i>`,
  );
}

export async function GET() {
  return Response.json({
    ok: true,
    configured: botConfigured(),
    note: "Telegram posts updates here. The bot reads and reasons; it never holds a key and never signs.",
  });
}
