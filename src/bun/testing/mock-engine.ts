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

/**
 * Scripted scenarios driven by prompt markers (02-01 Task 3). When
 * `params.prompt` contains a marker, the engine yields a deterministic scripted
 * sequence instead of the plain mock response — used by the AG-UI e2e suite to
 * prove tool/reasoning/error/synthesis paths on the real wire.
 *
 * Plain-text prompts keep the existing behavior (chunked mock response).
 */
const SCRIPT_MARKERS = [
  "__SCRIPT_TOOLS__",
  "__SCRIPT_DANGLING_TOOL__",
  "__SCRIPT_SLOW__",
  "__SCRIPT_ERROR__",
  "__SCRIPT_DECISION__",
] as const;

function scriptedEvents(prompt: string): { events: EngineEvent[]; pauseMs?: number } | null {
  if (prompt.includes("__SCRIPT_TOOLS__")) {
    return { events: [
      { type: "reasoning", content: "reasoning about the request" },
      { type: "tool_start", name: "read_file", callId: "call_1", arguments: JSON.stringify({ path: "a.txt" }) },
      { type: "tool_result", name: "read_file", callId: "call_1", result: "file contents" },
      { type: "token", content: "Here is the file content." },
      { type: "done" },
    ] };
  }
  if (prompt.includes("__SCRIPT_DANGLING_TOOL__")) {
    // D-09 wire proof: a tool call with NO result — the bridge must synthesize
    // TOOL_CALL_RESULT before RUN_FINISHED.
    return { events: [
      { type: "tool_start", name: "read_file", callId: "call_1", arguments: JSON.stringify({ path: "a.txt" }) },
      { type: "token", content: "Done." },
      { type: "done" },
    ] };
  }
  if (prompt.includes("__SCRIPT_SLOW__")) {
    // Long-pause run (concurrent-run test in 02-02): a token, a 2s silence, then done.
    return { events: [
      { type: "token", content: "slow" },
      { type: "status", message: "waiting" },
      { type: "done" },
    ], pauseMs: 2000 };
  }
  if (prompt.includes("__SCRIPT_ERROR__")) {
    return { events: [
      { type: "token", content: "about to fail" },
      { type: "error", message: "scripted failure", fatal: true },
    ] };
  }
  if (prompt.includes("__SCRIPT_DECISION__")) {
    // Phase A (original run): text then the decision request — the run must end
    // with the interrupt outcome (RUN_FINISHED outcome.interrupt), NOT an
    // error, and no events after it. Deliberately NO done event: the run ends
    // at the decision (stream-processor maps decision_request →
    // onRunEnd("decision")).
    return { events: [
      { type: "token", content: "I need your decision." },
      { type: "decision_request", payload: JSON.stringify({
          context: "mock context",
          questions: [{ question: "Choose __DECISION_OPTION__", type: "exclusive",
                        options: [{ title: "A", description: "" }, { title: "B", description: "" }] }],
        }) },
    ] };
  }
  if (prompt.includes("Choose __DECISION_OPTION__")) {
    // Phase B (resume run): the translated submission text contains the
    // question (buildDecisionSubmission formats "**Q [MEDIUM]:** Choose
    // __DECISION_OPTION__"). Phase B fires ONLY when the formatted decision
    // text reached params.prompt via the engineContent path — the proof that
    // the engine received the translated decision (research Pattern 4).
    return { events: [
      { type: "token", content: "Decision received, continuing." },
      { type: "done" },
    ] };
  }
  return null;
}

export class MockExecutionEngine implements ExecutionEngine {
  readonly type = "copilot";
  private readonly cancelled = new Set<number>();

  async *execute(params: ExecutionParams): AsyncIterable<EngineEvent> {
    const scripted = scriptedEvents(params.prompt);
    if (scripted) {
      for (let i = 0; i < scripted.events.length; i++) {
        if (params.signal.aborted || this.cancelled.has(params.executionId)) return;
        await delay(10);
        if (params.signal.aborted || this.cancelled.has(params.executionId)) return;
        yield scripted.events[i];
        // Scripted silence AFTER the event (e.g. __SCRIPT_SLOW__'s 2s pause).
        if (scripted.pauseMs && i === 0) {
          await delay(scripted.pauseMs);
          if (params.signal.aborted || this.cancelled.has(params.executionId)) return;
        }
      }
      return;
    }

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
