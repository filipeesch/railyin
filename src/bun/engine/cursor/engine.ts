/**
 * Cursor Engine - implements ExecutionEngine using the Cursor SDK.
 *
 * Uses @cursor/sdk for agent execution. The Cursor SDK provides
 * agent-based execution via gRPC/Connect protocol.
 *
 * Auth: handled via environment variables or Cursor CLI setup.
 */
import type { ExecutionEngine, ExecutionParams, EngineEvent, EngineModelInfo, CommandInfo, OnTaskUpdated, OnNewMessage } from "../types.ts";
import type { CursorSdkAdapter, CursorSdkModelInfo } from "./adapter";

export class CursorEngine implements ExecutionEngine {
  private readonly adapter: CursorSdkAdapter;
  private readonly _onTaskUpdated: OnTaskUpdated;

  constructor(
    onTaskUpdated: OnTaskUpdated,
    _onNewMessage: OnNewMessage,
    adapter: CursorSdkAdapter = createDefaultCursorSdkAdapter(),
  ) {
    this._onTaskUpdated = onTaskUpdated;
    this.adapter = adapter;
  }

  execute(params: ExecutionParams): AsyncIterable<EngineEvent> {
    return this._run(params);
  }

  async resume(executionId: number, input: any): Promise<void> {
    // Cursor SDK doesn't resume sessions like Copilot - each send() is a new turn
    // We just pass through the user input
  }

  cancel(executionId: number): void {
    // Cancel via adapter - SDK handles cancellation
  }

  async listModels(): Promise<EngineModelInfo[]> {
    const models = await this.adapter.listModels(process.cwd());
    return models.map((m) => ({
      qualifiedId: `cursor/${m.value}`,
      displayName: m.displayName,
      description: m.description,
      supportsThinking: m.supportsThinking,
    }));
  }

  async listCommands(taskId: number): Promise<CommandInfo[]> {
    return await this.adapter.listCommands(process.cwd());
  }

  async shutdown(options?: any): Promise<void> {
    await this.adapter.shutdownAll?.();
  }

  private async *_run(params: ExecutionParams): AsyncGenerator<EngineEvent> {
    const { executionId, workingDirectory, model, prompt, signal, systemInstructions, taskContext } = params;

    const sessionId = `cursor-${params.conversationId}`;

    // Build config for adapter
    const config = {
      executionId,
      taskId: params.taskId || 0,
      prompt,
      workingDirectory,
      model,
      systemInstructions,
      taskContext,
      signal,
      sessionId,
    };

    try {
      for await (const event of this.adapter.run(config)) {
        yield event;
      }
    } catch (err) {
      yield { type: "error", message: err instanceof Error ? err.message : String(err), fatal: true };
    }
  }
}

/**
 * Create a default Cursor SDK adapter for the engine.
 */
export function createDefaultCursorSdkAdapter(): CursorSdkAdapter {
  return new (require("./adapter").DefaultCursorSdkAdapter)();
}
