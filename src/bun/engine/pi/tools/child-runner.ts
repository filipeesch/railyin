/**
 * Shared child-session runner for Pi engine tools that spawn child agents.
 *
 * Encapsulates child session creation, event forwarding, loop detection,
 * subagent bubbles, raw-model observability, and disposal.
 *
 * Used by both `delegate` (fan-out) and `web_search` (browser agent) tools.
 */

import { ToolLoopDetector, LOOP_MAX_REPEAT, LOOP_WINDOW_SIZE } from "../harness/tool-loop-detector.ts";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { EngineEvent, RawModelMessage } from "../../types.ts";
import type { ChildSessionFactory, ChildSessionHandle } from "../child-session.ts";
import type { ProviderLimiterRegistry } from "../provider-limiter.ts";
import type { PiEngineConfig } from "../../../config/index.ts";
import type { Model } from "@earendil-works/pi-ai";
import { defaultChildSessionFactory } from "../child-session.ts";
import { runWithLimiter } from "../provider-transport.ts";
import { translateEvent } from "../event-translator.ts";
import { formatPiError } from "../pi-error.ts";
import type { AgentTool } from "@earendil-works/pi-agent-core";

// ─── Options ─────────────────────────────────────────────────────────────────

export interface RunChildSessionOptions {
  /** Unique job identifier for debug logging and event correlation. */
  jobId: string;
  /** Tools to provide to the child session. */
  tools: AgentTool<any>[];
  /** Parent model — child reuses the same provider/model. */
  model: Model<"openai-completions">;
  /** Engine config for auth and compaction settings. */
  config: PiEngineConfig;
  /** Parent system prompt. A suffix may be appended by the caller. */
  parentSystemPrompt?: string;
  /** Optional suffix appended to the parent system prompt for the child. */
  systemPromptSuffix?: string;
  /** Working directory for the child session. */
  cwd: string;
  /** Prompt to send to the child session. */
  prompt: string;
  /** Abort signal for cancellation. */
  signal?: AbortSignal;
  /** Reference to emit child events to the parent execution queue. */
  delegateEmitRef?: { emit?: (event: EngineEvent) => void };
  /** Callback for forwarding child raw-model events to the parent's observability pipeline. */
  onRawModelMessage?: (message: RawModelMessage) => void;
  /** Factory for creating child sessions (injected for testability). */
  childSessionFactory?: ChildSessionFactory;
  /** Provider limiter registry for concurrency control. */
  limiterRegistry?: ProviderLimiterRegistry;
  /** Parent conversation ID for session correlation. */
  parentConversationId?: number;
  /** Parent tool call ID for observability correlation. */
  parentToolCallId?: string;
  /** Maximum number of tool calls (steps) the child may make. */
  maxSteps?: number;
}

// ─── Result ──────────────────────────────────────────────────────────────────

export interface RunChildSessionResult {
  /** The child agent's final text response. */
  text: string;
  /** Whether the session completed successfully. */
  ok: boolean;
  /** Error message if the session failed. */
  error?: string;
  /** Duration in milliseconds. */
  durationMs: number;
  /** Token usage if available. */
  tokens?: number;
}

// ─── Runner ──────────────────────────────────────────────────────────────────

/**
 * Run a single child agent session with full event forwarding and cleanup.
 *
 * This function:
 * 1. Creates a child session via the injected factory.
 * 2. Sets up a loop detector on the child session.
 * 3. Subscribes to child events and forwards them to the parent queue.
 * 4. Emits subagent_start/subagent_stop events for UI rendering.
 * 5. Runs the child session with the given prompt.
 * 6. Extracts the final assistant text response.
 * 7. Cleans up (unsubscribe, dispose).
 *
 * @returns A result object with the child's text response and metadata.
 */
