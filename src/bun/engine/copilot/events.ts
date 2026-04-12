/**
 * Copilot SDK event translation — maps Copilot streaming events to EngineEvent (Task 7.4).
 *
 * Maps @github/copilot-sdk streaming events to our unified EngineEvent format:
 *   assistant.message_delta  → { type: "token" }
 *   assistant.reasoning_delta → { type: "reasoning" }
 *   assistant.usage          → { type: "usage" }
 *   session.task_complete    → { type: "done" }
 *   session.idle             → { type: "done" }
 *   session.error            → { type: "error", fatal: true }
 */

import type { CopilotSdkEvent, CopilotSdkSession } from "./session.ts";
import type { EngineEvent } from "../types.ts";

type ToolEventMeta = {
  name: string;
  parentCallId?: string;
  isInternal: boolean;
};

/**
 * Subscribe to a CopilotSession and yield EngineEvents until the session
 * completes (session.idle or session.task_complete) or errors.
 *
 * The session must already have a pending send/sendAndWait call in flight
 * before or immediately after this generator is iterated.
 */
export async function* translateCopilotStream(
  session: CopilotSdkSession,
  signal?: AbortSignal,
  sendPromise?: Promise<unknown>,
  onWatchdogFire?: () => Promise<boolean>,
): AsyncGenerator<EngineEvent> {
  // Use a queue + promise to bridge the callback-based session.on() API
  // into an async generator.
  const queue: EngineEvent[] = [];
  let notify: (() => void) | null = null;
  let done = false;

  function wake() {
    if (notify) {
      const n = notify;
      notify = null;
      n();
    }
  }

  // Track whether streaming deltas were received this turn to avoid
  // double-counting when the SDK emits both deltas and a complete message.
  let receivedTokenDelta = false;
  let receivedReasoningDelta = false;

  // Track tool metadata by callId so tool.execution_complete can include the tool
  // name and preserve filtering context.
  const toolMetaByCallId = new Map<string, ToolEventMeta>();

  // Unblock the generator immediately when the caller aborts (e.g. stop button).
  // Without this, translateCopilotStream would hang waiting for the next SDK event
  // if session.disconnect() doesn't emit one.
  signal?.addEventListener("abort", () => {
    done = true;
    wake();
  }, { once: true });

  // If session.send() rejects (CLI crash, session invalidated), propagate it as a
  // fatal error so the generator exits instead of hanging forever with no events.
  sendPromise?.catch((err: unknown) => {
    queue.push({
      type: "error",
      message: err instanceof Error ? err.message : String(err),
      fatal: true,
    });
    done = true;
    wake();
  });

  // Watchdog configuration and per-execution state
  const IDLE_TIMEOUT_MS = 120_000;
  const MAX_SILENCE_COUNT = 3;
  let silenceCount = 0;
  // Count of tool calls that have started but not yet completed. The watchdog
  // is suppressed while any tool is in-flight — a long-running tool (e.g.
  // `bun test`) can legitimately produce no events for minutes at a time.
  let toolsInFlight = 0;

  const unsubscribe: () => void = session.on((event: CopilotSdkEvent) => {
    silenceCount = 0; // CLI is active; reset the consecutive-silence counter
    if (event.type === "assistant.message_delta") receivedTokenDelta = true;
    if (event.type === "assistant.reasoning_delta") receivedReasoningDelta = true;
    if (event.type === "tool.execution_start") {
      toolsInFlight++;
      const data = event.data as { toolCallId: string; toolName: string; parentToolCallId?: string };
      toolMetaByCallId.set(data.toolCallId, {
        name: data.toolName,
        parentCallId: data.parentToolCallId,
        isInternal: isInternalCopilotEvent(event, data.toolName, data.parentToolCallId),
      });
    }
    if (event.type === "tool.execution_complete") {
      toolsInFlight = Math.max(0, toolsInFlight - 1);
    }

    const engineEvent = translateEvent(event, receivedTokenDelta, receivedReasoningDelta, toolMetaByCallId);
    if (engineEvent) {
      queue.push(engineEvent);
    }

    if (
      event.type === "session.task_complete" ||
      event.type === "session.idle" ||
      event.type === "session.error"
    ) {
      done = true;
    }

    wake();
  });

  try {
    while (true) {
      // Drain queue
      while (queue.length > 0) {
        yield queue.shift()!;
      }

      if (done) break;

      // Wait for more events, with a watchdog timeout.
      // The watchdog is suppressed while tools are in-flight — a tool like
      // `bun test` can legitimately run for minutes with no streaming events.
      // On each timeout (no tools in-flight):
      //   - CLI dead (ping fails/times out within 5s) → fatal error immediately
      //   - CLI alive but session silent → increment silenceCount
      //     - silenceCount >= MAX_SILENCE_COUNT → unresponsive error
      //     - otherwise → restart the timer and keep waiting
      await new Promise<void>((r) => {
        notify = r;
        const t = setTimeout(async () => {
          notify = null; // prevent double-resolve if an event arrives during the async check
          // A tool is currently running — silence is expected; just restart the timer.
          if (toolsInFlight > 0) {
            r();
            return;
          }
          const cliHealthy = onWatchdogFire ? await onWatchdogFire() : true;
          if (!cliHealthy) {
            queue.push({
              type: "error",
              message: "Copilot CLI process crashed or became unreachable",
              fatal: true,
            });
            done = true;
          } else {
            silenceCount++;
            if (silenceCount >= MAX_SILENCE_COUNT) {
              queue.push({
                type: "error",
                message: `Copilot session unresponsive (no events for ${(IDLE_TIMEOUT_MS * MAX_SILENCE_COUNT) / 1000}s, CLI healthy)`,
                fatal: true,
              });
              done = true;
            }
          }
          r();
        }, IDLE_TIMEOUT_MS);
        // Store a reference so the timeout can be cancelled when an event arrives
        // naturally. We patch wake() to clear it.
        const origNotify = notify;
        notify = () => { clearTimeout(t); origNotify?.(); };
      });
    }

    // Drain any remaining events that arrived right before done was set
    while (queue.length > 0) {
      yield queue.shift()!;
    }
  } finally {
    unsubscribe();
  }
}

