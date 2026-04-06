import type {
  AIProvider,
  AIMessage,
  AICallOptions,
  AITurnResult,
  AIToolCall,
  AIToolDefinition,
  StreamEvent,
} from "./types.ts";
import { ProviderError } from "./retry.ts";

// ─── Anthropic wire types ─────────────────────────────────────────────────────

interface AnthropicTextBlock {
  type: "text";
  text: string;
}

interface AnthropicToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

type AnthropicContentBlock = AnthropicTextBlock | AnthropicToolUseBlock;

interface AnthropicUserMessage {
  role: "user";
  content: string | Array<{ type: "text"; text: string } | { type: "tool_result"; tool_use_id: string; content: string }>;
}

interface AnthropicAssistantMessage {
  role: "assistant";
  content: string | AnthropicContentBlock[];
}

type AnthropicMessage = AnthropicUserMessage | AnthropicAssistantMessage;

interface AnthropicTool {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, { type: string; description: string }>;
    required?: string[];
  };
}

// ─── Message adaptation ───────────────────────────────────────────────────────

/**
 * Adapt internal AIMessage[] to Anthropic's wire format:
 * - system messages extracted into top-level `system` field
 * - `role: "tool"` → `role: "user"` with tool_result content block
 * - `role: "assistant"` with tool_calls → `role: "assistant"` with tool_use content blocks
 */
export function adaptMessages(messages: AIMessage[]): {
  system: string | undefined;
  messages: AnthropicMessage[];
} {
  const systemParts: string[] = [];
  const adapted: AnthropicMessage[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      if (msg.content) systemParts.push(msg.content as string);
      continue;
    }

    if (msg.role === "tool") {
      // Merge consecutive tool results into a single user message with multiple blocks
      // if the last adapted message is already a tool-result user message, append.
      const block = {
        type: "tool_result" as const,
        tool_use_id: msg.tool_call_id ?? "",
        content: msg.content ?? "",
      };
      const last = adapted[adapted.length - 1];
      if (
        last &&
        last.role === "user" &&
        Array.isArray(last.content) &&
        last.content.some((b) => b.type === "tool_result")
      ) {
        (last.content as Array<{ type: "tool_result"; tool_use_id: string; content: string }>).push(block);
      } else {
        adapted.push({ role: "user", content: [block] });
      }
      continue;
    }

    if (msg.role === "assistant" && msg.tool_calls?.length) {
      // Anthropic expects the assistant message to contain tool_use content blocks
      const contentBlocks: AnthropicToolUseBlock[] = msg.tool_calls.map((tc) => ({
        type: "tool_use",
        id: tc.id,
        name: tc.function.name,
        input: (() => {
          try {
            return JSON.parse(tc.function.arguments || "{}");
          } catch {
            return {};
          }
        })(),
      }));
      // If there was preamble text, include it as a leading text block
      const blocks: AnthropicContentBlock[] = [];
      if (msg.content) blocks.push({ type: "text", text: msg.content as string });
      blocks.push(...contentBlocks);
      adapted.push({ role: "assistant", content: blocks });
      continue;
    }

    if (msg.role === "user" || msg.role === "assistant") {
      adapted.push({ role: msg.role, content: (msg.content as string) ?? "" });
    }
  }

  return {
    system: systemParts.length > 0 ? systemParts.join("\n\n") : undefined,
    messages: adapted,
  };
}

/** Map AIToolDefinition[] to Anthropic's tool format (parameters → input_schema) */
export function adaptTools(tools: AIToolDefinition[]): AnthropicTool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: {
      type: "object",
      properties: t.parameters.properties,
      required: t.parameters.required,
    },
  }));
}

// ─── AnthropicProvider ────────────────────────────────────────────────────────

const ANTHROPIC_BASE_URL = "https://api.anthropic.com";
const ANTHROPIC_VERSION = "2023-06-01";
const ANTHROPIC_BETA_THINKING = "interleaved-thinking-2025-05-14";

