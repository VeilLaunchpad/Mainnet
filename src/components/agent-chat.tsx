"use client";

import { useEffect, useRef, useState } from "react";
import { useAccount } from "wagmi";
import { useAgentChat, useHeartbeat, type ChatTurn } from "@/lib/use-agent-chat";
import { ActionCard } from "./action-card";
import { deDash } from "@/lib/text";

/** The reason a step failed, when the tool returned one. */
function toolError(result: unknown): string {
  if (!result || typeof result !== "object") return "";
  const e = (result as { error?: unknown }).error;
  return typeof e === "string" ? e : "";
}

const TOOL_LABEL: Record<string, string> = {
  get_chain_info: "reading network",
  get_coti_market: "checking COTI price",
  get_coti_candles: "pulling candles",
  search_web: "searching the web",
  get_native_balance: "reading balance",
  read_token: "reading token",
  list_launches: "scanning launches",
  get_token: "opening token",
  quote_trade: "pricing the trade",
  propose_trade: "drafting a trade",
  propose_launch: "drafting a launch",
  send_private_message: "encrypting a message",
  propose_bridge: "planning a bridge",
  remember: "storing a memory",
  recall: "recalling",
  log_event: "posting to feed",
  set_heartbeat: "setting a heartbeat",
  watch_token: "updating watchlist",
  get_watchlist: "reading watchlist",
  find_pairs: "checking external DEXs",
  get_profile: "looking up profile",
  list_agents: "listing agents",
};

