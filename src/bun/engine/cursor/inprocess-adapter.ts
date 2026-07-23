/**
 * In-process Cursor SDK adapter.
 *
 * Runs @cursor/sdk directly under Bun instead of delegating to a Node
 * subprocess. The prior subprocess bridge existed only to work around a
 * suspected Bun HTTP/2 bug; live testing confirmed the real cause was a bug
 * in @cursor/sdk itself (fixed between 1.0.18 and 1.0.23) — unrelated to
 * the Bun runtime. Removing the bridge deletes the entire proxy-tool/IPC
 * layer: custom tools' `execute` runs directly in this call stack.
 */

import { randomUUID } from "node:crypto";
import { setMaxListeners } from "node:events";
import { Agent, Cursor } from "@cursor/sdk";
import type { Agent as AgentClass, Run, SDKAgent } from "@cursor/sdk";
import type { EngineEvent } from "../types.ts";
import { buildBaseOptions } from "./options.ts";
import { PersistentBusyError, sendPromptWithRecovery, type RecoveryLog } from "./recovery.ts";
import type { AgentNamespace } from "./resume.ts";
import { translateCursorMessage, type CursorSDKMessage } from "./translate-events.ts";
import type {
  CursorAdapterOptions,
  CursorRunConfig,
  CursorSdkAdapter,
  CursorSdkModelInfo,
} from "./adapter.ts";

// The Cursor SDK registers abort listeners on shared internal AbortSignals
// per Agent.create()/resume() call and doesn't always tear them down on
// agent.close(). Across many turns the count crosses Node's default of 10
// and triggers a MaxListenersExceededWarning. Disabling the cap here mirrors
// the former worker.mjs behavior — accepted risk, no dedicated leak guard.
setMaxListeners(0);

// Force local-agent SDK streams onto HTTP/1.1 + SSE instead of HTTP/2.
// @cursor/sdk bundles @connectrpc/connect-node, whose HTTP/2 session manager
// has a known, unfixed upstream bug (connectrpc/connect-es#1678, #1561):
// an idle/in-flight session can be torn down by the backend/network with
// `ConnectError: [internal] Session closed with error code 6` in a way the
// SDK's own retry/error paths never observe, silently stalling the run.
// Cursor's own docs recommend this flag for exactly this class of transport
// issue ("Bun defaults to HTTP/1.1 due to upstream HTTP/2 compatibility
// issues"). Configured once here, process-wide, before any Agent.create/
// Agent.resume call can occur.
Cursor.configure({ local: { useHttp1ForAgent: true } });

/** Injectable SDK surface — real `@cursor/sdk` exports by default, a fake in tests. */
export interface CursorSdkClient {
  Agent: AgentNamespace | typeof AgentClass;
  Cursor: {
    models: {
      list(options?: { apiKey?: string }): Promise<
        Array<{
          id: string;
          displayName: string;
          description?: string;
          supportsThinking?: boolean;
          variants?: unknown[];
          parameters?: unknown[];
        }>
      >;
    };
  };
}

interface RunState {
  agent?: SDKAgent;
  run?: Run;
  aborted: boolean;
  /** Set when the per-run stall watchdog fires; treated like `aborted` for post-loop wait()/done-sentinel skipping. */
  stalled: boolean;
  /** call_id's of tool_call messages currently "running" (SDK built-in or custom tools). Non-empty means the run is legitimately busy, not idly waiting on the assistant/SDK. */
  inFlightToolCalls: Set<string>;
}

/** Default per-run inactivity threshold when idle (no tool call in flight): no SDK message for this long while still streaming is treated as a dead run. */
const DEFAULT_STALL_TIMEOUT_MS = 5 * 60_000;

/**
 * Default per-run inactivity threshold while a tool call is in flight.
 * Tool execution (shell commands, large edits, indexing) can legitimately
 * run far longer than the idle-wait threshold above without any intermediate
 * SDK message — a long shell command must not be mistaken for a dead
 * session. This threshold only guards against a tool call itself silently
 * hanging forever; it does not need to be as tight as the idle threshold.
 */
const DEFAULT_TOOL_EXECUTION_STALL_TIMEOUT_MS = 30 * 60_000;

const logToConsole: RecoveryLog = (level, message) => {
  const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  fn(`[cursor] ${message}`);
};

/**
 * Duck-types `@connectrpc/connect`'s `ConnectError` without importing it
 * directly — it's a transitive dependency bundled inside `@cursor/sdk`, not
 * one Railyin declares itself. `ConnectError` always sets `error.name =
 * "ConnectError"` (see connect-error.js). This is the known, currently
 * unfixed upstream transport failure class (connectrpc/connect-es#1678,
 * #1561) responsible for `Session closed with error code 6` — logged here
 * distinctly from other failures so future occurrences are traceable in
 * bun.log instead of anonymous unhandled-rejection lines.
 */