function translateEvent(
  event: CopilotSdkEvent,
  receivedTokenDelta: boolean,
  receivedReasoningDelta: boolean,
  toolMetaByCallId: Map<string, ToolEventMeta>,
): EngineEvent | null {
  switch (event.type) {
    // Streaming delta (incremental) — preferred when streaming is active
    case "assistant.message_delta": {
      const data = event.data as { deltaContent: string };
      return { type: "token", content: data.deltaContent };
    }

    // Complete message (non-streaming fallback) — only emit if no deltas
    // were received for this turn, to avoid doubling content
    case "assistant.message": {
      const data = event.data as { content?: string };
      if (receivedTokenDelta || !data.content) return null;
      return { type: "token", content: data.content };
    }

    // Streaming reasoning delta (incremental)
    case "assistant.reasoning_delta": {
      const data = event.data as { deltaContent: string };
      return { type: "reasoning", content: data.deltaContent };
    }

    // Complete reasoning block (non-streaming fallback)
    case "assistant.reasoning": {
      const data = event.data as { content?: string };
      if (receivedReasoningDelta || !data.content) return null;
      return { type: "reasoning", content: data.content };
    }

    case "tool.execution_start": {
      const data = event.data as { toolName: string; arguments?: unknown; toolCallId: string; parentToolCallId?: string };
      const meta = toolMetaByCallId.get(data.toolCallId);
      return {
        type: "tool_start",
        name: data.toolName,
        arguments: JSON.stringify(data.arguments ?? {}),
        callId: data.toolCallId,
        parentCallId: meta?.parentCallId,
        isInternal: meta?.isInternal ?? false,
      };
    }

    case "tool.execution_partial_result": {
      const data = event.data as { toolCallId: string; partialOutput: string };
      if (!data.partialOutput) return null;
      const partialMeta = data.toolCallId ? toolMetaByCallId.get(data.toolCallId) : undefined;
      if (partialMeta?.isInternal) return null;
      return { type: "status", message: summarizeStatus(data.partialOutput, partialMeta?.name) };
    }

    case "tool.execution_progress": {
      const data = event.data as { toolCallId: string; progressMessage: string };
      if (!data.progressMessage) return null;
      const progressMeta = data.toolCallId ? toolMetaByCallId.get(data.toolCallId) : undefined;
      if (progressMeta?.isInternal) return null;
      return { type: "status", message: summarizeStatus(data.progressMessage, progressMeta?.name) };
    }

    case "tool.execution_complete": {
      const data = event.data as {
        toolCallId: string;
        success: boolean;
        result?: { content?: string; detailedContent?: string; contents?: Array<Record<string, unknown>> };
      };
      const meta = toolMetaByCallId.get(data.toolCallId);
      toolMetaByCallId.delete(data.toolCallId);
      return {
        type: "tool_result",
        name: meta?.name ?? "unknown",
        result: data.result?.content ?? "",
        callId: data.toolCallId,
        isError: !data.success,
        parentCallId: meta?.parentCallId,
        isInternal: meta?.isInternal ?? false,
        detailedResult: data.result?.detailedContent,
        contentBlocks: data.result?.contents,
      };
    }

    case "assistant.usage": {
      const data = event.data as { inputTokens?: number; outputTokens?: number };
      return {
        type: "usage",
        inputTokens: data.inputTokens ?? 0,
        outputTokens: data.outputTokens ?? 0,
      };
    }

    case "session.ask_user": {
      const data = event.data as { payload: string };
      return {
        type: "ask_user",
        payload: data.payload,
      };
    }

    case "session.task_complete":
      return { type: "done" };

    case "session.idle":
      return { type: "done" };

    case "session.error": {
      const data = event.data as { message: string };
      return {
        type: "error",
        message: data.message,
        fatal: true,
      };
    }

    default:
      return null;
  }
}

/** Truncate a status message to a single summary line, capped at 120 chars.
 *  Uses the last non-empty line (most relevant for streaming terminal output)
 *  and prefixes with the tool name when available. */
function summarizeStatus(raw: string, toolName?: string): string {
  const lines = raw.split("\n");
  let last = "";
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i].trim();
    if (trimmed) { last = trimmed; break; }
  }
  if (!last) last = raw.trim();
  const prefix = toolName ? `${toolName}: ` : "";
  const combined = prefix + last;
  return combined.length > 120 ? combined.slice(0, 117) + "…" : combined;
}

function isInternalCopilotEvent(
  event: CopilotSdkEvent,
  toolName?: string,
  parentToolCallId?: string,
): boolean {
  if (event.source?.startsWith("skill-")) return true;
  if (parentToolCallId) return true;
  if (!toolName) return false;
  return toolName.startsWith("internal_") || toolName.startsWith("copilot_");
}
