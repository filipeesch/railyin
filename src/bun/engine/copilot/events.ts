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

import type { CopilotSession, SessionEvent } from "@github/copilot-sdk";
import type { EngineEvent } from "../types.ts";

/**
 * Subscribe to a CopilotSession and yield EngineEvents until the session
 * completes (session.idle or session.task_complete) or errors.
 *
 * The session must already have a pending send/sendAndWait call in flight
 * before or immediately after this generator is iterated.
 */
export async function* translateCopilotStream(
  session: CopilotSession,
  signal?: AbortSignal,
  sendPromise?: Promise<unknown>,
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

  // Track tool names by callId so tool.execution_complete can include the tool name.
  const toolNameByCallId = new Map<string, string>();

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

  const unsubscribe: () => void = session.on((event: SessionEvent) => {
    if (event.type === "assistant.message_delta") receivedTokenDelta = true;
    if (event.type === "assistant.reasoning_delta") receivedReasoningDelta = true;
    if (event.type === "tool.execution_start") {
      toolNameByCallId.set(event.data.toolCallId, event.data.toolName);
    }

    const engineEvent = translateEvent(event, receivedTokenDelta, receivedReasoningDelta, toolNameByCallId);
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
      // If no SDK events arrive within IDLE_TIMEOUT_MS, we assume the Copilot
      // CLI process has crashed or the connection has silently dropped, and we
      // yield a fatal error so consumeStream can write 'failed' state and exit.
      const IDLE_TIMEOUT_MS = 120_000;
      await new Promise<void>((r) => {
        notify = r;
        const t = setTimeout(() => {
          queue.push({
            type: "error",
            message: `Copilot connection timed out (no events for ${IDLE_TIMEOUT_MS / 1000}s)`,
            fatal: true,
          });
          done = true;
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
  event: SessionEvent,
  receivedTokenDelta: boolean,
  receivedReasoningDelta: boolean,
  toolNameByCallId: Map<string, string>,
): EngineEvent | null {
  switch (event.type) {
    // Streaming delta (incremental) — preferred when streaming is active
    case "assistant.message_delta":
      return { type: "token", content: event.data.deltaContent };

    // Complete message (non-streaming fallback) — only emit if no deltas
    // were received for this turn, to avoid doubling content
    case "assistant.message":
      if (receivedTokenDelta || !event.data.content) return null;
      return { type: "token", content: event.data.content };

    // Streaming reasoning delta (incremental)
    case "assistant.reasoning_delta":
      return { type: "reasoning", content: event.data.deltaContent };

    // Complete reasoning block (non-streaming fallback)
    case "assistant.reasoning":
      if (receivedReasoningDelta || !event.data.content) return null;
      return { type: "reasoning", content: event.data.content };

    case "tool.execution_start":
      return {
        type: "tool_start",
        name: event.data.toolName,
        arguments: JSON.stringify(event.data.arguments ?? {}),
        callId: event.data.toolCallId,
      };

    case "tool.execution_complete": {
      const name = toolNameByCallId.get(event.data.toolCallId) ?? "unknown";
      toolNameByCallId.delete(event.data.toolCallId);
      return {
        type: "tool_result",
        name,
        result: event.data.result?.content ?? "",
        callId: event.data.toolCallId,
        isError: !event.data.success,
      };
    }

    case "assistant.usage":
      return {
        type: "usage",
        inputTokens: event.data.inputTokens ?? 0,
        outputTokens: event.data.outputTokens ?? 0,
      };

    case "session.task_complete":
      return { type: "done" };

    case "session.idle":
      return { type: "done" };

    case "session.error":
      return {
        type: "error",
        message: event.data.message,
        fatal: true,
      };

    default:
      return null;
  }
}
