/**
 * Copilot SDK event translation — maps Copilot streaming events to EngineEvent (Task 7.4).
 *
 * Maps @github/copilot-sdk streaming events to our unified EngineEvent format:
 *   assistant.message_delta  → { type: "token" }
 *   assistant.reasoning_delta → { type: "reasoning" }
 *   session.task_complete    → { type: "done" }
 *   session.idle             → { type: "done" }
 *   session.error            → { type: "error", fatal: true }
 *
 * Trimmed (07-02): assistant.usage (usage display), session.ask_user,
 * session.compaction_* (compaction_summary), report_intent status, and the
 * file-diff extraction on tool_result — the EngineEvent union members were
 * removed; the bridge no longer consumes them.
 */

import type { CopilotSdkEvent, CopilotSdkSession } from "./session.ts";
import type { EngineEvent } from "../types.ts";
import type { ToolCallDisplay } from "../../../shared/rpc-types.ts";
import { COMMON_TOOL_NAMES, buildCommonToolDisplay } from "../common-tools.ts";
import { canonicalToolDisplayLabel, humanizeToolName, stripWorktreePath } from "../tool-display.ts";

type ToolEventMeta = {
  name: string;
  parentCallId?: string;
  isInternal: boolean;
  arguments?: unknown;
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
  options?: {
    signal?: AbortSignal;
    sendPromise?: Promise<unknown>;
    worktreePath?: string;
    onWatchdogFire?: () => Promise<boolean>;
    onRawEvent?: (event: CopilotSdkEvent) => void;
    onHeartbeat?: () => void;
    idleTimeoutMs?: number;
    maxSilenceCount?: number;
  },
): AsyncGenerator<EngineEvent> {
  const {
    signal,
    sendPromise,
    worktreePath,
    onWatchdogFire,
    onRawEvent,
    onHeartbeat,
    idleTimeoutMs = 120_000,
    maxSilenceCount = 3,
  } = options ?? {};
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
  let silenceCount = 0;
  // Count of tool calls that have started but not yet completed. The watchdog
  // is suppressed while any tool is in-flight — a long-running tool (e.g.
  // `bun test`) can legitimately produce no events for minutes at a time.
  let toolsInFlight = 0;

  const unsubscribe: () => void = session.on((event: CopilotSdkEvent) => {
    onRawEvent?.(event);
    silenceCount = 0; // CLI is active; reset the consecutive-silence counter
    if (event.type === "assistant.message_delta") receivedTokenDelta = true;
    if (event.type === "assistant.reasoning_delta") receivedReasoningDelta = true;
    if (event.type === "tool.execution_start") {
      toolsInFlight++;
      const data = event.data as { toolCallId: string; toolName: string; parentToolCallId?: string; arguments?: unknown };
      toolMetaByCallId.set(data.toolCallId, {
        name: data.toolName,
        parentCallId: data.parentToolCallId,
        isInternal: isInternalCopilotEvent(event, data.toolName, data.parentToolCallId),
        arguments: data.arguments,
      });
    }
    if (event.type === "tool.execution_complete") {
      toolsInFlight = Math.max(0, toolsInFlight - 1);
    }

    const engineEvent = translateEvent(event, receivedTokenDelta, receivedReasoningDelta, toolMetaByCallId, worktreePath);
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
          onHeartbeat?.();
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
            if (silenceCount >= maxSilenceCount) {
              queue.push({
                type: "error",
                message: `Copilot session unresponsive (no events for ${(idleTimeoutMs * maxSilenceCount) / 1000}s, CLI healthy)`,
                fatal: true,
              });
              done = true;
            }
          }
          r();
        }, idleTimeoutMs);
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
  worktreePath?: string,
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
      const data = event.data as { toolName: string; arguments?: Record<string, unknown>; toolCallId: string; parentToolCallId?: string };
      const meta = toolMetaByCallId.get(data.toolCallId);
      return {
        type: "tool_start",
        name: data.toolName,
        arguments: JSON.stringify(data.arguments ?? {}),
        callId: data.toolCallId,
        parentCallId: meta?.parentCallId,
        isInternal: meta?.isInternal ?? false,
        display: COMMON_TOOL_NAMES.has(data.toolName)
          ? buildCommonToolDisplay(data.toolName, data.arguments ?? {})
          : buildCopilotNativeDisplay(data.toolName, data.arguments ?? {}, worktreePath),
      };
    }

    case "tool.execution_partial_result":
    case "tool.execution_progress":
      // Status is driven solely by report_intent; ignore noisy tool output fragments.
      return null;

    case "tool.execution_complete": {
      const data = event.data as {
        toolCallId: string;
        success: boolean;
        result?: { content?: string; detailedContent?: string; contents?: Array<Record<string, unknown>> };
      };
      const meta = toolMetaByCallId.get(data.toolCallId);
      toolMetaByCallId.delete(data.toolCallId);
      const rawResultContent = data.result?.content ?? "";
      let detailedResult: string | undefined = data.result?.detailedContent;
      if (!detailedResult) {
        try {
          const parsed = JSON.parse(rawResultContent);
          if (parsed && typeof parsed.detailedContent === "string" && parsed.detailedContent) {
            detailedResult = parsed.detailedContent;
          }
        } catch { /* not JSON envelope */ }
      }
      return {
        type: "tool_result",
        name: meta?.name ?? "unknown",
        result: rawResultContent,
        callId: data.toolCallId,
        isError: !data.success,
        parentCallId: meta?.parentCallId,
        isInternal: meta?.isInternal ?? false,
        detailedResult,
        contentBlocks: data.result?.contents,
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

function buildCopilotNativeDisplay(name: string, args: Record<string, unknown>, worktreePath?: string): ToolCallDisplay {
  const str = (v: unknown): string => (v != null ? String(v) : "");
  switch (name) {
    case "read_file":
      return {
        label: canonicalToolDisplayLabel(name),
        subject: stripWorktreePath(str(args.path) || undefined, worktreePath),
        contentType: "file",
        startLine: typeof args.startLine === "number" && args.startLine > 0 ? args.startLine : undefined,
      };
    case "view":
      return {
        label: canonicalToolDisplayLabel(name),
        subject: stripWorktreePath(str(args.path) || undefined, worktreePath),
        contentType: "file",
      };
    case "bash": {
      const cmd = str(args.command) || undefined;
      return {
        label: canonicalToolDisplayLabel(name),
        subject: stripWorktreePath(cmd, worktreePath),
        contentType: "terminal",
      };
    }
    case "create":
    case "write_file":
      return { label: canonicalToolDisplayLabel(name), subject: stripWorktreePath(str(args.path) || undefined, worktreePath), contentType: "file" };
    case "edit":
      return {
        label: canonicalToolDisplayLabel(name),
        subject: stripWorktreePath(str(args.path) || undefined, worktreePath),
        contentType: "file",
        startLine: typeof args.startLine === "number" && args.startLine > 0 ? args.startLine : undefined,
      };
    case "apply_patch":
      return { label: canonicalToolDisplayLabel(name) };
    case "run_in_terminal": {
      const cmd = str(args.command) || str(args.explanation) || undefined;
      return {
        label: canonicalToolDisplayLabel(name),
        subject: stripWorktreePath(cmd, worktreePath),
        contentType: "terminal",
      };
    }
    case "grep_search":
      return { label: canonicalToolDisplayLabel(name), subject: str(args.query || args.pattern) || undefined };
    case "find_files":
    case "find":
      return { label: canonicalToolDisplayLabel(name), subject: str(args.pattern || args.path as string) || undefined };
    case "delete_file":
      return { label: canonicalToolDisplayLabel(name), subject: stripWorktreePath(str(args.path) || undefined, worktreePath) };
    case "rename_file":
      return { label: canonicalToolDisplayLabel(name), subject: stripWorktreePath(str(args.path) || undefined, worktreePath) };
    default:
      return { label: humanizeToolName(name) };
  }
}

function isInternalCopilotEvent(
  event: CopilotSdkEvent,
  toolName?: string,
  parentToolCallId?: string,
): boolean {
  const source = (event as { source?: string }).source;
  if (source?.startsWith("skill-")) return true;
  if (!toolName) return false;
  if (toolName === "report_intent") return true;
  return toolName.startsWith("internal_") || toolName.startsWith("copilot_");
}
