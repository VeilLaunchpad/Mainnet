/**
 * THE BRAIN - an OpenAI-compatible pool with automatic failover.
 *
 * Rate limits are per model per account, so every (account x model) pair is
 * extra headroom. On 429/402/5xx the entry is parked for a cooldown and the
 * next one is used, so the agents keep talking even under load.
 */

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: ChatRole;
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolSpec {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface PoolEntry {
  preset: string;
  apiKey: string;
  model: string;
  baseUrl: string;
  parkedUntil: number;
}

/** Groq returns the wait in `retry-after` (seconds) - respect it. */
function parkFor(entry: PoolEntry, res?: Response) {
  const header = res?.headers.get("retry-after");
  const secs = header ? Number(header) : NaN;
  const wait = Number.isFinite(secs) && secs > 0 ? Math.min(secs * 1000, 60_000) : PARK_MS;
  entry.parkedUntil = Date.now() + wait;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const PARK_MS = 20_000;

let _pool: PoolEntry[] | null = null;

/**
 * Round-robin cursor.
 *
 * Groq's free tier meters ~8k tokens per minute per (key, model). Always
 * starting at entry 0 means entry 0 absorbs every request and hits that
 * ceiling within a few agent steps while the other eight sit idle. Rotating
 * the start spreads a conversation across the whole pool, which is the entire
 * reason the pool has nine entries.
 */
let _cursor = 0;

function presets(): Record<string, string> {
  const raw = process.env.LLM_PRESETS || "";
  const out: Record<string, string> = {
    groq: "https://api.groq.com/openai/v1",
    openai: "https://api.openai.com/v1",
    openrouter: "https://openrouter.ai/api/v1",
  };
  for (const part of raw.split(",")) {
    const [name, url] = part.split("=");
    if (name && url) out[name.trim()] = url.trim();
  }
  return out;
}

function pool(): PoolEntry[] {
  if (_pool) return _pool;
  const p = presets();
  const entries: PoolEntry[] = [];
  for (const part of (process.env.LLM_POOL || "").split(",")) {
    const [preset, apiKey, model] = part.split("|").map((s) => s?.trim());
    if (!preset || !apiKey || !model) continue;
    const baseUrl = p[preset];
    if (!baseUrl) continue;
    entries.push({ preset, apiKey, model, baseUrl, parkedUntil: 0 });
  }
  _pool = entries;
  return entries;
}

export function brainAvailable(): boolean {
  return pool().length > 0;
}

/**
 * Health of the reasoning pool, without naming what is inside it.
 *
 * Which model or vendor answers a turn is an implementation detail, and
 * publishing it invites people to treat VEILPAD as a thin wrapper over someone
 * else's product. Capacity and health are what an operator actually needs.
 */
export function brainStatus() {
  const t = Date.now();
  const entries = pool();
  const healthy = entries.filter((e) => e.parkedUntil <= t).length;

  return {
    capacity: entries.length,
    healthy,
    /** 0 to 1. Anything above zero means agents can still answer. */
    availability: entries.length ? healthy / entries.length : 0,
    failover: entries.length > 1,
    status: healthy === 0 ? "down" : healthy < entries.length ? "degraded" : "operational",
  };
}

export interface CompleteOptions {
  messages: ChatMessage[];
  tools?: ToolSpec[];
  temperature?: number;
  maxTokens?: number;
  prefer?: string;
}

export interface CompleteResult {
  message: ChatMessage;
  model: string;
  finishReason: string;
}

function orderedEntries(prefer?: string): PoolEntry[] {
  const all = pool();
  if (!all.length) return [];

  // Rotate the starting point so consecutive calls land on different entries.
  const start = _cursor % all.length;
  _cursor = (_cursor + 1) % all.length;
  const rotated = [...all.slice(start), ...all.slice(0, start)];

  const t = Date.now();
  const live = rotated.filter((e) => e.parkedUntil <= t);
  const usable = live.length ? live : rotated;

  if (!prefer) return usable;
  return [...usable].sort((a, b) => {
    const av = a.model.includes(prefer) ? 0 : 1;
    const bv = b.model.includes(prefer) ? 0 : 1;
    return av - bv;
  });
}

/** Shortest wait until some entry frees up, so a full sweep can retry. */
function soonestUnpark(): number {
  const t = Date.now();
  const waits = pool().map((e) => Math.max(0, e.parkedUntil - t));
  return waits.length ? Math.min(...waits) : 0;
}

/** Non-streaming completion with tool support. Walks the pool on failure. */
export async function complete(opts: CompleteOptions, retriesLeft = 1): Promise<CompleteResult> {
  const entries = orderedEntries(opts.prefer);
  if (!entries.length) throw new Error("LLM pool is empty - set LLM_POOL in .env.local");

  let lastErr: unknown = null;

  for (const entry of entries) {
    try {
      const res = await fetch(entry.baseUrl + "/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer " + entry.apiKey,
        },
        body: JSON.stringify({
          model: entry.model,
          messages: opts.messages,
          ...(opts.tools?.length ? { tools: opts.tools, tool_choice: "auto" } : {}),
          temperature: opts.temperature ?? 0.7,
          max_tokens: opts.maxTokens ?? 2048,
        }),
      });

      if (res.status === 429 || res.status === 402 || res.status >= 500) {
        parkFor(entry, res);
        lastErr = new Error(entry.model + " -> HTTP " + res.status);
        continue;
      }
      if (!res.ok) {
        lastErr = new Error(entry.model + " -> HTTP " + res.status + ": " + (await res.text()));
        continue;
      }

      const json = (await res.json()) as {
        choices?: { message?: ChatMessage; finish_reason?: string }[];
      };
      const choice = json.choices?.[0];
      if (!choice?.message) {
        lastErr = new Error("empty completion");
        continue;
      }
      return {
        message: choice.message,
        model: entry.model,
        finishReason: choice.finish_reason || "stop",
      };
    } catch (err) {
      parkFor(entry);
      lastErr = err;
    }
  }

  // Everything is throttled. Rather than failing the turn, wait for the
  // soonest window to open and take one more pass - a few seconds of latency
  // beats dropping the agent mid-thought.
  if (retriesLeft > 0) {
    const wait = Math.min(Math.max(soonestUnpark(), 1_000), 12_000);
    await sleep(wait);
    return complete(opts, retriesLeft - 1);
  }

  throw new Error("all LLM pool entries failed: " + String(lastErr));
}

