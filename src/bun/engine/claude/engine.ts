import type { ExecutionEngine, ExecutionParams, EngineEvent, EngineModelInfo, EngineResumeInput } from "../types.ts";
import type { OnTaskUpdated, OnNewMessage } from "../../workflow/engine.ts";
import type { ClaudeRunConfig, ClaudeSdkAdapter } from "./adapter.ts";
import { claudeSessionIdForTask, createDefaultClaudeSdkAdapter } from "./adapter.ts";

export class ClaudeEngine implements ExecutionEngine {
  private readonly defaultModel: string | undefined;
  private readonly sdkAdapter: ClaudeSdkAdapter;
  private readonly pendingResumes = new Map<number, {
    resolve: (input: EngineResumeInput) => void;
    reject: (error: Error) => void;
  }>();

  constructor(
    defaultModel: string | undefined,
    _onTaskUpdated: OnTaskUpdated,
    _onNewMessage: OnNewMessage,
    sdkAdapter: ClaudeSdkAdapter = createDefaultClaudeSdkAdapter(),
  ) {
    this.defaultModel = defaultModel;
    this.sdkAdapter = sdkAdapter;
  }

  execute(params: ExecutionParams): AsyncIterable<EngineEvent> {
    const { executionId, taskId, boardId, workingDirectory, model, prompt, signal, systemInstructions } = params;
    const runConfig: ClaudeRunConfig = {
      executionId,
      taskId,
      prompt,
      workingDirectory,
      model: model || this.defaultModel,
      systemInstructions,
      signal,
      sessionId: claudeSessionIdForTask(taskId),
      commonToolContext: {
        taskId,
        boardId: boardId ?? 0,
        onTransition: () => { },
        onHumanTurn: () => { },
        onCancel: (id) => this.cancel(id),
      },
      waitForResume: (request) => this.waitForResume(executionId, request, signal),
      onRawMessage: (message) => {
        params.onRawModelMessage?.({
          engine: "claude",
          sessionId: claudeSessionIdForTask(taskId),
          direction: "inbound",
          eventType: String(message.type ?? "unknown"),
          eventSubtype: typeof message.subtype === "string" ? message.subtype : undefined,
          payload: message,
        });
      },
    };

    return this.sdkAdapter.run(runConfig);
  }

  async resume(executionId: number, input: EngineResumeInput): Promise<void> {
    const pending = this.pendingResumes.get(executionId);
    if (!pending) {
      throw new Error(`Execution ${executionId} is not waiting for resume input`);
    }
    this.pendingResumes.delete(executionId);
    pending.resolve(input);
  }

  cancel(executionId: number): void {
    const pending = this.pendingResumes.get(executionId);
    if (pending) {
      this.pendingResumes.delete(executionId);
      pending.reject(new Error(`Execution ${executionId} cancelled`));
    }
    void this.sdkAdapter.cancel(executionId).catch(() => { });
  }

  async listModels(): Promise<EngineModelInfo[]> {
    const models = await this.sdkAdapter.listModels(process.cwd());
    return models.map((model) => ({
      qualifiedId: `claude/${model.value}`,
      displayName: model.displayName,
      description: model.description,
      supportsThinking: model.supportsEffort || model.supportsAdaptiveThinking,
    }));
  }

  private waitForResume(
    executionId: number,
    _request: { type: "ask_user" | "shell_approval" },
    signal?: AbortSignal,
  ): Promise<EngineResumeInput> {
    return new Promise<EngineResumeInput>((resolve, reject) => {
      const existing = this.pendingResumes.get(executionId);
      if (existing) {
        reject(new Error(`Execution ${executionId} is already waiting for resume input`));
        return;
      }

      const cleanup = () => {
        signal?.removeEventListener("abort", onAbort);
        this.pendingResumes.delete(executionId);
      };

      const onAbort = () => {
        cleanup();
        reject(new Error(`Execution ${executionId} aborted while waiting for input`));
      };

      signal?.addEventListener("abort", onAbort, { once: true });
      this.pendingResumes.set(executionId, {
        resolve: (input) => {
          cleanup();
          resolve(input);
        },
        reject: (error) => {
          cleanup();
          reject(error);
        },
      });
    });
  }
}
