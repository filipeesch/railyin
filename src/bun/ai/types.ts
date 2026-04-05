// AIProvider interface — all AI calls go through this abstraction.
// Any OpenAI-compatible endpoint (OpenRouter, Ollama, LM Studio) uses
// OpenAICompatibleProvider. FakeAIProvider is used for UI development.

export interface AIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  // Present on assistant messages that issued tool calls
  tool_calls?: AIToolCall[];
  // Present on tool result messages
  tool_call_id?: string;
  name?: string;
  // Set on tool result messages when the tool returned an error string
  isError?: boolean;
}

// ─── Usage stats ──────────────────────────────────────────────────────────────

export interface UsageStats {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
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

// Returned by turn() — either the final text or a list of tool calls
export type AITurnResult =
  | { type: "text"; content: string; usage?: UsageStats }
  | { type: "tool_calls"; calls: AIToolCall[]; usage?: UsageStats };

// Yielded by stream() — unified streaming events covering tokens and tool calls
export type StreamEvent =
  | { type: "token"; content: string }
  | { type: "reasoning"; content: string }
  | { type: "tool_calls"; calls: AIToolCall[] }
  | { type: "usage"; usage: UsageStats }
  | { type: "done" }
  // Ephemeral status messages emitted by retryStream() during non-streaming fallback.
  // These are NOT stored in the DB — they describe transient API wait state only.
  | { type: "status"; content: string };

export interface AICallOptions {
  maxTokens?: number;
  tools?: AIToolDefinition[];
  signal?: AbortSignal;
}

export interface AIProvider {
  /**
   * Unified streaming method — handles both text tokens and structured tool
   * calls in the same SSE stream. Tools are always passed so the model is
   * never switched out of tool-aware mode between rounds.
   */
  stream(messages: AIMessage[], options?: AICallOptions): AsyncIterable<StreamEvent>;
  /**
   * Non-streaming turn with tool support — retained for sub-agent use only.
   * Returns either the assistant's final text or a list of tool calls.
   */
  turn(messages: AIMessage[], options?: AICallOptions): Promise<AITurnResult>;
}
