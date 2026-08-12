/**
 * Mock Cursor SDK adapter for testing.
 *
 * Mirrors the queue/step-builder API of MockCopilotSdkAdapter so cursor can
 * drive the engine-agnostic scenarios in shared-rpc-scenarios.ts. Each call
 * to `run()` pops the next queued turn and emits its scripted steps as
 * EngineEvents (cursor's adapter contract is already in EngineEvent shape).
 *
 * Custom-tool dispatch is supported via the `callTool` step — the mock
 * invokes the registered tool's `execute(args, {})` exactly as production
 * does. Streaming decision_request calls route their page payload through the
 * engine's onPage callback (wired via buildCursorTools) and continue the loop.
 * It also emits a real tool_start/tool_result event pair using
 * the tool's actual return value, so scenarios can assert on genuine tool
 * output (e.g. dynamic MCP discovery tools).
 */

import type { EngineEvent } from "@bun/engine/types";
import type { CursorRunConfig, CursorSdkAdapter, CursorSdkModelInfo } from "@bun/engine/cursor/adapter";
import type { ToolCallDisplay, FileDiffPayload } from "@shared/rpc-types";

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
    shutdownCalls: 0,
    compactCalls: [] as string[],
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
          const callId = `call_${Date.now()}_${Math.random().toString(36).slice(2)}`;
          // Real worker invokes execute() and captures the return value. Streaming
          // decision_request returns `page` — the engine-side onPage callback
          // (wired through buildCursorTools) pushes a decision_request_page event
          // into the run loop, and the tool_start/tool_result pair is emitted so
          // scenarios can assert genuine tool output. There is no suspend/abort
          // path anymore (ask_user/shell_approval are engine-level events, not
          // common-tool results).
          let resultText: string | undefined;
          let errored = false;
          try {
            resultText = String(await tool.execute(step.args as never, {} as never));
          } catch {
            // Tool errors surface as fatal in production; tests can use the
            // `error` step builder to drive that path explicitly.
            errored = true;
          }
          if (config.signal?.aborted || errored) break;
          yield { type: "tool_start", name: step.toolName, arguments: JSON.stringify(step.args), callId };
          yield { type: "tool_result", name: "", result: resultText!, callId, isError: false };
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

  async compact(agentId: string): Promise<void> {
    this.trace.compactCalls.push(agentId);
  }

  async listModels(_workingDirectory: string): Promise<CursorSdkModelInfo[]> {
    this.trace.listModelsCalls += 1;
    return this.models;
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

/* ─── Display-aware step builders ─────────────────────────────────── */

/**
 * Emit a tool_start event with display metadata pre-populated.
 * Useful for testing that the UI renders tool call labels and subjects correctly.
 */
export function toolStartWithDisplay(
  callId: string,
  name: string,
  args: unknown = {},
  display: ToolCallDisplay,
): CursorMockStep {
  return {
    kind: "emit",
    event: {
      type: "tool_start",
      name,
      arguments: JSON.stringify(args),
      callId,
      display,
    },
  };
}

/**
 * Emit a tool_result event with structured data (detailedResult, writtenFiles).
 * Useful for testing that the UI renders shell stdout and edit diffs correctly.
 */
export function toolResultWithStructuredData(
  callId: string,
  result: string,
  options?: {
    detailedResult?: string;
    writtenFiles?: FileDiffPayload[];
    success?: boolean;
  },
): CursorMockStep {
  return {
    kind: "emit",
    event: {
      type: "tool_result",
      name: "",
      result,
      callId,
      isError: options?.success === false,
      detailedResult: options?.detailedResult,
      writtenFiles: options?.writtenFiles,
    },
  };
}