export class AnthropicProvider implements AIProvider {
  cooldownUntil = 0;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(apiKey: string, model: string, baseUrl = ANTHROPIC_BASE_URL) {
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl;
  }

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "x-api-key": this.apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "anthropic-beta": ANTHROPIC_BETA_THINKING,
    };
  }

  // ─── Non-streaming turn ─────────────────────────────────────────────────────

  async turn(messages: AIMessage[], options: AICallOptions = {}): Promise<AITurnResult> {
    const { system, messages: adaptedMessages } = adaptMessages(messages);

    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: options.maxTokens ?? 8192,
      messages: adaptedMessages,
    };
    if (system) body.system = system;
    if (options.tools?.length) body.tools = adaptTools(options.tools);

    const response = await fetch(`${this.baseUrl}/v1/messages`, {
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
        `Anthropic API returned ${response.status}: ${text}`,
        retryAfter ? parseInt(retryAfter, 10) : undefined,
      );
    }

    const json = await response.json() as {
      content?: AnthropicContentBlock[];
    };

    const toolUseBlocks = (json.content ?? []).filter((b): b is AnthropicToolUseBlock => b.type === "tool_use");
    if (toolUseBlocks.length > 0) {
      const calls: AIToolCall[] = toolUseBlocks.map((b) => ({
        id: b.id,
        type: "function",
        function: { name: b.name, arguments: JSON.stringify(b.input) },
      }));
      return { type: "tool_calls", calls };
    }

    const textBlock = (json.content ?? []).find((b): b is AnthropicTextBlock => b.type === "text");
    return { type: "text", content: textBlock?.text ?? "" };
  }

  // ─── Streaming ──────────────────────────────────────────────────────────────

  async *stream(messages: AIMessage[], options: AICallOptions = {}): AsyncIterable<StreamEvent> {
    const { system, messages: adaptedMessages } = adaptMessages(messages);

    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: options.maxTokens ?? 8192,
      messages: adaptedMessages,
      stream: true,
    };
    if (system) body.system = system;
    if (options.tools?.length) body.tools = adaptTools(options.tools);

    const response = await fetch(`${this.baseUrl}/v1/messages`, {
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
        `Anthropic API returned ${response.status}: ${text}`,
        retryAfter ? parseInt(retryAfter, 10) : undefined,
      );
    }

    if (!response.body) throw new Error("Anthropic API returned no response body");

    const decoder = new TextDecoder();
    const reader = response.body.getReader();

    // Accumulate tool_use blocks by index
    const toolAccum = new Map<number, { id: string; name: string; inputJson: string }>();
    let hasToolUse = false;
    // Track current content block index → type
    const blockTypes = new Map<number, string>();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;

          const jsonStr = trimmed.slice(6);
          let parsed: Record<string, unknown>;
          try {
            parsed = JSON.parse(jsonStr) as Record<string, unknown>;
          } catch {
            continue;
          }

          const eventType = parsed.type as string | undefined;

          if (eventType === "content_block_start") {
            const idx = parsed.index as number;
            const block = parsed.content_block as { type: string; id?: string; name?: string } | undefined;
            if (!block) continue;
            blockTypes.set(idx, block.type);
            if (block.type === "tool_use") {
              hasToolUse = true;
              toolAccum.set(idx, { id: block.id ?? "", name: block.name ?? "", inputJson: "" });
            }
            continue;
          }

          if (eventType === "content_block_delta") {
            const idx = parsed.index as number;
            const delta = parsed.delta as { type: string; text?: string; thinking?: string; partial_json?: string } | undefined;
            if (!delta) continue;

            if (delta.type === "text_delta" && delta.text) {
              yield { type: "token", content: delta.text };
            } else if (delta.type === "thinking_delta" && delta.thinking) {
              yield { type: "reasoning", content: delta.thinking };
            } else if (delta.type === "input_json_delta" && delta.partial_json !== undefined) {
              const entry = toolAccum.get(idx);
              if (entry) entry.inputJson += delta.partial_json;
            }
            continue;
          }

          if (eventType === "message_stop" || eventType === "message_delta") {
            if (eventType === "message_stop" && hasToolUse) {
              const calls: AIToolCall[] = Array.from(toolAccum.values()).map((entry) => ({
                id: entry.id,
                type: "function",
                function: {
                  name: entry.name,
                  arguments: entry.inputJson || "{}",
                },
              }));
              if (calls.length > 0) yield { type: "tool_calls", calls };
              hasToolUse = false;
              toolAccum.clear();
            }
            if (eventType === "message_stop") {
              yield { type: "done" };
            }
            continue;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  // ─── Model list ─────────────────────────────────────────────────────────────

  async listModels(): Promise<Array<{ id: string; contextWindow: number | null }>> {
    const response = await fetch(`${this.baseUrl}/v1/models`, {
      headers: this.headers(),
    });

    if (!response.ok) return [];

    const json = await response.json() as {
      data?: Array<{ id: string; context_window?: number }>;
    };

    return (json.data ?? []).map((m) => ({
      id: m.id,
      contextWindow: typeof m.context_window === "number" ? m.context_window : null,
    }));
  }
}
