import type {
  CommandInfo,
  EngineEvent,
  EngineModelInfo,
  EngineResumeInput,
  ExecutionEngine,
  ExecutionParams,
} from "../engine/types.ts";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class MockExecutionEngine implements ExecutionEngine {
  private readonly cancelled = new Set<number>();

  async *execute(params: ExecutionParams): AsyncIterable<EngineEvent> {
    const response = `Mock response: ${params.prompt}`;
    const midpoint = Math.max(1, Math.ceil(response.length / 2));
    const chunks = [response.slice(0, midpoint), response.slice(midpoint)].filter(Boolean);

    for (const chunk of chunks) {
      if (params.signal.aborted || this.cancelled.has(params.executionId)) return;
      await delay(10);
      if (params.signal.aborted || this.cancelled.has(params.executionId)) return;
      yield { type: "token", content: chunk };
    }

    if (params.signal.aborted || this.cancelled.has(params.executionId)) return;
    yield {
      type: "usage",
      inputTokens: params.prompt.length,
      outputTokens: response.length,
    };
    yield { type: "done" };
  }

  async resume(_executionId: number, _input: EngineResumeInput): Promise<void> { }

  cancel(executionId: number): void {
    this.cancelled.add(executionId);
  }

  async listModels(): Promise<EngineModelInfo[]> {
    return [{
      qualifiedId: "copilot/mock-model",
      displayName: "Mock Model",
      contextWindow: 128_000,
      enabled: true,
    }];
  }

  async listCommands(_taskId: number): Promise<CommandInfo[]> {
    return [];
  }

  async compact(): Promise<void> { }
}