export type StreamEvent =
  | { type: "text"; text: string }
  /**
   * `finishReason` matters more than it looks. Reasoning models spend part of
   * the same token budget on thinking, so a generous-looking limit can still
   * stop the visible answer mid-word. Without this the caller cannot tell a
   * finished reply from a severed one.
   */
  | { type: "done"; message: ChatMessage; model: string; finishReason: string };

/**
 * Streaming completion. Yields text deltas as they arrive and accumulates any
 * tool-call fragments, emitting the assembled assistant message on close so the
 * agent loop can act without a second round-trip.
 */
export async function* streamComplete(
  opts: CompleteOptions,
  retriesLeft = 1,
): AsyncGenerator<StreamEvent> {
  const entries = orderedEntries(opts.prefer);
  if (!entries.length) throw new Error("LLM pool is empty - set LLM_POOL in .env.local");

  let lastErr: unknown = null;

  for (const entry of entries) {
    let res: Response;
    let body = "";
    try {
      body = JSON.stringify({
        model: entry.model,
        messages: opts.messages,
        ...(opts.tools?.length ? { tools: opts.tools, tool_choice: "auto" } : {}),
        temperature: opts.temperature ?? 0.7,
        max_tokens: opts.maxTokens ?? 2048,
        stream: true,
      });

      res = await fetch(entry.baseUrl + "/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer " + entry.apiKey,
        },
        body,
      });
    } catch (err) {
      parkFor(entry);
      lastErr = err;
      continue;
    }

    if (!res.ok || !res.body) {
      if (res.status === 429 || res.status === 402 || res.status >= 500) {
        parkFor(entry, res);
      }
      const detail =
        res.status === 413
          ? " (payload " + Math.round(body.length / 1024) + "KB, " + (opts.tools?.length ?? 0) + " tools)"
          : "";
      lastErr = new Error(entry.model + " -> HTTP " + res.status + detail);
      continue;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";
    let finishReason = "";
    const calls: ToolCall[] = [];

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") continue;

        let parsed: {
          choices?: {
            finish_reason?: string | null;
            delta?: {
              content?: string;
              tool_calls?: {
                index: number;
                id?: string;
                function?: { name?: string; arguments?: string };
              }[];
            };
          }[];
        };
        try {
          parsed = JSON.parse(payload);
        } catch {
          continue;
        }

        const choice = parsed.choices?.[0];
        if (choice?.finish_reason) finishReason = choice.finish_reason;

        const delta = choice?.delta;
        if (delta?.content) {
          text += delta.content;
          yield { type: "text", text: delta.content };
        }
        for (const tc of delta?.tool_calls || []) {
          const slot = (calls[tc.index] ||= {
            id: tc.id || "call_" + tc.index,
            type: "function",
            function: { name: "", arguments: "" },
          });
          if (tc.id) slot.id = tc.id;
          if (tc.function?.name) slot.function.name += tc.function.name;
          if (tc.function?.arguments) slot.function.arguments += tc.function.arguments;
        }
      }
    }

    const finalCalls = calls.filter(Boolean);
    yield {
      type: "done",
      model: entry.model,
      finishReason,
      message: {
        role: "assistant",
        content: text || null,
        ...(finalCalls.length ? { tool_calls: finalCalls } : {}),
      },
    };
    return;
  }

  if (retriesLeft > 0) {
    const wait = Math.min(Math.max(soonestUnpark(), 1_000), 12_000);
    await sleep(wait);
    yield* streamComplete(opts, retriesLeft - 1);
    return;
  }

  throw new Error("all LLM pool entries failed: " + String(lastErr));
}
