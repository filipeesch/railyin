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
import type { DecisionRequestPayload } from "../../shared/rpc-types.ts";
import { buildDecisionSubmission } from "../conversation/decision-submission.ts";
import type { DecisionAnswer } from "../../shared/rpc-types.ts";

/** Per-run mutable translation state. Owned by the agent's run closure —
 * NEVER agent instance fields (the runtime clones per request). */
export interface TranslateState {
  threadId: string;
  runId: string;
  textSeq: number;
  reasoningSeq: number;
  toolSeq: number;
  /**
   * Per-call seq assigned at START time and consumed at RESULT time (CR-01).
   * Keyed by `${parentCallId}\u0000${callId}` (mirror of stream-processor's
   * childCallKey) — subagent_start uses an empty parentCallId prefix. Without
   * this, a single shared counter breaks when subagent and child tool events
   * interleave or when parallel children resolve out of order: the RESULT
   * would read the counter AFTER another start incremented it, producing a
   * tool id that was never started (verifyEvents rejects those).
   */
  toolSeqByCall: Map<string, number>;
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
    toolSeqByCall: new Map(),
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
 * stream-processor.ts:313-319). The per-call seq is stored at START time and
 * consumed at RESULT time so interleaved/parallel children resolve back to
 * THEIR OWN id (CR-01); the shared counter is only consulted when no entry
 * exists (a start without a stored seq — e.g. the very first occurrence). */
