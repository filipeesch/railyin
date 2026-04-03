import type { AIProvider, AIMessage, AICallOptions, AITurnResult, AIToolCall } from "./types.ts";

export class OpenAICompatibleProvider implements AIProvider {
  private baseUrl: string;
  private apiKey: string;
  private model: string;

  constructor(baseUrl: string, apiKey: string, model: string) {
    // Normalise: strip trailing slash, also strip a trailing /v1 so we can add it ourselves
    this.baseUrl = baseUrl.replace(/\/$/, "").replace(/\/v1$/, "");
    this.apiKey = apiKey;
    this.model = model;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) h["Authorization"] = `Bearer ${this.apiKey}`;
    return h;
  }

  // ─── Non-streaming turn (used for tool-call rounds) ─────────────────────────

  async turn(messages: AIMessage[], options: AICallOptions = {}): Promise<AITurnResult> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: messages.map(toWireMessage),
      stream: false,
      ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
    };

    if (options.tools?.length) {
      body.tools = options.tools.map((t) => ({ type: "function", function: t }));
      body.tool_choice = "auto";
    }

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`AI provider returned ${response.status}: ${text}`);
    }

    const json = await response.json() as {
      choices?: Array<{
        message?: {
          content?: string | null;
          tool_calls?: AIToolCall[];
        };
      }>;
    };

    const message = json.choices?.[0]?.message;
    if (!message) throw new Error("AI provider returned empty response");

    if (message.tool_calls?.length) {
      return { type: "tool_calls", calls: message.tool_calls };
    }

    return { type: "text", content: message.content ?? "" };
  }

  // ─── Streaming chat (used for the final text response) ──────────────────────

  async *chat(messages: AIMessage[], options: AICallOptions = {}): AsyncIterable<string> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: messages.map(toWireMessage),
      stream: true,
      // Suppress <think> preamble on models that support it (e.g. Qwen3)
      enable_thinking: false,
      ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
    };

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
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
    // State for stripping <think>...</think> blocks that some models emit
    let inThinkBlock = false;
    let thinkBuf = "";

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
            if (!token) continue;

            // Strip <think>...</think> blocks
            thinkBuf += token;
            let out = "";
            while (thinkBuf.length > 0) {
              if (inThinkBlock) {
                const end = thinkBuf.indexOf("</think>");
                if (end === -1) {
                  // Still inside think block — keep buffering
                  thinkBuf = thinkBuf.slice(-8); // keep only tail in case tag spans chunks
                  break;
                }
                inThinkBlock = false;
                thinkBuf = thinkBuf.slice(end + 8);
              } else {
                const start = thinkBuf.indexOf("<think>");
                if (start === -1) {
                  out += thinkBuf;
                  thinkBuf = "";
                  break;
                }
                out += thinkBuf.slice(0, start);
                inThinkBlock = true;
                thinkBuf = thinkBuf.slice(start + 7);
              }
            }
            if (out) yield out;
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

// ─── Map internal AIMessage to what the wire expects ─────────────────────────

function toWireMessage(m: AIMessage): Record<string, unknown> {
  const base: Record<string, unknown> = { role: m.role, content: m.content ?? null };
  if (m.tool_calls) base.tool_calls = m.tool_calls;
  if (m.tool_call_id) base.tool_call_id = m.tool_call_id;
  if (m.name) base.name = m.name;
  return base;
}
