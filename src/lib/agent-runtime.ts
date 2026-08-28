import { db, rows, row, now } from "./db";
import { toolSpecs, runTool, type ToolContext } from "./agent-tools";
import { streamComplete, complete, type ChatMessage } from "./llm";
import { chainInfo } from "./rpc";

/**
 * The agent runtime.
 *
 * The distinction that matters: this is not request/response Q&A. Every agent
 * has (a) durable memory that outlives the session, (b) a tool loop that can
 * run several steps before it speaks, (c) a heartbeat that lets it wake up and
 * post on its own, and (d) a standing brief that keeps it in character. It
 * carries a conversation forward instead of answering a question and forgetting.
 */

export interface AgentRow {
  id: string;
  slug: string;
  owner: string;
  name: string;
  kind: string;
  avatar: string;
  tagline: string;
  persona: string;
  autonomy: "advisory" | "approval" | "auto";
  visibility: "private" | "public";
  wallet: string;
  token: string;
  config: string;
  memory: string;
  status: string;
  heartbeat_sec: number;
  last_tick: number;
  created_at: number;
  updated_at: number;
}

export const AGENT_KINDS = ["trader", "launcher", "social", "research", "ops"] as const;
export type AgentKind = (typeof AGENT_KINDS)[number];

const KIND_BRIEF: Record<string, string> = {
  trader: `You are a PRIVATE TRADING AGENT. Your edge is that your strategy lives behind COTI's
garbled-circuit privacy: positions and balances are ciphertext on-chain, so nobody front-runs you
and nobody copy-trades you. You watch the curve, you form a thesis, you size it, you say what would
falsify it. You never claim a number you did not fetch with a tool.`,

  launcher: `You are a LAUNCH AGENT. You take a half-formed idea and turn it into a shipped token on
VEILPAD: name, ticker, launch copy, and the actual on-chain launch. You are opinionated about naming
and honest about risk. Tokens start on a bonding curve and graduate into a VeilSwap pair once the
curve fills.

Supply is fixed at 1,000,000,000 for every VEILPAD launch. Never ask the user to choose a supply and
never quote a different number. Ask only for what you actually need: ticker, name, description. An
image, socials and a dev buy are optional. Keep, burn or lock of the dev's own tokens is chosen on
the launch page at signing time, not by you.`,

  social: `You are a SOCIAL AGENT. You live in the agent-to-agent network: you find counterparties,
negotiate, and send end-to-end encrypted on-chain messages via COTI PrivateMessaging. Routing metadata
is public, message bodies never are. You are concise and you always say who you are talking to.`,

  research: `You are a RESEARCH AGENT. You dig - chain state, market data, live web - and you separate
what you verified from what you are inferring. You state confidence. You would rather say "I could not
confirm this" than fill a gap with a guess.`,

  ops: `You are an OPS AGENT. You handle the plumbing: balances, bridging between Ethereum and COTI,
transaction triage, wallet hygiene, moving value where it needs to be. You are precise about addresses
and you always restate a destination before proposing a transfer.`,
};

const AUTONOMY_BRIEF: Record<string, string> = {
  advisory: `AUTONOMY: ADVISORY. You may read anything and recommend anything, but you do not propose
transactions unless the user asks for one explicitly.`,
  approval: `AUTONOMY: APPROVAL. You propose transactions freely as signable cards. The user signs with
their own wallet - you never hold keys. Propose decisively, then explain.`,
  auto: `AUTONOMY: AUTO. You act on your own within the limits in your config, and you report every
action you take, before and after. If an action would exceed your limits, propose it instead.`,
};

