/**
 * Mock Cursor SDK adapter for testing.
 *
 * Mirrors the queue/step-builder API of MockCopilotSdkAdapter so cursor can
 * drive the engine-agnostic scenarios in shared-rpc-scenarios.ts. Each call
 * to `run()` pops the next queued turn and emits its scripted steps as
 * EngineEvents (cursor's adapter contract is already in EngineEvent shape).
 *
 * Custom-tool dispatch is supported via the `callTool` step — the mock
 * invokes the registered tool's `execute(args, {})` so suspend-loop tools
 * (decision_request) can fire the engine's onSuspend callback exactly as in
 * production.
 */

import type { EngineEvent } from "@bun/engine/types";
import type { CursorRunConfig, CursorSdkAdapter, CursorSdkModelInfo } from "@bun/engine/cursor/adapter";

export type CursorMockStep =
  | { kind: "emit"; event: EngineEvent }
  | { kind: "callTool"; toolName: string; args: unknown }
  | { kind: "waitForAbort" }
  | { kind: "error"; message: string; fatal?: boolean };

export interface CursorMockTurn {
  steps: CursorMockStep[];
  /** If set, `run()` throws this error before streaming any events. */
  sendError?: Error;
}

export class MockCursorSdkAdapter implements CursorSdkAdapter {
  private readonly turns: CursorMockTurn[] = [];
  private models: CursorSdkModelInfo[] = [
    {
      value: "mock-model",
      displayName: "Mock Cursor Model",
      description: "Mock model for testing",
      supportsThinking: true,
    },
  ];

  readonly trace = {
    runCalls: 0,
    runConfigs: [] as CursorRunConfig[],
    cancelCalls: 0,
    listModelsCalls: 0,
    listCommandsCalls: 0,
    shutdownCalls: 0,
  };

  queueTurn(turn: CursorMockTurn): this {
    this.turns.push(turn);
    return this;
  }

  setModels(models: CursorSdkModelInfo[]): this {
    this.models = models;
    return this;
  }

  async *run(config: CursorRunConfig): AsyncIterable<EngineEvent> {
    this.trace.runCalls += 1;
    this.trace.runConfigs.push(config);

    const turn = this.turns.shift();
    if (!turn) throw new Error("No mock cursor turn queued");
    if (turn.sendError) throw turn.sendError;

    for (const step of turn.steps) {
      if (config.signal?.aborted) break;

      switch (step.kind) {
        case "emit": {
          yield step.event;
          break;
        }
        case "callTool": {
          const tool = config.customTools?.[step.toolName];
          if (!tool) throw new Error(`Mock cursor tool not found: ${step.toolName}`);
          // Real worker invokes execute and ignores the return when the tool
          // suspends — the onSuspend side-effect (abort signal) is what stops
          // the stream. Mirror that here.
          try {
            await tool.execute(step.args as never, {} as never);
          } catch {
            // Tool errors surface as fatal in production; tests can use the
            // `error` step builder to drive that path explicitly.
          }
          break;
        }
        case "waitForAbort": {
          if (!config.signal) break;
          if (config.signal.aborted) break;
          await new Promise<void>((resolve) => {
            config.signal!.addEventListener("abort", () => resolve(), { once: true });
          });
          break;
        }
        case "error": {
          yield { type: "error", message: step.message, fatal: step.fatal ?? true };
          return;
        }
      }
    }

    // Match the production SubprocessCursorAdapter: do not emit the terminal
    // "done" when the signal aborted — the engine treats that as a cancel.
    if (!config.signal?.aborted) yield { type: "done" };
  }

  async cancel(_executionId: number): Promise<void> {
    this.trace.cancelCalls += 1;
  }

  async listModels(_workingDirectory: string): Promise<CursorSdkModelInfo[]> {
    this.trace.listModelsCalls += 1;
    return this.models;
  }

  async listCommands(_workingDirectory: string): Promise<Array<{ name: string; description: string }>> {
    this.trace.listCommandsCalls += 1;
    return [];
  }

  async shutdownAll(): Promise<void> {
    this.trace.shutdownCalls += 1;
  }
}

export function createMockCursorSdkAdapter(): MockCursorSdkAdapter {
  return new MockCursorSdkAdapter();
}

/* ─── Step builders ─────────────────────────────────────────────────── */

export function token(content: string): CursorMockStep {
  return { kind: "emit", event: { type: "token", content } };
}

export function reasoning(content: string): CursorMockStep {
  return { kind: "emit", event: { type: "reasoning", content } };
}

export function toolStart(callId: string, name: string, args: unknown = {}): CursorMockStep {
  return {
    kind: "emit",
    event: { type: "tool_start", name, arguments: JSON.stringify(args), callId },
  };
}

export function toolResult(callId: string, result: string, success = true): CursorMockStep {
  return {
    kind: "emit",
    event: { type: "tool_result", name: "", result, callId, isError: !success },
  };
}

export function statusMessage(message: string): CursorMockStep {
  return { kind: "emit", event: { type: "status", message } };
}

export function askUser(payload = '{"question":"Need input"}'): CursorMockStep {
  return { kind: "emit", event: { type: "ask_user", payload } };
}

export function callTool(toolName: string, args: unknown = {}): CursorMockStep {
  return { kind: "callTool", toolName, args };
}

export function waitForAbort(): CursorMockStep {
  return { kind: "waitForAbort" };
}

export function fatalError(message: string): CursorMockStep {
  return { kind: "error", message, fatal: true };
}
