import type { AIProvider, AIMessage, AITurnResult, AICallOptions } from "./types.ts";

// ─── Test scripting support ───────────────────────────────────────────────────
// Tests can push scripted responses and inspect captured options.

const _scriptedTurnResponses: AITurnResult[] = [];
const _capturedTurnOptions: AICallOptions[] = [];

/** Queue a response to be returned by the next `turn()` call (FIFO). */
export function queueTurnResponse(result: AITurnResult): void {
  _scriptedTurnResponses.push(result);
}

/** Return a copy of all `AICallOptions` captured from `turn()` calls. */
export function getCapturedTurnOptions(): AICallOptions[] {
  return [..._capturedTurnOptions];
}

/** Reset scripted responses and captured calls. Call in `afterEach`. */
export function resetFakeAI(): void {
  _scriptedTurnResponses.length = 0;
  _capturedTurnOptions.length = 0;
}

const FAKE_RESPONSES = [
  "I've analysed the task and here is my plan:\n\n1. First, I'll review the existing code structure.\n2. Then I'll identify the key integration points.\n3. Finally, I'll implement the changes incrementally.\n\nLet me start by reading the relevant files.",
  "Looking at the codebase, I can see the main entry point is well-structured. The implementation approach will be straightforward.\n\nI'll proceed with the changes now.",
  "The changes are complete. Here's a summary of what was done:\n\n- Updated the core logic in the main module\n- Added appropriate error handling\n- Ensured backward compatibility\n\nThe implementation is ready for review.",
];

export class FakeAIProvider implements AIProvider {
  private delayMs: number;

  constructor(delayMs = 30) {
    this.delayMs = delayMs;
  }

  async turn(messages: AIMessage[], options: AICallOptions = {}): Promise<AITurnResult> {
    _capturedTurnOptions.push(options);
    // Return a scripted response if one is queued
    if (_scriptedTurnResponses.length > 0) {
      return _scriptedTurnResponses.shift()!;
    }
    // Default: return text directly (no tool calls)
    const response = FAKE_RESPONSES[messages.length % FAKE_RESPONSES.length];
    return { type: "text", content: response };
  }

  async *chat(messages: AIMessage[], _options: AICallOptions = {}): AsyncIterable<string> {
    // Pick a deterministic response based on message count
    const response = FAKE_RESPONSES[messages.length % FAKE_RESPONSES.length];
    const words = response.split(" ");

    for (const word of words) {
      yield word + " ";
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }
  }
}
