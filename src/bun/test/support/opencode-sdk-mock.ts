import type { EngineEvent, EngineModelInfo, CommandInfo } from "../../engine/types.ts";
import type { OpenCodeSdkAdapter, OpenCodeRunParams } from "../../engine/opencode/types.ts";
import { executeCommonTool } from "../../engine/common-tools.ts";

type MockTurnStep =
  | { kind: "emit"; event: EngineEvent }
  | { kind: "waitForAbort" }
  | { kind: "callTool"; toolName: string; args: unknown };

export interface MockOpenCodeTurnScript {
  steps: MockTurnStep[];
  sendError?: Error;
}

export class MockOpenCodeSdkAdapter implements OpenCodeSdkAdapter {
  private readonly createScripts: MockOpenCodeTurnScript[] = [];
  private readonly resumeScripts: MockOpenCodeTurnScript[] = [];
  private readonly activeControllers = new Map<number, { abort: () => void }>();
  private sessionCounter = 1;
  private models: EngineModelInfo[] = [];
  private skills: Array<{ name: string; description: string }> = [];

  /** Tracks conversationId → sessionId for reuse detection */
  private readonly sessionMap = new Map<number, string>();

  readonly trace = {
    createCalls: [] as Array<{ conversationId: number; directory: string; model?: string }>,
    resumeCalls: [] as Array<{ conversationId: number; sessionId: string }>,
    listModelsCalls: 0,
    listCommandsCalls: [] as Array<{ directory: string }>,
    respondPermissionCalls: [] as Array<{ requestId: string; decision: string }>,
  };

  /** Set of conversationIds currently registered in an active run */
  readonly activeContexts = new Set<number>();

  queueCreate(script: MockOpenCodeTurnScript): this {
    this.createScripts.push(script);
    return this;
  }

  queueResume(script: MockOpenCodeTurnScript): this {
    this.resumeScripts.push(script);
    return this;
  }

  setModels(models: EngineModelInfo[]): this {
    this.models = models;
    return this;
  }

  setSkills(skills: Array<{ name: string; description: string }>): this {
    this.skills = skills;
    return this;
  }

  async getOrCreateSession(conversationId: number, workingDirectory: string): Promise<string> {
    const existing = this.sessionMap.get(conversationId);
    if (existing) {
      this.trace.resumeCalls.push({ conversationId, sessionId: existing });
      return existing;
    }
    const sessionId = `mock-session-${this.sessionCounter++}`;
    this.sessionMap.set(conversationId, sessionId);
    this.trace.createCalls.push({ conversationId, directory: workingDirectory, model: undefined });
    return sessionId;
  }

  run(params: OpenCodeRunParams): AsyncIterable<EngineEvent> {
    const isResume = this.sessionMap.has(params.conversationId) &&
      this.trace.createCalls.some(c => c.conversationId === params.conversationId);
    // If createCalls already has this conversationId it's a subsequent call (resume)
    const isActualResume = this.trace.resumeCalls.some(r => r.conversationId === params.conversationId);

    const script = isActualResume ? this.resumeScripts.shift() : this.createScripts.shift();
    if (!script) {
      throw new Error(`No mock OpenCode ${isActualResume ? "resume" : "create"} script queued for conversationId ${params.conversationId}`);
    }
    if (script.sendError) {
      throw script.sendError;
    }

    return this.runScript(params, script);
  }

  private async *runScript(params: OpenCodeRunParams, script: MockOpenCodeTurnScript): AsyncGenerator<EngineEvent> {
    let aborted = false;
    let abortWaiters: Array<() => void> = [];

    this.activeContexts.add(params.conversationId);
    this.activeControllers.set(params.executionId, {
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

          case "waitForAbort":
            await new Promise<void>((resolve) => {
              if (aborted) {
                resolve();
                return;
              }
              abortWaiters.push(resolve);
            });
            return;

          case "callTool": {
            const callId = `call_${Date.now()}_${Math.random().toString(36).slice(2)}`;
            yield { type: "tool_start", name: step.toolName, arguments: JSON.stringify(step.args), callId };
            const result = await executeCommonTool(step.toolName, step.args as Record<string, unknown>, params.commonToolContext);
            yield { type: "tool_result", name: step.toolName, result: result.text, callId, isError: false };
            break;
          }
        }
      }
    } finally {
      this.activeContexts.delete(params.conversationId);
      this.activeControllers.delete(params.executionId);
    }
  }

  async cancel(executionId: number): Promise<void> {
    this.activeControllers.get(executionId)?.abort();
  }

  async respondPermission(requestId: string, decision: "approve_once" | "approve_all" | "deny"): Promise<void> {
    this.trace.respondPermissionCalls.push({ requestId, decision });
  }

  async listModels(_workingDirectory: string): Promise<EngineModelInfo[]> {
    this.trace.listModelsCalls += 1;
    return this.models;
  }

  async listCommands(workingDirectory: string): Promise<CommandInfo[]> {
    this.trace.listCommandsCalls.push({ directory: workingDirectory });
    return this.skills;
  }

  async compact(_sessionId: string, _workingDirectory: string): Promise<void> {
    // no-op in mock
  }

  async shutdown(): Promise<void> {
    this.sessionMap.clear();
    this.activeContexts.clear();
    this.activeControllers.clear();
  }
}

// ── Event builder helpers ────────────────────────────────────────────────────

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

export function callTool(toolName: string, args: unknown = {}): MockTurnStep {
  return { kind: "callTool", toolName, args };
}