export async function runChildSession(opts: RunChildSessionOptions): Promise<RunChildSessionResult> {
  const {
    jobId,
    tools,
    model,
    config,
    parentSystemPrompt,
    systemPromptSuffix,
    cwd,
    prompt,
    signal,
    delegateEmitRef,
    onRawModelMessage,
    childSessionFactory = defaultChildSessionFactory,
    limiterRegistry,
    parentConversationId,
    parentToolCallId,
    maxSteps,
  } = opts;

  const startMs = Date.now();
  const childBlockId = `child-${jobId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  // Emit subagent_start event for UI rendering
  delegateEmitRef?.emit?.({
    type: "subagent_start",
    callId: childBlockId,
    intent: jobId,
    prompt,
  });

  let handle: Awaited<ReturnType<ChildSessionFactory>> | null = null;
  let unsubscribe: (() => void) | null = null;

  try {
    handle = await childSessionFactory({
      jobId,
      tools,
      model,
      config,
      parentSystemPrompt: systemPromptSuffix
        ? (parentSystemPrompt ?? "") + systemPromptSuffix
        : parentSystemPrompt,
      cwd,
    });

    // Set up loop detection on the child session
    const childLoopDetector = new ToolLoopDetector();
    let stepCount = 0;
    handle.session.agent.beforeToolCall = async (ctx) => {
      // Enforce step limit
      if (maxSteps != null && stepCount >= maxSteps) {
        return {
          block: true,
          reason: `Step limit reached (${maxSteps} steps). Please summarize your findings and return your results.`,
        };
      }
      stepCount++;

      const looping = childLoopDetector.record(ctx.toolCall.name, ctx.args as unknown);
      if (looping) {
        return {
          block: true,
          reason: `Tool loop detected: '${ctx.toolCall.name}' (or a group including it) has been called with the same arguments ${LOOP_MAX_REPEAT} times in the last ${LOOP_WINDOW_SIZE} calls. Try a different approach or summarize your findings.`,
        };
      }
      return undefined;
    };

    // Subscribe to child events BEFORE prompting
    const childSessionId = parentConversationId != null ? `${parentConversationId}/${jobId}` : jobId;
    unsubscribe = handle.session.subscribe((event: AgentSessionEvent) => {
      // Forward tool events to parent queue as internal events
      if (delegateEmitRef?.emit) {
        const engineEvents = translateEvent(event as any, cwd);
        for (const ev of engineEvents) {
          if (ev.type === "tool_start" || ev.type === "tool_result") {
            delegateEmitRef.emit({ ...ev, parentCallId: childBlockId, isInternal: true });
          }
        }
      }

      // Forward raw-model events for observability
      if (onRawModelMessage) {
        onRawModelMessage({
          engine: "pi",
          sessionId: childSessionId,
          parentToolCallId: parentToolCallId ?? undefined,
          direction: "inbound",
          eventType: event.type,
          payload: event as unknown as Record<string, unknown>,
        });
      }
    });

    // Run the child session
    if (limiterRegistry) {
      const providerName = model.provider;
      await runWithLimiter(limiterRegistry, providerName, signal, () => handle!.session.prompt(prompt));
    } else {
      await handle.session.prompt(prompt);
    }

    // Extract the final assistant text
    const messages = handle.session.agent.state.messages as Array<{
      role: string;
      content?: Array<{ type: string; text?: string }>;
    }>;
    const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
    const text =
      lastAssistant?.content
        ?.filter((c) => c.type === "text")
        .map((c) => c.text ?? "")
        .join("") ?? "(no result)";

    const usage = handle.session.getContextUsage?.();
    const durationMs = Date.now() - startMs;

    // Emit subagent stop as a tool_result (succeeded)
    delegateEmitRef?.emit?.({
      type: "tool_result",
      name: "subagent",
      callId: childBlockId,
      result: text,
      isInternal: false,
    });

    return {
      text,
      ok: true,
      durationMs,
      tokens: usage?.tokens ?? undefined,
    };
  } catch (err) {
    const isAbort = err instanceof DOMException && err.name === "AbortError";
    const errorMessage = isAbort ? "Aborted" : formatPiError(err instanceof Error ? err : new Error(String(err)));

    // Emit subagent stop as a tool_result (errored)
    delegateEmitRef?.emit?.({
      type: "tool_result",
      name: "subagent",
      callId: childBlockId,
      result: errorMessage,
      isError: true,
      isInternal: false,
    });

    return {
      text: "",
      ok: false,
      error: errorMessage,
      durationMs: Date.now() - startMs,
    };
  } finally {
    unsubscribe?.();
    handle?.dispose();
  }
}
