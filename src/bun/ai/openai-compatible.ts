import type { AIProvider, AIMessage, AICallOptions } from "./types.ts";

export class OpenAICompatibleProvider implements AIProvider {
  private baseUrl: string;
  private apiKey: string;
  private model: string;

  constructor(baseUrl: string, apiKey: string, model: string) {
    // Normalise: strip trailing slash
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiKey = apiKey;
    this.model = model;
  }

  async *chat(messages: AIMessage[], options: AICallOptions = {}): AsyncIterable<string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    // Task 4.3 — omit Authorization header when api_key is empty (Ollama / LM Studio)
    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    const body = JSON.stringify({
      model: this.model,
      messages,
      stream: true,
      ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
    });

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers,
      body,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`AI provider returned ${response.status}: ${text}`);
    }

    if (!response.body) {
      throw new Error("AI provider returned no response body");
    }

    const decoder = new TextDecoder();
    const reader = response.body.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === "data: [DONE]") continue;
          if (!trimmed.startsWith("data: ")) continue;

          const json = trimmed.slice(6);
          try {
            const parsed = JSON.parse(json) as {
              choices?: Array<{ delta?: { content?: string } }>;
            };
            const token = parsed.choices?.[0]?.delta?.content;
            if (token) yield token;
          } catch {
            // Ignore malformed SSE lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