export function systemPrompt(agent: AgentRow, ctx: ToolContext, extra?: string): string {
  const info = chainInfo();
  let memory: string[] = [];
  try {
    memory = JSON.parse(agent.memory || "[]");
  } catch {
    memory = [];
  }

  return [
    `You are ${agent.name}, an autonomous agent living inside VEILPAD - the agentic privacy superapp on COTI.`,
    agent.tagline ? `Your tagline: ${agent.tagline}` : "",
    "",
    KIND_BRIEF[agent.kind] || KIND_BRIEF.research,
    "",
    AUTONOMY_BRIEF[agent.autonomy] || AUTONOMY_BRIEF.approval,
    agent.persona ? `\nOWNER'S BRIEF TO YOU:\n${agent.persona}` : "",
    "",
    `NETWORK: ${info.name} (chain ${info.chainId}). Explorer ${info.explorer}.`,
    `COTI is an EVM chain where confidentiality comes from garbled circuits run by an MPC network -`,
    `balances and message bodies are ciphertext on-chain and only key-holders can read them.`,
    `A PrivateERC20 returns totalSupply = 0 on purpose; that is privacy, not a bug.`,
    "",
    /**
     * Facts every agent gets wrong when left to general knowledge.
     *
     * A model that has read a thousand launchpad docs will confidently ask for
     * an initial supply, because that is how most of them work. Stating the
     * house rules here stops any agent inventing a flow VEILPAD does not have,
     * including the ones with no launch tool of their own.
     */
    `HOW VEILPAD ACTUALLY WORKS. Do not infer these from other launchpads:`,
    `- Every launch has a FIXED supply of 1,000,000,000 tokens. There is no supply choice. Never ask for one.`,
    `- A launch needs only a ticker, a name and a description. Image, socials and a dev buy are optional.`,
    `- Keeping, burning or locking the creator's own tokens is chosen on the launch page at signing time.`,
    `- Every launched contract address ends in 8888.`,
    `- Tokens start on a bonding curve and graduate into a VeilSwap pair when the curve fills.`,
    `- The bridge has two halves. COTI to COTI Private carries exactly seven assets: COTI, gCOTI, WETH,`,
    `  WBTC, USDT, USDC.e and WADA. Ethereum to COTI carries COTI and gCOTI only. These are settled`,
    `  facts, so state them directly rather than searching the web for them.`,
    `- You never sign anything. You prepare an action and the user's own wallet confirms it.`,
    "",
    ctx.user ? `CONNECTED WALLET: ${ctx.user}` : `No wallet is connected right now.`,
    "",
    memory.length
      ? `WHAT YOU REMEMBER (durable, across sessions):\n${memory.map((m) => "- " + m).join("\n")}`
      : `You have no stored memories yet. Use the remember tool when you learn something worth keeping.`,
    "",
    `HOW YOU BEHAVE:`,
    `- You are in an ongoing relationship, not a Q&A session. Refer back to what happened earlier.`,
    `- Use tools before asserting facts. Numbers you did not fetch are numbers you do not state.`,
    `- Chain several tools in one turn when a question needs it. Do not narrate that you are "about to check" - check.`,
    `- Keep replies tight. Two or three short paragraphs, or a few bullets. No walls of text.`,
    `- End with momentum: the next thing you will do, or the one thing you need from the user.`,
    `- Never invent an address, a price, a transaction hash or a pool. Say you could not find it.`,
    `- When you propose an action, say plainly what it costs and what could go wrong.`,
    extra ? "\n" + extra : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/* ── thread + message persistence ─────────────────────────────────────── */

export interface StoredMessage {
  id: number;
  thread_id: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls: string;
  tool_call_id: string;
  name: string;
  meta: string;
  created_at: number;
}

export function getAgent(idOrSlug: string): AgentRow | null {
  return row<AgentRow>(
    db().prepare("SELECT * FROM agents WHERE id = ? OR slug = ?").get(idOrSlug, idOrSlug),
  );
}

/**
 * Which agents a given viewer is allowed to see.
 *
 * The rule is deliberately simple, because anything subtler gets a privacy
 * decision wrong eventually: a private agent is visible to the address that
 * created it and to nobody else, and the house agents that ship with VEILPAD
 * have no owner so they are always public.
 *
 * Passing no viewer is the anonymous case, and it sees only public agents.
 * `ownedOnly` narrows to what the viewer actually created, which is what the
 * "your agents" surfaces want.
 */
export function listAgents(viewer?: string, ownedOnly = false): AgentRow[] {
  if (ownedOnly) {
    if (!viewer) return [];
    return rows<AgentRow>(
      db()
        .prepare("SELECT * FROM agents WHERE lower(owner) = lower(?) ORDER BY created_at DESC")
        .all(viewer),
    );
  }

  if (!viewer) {
    return rows<AgentRow>(
      db()
        .prepare(
          "SELECT * FROM agents WHERE visibility = 'public' OR owner = '' ORDER BY created_at DESC LIMIT 100",
        )
        .all(),
    );
  }

  return rows<AgentRow>(
    db()
      .prepare(
        `SELECT * FROM agents
          WHERE visibility = 'public' OR owner = '' OR lower(owner) = lower(?)
          ORDER BY created_at DESC LIMIT 100`,
      )
      .all(viewer),
  );
}

/** True when this viewer may open the agent at all. */
export function canView(agent: AgentRow, viewer?: string): boolean {
  if (agent.visibility === "public" || !agent.owner) return true;
  return !!viewer && agent.owner.toLowerCase() === viewer.toLowerCase();
}

export function ensureThread(agentId: string, threadId?: string, owner = ""): string {
  if (threadId) {
    const t = row(db().prepare("SELECT id FROM threads WHERE id = ?").get(threadId));
    if (t) return threadId;
  }
  const id = threadId || "th_" + Math.random().toString(36).slice(2, 12);
  db()
    .prepare("INSERT INTO threads (id, agent_id, owner, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, agentId, owner, "New session", now(), now());
  return id;
}

export function appendMessage(threadId: string, m: Partial<StoredMessage> & { role: string }) {
  db()
    .prepare(
      "INSERT INTO messages (thread_id, role, content, tool_calls, tool_call_id, name, meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      threadId,
      m.role,
      m.content || "",
      m.tool_calls || "",
      m.tool_call_id || "",
      m.name || "",
      m.meta || "{}",
      now(),
    );
  db().prepare("UPDATE threads SET updated_at = ? WHERE id = ?").run(now(), threadId);
}

export function threadMessages(threadId: string, limit = 60): StoredMessage[] {
  const list = rows<StoredMessage>(
    db()
      .prepare("SELECT * FROM messages WHERE thread_id = ? ORDER BY id DESC LIMIT ?")
      .all(threadId, limit),
  );
  return list.reverse();
}

/** Rehydrate stored rows into the wire format the model expects. */
export function toChatMessages(stored: StoredMessage[]): ChatMessage[] {
  return stored.map((m) => {
    const base: ChatMessage = { role: m.role, content: m.content || null };
    if (m.tool_calls) {
      try {
        base.tool_calls = JSON.parse(m.tool_calls);
      } catch {
        /* ignore malformed */
      }
    }
    if (m.tool_call_id) base.tool_call_id = m.tool_call_id;
    if (m.name) base.name = m.name;
    return base;
  });
}

function clip(payload: string): string {
  if (payload.length <= TOOL_RESULT_CHARS) return payload;
  return payload.slice(0, TOOL_RESULT_CHARS) + '…","truncated":true}';
}

/**
 * A `tool` message is only valid if the assistant message that requested it is
 * still in the window. Slicing a transcript can orphan one, which some
 * providers reject outright - so drop any tool message whose call id is no
 * longer present, and any assistant tool_call whose result was dropped.
 */
function trimHistory(messages: ChatMessage[]): ChatMessage[] {
  const callIds = new Set<string>();
  for (const m of messages) {
    for (const c of m.tool_calls || []) callIds.add(c.id);
  }

  const kept = messages.filter((m) => m.role !== "tool" || (m.tool_call_id && callIds.has(m.tool_call_id)));

  const answered = new Set(kept.filter((m) => m.role === "tool").map((m) => m.tool_call_id));
  return kept
    .map((m) => {
      if (!m.tool_calls?.length) return m;
      const live = m.tool_calls.filter((c) => answered.has(c.id));
      if (live.length === m.tool_calls.length) return m;
      if (!live.length) {
        const { tool_calls: _drop, ...rest } = m;
        return rest.content ? (rest as ChatMessage) : null;
      }
      return { ...m, tool_calls: live };
    })
    .filter((m): m is ChatMessage => m !== null);
}

/**
 * The request body has a size limit, and message count does not track it.
 *
 * Sixteen turns of chat is small; sixteen turns where each one carried a
 * 1400-character tool result is not, and the provider answers HTTP 413. That
 * failure looked to the user like the bot going silent or replying with
 * nothing, which is exactly what it was. So the context is fitted to a
 * character budget: the system prompt always survives, then messages are kept
 * from the most recent backwards until the budget runs out.
 */
/**
 * Measured, not guessed. The smallest model in the pool rejects a 29KB request
 * with HTTP 413, and roughly 8KB of that is the tool schema, so the message
 * history has to fit well inside what is left. Sizing to the weakest provider
 * keeps every entry in the pool usable instead of silently dropping to one.
 */
const CONTEXT_CHARS = 12_000;

function fitContext(messages: ChatMessage[], budget = CONTEXT_CHARS): ChatMessage[] {
  const size = (m: ChatMessage) =>
    (m.content?.length ?? 0) + (m.tool_calls ? JSON.stringify(m.tool_calls).length : 0) + 32;

  const system = messages[0]?.role === "system" ? messages[0] : null;
  const rest = system ? messages.slice(1) : messages;

  let used = system ? size(system) : 0;
  const kept: ChatMessage[] = [];

  for (let i = rest.length - 1; i >= 0; i -= 1) {
    const s = size(rest[i]);
    // Always keep the most recent message, even if it alone is oversized:
    // dropping it would mean answering a question the model cannot see.
    if (used + s > budget && kept.length) break;
    used += s;
    kept.unshift(rest[i]);
  }

  // Slicing can orphan a tool result from the call that asked for it.
  return system ? [system, ...trimHistory(kept)] : trimHistory(kept);
}

export function threadTitleFrom(text: string): string {
  return text.trim().replace(/\s+/g, " ").slice(0, 60) || "New session";
}

/* ── the agentic loop ─────────────────────────────────────────────────── */

export type AgentEvent =
  | { type: "thread"; threadId: string }
  | { type: "step"; step: number }
  | { type: "text"; text: string }
  | { type: "tool_start"; name: string; args: string }
  | { type: "tool_end"; name: string; ok: boolean; result: unknown }
  | { type: "action"; action: Record<string, unknown> }
  | { type: "done"; model: string; steps: number }
  | { type: "error"; error: string };

const MAX_STEPS = 6;

/** How many times a single reply may be resumed after a length stop. */
const MAX_CONTINUATIONS = 3;

const CONTINUE_PROMPT =
  "Continue your previous message from exactly where it stopped, mid-word if that is where it ended. " +
  "Do not repeat anything you already wrote, do not restate it, and do not start over.";

/**
 * Context budget.
 *
 * The hosted models are metered per minute, so a long transcript does not just
 * cost money - it costs the agent its next turn. We keep a short window of
 * recent messages and clip tool payloads, which is enough for the agent to
 * stay coherent because anything worth keeping longer belongs in `remember`.
 */
const HISTORY_TURNS = 16;
/**
 * Tool payloads are the bulk of a long conversation. Keeping each one smaller
 * means more turns of actual dialogue survive inside the same budget, which
 * matters more to the answer than the tail of a JSON blob.
 */
const TOOL_RESULT_CHARS = 1_200;

/**
 * One turn of the agent. It may take several internal steps - read the market,
 * read the token, quote the trade - and only then speak. Each step is streamed
 * so the user watches it think instead of staring at a spinner.
 */
export async function* runAgentTurn(opts: {
  agent: AgentRow;
  threadId: string;
  ctx: ToolContext;
  /** Extra system guidance for this turn only (e.g. heartbeat instructions). */
  turnBrief?: string;
}): AsyncGenerator<AgentEvent> {
  const { agent, threadId, ctx } = opts;

  const history = trimHistory(toChatMessages(threadMessages(threadId, HISTORY_TURNS)));
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(agent, ctx, opts.turnBrief) },
    ...history,
  ];

  const specs = toolSpecs(agent.kind);
  let model = "";
  let step = 0;
  /** Whether the user has already been given words this turn. */
  let spoke = 0;

  try {
    while (step < MAX_STEPS) {
      step += 1;
      yield { type: "step", step };

      let assistant: ChatMessage | null = null;

      /**
       * Keep going until the model has actually finished.
       *
       * Reasoning models spend part of the token budget thinking, so a reply
       * can stop mid-word with `finish_reason: "length"` while looking like a
       * completed answer. Raising the ceiling alone does not fix that, it just
       * moves where the cut lands, so a severed reply is resumed and stitched
       * onto the same assistant message.
       */
      const context = [...messages];
      let continuations = 0;

      for (;;) {
        let chunk: ChatMessage | null = null;
        let finishReason = "";

        for await (const ev of streamComplete({
          messages: fitContext(context),
          tools: specs,
          temperature: agent.kind === "trader" ? 0.4 : 0.7,
          maxTokens: 2048,
        })) {
          if (ev.type === "text") {
            spoke += ev.text.length;
            yield { type: "text", text: ev.text };
          } else {
            chunk = ev.message;
            model = ev.model;
            finishReason = ev.finishReason;
          }
        }

        if (!chunk) break;

        if (!assistant) {
          assistant = chunk;
        } else {
          assistant.content = (assistant.content ?? "") + (chunk.content ?? "");
          if (chunk.tool_calls?.length) assistant.tool_calls = chunk.tool_calls;
        }

        // A truncated tool call cannot be stitched back together safely, so
        // only plain prose is resumed.
        const severed =
          finishReason === "length" && !chunk.tool_calls?.length && !!chunk.content;

        if (!severed || continuations >= MAX_CONTINUATIONS) break;

        continuations += 1;
        yield { type: "step", step };
        context.push({ role: "assistant", content: chunk.content ?? "" });
        context.push({ role: "user", content: CONTINUE_PROMPT });
      }

      if (!assistant) {
        // Falling back rather than returning: the tool results gathered so far
        // are usually enough to answer with, and an empty reply is the one
        // outcome the user can do nothing with.
        console.warn("agent: model returned nothing at step " + step + ", forcing a final answer");
        for await (const ev of finalAnswer(messages, threadId)) {
          if (ev.type === "text") yield { type: "text", text: ev.text };
          else model = ev.model || model;
        }
        yield { type: "done", model, steps: step };
        return;
      }

      messages.push(assistant);
      appendMessage(threadId, {
        role: "assistant",
        content: assistant.content || "",
        tool_calls: assistant.tool_calls ? JSON.stringify(assistant.tool_calls) : "",
      });

      const calls = assistant.tool_calls || [];
      if (!calls.length) {
        yield { type: "done", model, steps: step };
        return;
      }

      for (const call of calls) {
        yield { type: "tool_start", name: call.function.name, args: call.function.arguments };

        const result = await runTool(call.function.name, call.function.arguments, ctx);

        yield { type: "tool_end", name: call.function.name, ok: !!result.ok, result };
        if (result.action) {
          yield { type: "action", action: result.action as Record<string, unknown> };
        }

        const payload = clip(JSON.stringify(result));
        const toolMsg: ChatMessage = {
          role: "tool",
          content: payload,
          tool_call_id: call.id,
          name: call.function.name,
        };
        messages.push(toolMsg);
        appendMessage(threadId, {
          role: "tool",
          content: payload,
          tool_call_id: call.id,
          name: call.function.name,
          meta: result.action ? JSON.stringify({ action: result.action }) : "{}",
        });
      }
    }

    /**
     * Out of tool budget, and still nothing said.
     *
     * Reaching MAX_STEPS used to end the turn on a tool result, so the caller
     * had an empty reply and the user got "I have nothing useful to add" after
     * the agent had just done six useful lookups. One more pass with no tools
     * offered forces the model to answer from what it already gathered.
     */
    if (!spoke) {
      for await (const ev of finalAnswer(messages, threadId)) {
        if (ev.type === "text") yield { type: "text", text: ev.text };
        else model = ev.model || model;
      }
    }

    yield { type: "done", model, steps: step };
  } catch (err) {
    console.warn("agent turn failed at step " + step + ": " + String(err).slice(0, 300));

    // One more attempt with no tools. If the failure was in the tool-calling
    // path it often succeeds, and the user gets an answer instead of an
    // apology built from an exception message.
    let rescued = "";
    if (!spoke) {
      try {
        for await (const ev of finalAnswer(messages, threadId)) {
          if (ev.type === "text") {
            rescued += ev.text;
            yield { type: "text", text: ev.text };
          }
        }
      } catch {
        /* the rescue is best effort */
      }
    }

    if (!rescued.trim() && !spoke) yield { type: "error", error: String(err).slice(0, 400) };
    else yield { type: "done", model, steps: step };
  }
}

/**
 * One tool-free completion, so a turn always ends in words.
 *
 * Passing no tools is what makes this terminate: the model cannot ask for
 * another lookup even if it wants one.
 */
async function* finalAnswer(
  messages: ChatMessage[],
  threadId: string,
): AsyncGenerator<{ type: "text"; text: string } | { type: "done"; model: string }> {
  const context = [
    ...messages,
    {
      role: "user" as const,
      content:
        "You have run out of tool calls for this turn. Answer now, completely, using only what you " +
        "already gathered above. Do not ask to run more tools and do not mention this instruction.",
    },
  ];

  let text = "";
  let model = "";

  try {
    for await (const ev of streamComplete({
      messages: fitContext(context),
      temperature: 0.5,
      maxTokens: 2048,
    })) {
      if (ev.type === "text") {
        text += ev.text;
        yield { type: "text", text: ev.text };
      } else {
        model = ev.model;
      }
    }
  } catch {
    // The turn still ends; the caller reports what it has.
  }

  if (text.trim()) appendMessage(threadId, { role: "assistant", content: text });
  yield { type: "done", model };
}

/**
 * Heartbeat tick - the agent wakes itself, looks around and decides whether
 * anything is worth saying. Silence is a valid outcome; an agent that
 * comments on nothing every minute is noise, not intelligence.
 */
export async function heartbeatTick(agent: AgentRow): Promise<{ spoke: boolean; text: string }> {
  const ctx: ToolContext = {
    user: (agent.owner || null) as `0x${string}` | null,
    agentId: agent.id,
    autonomy: agent.autonomy,
  };

  const brief = `This is an unprompted HEARTBEAT wake-up, not a user message. Check what you are watching.
If nothing material changed, reply with exactly the token NOTHING and nothing else. Only speak if you
have something a human would actually want pushed to them: a level hit, a launch nearing graduation,
a thesis invalidated. If you speak, be under 60 words and lead with the fact.`;

  try {
    const res = await complete({
      messages: [
        { role: "system", content: systemPrompt(agent, ctx, brief) },
        { role: "user", content: "[heartbeat] Anything worth reporting?" },
      ],
      tools: toolSpecs(agent.kind),
      temperature: 0.5,
      maxTokens: 500,
    });

    const text = (res.message.content || "").trim();
    db().prepare("UPDATE agents SET last_tick = ? WHERE id = ?").run(now(), agent.id);

    if (!text || text.toUpperCase().includes("NOTHING")) return { spoke: false, text: "" };

    db()
      .prepare("INSERT INTO agent_events (agent_id, kind, title, body, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(agent.id, "heartbeat", text.slice(0, 80), text, now());

    return { spoke: true, text };
  } catch (err) {
    db().prepare("UPDATE agents SET last_tick = ? WHERE id = ?").run(now(), agent.id);
    return { spoke: false, text: String(err).slice(0, 200) };
  }
}
