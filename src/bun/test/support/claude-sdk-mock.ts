import type { EngineEvent, EngineResumeInput } from "../../engine/types.ts";
import type { ClaudeRunConfig, ClaudeSdkAdapter, ClaudeSdkModelInfo } from "../../engine/claude/adapter.ts";

type MockTurnStep =
  | { kind: "emit"; event: EngineEvent }
  | { kind: "ask_user"; payload: string }
  | { kind: "shell_approval"; command: string }
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
    createCalls: [] as Array<{ sessionId: string; model?: string }>,
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
      this.trace.createCalls.push({ sessionId: config.sessionId, model: config.model });
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

          case "ask_user": {
            yield { type: "ask_user", payload: step.payload };
            await config.waitForResume({ type: "ask_user", payload: step.payload });
            break;
          }

          case "shell_approval": {
            yield { type: "shell_approval", command: step.command, executionId: config.executionId };
            await config.waitForResume({ type: "shell_approval", command: step.command });
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

export function usage(inputTokens: number, outputTokens: number): MockTurnStep {
  return { kind: "emit", event: { type: "usage", inputTokens, outputTokens } };
}

export function done(): MockTurnStep {
  return { kind: "emit", event: { type: "done" } };
}

export function askUser(payload = '{"question":"Need input"}'): MockTurnStep {
  return { kind: "ask_user", payload };
}

export function shellApproval(command: string): MockTurnStep {
  return { kind: "shell_approval", command };
}

export function fatal(message: string): MockTurnStep {
  return { kind: "emit", event: { type: "error", message, fatal: true } };
}

export function waitForAbort(): MockTurnStep {
  return { kind: "waitForAbort" };
}
