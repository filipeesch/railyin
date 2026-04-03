import type { AIProvider, AIMessage } from "./types.ts";

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

  async *chat(messages: AIMessage[]): AsyncIterable<string> {
    // Pick a deterministic response based on message count
    const response = FAKE_RESPONSES[messages.length % FAKE_RESPONSES.length];
    const words = response.split(" ");

    for (const word of words) {
      yield word + " ";
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }
  }
}
