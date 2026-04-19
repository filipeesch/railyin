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

// Token usage stats returned by providers. Reflects actual API-reported counts.
export interface UsageStats {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
}

// Returned by turn() — either the final text or a list of tool calls
export type AITurnResult =
  | { type: "text"; content: string; stopReason?: string; usage?: UsageStats }
  | { type: "tool_calls"; calls: AIToolCall[]; usage?: UsageStats };

// Yielded by stream() — unified streaming events covering tokens and tool calls
export type StreamEvent =
  | { type: "token"; content: string }
  | { type: "reasoning"; content: string }
  | { type: "tool_calls"; calls: AIToolCall[] }
  | { type: "done" }
  | { type: "stop_reason"; reason: string }
  // Ephemeral status messages emitted by retryStream() during non-streaming fallback.
  // These are NOT stored in the DB — they describe transient API wait state only.
  | { type: "status"; content: string }
  // Usage stats emitted per stream round. For Anthropic: emitted twice — once at
  // message_start (outputTokens=0, costEst=0) and once at message_stop (final values).
  // For OpenAI-compatible: emitted once at stream end. costEst is 0 for non-Anthropic.
  | { type: "usage"; usage: UsageStats; costEst: number };

export interface AICallOptions {
  maxTokens?: number;
  tools?: AIToolDefinition[];
  signal?: AbortSignal;
  /** Anthropic effort level (GA, no beta header required). Controls token spend
   * and thinking depth. Defaults to "high" on Sonnet 4.6 / Opus 4.6.
   * Use "low" for sub-agents and simple tasks; "medium" for balanced agentic work. */
  effort?: "low" | "medium" | "high" | "max";
  /** Optional label to prefix usage log lines (e.g. "Agent 2/3" for sub-agents). */
  agentLabel?: string;
  /** Execution ID propagated to the provider for per-execution state tracking
   * (e.g. cache break detection across rounds). Not sent to the API. */
  executionId?: number;
}

export interface AIProvider {
  /**
   * Shared timestamp (epoch ms) until which the provider is rate-limited.
   * Set by the retry wrapper when a 429 response includes a `retry-after` header.
   * All concurrent callers sharing this provider instance will wait until this time
   * before making a new API request.
   */
  cooldownUntil: number;
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
