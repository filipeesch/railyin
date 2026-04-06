import type { AIProvider, AIMessage, AITurnResult, AICallOptions, AIToolCall, StreamEvent } from "./types.ts";

// ─── FakeStep — scripted stream events ───────────────────────────────────────

export type FakeStep =
  | { type: "tool_calls"; calls: AIToolCall[] }
  | { type: "text"; tokens: string[] };

// ─── Test scripting support ───────────────────────────────────────────────────
// Tests can push scripted steps and inspect captured options.

const _scriptedSteps: FakeStep[] = [];
const _capturedStreamOptions: AICallOptions[] = [];
const _capturedStreamMessages: AIMessage[][] = [];

// Keep turn-related state for sub-agent use (runSubExecution still calls turn())
const _scriptedTurnResponses: AITurnResult[] = [];
const _capturedTurnOptions: AICallOptions[] = [];

/** Queue a scripted stream step to be yielded by the next `stream()` call (FIFO). */
export function queueStreamStep(step: FakeStep): void {
  _scriptedSteps.push(step);
}

/** Return a copy of all `AICallOptions` captured from `stream()` calls. */
export function getCapturedStreamOptions(): AICallOptions[] {
  return [..._capturedStreamOptions];
}

/** Return a copy of all message arrays passed to `stream()` calls (one entry per call). */
export function getCapturedStreamMessages(): AIMessage[][] {
  return [..._capturedStreamMessages];
}

/** Queue a response to be returned by the next `turn()` call (FIFO). */
export function queueTurnResponse(result: AITurnResult): void {
  _scriptedTurnResponses.push(result);
}

/** Return a copy of all `AICallOptions` captured from `turn()` calls. */
export function getCapturedTurnOptions(): AICallOptions[] {
  return [..._capturedTurnOptions];
}

/** Reset all scripted responses and captured calls. Call in `afterEach`. */
export function resetFakeAI(): void {
  _scriptedSteps.length = 0;
  _capturedStreamOptions.length = 0;
  _capturedStreamMessages.length = 0;
  _scriptedTurnResponses.length = 0;
  _capturedTurnOptions.length = 0;
}

const FAKE_TOKENS = [
  "I've analysed the task and here is my plan:\n\n1. First, I'll review the existing code structure.\n2. Then I'll identify the key integration points.\n3. Finally, I'll implement the changes incrementally.\n\nLet me start by reading the relevant files.",
  "Looking at the codebase, I can see the main entry point is well-structured. The implementation approach will be straightforward.\n\nI'll proceed with the changes now.",
  "The changes are complete. Here's a summary of what was done:\n\n- Updated the core logic in the main module\n- Added appropriate error handling\n- Ensured backward compatibility\n\nThe implementation is ready for review.",
];

export class FakeAIProvider implements AIProvider {
  cooldownUntil = 0;
  private delayMs: number;

  constructor(delayMs = 30) {
    this.delayMs = delayMs;
  }

  async *stream(messages: AIMessage[], options: AICallOptions = {}): AsyncIterable<StreamEvent> {
    _capturedStreamOptions.push(options);
    _capturedStreamMessages.push([...messages]);

    if (_scriptedSteps.length > 0) {
      const step = _scriptedSteps.shift()!;
      if (step.type === "tool_calls") {
        yield { type: "tool_calls", calls: step.calls };
      } else {
        for (const token of step.tokens) {
          yield { type: "token", content: token };
          await new Promise((resolve) => setTimeout(resolve, this.delayMs));
        }
      }
      yield { type: "done" };
      return;
    }

    // Default: stream a deterministic text response word-by-word
    const response = FAKE_TOKENS[messages.length % FAKE_TOKENS.length];
    const words = response.split(" ");
    for (const word of words) {
      yield { type: "token", content: word + " " };
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }
    yield { type: "done" };
  }

  async turn(messages: AIMessage[], options: AICallOptions = {}): Promise<AITurnResult> {
    _capturedTurnOptions.push(options);
    if (_scriptedTurnResponses.length > 0) {
      return _scriptedTurnResponses.shift()!;
    }
    const response = FAKE_TOKENS[messages.length % FAKE_TOKENS.length];
    return { type: "text", content: response };
  }
}
