"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Client half of the agentic loop.
 *
 * Holds the transcript, streams SSE from /api/chat, surfaces tool steps as
 * they run, and keeps a thread id so a reload picks the same conversation back
 * up. The heartbeat poller is what turns this from a chat box into an agent:
 * the server may push something the user never asked for.
 */

export interface ToolStep {
  name: string;
  ok?: boolean;
  running: boolean;
  result?: unknown;
}

export interface AgentAction {
  id: string;
  kind: string;
  summary: string;
  payload: Record<string, any>;
  state?: "pending" | "sent" | "done" | "failed" | "dismissed";
  txHash?: string;
  error?: string;
}

export interface ChatTurn {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  tools: ToolStep[];
  actions: AgentAction[];
  streaming?: boolean;
  at: number;
}

const uid = () => Math.random().toString(36).slice(2, 10);

export function useAgentChat(agentSlug: string, address?: string | null) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const storageKey = "devoxpad.thread." + agentSlug;

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) setThreadId(saved);
    } catch {
      /* private mode */
    }
  }, [storageKey]);

  useEffect(() => {
    if (!threadId) return;
    try {
      localStorage.setItem(storageKey, threadId);
    } catch {
      /* private mode */
    }
    let cancelled = false;
    fetch("/api/threads/" + threadId)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled || !Array.isArray(j.messages)) return;
        setTurns((prev) => {
          if (prev.length) return prev;
          return j.messages.map((m: any) => ({
            id: uid(),
            role: m.role,
            content: m.content,
            tools: (m.tools || []).map((t: any) => ({ name: t.name, ok: t.ok, running: false, result: t.result })),
            actions: (m.actions || []).map((a: any) => ({ ...a, state: "pending" as const })),
            at: m.at,
          }));
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [threadId]);

  const patchLast = useCallback((fn: (t: ChatTurn) => ChatTurn) => {
    setTurns((prev) => {
      if (!prev.length) return prev;
      const copy = [...prev];
      copy[copy.length - 1] = fn(copy[copy.length - 1]);
      return copy;
    });
  }, []);

  const send = useCallback(
    async (text: string) => {
      const message = text.trim();
      if (!message || busy) return;

      setError(null);
      setBusy(true);
      setTurns((p) => [
        ...p,
        { id: uid(), role: "user", content: message, tools: [], actions: [], at: Date.now() },
        { id: uid(), role: "assistant", content: "", tools: [], actions: [], streaming: true, at: Date.now() },
      ]);

      const ac = new AbortController();
      abortRef.current = ac;

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ agent: agentSlug, threadId, message, address }),
          signal: ac.signal,
        });

        if (!res.ok || !res.body) {
          const j = await res.json().catch(() => ({ error: "request failed" }));
          throw new Error(j.error || "HTTP " + res.status);
        }

        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() || "";

          for (const line of lines) {
            const t = line.trim();
            if (!t.startsWith("data:")) continue;
            const payload = t.slice(5).trim();
            if (payload === "[DONE]") continue;

            let ev: any;
            try {
              ev = JSON.parse(payload);
            } catch {
              continue;
            }

            if (ev.type === "thread") setThreadId(ev.threadId);
            else if (ev.type === "text") patchLast((x) => ({ ...x, content: x.content + ev.text }));
            else if (ev.type === "tool_start")
              patchLast((x) => ({ ...x, tools: [...x.tools, { name: ev.name, running: true }] }));
            else if (ev.type === "tool_end")
              patchLast((x) => {
                const tools = [...x.tools];
                for (let i = tools.length - 1; i >= 0; i -= 1) {
                  if (tools[i].name === ev.name && tools[i].running) {
                    tools[i] = { name: ev.name, ok: ev.ok, running: false, result: ev.result };
                    break;
                  }
                }
                return { ...x, tools };
              });
            else if (ev.type === "action")
              patchLast((x) => ({ ...x, actions: [...x.actions, { ...ev.action, state: "pending" }] }));
            else if (ev.type === "error") setError(ev.error);
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") setError(String((err as Error).message || err));
      } finally {
        patchLast((x) => ({ ...x, streaming: false }));
        setBusy(false);
        abortRef.current = null;
      }
    },
    [agentSlug, address, busy, patchLast, threadId],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setBusy(false);
  }, []);

  const reset = useCallback(() => {
    setTurns([]);
    setThreadId(null);
    setError(null);
    try {
      localStorage.removeItem(storageKey);
    } catch {
      /* private mode */
    }
  }, [storageKey]);

  /** Push a message the agent produced on its own, with no user turn before it. */
  const pushAgentMessage = useCallback((content: string) => {
    setTurns((p) => [
      ...p,
      { id: uid(), role: "assistant", content, tools: [], actions: [], at: Date.now() },
    ]);
  }, []);

  const updateAction = useCallback((actionId: string, patch: Partial<AgentAction>) => {
    setTurns((prev) =>
      prev.map((t) => ({
        ...t,
        actions: t.actions.map((a) => (a.id === actionId ? { ...a, ...patch } : a)),
      })),
    );
  }, []);

  return { turns, threadId, busy, error, send, stop, reset, pushAgentMessage, updateAction };
}

/** Polls the agent's heartbeat so it can speak without being spoken to. */
export function useHeartbeat(
  agentSlug: string,
  enabled: boolean,
  onSpeak: (text: string) => void,
  intervalMs = 45_000,
) {
  useEffect(() => {
    if (!enabled) return;
    let alive = true;

    const tick = async () => {
      try {
        const res = await fetch("/api/agents/" + agentSlug + "/tick", { method: "POST" });
        const j = await res.json();
        if (alive && j.spoke && j.text) onSpeak(j.text);
      } catch {
        /* offline is fine, try again next tick */
      }
    };

    const timer = setInterval(tick, intervalMs);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [agentSlug, enabled, intervalMs, onSpeak]);
}