function isConnectTransportError(err: unknown): boolean {
  return err instanceof Error && err.name === "ConnectError";
}

export class InProcessCursorAdapter implements CursorSdkAdapter {
  private readonly apiKey?: string;
  private readonly sdk: CursorSdkClient;
  private readonly stallTimeoutMs: number;
  private readonly toolExecutionStallTimeoutMs: number;
  private readonly activeRuns = new Map<string, RunState>();

  constructor(
    options: CursorAdapterOptions = {},
    sdk: CursorSdkClient = { Agent, Cursor },
    stallTimeoutMs: number = DEFAULT_STALL_TIMEOUT_MS,
    toolExecutionStallTimeoutMs: number = DEFAULT_TOOL_EXECUTION_STALL_TIMEOUT_MS,
  ) {
    this.apiKey = options.apiKey;
    this.sdk = sdk;
    this.stallTimeoutMs = stallTimeoutMs;
    this.toolExecutionStallTimeoutMs = toolExecutionStallTimeoutMs;
  }

  private resolveApiKey(): string | undefined {
    return this.apiKey ?? process.env.CURSOR_API_KEY;
  }

  /**
   * Races the next SDK stream message against `timeoutMs` (the caller
   * selects the idle or tool-execution threshold based on whether a tool
   * call is currently in flight — see `run()`'s call site).
   *
   * A plain `setTimeout` cannot "inject" a yield into a paused
   * `for await` loop — the iterator must be driven manually so each
   * `.next()` call can be raced. `Promise.race` attaches a rejection
   * handler to both promises internally, so a losing `iterator.next()`
   * that later rejects does not surface as an unhandled rejection.
   */
  private async nextWithStallTimeout(
    iterator: AsyncIterator<unknown>,
    timeoutMs: number,
  ): Promise<{ stalled: true } | { stalled: false; result: IteratorResult<unknown> }> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<{ stalled: true }>((resolve) => {
      timer = setTimeout(() => resolve({ stalled: true }), timeoutMs);
    });
    try {
      return await Promise.race([
        iterator.next().then((result) => ({ stalled: false as const, result })),
        timeoutPromise,
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async *run(config: CursorRunConfig): AsyncIterable<EngineEvent> {
    const runId = randomUUID();
    const state: RunState = { aborted: false, stalled: false, inFlightToolCalls: new Set() };
    this.activeRuns.set(runId, state);

    const onAbort = () => {
      state.aborted = true;
      state.run?.cancel().catch(() => {});
    };
    if (config.signal) {
      if (config.signal.aborted) onAbort();
      else config.signal.addEventListener("abort", onAbort, { once: true });
    }

    try {
      const baseOptions = buildBaseOptions(
        this.resolveApiKey(),
        config.model,
        config.workingDirectory,
        config.customTools ?? {},
        config.modelParams,
      );

      const { agent, run } = await sendPromptWithRecovery<SDKAgent, Run>(
        this.sdk.Agent,
        config.agentId,
        baseOptions,
        config.prompt,
        {
          runId,
          executionId: config.executionId,
          taskId: config.taskId,
          conversationId: config.conversationId,
          log: logToConsole,
        },
      );
      state.agent = agent;
      state.run = run;

      const iterator = run.stream()[Symbol.asyncIterator]();
      while (!state.aborted) {
        // While a tool call is in flight (SDK built-in or custom), the run is
        // legitimately busy and may not emit any SDK message for a long time
        // (e.g. a slow shell command) — use the relaxed threshold. Otherwise
        // we're idly waiting on the assistant/SDK to respond, which is the
        // actual failure mode this watchdog targets — use the strict one.
        const activeTimeoutMs =
          state.inFlightToolCalls.size > 0 ? this.toolExecutionStallTimeoutMs : this.stallTimeoutMs;
        const raced = await this.nextWithStallTimeout(iterator, activeTimeoutMs);

        if (raced.stalled) {
          // An abort may have won the race against the stall timer (e.g. the
          // caller cancelled right as the threshold elapsed). Let the existing
          // abort path resolve naturally instead of double-yielding an error.
          if (state.aborted) break;

          state.stalled = true;
          console.error(`[cursor] ${JSON.stringify({
            event: "cursor_run_stalled",
            runId,
            executionId: config.executionId,
            taskId: config.taskId,
            conversationId: config.conversationId,
            agentId: config.agentId ?? null,
            stallTimeoutMs: activeTimeoutMs,
            toolExecutionInFlight: state.inFlightToolCalls.size > 0,
          })}`);
          state.run?.cancel().catch(() => {});
          yield {
            type: "error",
            message: `Cursor run stalled: no SDK event for ${activeTimeoutMs}ms`,
            fatal: true,
          };
          break;
        }

        const { value, done } = raced.result;
        if (done || state.aborted) break;
        config.onRawMessage?.(value);
        this.trackToolCallLifecycle(state, value as CursorSDKMessage);
        for (const event of translateCursorMessage(value as CursorSDKMessage)) {
          yield event;
        }
      }

      if (!state.aborted && !state.stalled) {
        try {
          const result = await run.wait();
          if (result.status === "error") {
            yield {
              type: "error",
              message: typeof result.result === "string" ? result.result : "Cursor agent run failed with no detail",
              fatal: true,
            };
          }
        } catch (waitErr) {
          yield {
            type: "error",
            message: `wait() threw: ${waitErr instanceof Error ? waitErr.message : String(waitErr)}`,
            fatal: true,
          };
        }
      }
    } catch (err) {
      if (err instanceof PersistentBusyError) {
        console.error(`[cursor] ${JSON.stringify({
          event: "cursor_run_failed",
          failureKind: err.failureKind,
          runId,
          executionId: config.executionId,
          taskId: config.taskId,
          conversationId: config.conversationId,
          agentId: config.agentId ?? null,
          detail: err.message,
        })}`);
      } else if (isConnectTransportError(err)) {
        console.error(`[cursor] ${JSON.stringify({
          event: "cursor_transport_error",
          runId,
          executionId: config.executionId,
          taskId: config.taskId,
          conversationId: config.conversationId,
          agentId: config.agentId ?? null,
          detail: err instanceof Error ? err.message : String(err),
        })}`);
      }
      yield { type: "error", message: err instanceof Error ? err.message : String(err), fatal: true };
    } finally {
      if (config.signal) config.signal.removeEventListener("abort", onAbort);
      await this.finalizeRunState(state);
      this.activeRuns.delete(runId);
    }

    // Sentinel end-of-stream marker consumed by CursorEngine._run(), which
    // swallows it and emits its own terminal "done" — matches the former
    // subprocess adapter's contract (no terminal event after an abort or stall).
    if (!state.aborted && !state.stalled) yield { type: "done" };
  }

  /**
   * Maintains `state.inFlightToolCalls` based on `tool_call` message
   * lifecycle: added on `status: "running"`, removed on `"completed"` or
   * `"error"`. Drives the watchdog's idle-vs-busy timeout selection — see
   * the comment above `nextWithStallTimeout`'s call site in `run()`.
   */
  private trackToolCallLifecycle(state: RunState, message: CursorSDKMessage): void {
    if (message.type !== "tool_call" || !message.call_id) return;
    if (message.status === "running") {
      state.inFlightToolCalls.add(message.call_id);
    } else if (message.status === "completed" || message.status === "error") {
      state.inFlightToolCalls.delete(message.call_id);
    }
  }

  private async finalizeRunState(state: RunState): Promise<void> {
    if (state.run) {
      await state.run.cancel().catch(() => {});
    }
    if (state.agent) {
      try {
        await state.agent.close();
      } catch {
        // Ignore close failures; the run has already terminated.
      }
    }
  }

  async cancel(_executionId: number): Promise<void> {
    // Cancel is driven by the AbortSignal passed into run(); no separate path.
  }

  async listModels(_workingDirectory: string): Promise<CursorSdkModelInfo[]> {
    const apiKey = this.resolveApiKey();
    if (!apiKey) {
      console.warn("[cursor] listModels: no api_key configured and CURSOR_API_KEY is not set; returning empty model list");
      return [];
    }
    const models = await this.sdk.Cursor.models.list({ apiKey });
    return models.map((m) => ({
      value: m.id,
      displayName: m.displayName,
      description: m.description,
      supportsThinking: Boolean(m.supportsThinking),
      variants: Array.isArray(m.variants) ? m.variants : undefined,
      parameters: Array.isArray(m.parameters) ? m.parameters : undefined,
    }));
  }

  async listCommands(_workingDirectory: string): Promise<Array<{ name: string; description: string }>> {
    // No-op: DB-path-resolution + CursorDialect.listCommands() delegation
    // live in CursorEngine.listCommands(), not the adapter. Matches the
    // former SubprocessCursorAdapter's stub behavior.
    return [];
  }

  async shutdownAll(): Promise<void> {
    for (const state of this.activeRuns.values()) {
      state.aborted = true;
      await this.finalizeRunState(state);
    }
    this.activeRuns.clear();
  }
}
