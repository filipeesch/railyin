// AIProvider interface — all AI calls go through this abstraction.
// Any OpenAI-compatible endpoint (OpenRouter, Ollama, LM Studio) uses
// OpenAICompatibleProvider. FakeAIProvider is used for UI development.

export interface AIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  // Present on assistant messages that issued tool calls
  tool_calls?: AIToolCall[];
  // Present on tool result messages
  tool_call_id?: string;
  name?: string;
}

// ─── Tool calling types ───────────────────────────────────────────────────────

export interface AIToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, { type: string; description: string }>;
    required?: string[];
  };
}

export interface AIToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

// Returned by chatWithTools — either the final text or a list of tool calls
export type AITurnResult =
  | { type: "text"; content: string }
  | { type: "tool_calls"; calls: AIToolCall[] };

export interface AICallOptions {
  maxTokens?: number;
  tools?: AIToolDefinition[];
  signal?: AbortSignal;
}

export interface AIProvider {
  /** Streaming chat — used for the final text response to the user. */
  chat(messages: AIMessage[], options?: AICallOptions): AsyncIterable<string>;
  /**
   * Non-streaming turn with tool support.  Returns either the assistant's
   * final text or a list of tool calls that need executing.
   */
  turn(messages: AIMessage[], options?: AICallOptions): Promise<AITurnResult>;
}
