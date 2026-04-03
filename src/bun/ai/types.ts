// AIProvider interface — all AI calls go through this abstraction.
// Any OpenAI-compatible endpoint (OpenRouter, Ollama, LM Studio) uses
// OpenAICompatibleProvider. FakeAIProvider is used for UI development.

export interface AIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AICallOptions {
  maxTokens?: number;
}

export interface AIProvider {
  chat(messages: AIMessage[], options?: AICallOptions): AsyncIterable<string>;
}
