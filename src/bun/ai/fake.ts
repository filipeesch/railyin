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
const _capturedTurnMessages: AIMessage[][] = [];

// Hanging turn: blocks until the caller's AbortSignal fires (or 5 s timeout).
let _hangingTurn = false;
let _hangingTurnStarted: (() => void) | null = null;

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

/** Return a copy of all message arrays passed to `turn()` calls (one entry per call). */
export function getCapturedTurnMessages(): AIMessage[][] {
  return [..._capturedTurnMessages];
}

/**
 * Queue a "hanging" turn response: the next `turn()` call will block until
 * the caller's AbortSignal fires (simulating a slow API cancelled by the user).
 * Returns a promise that resolves the moment the hanging turn starts, so tests
 * can synchronise: `await queueHangingTurn()` → then cancel.
 */
export function queueHangingTurn(): Promise<void> {
  _hangingTurn = true;
  return new Promise<void>((resolve) => {
    _hangingTurnStarted = resolve;
  });
}

/** Reset all scripted responses and captured calls. Call in `afterEach`. */
export function resetFakeAI(): void {
  _scriptedSteps.length = 0;
  _capturedStreamOptions.length = 0;
  _capturedStreamMessages.length = 0;
  _scriptedTurnResponses.length = 0;
  _capturedTurnOptions.length = 0;
  _capturedTurnMessages.length = 0;
  _hangingTurn = false;
  _hangingTurnStarted = null;
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
    // Mirror real fetch behaviour: throw immediately if signal is already aborted.
    if (options.signal?.aborted) {
      throw new DOMException("The user aborted a request.", "AbortError");
    }
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
    // Mirror real fetch behaviour: throw immediately if signal is already aborted.
    if (options.signal?.aborted) {
      throw new DOMException("The user aborted a request.", "AbortError");
    }
    _capturedTurnOptions.push(options);
    _capturedTurnMessages.push([...messages]);
    // Hanging turn: block until the AbortSignal fires or 5 s guard fires.
    if (_hangingTurn) {
      _hangingTurn = false;
      _hangingTurnStarted?.();
      _hangingTurnStarted = null;
      await new Promise<void>((_, reject) => {
        if (options.signal?.aborted) {
          reject(new DOMException("The user aborted a request.", "AbortError"));
          return;
        }
        const onAbort = () => reject(new DOMException("The user aborted a request.", "AbortError"));
        options.signal?.addEventListener("abort", onAbort, { once: true });
        setTimeout(() => {
          options.signal?.removeEventListener("abort", onAbort);
          reject(new Error("queueHangingTurn: timed out after 5 s without cancellation"));
        }, 5_000);
      });
    }
    if (_scriptedTurnResponses.length > 0) {
      return _scriptedTurnResponses.shift()!;
    }
    const response = FAKE_TOKENS[messages.length % FAKE_TOKENS.length];
    return { type: "text", content: response };
  }
}
