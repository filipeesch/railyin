import type {
  AIProvider,
  AIMessage,
  AICallOptions,
  AITurnResult,
  AIToolCall,
  AIToolDefinition,
  StreamEvent,
  UsageStats,
} from "./types.ts";
import { ProviderError } from "./retry.ts";

// ─── Anthropic wire types ─────────────────────────────────────────────────────

interface AnthropicTextBlock {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
}

interface AnthropicToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface AnthropicToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
  cache_control?: { type: "ephemeral" };
}

// Block type for system and assistant content
type AnthropicContentBlock = AnthropicTextBlock | AnthropicToolUseBlock;

// Block type for system messages (supports prompt caching)
type AnthropicSystemBlock = AnthropicTextBlock;

interface AnthropicUserMessage {
  role: "user";
  content: string | Array<AnthropicTextBlock | AnthropicToolResultBlock>;
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Parse a JSON string that may be double-encoded.
 * Some Anthropic models occasionally wrap their tool JSON in an extra string layer.
 * If the top-level value is a string, parse it again to unwrap.
 */
function safeParseJSON(raw: string): unknown {
  try {
    const first = JSON.parse(raw);
    if (typeof first === "string") {
      // Double-encoded — parse again
      try {
        return JSON.parse(first);
      } catch {
        return first;
      }
    }
    return first;
  } catch {
    return {};
  }
}

/**
 * Returns true for empty assistant messages that carry no text and no tool calls.
 * These are orphans left by aborted thinking blocks or streamed turns that were
 * cancelled before the model produced content.
 */
function isEmptyAssistantMessage(msg: AIMessage): boolean {
  return (
    msg.role === "assistant" &&
    !(msg.tool_calls?.length) &&
    !((typeof msg.content === "string" ? msg.content : "").trim())
  );
}

/**
 * Collapse consecutive messages with the same role by merging their content.
 * Anthropic's API rejects conversations that have two user messages or two
 * assistant messages in a row.
 */
function mergeConsecutiveSameRole(msgs: AnthropicMessage[]): AnthropicMessage[] {
  const toUserBlocks = (m: AnthropicUserMessage): Array<AnthropicTextBlock | AnthropicToolResultBlock> => {
    if (typeof m.content === "string") {
      return m.content ? [{ type: "text" as const, text: m.content }] : [];
    }
    return m.content;
  };
  const toAssistantBlocks = (m: AnthropicAssistantMessage): AnthropicContentBlock[] => {
    if (typeof m.content === "string") {
      return m.content ? [{ type: "text" as const, text: m.content }] : [];
    }
    return m.content;
  };

  const out: AnthropicMessage[] = [];
  for (const msg of msgs) {
    const prev = out[out.length - 1];
    if (prev && prev.role === msg.role) {
      if (prev.role === "user") {
        const prevU = prev as AnthropicUserMessage;
        const msgU = msg as AnthropicUserMessage;
        if (typeof prevU.content === "string" && typeof msgU.content === "string") {
          prevU.content += "\n\n" + msgU.content;
        } else {
          prevU.content = [...toUserBlocks(prevU), ...toUserBlocks(msgU)];
        }
      } else {
        const prevA = prev as AnthropicAssistantMessage;
        const msgA = msg as AnthropicAssistantMessage;
        if (typeof prevA.content === "string" && typeof msgA.content === "string") {
          prevA.content += "\n\n" + msgA.content;
        } else {
          prevA.content = [...toAssistantBlocks(prevA), ...toAssistantBlocks(msgA)];
        }
      }
    } else {
      out.push(msg);
    }
  }
  return out;
}

/**
 * Apply a prompt-caching breakpoint to the 5th-from-last user message.
 * Mutates in place; safe to call on the already-merged array.
 */
function applyHistoryCacheBreakpoint(msgs: AnthropicMessage[]): void {
  let userCount = 0;
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === "user") {
      userCount++;
      if (userCount === 5) {
        const msg = msgs[i] as AnthropicUserMessage;
        if (typeof msg.content === "string") {
          // Upgrade string content to a block so we can attach cache_control
          msg.content = [{ type: "text" as const, text: msg.content, cache_control: { type: "ephemeral" } }];
        } else if (msg.content.length > 0) {
          const blocks = msg.content;
          blocks[blocks.length - 1] = { ...blocks[blocks.length - 1], cache_control: { type: "ephemeral" } };
        }
        break;
      }
    }
  }
}

// ─── Message adaptation ───────────────────────────────────────────────────────

/**
 * Adapt internal AIMessage[] to Anthropic's wire format:
 * - system messages extracted into a block array with prompt-caching header
 * - empty assistant messages (thinking-block orphans) filtered out
 * - `role: "tool"` → `role: "user"` with tool_result content block (is_error propagated)
 * - `role: "assistant"` with tool_calls → `role: "assistant"` with tool_use content blocks
 * - consecutive same-role messages merged
 * - 5th-from-last user message marked with a prompt-cache breakpoint
 */
