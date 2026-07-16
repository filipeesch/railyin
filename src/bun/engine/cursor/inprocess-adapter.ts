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
}

const logToConsole: RecoveryLog = (level, message) => {
  const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  fn(`[cursor] ${message}`);
};

export class InProcessCursorAdapter implements CursorSdkAdapter {
  private readonly apiKey?: string;
  private readonly sdk: CursorSdkClient;
  private readonly activeRuns = new Map<string, RunState>();

  constructor(options: CursorAdapterOptions = {}, sdk: CursorSdkClient = { Agent, Cursor }) {
    this.apiKey = options.apiKey;
    this.sdk = sdk;
  }

  private resolveApiKey(): string | undefined {
    return this.apiKey ?? process.env.CURSOR_API_KEY;
  }

  async *run(config: CursorRunConfig): AsyncIterable<EngineEvent> {
    const runId = randomUUID();
    const state: RunState = { aborted: false };
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

      for await (const message of run.stream()) {
        if (state.aborted) break;
        config.onRawMessage?.(message);
        for (const event of translateCursorMessage(message as CursorSDKMessage)) {
          yield event;
        }
      }

      if (!state.aborted) {
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
      }
      yield { type: "error", message: err instanceof Error ? err.message : String(err), fatal: true };
    } finally {
      if (config.signal) config.signal.removeEventListener("abort", onAbort);
      await this.finalizeRunState(state);
      this.activeRuns.delete(runId);
    }

    // Sentinel end-of-stream marker consumed by CursorEngine._run(), which
    // swallows it and emits its own terminal "done" — matches the former
    // subprocess adapter's contract (no terminal event after an abort).
    if (!state.aborted) yield { type: "done" };
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
