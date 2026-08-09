import type { EngineEvent } from "../../engine/types.ts";
import type { ClaudeRunConfig, ClaudeSdkAdapter, ClaudeSdkModelInfo } from "../../engine/claude/adapter.ts";
import { executeCommonTool } from "../../engine/common-tools.ts";

type MockTurnStep =
  | { kind: "emit"; event: EngineEvent }
  | { kind: "subagent_start"; callId: string; intent: string; prompt: string }
  | { kind: "subagent_stop"; callId: string }
  | { kind: "callTool"; toolName: string; args: unknown }
  | { kind: "waitForAbort" };

export interface MockClaudeTurnScript {
  steps: MockTurnStep[];
}

export class MockClaudeSdkAdapter implements ClaudeSdkAdapter {
  private readonly createScripts: MockClaudeTurnScript[] = [];
  private readonly resumeScripts: MockClaudeTurnScript[] = [];
  private readonly activeControllers = new Map<number, { abort: () => void }>();
  private readonly knownSessions = new Set<string>();
  private models: ClaudeSdkModelInfo[] = [];

  readonly trace = {
    createCalls: [] as Array<{ sessionId: string; model?: string; systemInstructions?: string; prompt?: string }>,
    resumeCalls: [] as Array<{ sessionId: string; model?: string }>,
    cancelCalls: 0,
  };

  queueCreate(script: MockClaudeTurnScript): this {
    this.createScripts.push(script);
    return this;
  }

  queueResume(script: MockClaudeTurnScript): this {
    this.resumeScripts.push(script);
    return this;
  }

  setModels(models: ClaudeSdkModelInfo[]): this {
    this.models = models;
    return this;
  }

  run(config: ClaudeRunConfig): AsyncIterable<EngineEvent> {
    const isResume = this.knownSessions.has(config.sessionId);
    if (isResume) {
      this.trace.resumeCalls.push({ sessionId: config.sessionId, model: config.model });
    } else {
      this.trace.createCalls.push({ sessionId: config.sessionId, model: config.model, systemInstructions: config.systemInstructions, prompt: config.prompt });
      this.knownSessions.add(config.sessionId);
    }

    const script = isResume ? this.resumeScripts.shift() : this.createScripts.shift();
    if (!script) {
      throw new Error(`No mock Claude ${isResume ? "resume" : "create"} script queued`);
    }

    return this.runScript(config, script);
  }

  private async *runScript(config: ClaudeRunConfig, script: MockClaudeTurnScript): AsyncGenerator<EngineEvent> {
    let aborted = false;
    let abortWaiters: Array<() => void> = [];
    this.activeControllers.set(config.executionId, {
      abort: () => {
        aborted = true;
        for (const resolve of abortWaiters) resolve();
        abortWaiters = [];
      },
    });

    try {
      for (const step of script.steps) {
        if (aborted) return;

        switch (step.kind) {
          case "emit":
            yield step.event;
            break;

          case "subagent_start": {
            yield { type: "subagent_start", callId: step.callId, intent: step.intent, prompt: step.prompt };
            break;
          }

          case "subagent_stop": {
            yield { type: "subagent_stop", callId: step.callId };
            break;
          }

          case "callTool": {
            // Real dispatch: invoke the actual executeCommonTool handler with the shared
            // CommonToolContext already carried in config, and persist genuine
            // tool_start/tool_result events using its real return value — mirrors what
            // production Claude tool dispatch does, instead of the scripted
            // toolStart/toolResult pairs used elsewhere, which fake both the call AND its result.
            const callId = `call_${Date.now()}_${Math.random().toString(36).slice(2)}`;
            yield { type: "tool_start", name: step.toolName, arguments: JSON.stringify(step.args), callId };
            const result = await executeCommonTool(step.toolName, step.args as Record<string, unknown>, config.commonToolContext);
            const resultText = result.type === "suspend" ? result.payload : result.text;
            yield { type: "tool_result", name: step.toolName, result: resultText, callId, isError: false };
            break;
          }

          case "waitForAbort":
            await new Promise<void>((resolve) => {
              if (aborted) {
                resolve();
                return;
              }
              abortWaiters.push(resolve);
            });
            return;
        }
      }
    } finally {
      this.activeControllers.delete(config.executionId);
    }
  }

  async cancel(executionId: number): Promise<void> {
    this.trace.cancelCalls += 1;
    this.activeControllers.get(executionId)?.abort();
  }

  async listModels(): Promise<ClaudeSdkModelInfo[]> {
    return this.models;
  }

  async listCommands(_workingDirectory: string): Promise<Array<{ name: string; description: string }>> {
    return [];
  }
}

export function token(content: string): MockTurnStep {
  return { kind: "emit", event: { type: "token", content } };
}

export function reasoning(content: string): MockTurnStep {
  return { kind: "emit", event: { type: "reasoning", content } };
}

export function toolStart(callId: string, name: string, args: unknown = {}): MockTurnStep {
  return { kind: "emit", event: { type: "tool_start", name, arguments: JSON.stringify(args), callId } };
}

export function toolResult(callId: string, name: string, result: string, isError = false): MockTurnStep {
  return { kind: "emit", event: { type: "tool_result", name, result, callId, isError } };
}

export function done(): MockTurnStep {
  return { kind: "emit", event: { type: "done" } };
}

export function fatal(message: string): MockTurnStep {
  return { kind: "emit", event: { type: "error", message, fatal: true } };
}

export function waitForAbort(): MockTurnStep {
  return { kind: "waitForAbort" };
}

export function subagentStart(callId: string, intent: string, prompt = ""): MockTurnStep {
  return { kind: "subagent_start", callId, intent, prompt };
}

export function subagentStop(callId: string): MockTurnStep {
  return { kind: "subagent_stop", callId };
}

export function callTool(toolName: string, args: unknown = {}): MockTurnStep {
  return { kind: "callTool", toolName, args };
}