export function adaptMessages(messages: AIMessage[]): {
  system?: AnthropicSystemBlock[];
  messages: AnthropicMessage[];
} {
  const systemParts: string[] = [];
  const adapted: AnthropicMessage[] = [];

  // Filter out orphaned empty assistant messages (thinking-block orphan detection)
  const filtered = messages.filter((msg) => !isEmptyAssistantMessage(msg));

  for (const msg of filtered) {
    if (msg.role === "system") {
      if (msg.content) systemParts.push(msg.content as string);
      continue;
    }

    if (msg.role === "tool") {
      // Merge consecutive tool results into a single user message with multiple blocks
      // if the last adapted message is already a tool-result user message, append.
      const block: AnthropicToolResultBlock = {
        type: "tool_result",
        tool_use_id: msg.tool_call_id ?? "",
        content: msg.content ?? "",
        ...(msg.isError ? { is_error: true } : {}),
      };
      const last = adapted[adapted.length - 1];
      if (
        last &&
        last.role === "user" &&
        Array.isArray(last.content) &&
        (last.content as Array<{ type: string }>).some((b) => b.type === "tool_result")
      ) {
        (last.content as Array<AnthropicTextBlock | AnthropicToolResultBlock>).push(block);
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
            return JSON.parse(tc.function.arguments || "{}") as Record<string, unknown>;
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

  // Build system blocks with a prompt-caching header on the last block
  let systemBlocks: AnthropicSystemBlock[] | undefined;
  if (systemParts.length > 0) {
    const systemText = systemParts.join("\n\n");
    systemBlocks = [{ type: "text", text: systemText, cache_control: { type: "ephemeral" } }];
  }

  // Merge consecutive same-role messages, then apply conversation history cache breakpoint
  const merged = mergeConsecutiveSameRole(adapted);
  applyHistoryCacheBreakpoint(merged);

  return {
    system: systemBlocks,
    messages: merged,
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
    const { system: systemBlocks, messages: adaptedMessages } = adaptMessages(messages);

    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: options.maxTokens ?? 8192,
      messages: adaptedMessages,
    };
    if (systemBlocks?.length) body.system = systemBlocks;
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
      usage?: { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number };
    };

    // Extract usage stats from the response
    const usageRaw = json.usage;
    const usage: UsageStats | undefined = usageRaw
      ? {
          inputTokens: usageRaw.input_tokens ?? 0,
          outputTokens: usageRaw.output_tokens ?? 0,
          ...(usageRaw.cache_creation_input_tokens != null ? { cacheCreationInputTokens: usageRaw.cache_creation_input_tokens } : {}),
          ...(usageRaw.cache_read_input_tokens != null ? { cacheReadInputTokens: usageRaw.cache_read_input_tokens } : {}),
        }
      : undefined;

    const toolUseBlocks = (json.content ?? []).filter((b): b is AnthropicToolUseBlock => b.type === "tool_use");
    if (toolUseBlocks.length > 0) {
      const calls: AIToolCall[] = toolUseBlocks.map((b) => ({
        id: b.id,
        type: "function",
        function: { name: b.name, arguments: JSON.stringify(b.input) },
      }));
      return { type: "tool_calls", calls, usage };
    }

    const textBlock = (json.content ?? []).find((b): b is AnthropicTextBlock => b.type === "text");
    return { type: "text", content: textBlock?.text ?? "", usage };
  }

  // ─── Streaming ──────────────────────────────────────────────────────────────

  async *stream(messages: AIMessage[], options: AICallOptions = {}): AsyncIterable<StreamEvent> {
    const { system: systemBlocks, messages: adaptedMessages } = adaptMessages(messages);

    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: options.maxTokens ?? 8192,
      messages: adaptedMessages,
      stream: true,
    };
    if (systemBlocks?.length) body.system = systemBlocks;
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
    // Accumulate usage stats across message_start and message_delta events
    let usageAccum: UsageStats | null = null;

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

          if (eventType === "message_start") {
            // Capture input token usage from the opening event
            const msgUsage = (parsed.message as { usage?: { input_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number } } | undefined)?.usage;
            if (msgUsage) {
              usageAccum = {
                inputTokens: msgUsage.input_tokens ?? 0,
                outputTokens: 0,
                ...(msgUsage.cache_creation_input_tokens != null ? { cacheCreationInputTokens: msgUsage.cache_creation_input_tokens } : {}),
                ...(msgUsage.cache_read_input_tokens != null ? { cacheReadInputTokens: msgUsage.cache_read_input_tokens } : {}),
              };
            }
            continue;
          }

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

          if (eventType === "message_delta") {
            // Capture output token count from the delta stop event
            const deltaUsage = (parsed.usage as { output_tokens?: number } | undefined);
            if (deltaUsage?.output_tokens != null && usageAccum) {
              usageAccum.outputTokens = deltaUsage.output_tokens;
            }
            continue;
          }

          if (eventType === "message_stop") {
            if (hasToolUse) {
              const calls: AIToolCall[] = Array.from(toolAccum.values()).map((entry) => ({
                id: entry.id,
                type: "function",
                function: {
                  name: entry.name,
                  // safeParseJSON corrects double-encoded tool arguments then re-serialises
                  arguments: JSON.stringify(safeParseJSON(entry.inputJson || "{}")),
                },
              }));
              if (calls.length > 0) yield { type: "tool_calls", calls };
              hasToolUse = false;
              toolAccum.clear();
            }
            // Emit accumulated usage stats before signalling done
            if (usageAccum) {
              yield { type: "usage", usage: usageAccum };
              usageAccum = null;
            }
            yield { type: "done" };
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