export function AgentChat({
  agentSlug,
  agentName,
  suggestions = [],
  heartbeat = false,
  className = "",
  compact = false,
}: {
  agentSlug: string;
  agentName: string;
  suggestions?: string[];
  heartbeat?: boolean;
  className?: string;
  compact?: boolean;
}) {
  const { address } = useAccount();
  const { turns, busy, error, send, stop, reset, pushAgentMessage, updateAction } = useAgentChat(
    agentSlug,
    address,
  );
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useHeartbeat(agentSlug, heartbeat, pushAgentMessage);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns]);

  function submit() {
    const t = draft.trim();
    if (!t || busy) return;
    setDraft("");
    void send(t);
  }

  return (
    <div className={"flex min-h-0 flex-col " + className}>
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-1 py-2">
        {turns.length === 0 && (
          <Empty agentName={agentName} suggestions={suggestions} onPick={(s) => void send(s)} compact={compact} />
        )}

        {turns.map((t) => (
          <Turn key={t.id} turn={t} agentName={agentName} onUpdateAction={updateAction} />
        ))}

        {error && (
          <div className="rounded-xl border border-rose-400/30 bg-rose-400/[0.07] px-3 py-2 text-[12px] text-rose-300">
            {error}
          </div>
        )}
      </div>

      <div className="mt-2 shrink-0">
        <div className="flex items-end gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-2 focus-within:border-devox-400/50">
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={1}
            placeholder={"Talk to " + agentName + "…"}
            className="max-h-32 min-h-[38px] flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none placeholder:text-white/30"
          />
          {busy ? (
            <button
              onClick={stop}
              className="shrink-0 rounded-xl border border-white/15 px-3 py-2 text-[13px] font-semibold text-white/70 transition hover:text-white"
            >
              Stop
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={!draft.trim()}
              className="shrink-0 rounded-xl btn-primary px-4 py-2 text-[13px] font-semibold text-white transition hover:brightness-110 disabled:opacity-40"
            >
              Send
            </button>
          )}
        </div>
        <div className="mt-1.5 flex items-center justify-between px-1 text-[10px] text-white/25">
          <span>
            {heartbeat ? "Heartbeat on - this agent may speak first." : "Enter to send · Shift+Enter for a new line"}
          </span>
          {turns.length > 0 && (
            <button onClick={reset} className="transition hover:text-white/60">
              New session
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * One turn, as a bubble.
 *
 * An agent can call six tools before it says anything, and listing each as its
 * own row buries the reply under scaffolding. So the tools collapse into a
 * single line that expands on demand: the work stays inspectable without
 * shouting over the answer.
 */
function Turn({
  turn,
  agentName,
  onUpdateAction,
}: {
  turn: ChatTurn;
  agentName: string;
  onUpdateAction: (id: string, patch: Record<string, unknown>) => void;
}) {
  /**
   * The steps are for watching, not for reading afterwards.
   *
   * `null` means follow the work: expanded while tools are running, closed once
   * the answer lands. A click pins it either way, and the pin is dropped when
   * the turn finishes so the answer is what you are left looking at rather than
   * a list of steps that already happened.
   */
  const [pinned, setPinned] = useState<boolean | null>(null);

  /**
   * Let go of the pin when the work stops.
   *
   * Someone who opened the steps to watch them should not be left with the
   * answer pushed below a list of finished steps. This runs for every turn,
   * before the user-role early return, because a hook cannot be conditional.
   */
  const busy = turn.role !== "user" && turn.tools.some((t) => t.running);
  useEffect(() => {
    if (!busy) setPinned(null);
  }, [busy]);

  if (turn.role === "user") {
    return (
      <div className="animate-rise flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-devox-500/20 px-3.5 py-2.5 text-[13px] leading-relaxed text-white/90">
          {deDash(turn.content)}
        </div>
      </div>
    );
  }

  const running = turn.tools.some((t) => t.running);
  const done = turn.tools.filter((t) => !t.running);
  const failed = done.filter((t) => t.ok === false).length;
  const current = turn.tools.find((t) => t.running);
  const showTools = pinned ?? running;

  /**
   * Once the answer is here, the steps have done their job.
   *
   * They exist to show work in progress, not to sit above the reply
   * afterwards - so the whole block goes, pill included, the moment content
   * starts arriving. The one exception is a step that failed: the answer may
   * be missing something because of it, and quietly hiding that would be the
   * interface deciding you do not need to know.
   */
  /**
   * Steps are what you watch until there is something to read.
   *
   * The moment an answer starts arriving they are replaced by it, with no
   * exception - not for a failed step, not for anything. A replayed turn never
   * shows them either: the work finished before the page existed, so there is
   * no progress left to indicate.
   *
   * That does mean a failed step leaves no mark once the reply lands, so the
   * reply has to be the thing that tells the truth about it. See the note on
   * `failed` below.
   */
  const answered = !!turn.content && !running;
  const showSteps = !turn.restored && !answered;

  /**
   * Nothing to say and nothing to show.
   *
   * A turn that ended with no text, no actions and no visible steps was still
   * drawing an avatar beside an empty row - which reads as a reply that failed
   * to load rather than one that never had a body.
   */
  const empty =
    !turn.content && !turn.streaming && turn.actions.length === 0 && !showSteps;

  if (empty) return null;

  return (
    <div className="animate-rise flex gap-2.5">
      <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-devox-500 to-cy-500 text-[10px] font-bold text-white">
        {agentName.slice(0, 1)}
      </span>

      <div className="min-w-0 flex-1">
        {turn.tools.length > 0 && showSteps && (
          <div className="mb-1.5">
            <button
              onClick={() => setPinned(!showTools)}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-[11px] text-white/45 transition hover:border-white/20 hover:text-white/70"
            >
              <span
                className={
                  "size-1.5 rounded-full " +
                  (running ? "animate-pulse-slow bg-cy-400" : failed ? "bg-rose-400" : "bg-mint-400")
                }
              />
              {running
                ? TOOL_LABEL[current?.name ?? ""] || (current?.name ?? "working") + "..."
                : done.length + (done.length === 1 ? " step" : " steps")}
              {!running && failed > 0 && <span className="text-rose-400">{failed} failed</span>}
              <svg
                width="9"
                height="9"
                viewBox="0 0 10 10"
                fill="none"
                className={"transition " + (showTools ? "rotate-180" : "")}
              >
                <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </button>

            {showTools && (
              <div className="mt-1.5 space-y-1 rounded-xl border border-white/[0.07] bg-white/[0.02] p-2.5">
                {turn.tools.map((t, i) => (
                  <div key={i}>
                    <div className="flex items-center gap-2 text-[11px]">
                      <span
                        className={
                          "size-1.5 shrink-0 rounded-full " +
                          (t.running ? "animate-pulse-slow bg-cy-400" : t.ok ? "bg-mint-400" : "bg-rose-400")
                        }
                      />
                      <span className="text-white/50">
                        {TOOL_LABEL[t.name] || t.name.replace(/_/g, " ")}
                      </span>
                      <span className="mono ml-auto text-white/20">{t.name}</span>
                    </div>
                    {/* A red dot with no reason is the interface knowing why
                        something failed and declining to say. The tool already
                        returns one; it was simply never rendered. */}
                    {t.ok === false && toolError(t.result) && (
                      <div className="ml-3.5 mt-0.5 text-[10px] text-rose-300/70">
                        {toolError(t.result)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {turn.content && (
          <div
            className={
              "max-w-[95%] rounded-2xl rounded-tl-md bg-white/[0.05] px-3.5 py-2.5 text-[13px] leading-relaxed text-white/85 " +
              (turn.streaming ? "caret" : "")
            }
          >
            <Markdown text={deDash(turn.content)} />
          </div>
        )}

        {!turn.content && turn.streaming && turn.tools.length === 0 && (
          <div className="inline-flex gap-1 rounded-2xl rounded-tl-md bg-white/[0.05] px-3.5 py-3">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="size-1.5 animate-pulse-slow rounded-full bg-devox-400"
                style={{ animationDelay: i * 160 + "ms" }}
              />
            ))}
          </div>
        )}

        {turn.actions.map((a) => (
          <ActionCard key={a.id} action={a} onUpdate={onUpdateAction as never} />
        ))}
      </div>
    </div>
  );
}

/** Deliberately tiny: bold, code, links and bullets. Agents write prose, not documents. */
function Markdown({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <>
      {blocks.map((block, bi) => {
        const lines = block.split("\n");
        const isList = lines.every((l) => /^\s*[-*•]\s+/.test(l) || !l.trim());
        if (isList && lines.some((l) => l.trim())) {
          return (
            <ul key={bi} className="my-1.5 space-y-1 pl-1">
              {lines
                .filter((l) => l.trim())
                .map((l, li) => (
                  <li key={li} className="flex gap-2">
                    <span className="mt-[7px] size-1 shrink-0 rounded-full bg-devox-400/70" />
                    <span>{inline(l.replace(/^\s*[-*•]\s+/, ""))}</span>
                  </li>
                ))}
            </ul>
          );
        }
        return (
          <p key={bi} className="my-1.5 first:mt-0 last:mb-0">
            {lines.map((l, li) => (
              <span key={li}>
                {inline(l)}
                {li < lines.length - 1 && <br />}
              </span>
            ))}
          </p>
        );
      })}
    </>
  );
}

function inline(s: string) {
  const parts = s.split(/(\*\*[^*]+\*\*|`[^`]+`|https?:\/\/\S+)/g);
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**")) {
      return (
        <strong key={i} className="font-semibold text-white">
          {p.slice(2, -2)}
        </strong>
      );
    }
    if (p.startsWith("`") && p.endsWith("`")) {
      return (
        <code key={i} className="mono rounded bg-white/[0.08] px-1 py-0.5 text-[0.9em] text-cy-300">
          {p.slice(1, -1)}
        </code>
      );
    }
    if (/^https?:\/\//.test(p)) {
      return (
        <a key={i} href={p} target="_blank" rel="noreferrer" className="text-cy-300 underline underline-offset-2">
          {p.length > 46 ? p.slice(0, 46) + "…" : p}
        </a>
      );
    }
    return <span key={i}>{p}</span>;
  });
}

function Empty({
  agentName,
  suggestions,
  onPick,
  compact,
}: {
  agentName: string;
  suggestions: string[];
  onPick: (s: string) => void;
  compact: boolean;
}) {
  return (
    <div className={compact ? "py-4" : "py-10"}>
      <div className="mb-3 flex items-center gap-2.5">
        <span className="flex size-8 items-center justify-center rounded-xl bg-gradient-to-br from-devox-500 to-cy-500 text-sm font-bold text-white">
          {agentName.slice(0, 1)}
        </span>
        <div>
          <div className="text-sm font-semibold">{agentName} is listening</div>
          <div className="text-[11px] text-white/40">
            It remembers this conversation and can act on-chain with your signature.
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {suggestions.map((s) => (
          <button
            key={s}
            onClick={() => onPick(s)}
            className="btn-ghost px-2.5 py-1.5 text-left text-[12px] text-white/65 transition hover:border-devox-400/40 hover:text-white"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
