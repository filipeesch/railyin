/**
 * event-bridge.ts — the ONE translation path (BRDG-01): EngineEvent → AG-UI
 * BaseEvent. Pure module: no I/O, no constructor-visible deps.
 *
 * Mapping mirrors stream-processor.ts's consume() switch 1:1 (D-02), with the
 * AG-UI lifecycle corrections from RESEARCH.md:
 *  - token → TEXT_MESSAGE_START/CONTENT/END (grouped per assistant block)
 *  - reasoning → REASONING_MESSAGE_START/CONTENT/END (BRDG-02)
 *  - tool_start → TOOL_CALL_START/ARGS/END; tool_result → TOOL_CALL_RESULT
 *    (messageId REQUIRED — Pitfall 5; child ids namespaced — Pitfall 6)
 *  - subagent_start/subagent_stop → subagent tool-call pair
 *  - board/control events → ignored (the /ws board path is UNCHANGED)
 *  - the terminal (RUN_FINISHED/RUN_ERROR) is emitted by the agent via
 *    terminalEvent() — NOT here (Pitfall 3; exactly one terminal per run)
 */
import { EventType } from "@ag-ui/core";
import type { BaseEvent } from "@ag-ui/client";
import type { EngineEvent } from "../engine/types.ts";

/** Per-run mutable translation state. Owned by the agent's run closure —
 * NEVER agent instance fields (the runtime clones per request). */
export interface TranslateState {
  threadId: string;
  runId: string;
  textSeq: number;
  reasoningSeq: number;
  toolSeq: number;
  /** toolCallIds of open tool calls (namespaced ids when parentCallId set). */
  openToolCallIds: string[];
  /** True when the current token block is open; closed on any non-token boundary. */
  textOpen: boolean;
  /** True when the current reasoning block is open. */
  reasoningOpen: boolean;
}

export function createTranslateState(threadId: string, runId: string): TranslateState {
  return {
    threadId,
    runId,
    textSeq: 0,
    reasoningSeq: 1,
    toolSeq: 0,
    openToolCallIds: [],
    textOpen: false,
    reasoningOpen: false,
  };
}

/** Emit TOOL_CALL_RESULT with the REQUIRED messageId (Pitfall 5). */
function toolResult(toolCallId: string, content: string): BaseEvent {
  return {
    type: EventType.TOOL_CALL_RESULT,
    toolCallId,
    messageId: `${toolCallId}-result`,
    content,
    role: "tool",
  };
}

/** Namespaced id for child/internal tool calls (Pitfall 6, mirror of
 * stream-processor.ts:313-319). */
