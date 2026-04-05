import type { AIProvider, AIMessage, AICallOptions, AITurnResult, AIToolCall, StreamEvent, UsageStats } from "./types.ts";
import { ProviderError } from "./retry.ts";

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
      messages: normalizeMessages(messages).map(toWireMessage),
      stream: false,
      enable_thinking: false,
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
      signal: options.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      const retryAfter = response.headers.get("retry-after");
      throw new ProviderError(
        response.status,
        `AI provider returned ${response.status}: ${text}`,
        retryAfter ? parseInt(retryAfter, 10) : undefined,
      );
    }

    const json = await response.json() as {
      choices?: Array<{
        message?: {
          content?: string | null;
          tool_calls?: AIToolCall[];
        };
      }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    const message = json.choices?.[0]?.message;
    if (!message) throw new Error("AI provider returned empty response");

    const usageRaw = json.usage;
    const usage: UsageStats | undefined = usageRaw
      ? { inputTokens: usageRaw.prompt_tokens ?? 0, outputTokens: usageRaw.completion_tokens ?? 0 }
      : undefined;

    if (message.tool_calls?.length) {
      return { type: "tool_calls", calls: message.tool_calls, usage };
    }

    return { type: "text", content: message.content ?? "", usage };
  }

  // ─── Unified streaming (text tokens + tool calls in same SSE stream) ─────────

  async *stream(messages: AIMessage[], options: AICallOptions = {}): AsyncIterable<StreamEvent> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: normalizeMessages(messages).map(toWireMessage),
      stream: true,
      // Suppress <think> preamble on models that support it (e.g. Qwen3)
      enable_thinking: false,
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
      signal: options.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      const retryAfter = response.headers.get("retry-after");
      throw new ProviderError(
        response.status,
        `AI provider returned ${response.status}: ${text}`,
        retryAfter ? parseInt(retryAfter, 10) : undefined,
      );
    }

    if (!response.body) {
      throw new Error("AI provider returned no response body");
    }

    const decoder = new TextDecoder();
    const reader = response.body.getReader();

    // State for stripping <think>...</think> blocks that some models emit
    let inThinkBlock = false;
    let thinkBuf = "";

    // Accumulator for streaming tool_calls deltas (index-keyed)
    const toolCallAccum: Array<{
      id: string;
      type: "function";
      function: { name: string; arguments: string };
    }> = [];
    let hasToolCalls = false;
    // Usage stats from the final SSE chunk (some servers send usage on last chunk)
    let streamUsage: UsageStats | undefined;

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

          const jsonStr = trimmed.slice(6);
          let parsed: {
            choices?: Array<{
              delta?: {
                content?: string;
                reasoning_content?: string;
                tool_calls?: Array<{
                  index: number;
                  id?: string;
                  type?: "function";
                  function?: { name?: string; arguments?: string };
                }>;
              };
              finish_reason?: string | null;
            }>;
            usage?: { prompt_tokens?: number; completion_tokens?: number };
          };

          try {
            parsed = JSON.parse(jsonStr);
          } catch {
            continue; // Ignore malformed SSE lines
          }

          const choice = parsed.choices?.[0];

          // Capture usage data when present (typically on the final chunk)
          if (parsed.usage) {
            streamUsage = {
              inputTokens: parsed.usage.prompt_tokens ?? 0,
              outputTokens: parsed.usage.completion_tokens ?? 0,
            };
          }

          if (!choice) continue;

          const delta = choice.delta;

          // ── Reasoning tokens (e.g. Qwen3 thinking mode) ───────────────────
          if (delta?.reasoning_content) {
            yield { type: "reasoning", content: delta.reasoning_content };
          }

          // ── Text tokens ───────────────────────────────────────────────────
          if (delta?.content) {
            // Strip <think>...</think> blocks
            thinkBuf += delta.content;
            let out = "";
            while (thinkBuf.length > 0) {
              if (inThinkBlock) {
                const end = thinkBuf.indexOf("</think>");
                if (end === -1) {
                  thinkBuf = thinkBuf.slice(-8);
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
            if (out) yield { type: "token", content: out };
          }

          // ── Tool call deltas ──────────────────────────────────────────────
          if (delta?.tool_calls) {
            hasToolCalls = true;
            for (const tc of delta.tool_calls) {
              const idx = tc.index;
              if (!toolCallAccum[idx]) {
                toolCallAccum[idx] = {
                  id: tc.id ?? "",
                  type: "function",
                  function: { name: tc.function?.name ?? "", arguments: tc.function?.arguments ?? "" },
                };
              } else {
                if (tc.id) toolCallAccum[idx].id = tc.id;
                if (tc.function?.name) toolCallAccum[idx].function.name += tc.function.name;
                if (tc.function?.arguments) toolCallAccum[idx].function.arguments += tc.function.arguments;
              }
            }
          }

          // ── Finish reason ─────────────────────────────────────────────────
          if (choice.finish_reason === "tool_calls" || (choice.finish_reason === "stop" && hasToolCalls)) {
            // Snapshot before clearing — toolCallAccum is mutated in-place and
            // yielding a reference then clearing it would empty the caller's copy.
            const calls = toolCallAccum.slice();
            toolCallAccum.length = 0;
            hasToolCalls = false;
            yield { type: "tool_calls", calls: calls as AIToolCall[] };
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    if (streamUsage) {
      yield { type: "usage", usage: streamUsage };
    }
    yield { type: "done" };
  }
}

// ─── Map internal AIMessage to what the wire expects ─────────────────────────

function toWireMessage(m: AIMessage): Record<string, unknown> {
  // Use null (not empty string) for missing content — some models behave differently
  // when they see content:"" vs content:null in an assistant message with tool_calls.
  const base: Record<string, unknown> = { role: m.role, content: m.content || null };
  if (m.tool_calls) base.tool_calls = m.tool_calls;
  if (m.tool_call_id) base.tool_call_id = m.tool_call_id;
  if (m.name) base.name = m.name;
  return base;
}

// ─── Normalize consecutive same-role messages ─────────────────────────────────

/**
 * Collapse consecutive messages with the same role by concatenating their content.
 * Some local-model servers (e.g. llama.cpp) reject conversations with back-to-back
 * user messages. Tool result messages are always kept distinct (each has its own
 * tool_call_id), and messages with tool_calls are never merged mid-turn.
 */
function normalizeMessages(messages: AIMessage[]): AIMessage[] {
  const out: AIMessage[] = [];
  for (const msg of messages) {
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.role === msg.role &&
      msg.role !== "tool" &&
      !msg.tool_calls &&
      !prev.tool_calls
    ) {
      prev.content = ((prev.content ?? "") + "\n\n" + (msg.content ?? "")).trim() || null;
    } else {
      out.push({ ...msg });
    }
  }
  return out;
}