function resolveToolCallId(event: Extract<EngineEvent, { type: "tool_start" | "tool_result" }>, state: TranslateState): string {
  if (event.parentCallId) {
    const callId = event.callId ?? `call_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const key = `${event.parentCallId}\u0000${callId}`;
    let seq = state.toolSeqByCall.get(key);
    if (seq === undefined) {
      seq = ++state.toolSeq;
      state.toolSeqByCall.set(key, seq);
    }
    return `${event.parentCallId}::${callId}::${seq}`;
  }
  return event.callId ?? `call_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

/** The stored per-call seq for a result event, consumed (deleted) so a LATER
 * reuse of the same raw callId gets a fresh id. Falls back to the current
 * counter value when no start was seen (result without start). */
function consumeCallSeq(event: Extract<EngineEvent, { type: "tool_result" }>, state: TranslateState): number {
  if (!event.parentCallId) return state.toolSeq;
  const key = `${event.parentCallId}\u0000${event.callId ?? ""}`;
  const seq = state.toolSeqByCall.get(key);
  if (seq !== undefined) state.toolSeqByCall.delete(key);
  return seq ?? state.toolSeq;
}

/** Per-call seq key for a subagent (no parentCallId — empty prefix). */
function subagentKey(callId: string): string {
  return `\u0000${callId}`;
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
      // IN-04: close open blocks with their END events (atomic with the
      // close) — same shape as the tool_start branch — so no unterminated
      // message block survives on the wire.
      const out: BaseEvent[] = [];
      if (state.textOpen) {
        out.push({ type: EventType.TEXT_MESSAGE_END, messageId: `${state.runId}-text-${state.textSeq}` });
        state.textOpen = false;
      }
      if (state.reasoningOpen) {
        out.push({ type: EventType.REASONING_MESSAGE_END, messageId: `${state.runId}-reasoning-${state.reasoningSeq}` });
        state.reasoningOpen = false;
      }
      // CR-01: reuse the seq stored at tool_start (consumed here) so the
      // result matches the id the client saw STARTed.
      const toolCallId = event.parentCallId
        ? `${event.parentCallId}::${event.callId ?? ""}::${consumeCallSeq(event, state)}`
        : (event.callId ?? "");
      // Remove from open set (match by namespaced id when parentCallId set).
      const idx = state.openToolCallIds.lastIndexOf(toolCallId);
      if (idx !== -1) state.openToolCallIds.splice(idx, 1);
      out.push(toolResult(toolCallId, event.result));
      return out;
    }

    case "subagent_start": {
      const out: BaseEvent[] = [];
      // IN-04: a subagent boundary is a non-token boundary — close open
      // blocks before opening the tool-call pair.
      if (state.textOpen) {
        out.push({ type: EventType.TEXT_MESSAGE_END, messageId: `${state.runId}-text-${state.textSeq}` });
        state.textOpen = false;
      }
      if (state.reasoningOpen) {
        out.push({ type: EventType.REASONING_MESSAGE_END, messageId: `${state.runId}-reasoning-${state.reasoningSeq}` });
        state.reasoningOpen = false;
      }
      // CR-01: the subagent's own seq is stored under its own key so child
      // tool events interleaved between start and stop cannot shift it.
      const key = subagentKey(event.callId);
      let seq = state.toolSeqByCall.get(key);
      if (seq === undefined) {
        seq = ++state.toolSeq;
        state.toolSeqByCall.set(key, seq);
      }
      const toolCallId = `${event.callId}::${seq}`;
      state.openToolCallIds.push(toolCallId);
      out.push(
        { type: EventType.TOOL_CALL_START, toolCallId, toolCallName: "subagent" },
        { type: EventType.TOOL_CALL_ARGS, toolCallId, delta: JSON.stringify({ intent: event.intent, prompt: event.prompt }) },
        { type: EventType.TOOL_CALL_END, toolCallId },
      );
      return out;
    }

    case "subagent_stop": {
      const out: BaseEvent[] = [];
      if (state.textOpen) {
        out.push({ type: EventType.TEXT_MESSAGE_END, messageId: `${state.runId}-text-${state.textSeq}` });
        state.textOpen = false;
      }
      if (state.reasoningOpen) {
        out.push({ type: EventType.REASONING_MESSAGE_END, messageId: `${state.runId}-reasoning-${state.reasoningSeq}` });
        state.reasoningOpen = false;
      }
      const key = subagentKey(event.callId);
      const seq = state.toolSeqByCall.get(key);
      if (seq !== undefined) state.toolSeqByCall.delete(key);
      const toolCallId = `${event.callId}::${seq ?? state.toolSeq}`;
      const idx = state.openToolCallIds.lastIndexOf(toolCallId);
      if (idx !== -1) state.openToolCallIds.splice(idx, 1);
      out.push(toolResult(toolCallId, ""));
      return out;
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

/**
 * Build the canonical AG-UI interrupt terminal (RUNR-08, D-01/D-02/D-06):
 * RUN_FINISHED with `outcome: { type: "interrupt", interrupts: [...] }` — a
 * NORMAL completion (D-03), never an error. The bridge stays terminal-free
 * (Pitfall 3): this helper only BUILDS the shape; the agent emits it via
 * finishInterrupt().
 *
 * Payload parsing is defensive (T-03-01): a malformed engine payload yields
 * `metadata: undefined` + the message fallback, never a crash. `metadata`
 * carries the parsed DecisionRequestPayload — the Phase 5 decision card data
 * (UI-03 event-contract split).
 */
export function buildInterruptOutcome(
  threadId: string,
  runId: string,
  payload: string,
  interruptId: string,
): BaseEvent {
  let parsed: DecisionRequestPayload | null = null;
  try {
    const raw = JSON.parse(payload) as unknown;
    // WR-07: InterruptSchema declares `metadata: z.record(z.any())` — a
    // payload that PARSES but to a non-object (number/boolean/string/array/
    // null) would produce schema-invalid metadata and error the client's zod
    // validation. Only plain objects qualify; anything else falls through to
    // the message fallback with metadata omitted.
    if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
      parsed = raw as DecisionRequestPayload;
    }
  } catch {
    /* keep null — metadata optional */
  }
  return {
    type: EventType.RUN_FINISHED,
    threadId,
    runId,
    outcome: {
      type: "interrupt",
      interrupts: [
        {
          id: interruptId,
          reason: "decision_request",
          message: parsed?.context ?? "A decision is required.",
          metadata: parsed ?? undefined,
        },
      ],
    },
  };
}

/**
 * The Phase 5 resume-payload contract (A1/Open Question 2 — SINGLE SOURCE OF
 * TRUTH; Phase 5 must match this):
 *
 *   {
 *     decision: "approved" | "rejected",      // informational server-side — see below
 *     answers?: DecisionAnswer[],             // required for a RESOLVED resume
 *     generalNotes?: string,
 *     recordAsDecisions?: boolean,            // default true
 *   }
 *
 * `decision` is informational: the resume entry's `status` is the real channel
 * per A4 — `"cancelled"` is the rejection/dismissal (nothing reaches the
 * engine), while a RESOLVED resume MUST carry `answers` (a resolved payload
 * without answers is an error, INVALID_PAYLOAD, at the agent).
 *
 * Translates the payload into the existing decision-submission format
 * (D-07, Don't Hand-Roll row 3): delegates to buildDecisionSubmission — the
 * hidden record_decision instructions stay the single source of truth, and the
 * Q/A pairs are NEVER re-formatted here. Returns null when the payload carries
 * no answers (missing, non-array, or empty) or is not an object at all.
 */
export function translateResumeToSubmission(payload: unknown): { userContent: string; engineContent: string } | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
  const p = payload as { answers?: unknown; generalNotes?: unknown; recordAsDecisions?: boolean };
  if (!Array.isArray(p.answers) || p.answers.length === 0) return null;
  // WR-05: the resume payload is client-controlled input on a published
  // endpoint (ASVS L1 input validation). Validate every answer element BEFORE
  // delegation — a malformed payload (weight: 123 → .toUpperCase() crash, null
  // elements → property access crash, non-string generalNotes → .trim() crash)
  // must yield null here and INVALID_PAYLOAD at the agent, never an exception
  // thrown after RUN_STARTED was emitted.
  const malformed = p.answers.some(
    (a) =>
      a === null ||
      typeof a !== "object" ||
      typeof (a as DecisionAnswer).question !== "string" ||
      typeof (a as DecisionAnswer).answer !== "string" ||
      ((a as DecisionAnswer).weight !== undefined && typeof (a as DecisionAnswer).weight !== "string"),
  );
  if (malformed) return null;
  if (p.generalNotes !== undefined && typeof p.generalNotes !== "string") return null;
  return buildDecisionSubmission(p.answers as DecisionAnswer[], p.generalNotes, p.recordAsDecisions ?? true);
}