function resolveToolCallId(event: Extract<EngineEvent, { type: "tool_start" | "tool_result" }>, state: TranslateState): string {
  if (event.parentCallId) {
    const callId = event.callId ?? `call_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    return `${event.parentCallId}::${callId}::${++state.toolSeq}`;
  }
  return event.callId ?? `call_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

/**
 * Translate a single EngineEvent into zero or more AG-UI events.
 * The exhaustive dispatch mirrors stream-processor.ts's consume() switch.
 */
export function translateEngineEvent(event: EngineEvent, state: TranslateState): BaseEvent[] {
  switch (event.type) {
    case "token": {
      const out: BaseEvent[] = [];
      if (!state.textOpen) {
        state.textSeq += 1;
        state.textOpen = true;
        out.push({
          type: EventType.TEXT_MESSAGE_START,
          messageId: `${state.runId}-text-${state.textSeq}`,
          role: "assistant",
        });
      }
      out.push({
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: `${state.runId}-text-${state.textSeq}`,
        delta: event.content,
      });
      return out;
    }

    case "reasoning": {
      const out: BaseEvent[] = [];
      if (state.textOpen) {
        out.push({
          type: EventType.TEXT_MESSAGE_END,
          messageId: `${state.runId}-text-${state.textSeq}`,
        });
        state.textOpen = false;
      }
      if (!state.reasoningOpen) {
        state.reasoningOpen = true;
        out.push({
          type: EventType.REASONING_MESSAGE_START,
          messageId: `${state.runId}-reasoning-${state.reasoningSeq}`,
          role: "reasoning",
        });
      }
      out.push({
        type: EventType.REASONING_MESSAGE_CONTENT,
        messageId: `${state.runId}-reasoning-${state.reasoningSeq}`,
        delta: event.content,
      });
      return out;
    }

    case "tool_start": {
      if (event.isInternal && !event.parentCallId) return []; // mirror consume(): suppress truly internal
      const out: BaseEvent[] = [];
      if (state.textOpen) {
        out.push({ type: EventType.TEXT_MESSAGE_END, messageId: `${state.runId}-text-${state.textSeq}` });
        state.textOpen = false;
      }
      if (state.reasoningOpen) {
        out.push({ type: EventType.REASONING_MESSAGE_END, messageId: `${state.runId}-reasoning-${state.reasoningSeq}` });
        state.reasoningOpen = false;
      }
      const toolCallId = resolveToolCallId(event, state);
      state.openToolCallIds.push(toolCallId);
      out.push(
        {
          type: EventType.TOOL_CALL_START,
          toolCallId,
          toolCallName: event.name,
          ...(event.parentCallId ? { parentMessageId: event.parentCallId } : {}),
        },
        { type: EventType.TOOL_CALL_ARGS, toolCallId, delta: event.arguments },
        { type: EventType.TOOL_CALL_END, toolCallId },
      );
      return out;
    }

    case "tool_result": {
      if (event.isInternal && !event.parentCallId) return [];
      if (state.textOpen) {
        state.textOpen = false;
      }
      if (state.reasoningOpen) {
        state.reasoningOpen = false;
      }
      const toolCallId = event.parentCallId
        ? `${event.parentCallId}::${event.callId ?? ""}::${state.toolSeq}`
        : (event.callId ?? "");
      // Remove from open set (match by namespaced id when parentCallId set).
      const idx = state.openToolCallIds.lastIndexOf(toolCallId);
      if (idx !== -1) state.openToolCallIds.splice(idx, 1);
      return [toolResult(toolCallId, event.result)];
    }

    case "subagent_start": {
      const out: BaseEvent[] = [];
      const toolCallId = `${event.callId}::${++state.toolSeq}`;
      state.openToolCallIds.push(toolCallId);
      out.push(
        { type: EventType.TOOL_CALL_START, toolCallId, toolCallName: "subagent" },
        { type: EventType.TOOL_CALL_ARGS, toolCallId, delta: JSON.stringify({ intent: event.intent, prompt: event.prompt }) },
        { type: EventType.TOOL_CALL_END, toolCallId },
      );
      return out;
    }

    case "subagent_stop": {
      const toolCallId = `${event.callId}::${state.toolSeq}`;
      const idx = state.openToolCallIds.lastIndexOf(toolCallId);
      if (idx !== -1) state.openToolCallIds.splice(idx, 1);
      return [toolResult(toolCallId, "")];
    }

    // Terminal-causing engine events close any open text/reasoning blocks:
    // verifyEvents rejects RUN_FINISHED while text messages are still active,
    // so the END events must precede the terminal (emitted by terminalEvent()).
    case "done":
    case "error": {
      const out: BaseEvent[] = [];
      if (state.textOpen) {
        out.push({ type: EventType.TEXT_MESSAGE_END, messageId: `${state.runId}-text-${state.textSeq}` });
        state.textOpen = false;
      }
      if (state.reasoningOpen) {
        out.push({ type: EventType.REASONING_MESSAGE_END, messageId: `${state.runId}-reasoning-${state.reasoningSeq}` });
        state.reasoningOpen = false;
      }
      return out;
    }

    // Board /ws path is UNCHANGED (BRDG-01) — the bridge ignores these; the
    // terminal is emitted by the agent via terminalEvent().
    case "usage":
    case "status":
    case "task_updated":
    case "new_message":
    case "compaction_start":
    case "compaction_done":
    case "ask_user":
    case "shell_approval":
    case "decision_request":
      return [];
  }
}

/**
 * D-09/A5: complete every dangling tool call BEFORE the terminal so the
 * persisted log never contains open TOOL_CALL_START without RESULT. Call this
 * at run end — do NOT rely on finalizeRunEvents (it early-returns when a
 * terminal exists).
 *
 * NOTE (deviation from plan's "append TOOL_CALL_END + TOOL_CALL_RESULT"):
 * tool_start already emits TOOL_CALL_END, and verifyEvents REJECTS a second
 * TOOL_CALL_END for a call that is no longer active — so the synthesis emits
 * only TOOL_CALL_RESULT (verified against the installed client's verifyEvents).
 */
export function synthesizeMissingToolResults(state: TranslateState, events: BaseEvent[]): BaseEvent[] {
  if (state.openToolCallIds.length === 0) return events;
  const out = [...events];
  for (const toolCallId of [...state.openToolCallIds]) {
    out.push(toolResult(toolCallId, ""));
  }
  state.openToolCallIds.length = 0;
  return out;
}

/**
 * The single terminal event for a run (Pitfall 3 — exactly one per run).
 * done/aborted/decision → RUN_FINISHED {result: null}; error → RUN_ERROR.
 */
export function terminalEvent(
  threadId: string,
  runId: string,
  outcome: "done" | "error" | "aborted" | "decision",
  error?: { message: string; code?: string },
): BaseEvent {
  if (outcome === "error") {
    return { type: EventType.RUN_ERROR, message: error?.message ?? "Run failed", code: error?.code };
  }
  return { type: EventType.RUN_FINISHED, threadId, runId, result: null };
}
