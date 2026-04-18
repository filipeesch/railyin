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
import { log } from "../logger.ts";

// ─── Usage logging helper ─────────────────────────────────────────────────────

function logUsage(
  model: string,
  inputTokens: number,
  cacheReadTokens: number,
  cacheWriteTokens: number,
  outputTokens: number,
  agentLabel?: string,
): number {
  const total = inputTokens + cacheReadTokens + cacheWriteTokens;
  const hitPct = total > 0 ? Math.round((cacheReadTokens / total) * 100) : 0;
  // Estimate cost ($/ MTok) for Sonnet 4.6: base=$3, out=$15, cache_read=0.1×=$0.30.
  // All breakpoints use 1h TTL → cache_write is 2× base = $6/MTok.
  const costEst = (
    (inputTokens * 3 + cacheWriteTokens * 6 + cacheReadTokens * 0.3 + outputTokens * 15) / 1_000_000
  ).toFixed(4);
  const prefix = agentLabel ? `[${agentLabel}] ` : "";
  log("debug", `${prefix}Anthropic usage [${model}]: in=${inputTokens} cache_read=${cacheReadTokens} cache_write=${cacheWriteTokens} out=${outputTokens} | hit=${hitPct}% of ${total} input | ~$${costEst}`, {});
  return parseFloat(costEst);
}

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

export interface AnthropicSystemBlock {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral"; ttl?: "1h" };
}

type AnthropicUserContentBlock =
  | { type: "text"; text: string; cache_control?: { type: "ephemeral"; ttl?: "1h" } }
  | { type: "tool_result"; tool_use_id: string; content: string; cache_control?: { type: "ephemeral"; ttl?: "1h" } };

interface AnthropicUserMessage {
  role: "user";
  content: string | AnthropicUserContentBlock[];
}

interface AnthropicAssistantMessage {
  role: "assistant";
  content: string | AnthropicContentBlock[];
}

type AnthropicMessage = AnthropicUserMessage | AnthropicAssistantMessage;

interface AnthropicTool {
  name: string;
  description: string;
  strict: true;
  input_schema: {
    type: "object";
    properties: Record<string, { type: string; description: string }>;
    required?: string[];
    additionalProperties: false;
  };
  cache_control?: { type: "ephemeral"; ttl?: "1h" };
}

// ─── Message adaptation ───────────────────────────────────────────────────────

/**
 * Returns true when an assistant message has no meaningful content — no text
 * and no tool calls. These arise when streaming is interrupted after reasoning
 * tokens arrive but before any text or tool_use is emitted. Sending such a
 * message to the Anthropic API causes an HTTP 400 ("assistant turn must contain
 * at least one content block of type text or tool_use").
 */
export function isEmptyAssistantMessage(m: AIMessage): boolean {
  return (
    m.role === "assistant" &&
    (!m.content || (typeof m.content === "string" && !m.content.trim())) &&
    (!m.tool_calls || m.tool_calls.length === 0)
  );
}

/**
 * Adapt internal AIMessage[] to Anthropic's wire format:
 * - system messages extracted into top-level `system` field (as AnthropicSystemBlock[] with cache_control)
 * - `role: "tool"` → `role: "user"` with tool_result content block
 * - `role: "assistant"` with tool_calls → `role: "assistant"` with tool_use content blocks
 * - conversation history cache breakpoint placed at the 5th-from-last user message
 */
export function adaptMessages(messages: AIMessage[], cacheTtl?: "5m" | "1h"): {
  system?: AnthropicSystemBlock[];
  messages: AnthropicMessage[];
} {
  const systemParts: string[] = [];
  const adapted: AnthropicMessage[] = [];

  // Pre-flight orphan filter: remove empty-content assistant messages that have
  // no text and no tool calls. These occur when an execution is interrupted during
  // the reasoning phase before any output was produced. If sent to Anthropic they
  // cause an HTTP 400; filtering them here lets the next retry succeed cleanly.
  const filtered = messages.filter((m, idx) => {
    if (isEmptyAssistantMessage(m)) {
      console.warn(`[anthropic] adaptMessages: dropping orphaned empty assistant message at index ${idx}`);
      return false;
    }
    return true;
  });

  for (const msg of filtered) {
    if (msg.role === "system") {
      if (msg.content) systemParts.push(msg.content as string);
      continue;
    }

    if (msg.role === "tool") {
      // Merge consecutive tool results into a single user message with multiple blocks
      // if the last adapted message is already a tool-result user message, append.
      const block: AnthropicUserContentBlock = {
        type: "tool_result" as const,
        tool_use_id: msg.tool_call_id ?? "",
        content: (typeof msg.content === "string" ? msg.content : null) ?? "",
      };
      const last = adapted[adapted.length - 1];
      if (
        last &&
        last.role === "user" &&
        Array.isArray(last.content) &&
        last.content.some((b) => b.type === "tool_result")
      ) {
        (last.content as AnthropicUserContentBlock[]).push(block);
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

  // Build systemBlocks with cache_control on the last block.
  // System prompt + tools are stable across all rounds of an execution and across
  // executions, so they always use the 1-hour TTL to survive multi-minute stalls
  // and rate-limit retries without paying a cold-write cost each time.
  let system: AnthropicSystemBlock[] | undefined;
  if (systemParts.length > 0) {
    const joined = systemParts.join("\n\n");
    system = [{ type: "text", text: joined, cache_control: { type: "ephemeral", ttl: "1h" } }];
  }

  // Conversation breakpoints are no longer injected here. Instead, a top-level
  // `cache_control` on each request body enables Anthropic's automatic caching,
  // which moves the breakpoint to the last cacheable block on every turn and never
  // falls outside the 20-block lookback window.

  return { system, messages: adapted };
}

/**
 * Map AIToolDefinition[] to Anthropic's tool format (parameters → input_schema).
 * When cacheTtl is set, marks the last tool with cache_control so the entire
 * tools prefix is cached independently of system + messages. This is the
 * highest-leverage cache breakpoint for sub-agents, which use the same sorted
 * tool set across all parallel children but have unique instructions every call.
 */
/**
 * Recursively inject `additionalProperties: false` into every sub-schema that
 * has `type: "object"`. Anthropic strict mode requires this on ALL nested
 * objects, not just the top-level `input_schema`.
 */
function injectAdditionalProperties(schema: Record<string, unknown>): Record<string, unknown> {
  const result = { ...schema };
  if (result.type === "object") {
    result.additionalProperties = false;
    if (result.properties && typeof result.properties === "object") {
      const props: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(result.properties as Record<string, unknown>)) {
        props[key] = typeof val === "object" && val !== null
          ? injectAdditionalProperties(val as Record<string, unknown>)
          : val;
      }
      result.properties = props;
    }
  }
  // Always recurse into array items regardless of parent type — arrays can
  // contain objects that also need additionalProperties: false.
  if (result.items && typeof result.items === "object" && result.items !== null) {
    result.items = injectAdditionalProperties(result.items as Record<string, unknown>);
  }
  return result;
}

export function adaptTools(tools: AIToolDefinition[], cacheTtl?: "5m" | "1h"): AnthropicTool[] {
  return tools.map((t, i) => {
    const adapted: AnthropicTool = {
      name: t.name,
      description: t.description,
      strict: true,
      input_schema: injectAdditionalProperties({
        type: "object",
        properties: t.parameters.properties,
        required: t.parameters.required,
      }) as AnthropicTool["input_schema"],
    };
    // Mark last tool with 1h cache_control — tools are identical across all rounds
    // and executions, so a 1-hour cache survives long stalls and retries.
    if (i === tools.length - 1) {
      adapted.cache_control = { type: "ephemeral", ttl: "1h" };
    }
    return adapted;
  });
}

// ─── AnthropicProvider ────────────────────────────────────────────────────────

const ANTHROPIC_BASE_URL = "https://api.anthropic.com";
const ANTHROPIC_VERSION = "2023-06-01";
// interleaved-thinking-2025-05-14 beta header removed: adaptive thinking
// ({ type: "adaptive" }) automatically enables interleaved thinking on Claude 4.6
// models without any beta header. The header is deprecated per the migration guide.

// ─── Context edit strategy (server-side tool-result clearing) ────────────────

/** Server-side context edit strategy sent with every request when enabled.
 *  Instructs Anthropic to clear old tool results once input tokens exceed 80K,
 *  keeping the cache prefix valid while reducing effective context size. */
export const CONTEXT_EDIT_STRATEGY = {
  type: "clear_tool_uses_20250919",
  trigger: { type: "input_tokens", value: 80000 },
  keep: { type: "tool_uses", value: 20000 },
  clear_at_least: { type: "input_tokens", value: 20000 },
} as const;

// ─── Cache break detection ────────────────────────────────────────────────────

/** Per-execution hash state for cache break detection. Keyed by execution ID. */
const _execHashes = new Map<number, { system: string; tools: string; toolHashes: Map<string, string>; round: number }>();

/** Compute a short (8-char) SHA-256 hex digest of a string using Bun's crypto API. */
function hashShort(text: string): string {
  return new Bun.CryptoHasher("sha256").update(text).digest("hex").slice(0, 8);
}

/** Build a name→hash map from a serialized tools array. */
function buildToolHashes(toolsJson: string): Map<string, string> {
  const hashes = new Map<string, string>();
  try {
    const tools = JSON.parse(toolsJson) as Array<{ name?: string }>;
    for (const tool of tools) {
      if (tool.name) hashes.set(tool.name, hashShort(JSON.stringify(tool)));
    }
  } catch {
    // malformed JSON — leave empty
  }
  return hashes;
}

/** Compare system and tools hashes against the stored values for this execution.
 *  Emits console.warn when a hash changes (cache miss cause). Updates stored hashes. */
export function checkAndUpdateCacheBreak(
  executionId: number | undefined,
  systemText: string | undefined,
  toolsJson: string,
): void {
  if (!executionId) return;
  const sysHash = hashShort(systemText ?? "");
  const toolsHash = hashShort(toolsJson);
  const newToolHashes = buildToolHashes(toolsJson);
  const prev = _execHashes.get(executionId);
  if (prev) {
    if (prev.system !== sysHash) {
      console.warn(`[cache] system hash changed: ${prev.system} → ${sysHash}`);
    }
    if (prev.tools !== toolsHash) {
      const changed: string[] = [];
      const added: string[] = [];
      const removed: string[] = [];
      for (const [name, hash] of newToolHashes) {
        if (!prev.toolHashes.has(name)) added.push(name);
        else if (prev.toolHashes.get(name) !== hash) changed.push(name);
      }
      for (const name of prev.toolHashes.keys()) {
        if (!newToolHashes.has(name)) removed.push(name);
      }
      const parts: string[] = [];
      if (changed.length) parts.push(`changed: ${changed.join(", ")}`);
      if (added.length) parts.push(`added: ${added.join(", ")}`);
      if (removed.length) parts.push(`removed: ${removed.join(", ")}`);
      console.warn(`[cache] tools hash changed: ${prev.tools} → ${toolsHash}${parts.length ? ` (${parts.join("; ")})` : ""}`);
    }
  }
  _execHashes.set(executionId, { system: sysHash, tools: toolsHash, toolHashes: newToolHashes, round: (prev?.round ?? 0) + 1 });
}

/** After receiving a response, warn if cache_read_input_tokens is 0 on a non-first round.
 *  A zero read on round ≥ 2 means the cache was busted unexpectedly (TTL expiry, provider issue, etc.). */
export function checkCacheReadOnResponse(
  executionId: number | undefined,
  cacheReadTokens: number,
): void {
  if (!executionId) return;
  const state = _execHashes.get(executionId);
  if (!state || state.round <= 1) return;
  if (cacheReadTokens === 0) {
    console.warn(`[cache] unexpected miss on round ${state.round}: cache_read_input_tokens=0`);
  }
}

/** Clear stored hash state for an execution (call on completion to free memory). */
export function clearExecHashes(executionId: number): void {
  _execHashes.delete(executionId);
}

export class AnthropicProvider implements AIProvider {
  cooldownUntil = 0;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly cacheTtl: "5m" | "1h" | undefined;
  private readonly enableThinking: boolean;
  private readonly defaultEffort: "low" | "medium" | "high" | "max" | undefined;
  /** When true, include the context-editing-2025-10-01 beta header and
   *  `context_edit_strategy` body param on every request. */
  readonly contextEditEnabled: boolean;

  /** Resolved to true when the model's capabilities endpoint confirms effort support. */
  private supportsEffort = false;
  private capabilitiesReady: Promise<void> | undefined;

  constructor(
    apiKey: string,
    model: string,
    baseUrl = ANTHROPIC_BASE_URL,
    cacheTtl?: "5m" | "1h",
    enableThinking = false,
    defaultEffort?: "low" | "medium" | "high" | "max",
    contextEditEnabled = false,
  ) {
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl;
    this.cacheTtl = cacheTtl;
    this.enableThinking = enableThinking;
    this.defaultEffort = defaultEffort;
    this.contextEditEnabled = contextEditEnabled;
  }

  private getCapabilities(): Promise<void> {
    if (!this.capabilitiesReady) this.capabilitiesReady = this.fetchCapabilities();
    return this.capabilitiesReady;
  }

  private async fetchCapabilities(): Promise<void> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/models/${encodeURIComponent(this.model)}`, {
        headers: {
          "x-api-key": this.apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
        },
      });
      if (!response.ok) return;
      const data = await response.json() as { capabilities?: { effort?: { supported?: boolean } } };
      this.supportsEffort = data.capabilities?.effort?.supported === true;
    } catch {
      // Network error or mock server without /v1/models/ route: stay false (safe default).
    }
  }

  /**
   * After a successful response, check rate-limit headers and proactively set
   * cooldownUntil when any bucket (requests, tokens) is fully exhausted.
   * This lets concurrent callers (e.g. parallel sub-agents) wait before their
   * next attempt rather than racing to a 429.
   */
  private updateCooldownFromHeaders(responseHeaders: Headers): void {
    const pairs: Array<[string, string]> = [
      ["anthropic-ratelimit-requests-remaining", "anthropic-ratelimit-requests-reset"],
      ["anthropic-ratelimit-tokens-remaining",   "anthropic-ratelimit-tokens-reset"],
      ["anthropic-ratelimit-input-tokens-remaining", "anthropic-ratelimit-input-tokens-reset"],
      ["anthropic-ratelimit-output-tokens-remaining", "anthropic-ratelimit-output-tokens-reset"],
    ];
    for (const [remainingKey, resetKey] of pairs) {
      const remaining = responseHeaders.get(remainingKey);
      const reset = responseHeaders.get(resetKey);
      if (remaining !== null && reset && parseInt(remaining, 10) === 0) {
        const resetMs = new Date(reset).getTime();
        if (resetMs > this.cooldownUntil) this.cooldownUntil = resetMs;
      }
    }
  }

  private headers(agentLabel?: string): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
      "x-api-key": this.apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    };
    if (agentLabel) h["x-agent-label"] = agentLabel;
    return h;
  }

  // ─── Non-streaming turn ─────────────────────────────────────────────────────

  async turn(messages: AIMessage[], options: AICallOptions = {}): Promise<AITurnResult> {
    const { system: systemBlocks, messages: adaptedMessages } = adaptMessages(messages, this.cacheTtl);
    const adaptedTools = options.tools?.length ? adaptTools(options.tools, this.cacheTtl) : undefined;

    // Cache break detection: warn when system or tools hash changes across rounds.
    checkAndUpdateCacheBreak(
      options.executionId,
      systemBlocks?.[0]?.text,
      JSON.stringify(adaptedTools ?? []),
    );

    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: options.maxTokens ?? 8192,
      messages: adaptedMessages,
      // Top-level cache_control enables automatic conversation caching (same as stream).
      // Always 1h TTL to match system+tools breakpoints.
      cache_control: { type: "ephemeral", ttl: "1h" },
    };
    if (systemBlocks) body.system = systemBlocks;
    if (adaptedTools) body.tools = adaptedTools;
    if (this.enableThinking) body.thinking = { type: "adaptive" };
    const turnEffort = options.effort ?? this.defaultEffort;
    await this.getCapabilities();
    if (turnEffort && this.supportsEffort) body.output_config = { effort: turnEffort };

    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      headers: this.headers(options.agentLabel),
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

    this.updateCooldownFromHeaders(response.headers);

    const json = await response.json() as {
      content?: AnthropicContentBlock[];
      stop_reason?: string;
      usage?: {
        input_tokens?: number;
        cache_read_input_tokens?: number;
        cache_creation_input_tokens?: number;
        output_tokens?: number;
      };
    };

    if (json.usage) {
      const u = json.usage;
      checkCacheReadOnResponse(options.executionId, u.cache_read_input_tokens ?? 0);
      logUsage(
        this.model,
        u.input_tokens ?? 0,
        u.cache_read_input_tokens ?? 0,
        u.cache_creation_input_tokens ?? 0,
        u.output_tokens ?? 0,
        options.agentLabel,
      );
    }

    // Max-tokens escalation: if the call was truncated at the initial limit, retry
    // once with 64K. This eliminates the sub-agent truncation retry spiral.
    const initialMaxTokens = options.maxTokens ?? 8192;
    if (json.stop_reason === "max_tokens" && initialMaxTokens <= 16384) {
      log("info", `[anthropic] max_tokens hit at ${initialMaxTokens}, retrying with 64000`, {});
      return this.turn(messages, { ...options, maxTokens: 64000 });
    }

    const turnUsage: UsageStats | undefined = json.usage ? {
      inputTokens: json.usage.input_tokens ?? 0,
      outputTokens: json.usage.output_tokens ?? 0,
      ...(json.usage.cache_creation_input_tokens ? { cacheCreationInputTokens: json.usage.cache_creation_input_tokens } : {}),
      ...(json.usage.cache_read_input_tokens ? { cacheReadInputTokens: json.usage.cache_read_input_tokens } : {}),
    } : undefined;

    const toolUseBlocks = (json.content ?? []).filter((b): b is AnthropicToolUseBlock => b.type === "tool_use");
    if (toolUseBlocks.length > 0) {
      const calls: AIToolCall[] = toolUseBlocks.map((b) => ({
        id: b.id,
        type: "function",
        function: { name: b.name, arguments: JSON.stringify(b.input) },
      }));
      return { type: "tool_calls", calls, ...(turnUsage ? { usage: turnUsage } : {}) };
    }

    const textBlock = (json.content ?? []).find((b): b is AnthropicTextBlock => b.type === "text");
    const standardStopReasons = new Set(["end_turn", "tool_use", "max_tokens"]);
    const stopReason = json.stop_reason && !standardStopReasons.has(json.stop_reason) ? json.stop_reason : undefined;
    return { type: "text", content: textBlock?.text ?? "", ...(stopReason ? { stopReason } : {}), ...(turnUsage ? { usage: turnUsage } : {}) };
  }

  // ─── Streaming ──────────────────────────────────────────────────────────────

  async *stream(messages: AIMessage[], options: AICallOptions = {}): AsyncIterable<StreamEvent> {
    const { system: systemBlocks, messages: adaptedMessages } = adaptMessages(messages, this.cacheTtl);
    const adaptedTools = options.tools?.length ? adaptTools(options.tools, this.cacheTtl) : undefined;

    // Cache break detection: warn when system or tools hash changes across rounds.
    checkAndUpdateCacheBreak(
      options.executionId,
      systemBlocks?.[0]?.text,
      JSON.stringify(adaptedTools ?? []),
    );

    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: options.maxTokens ?? 8192,
      messages: adaptedMessages,
      stream: true,
      // Top-level cache_control enables Anthropic's automatic conversation caching:
      // the API places a breakpoint on the last cacheable message block and moves it
      // forward each turn, avoiding the 20-block lookback limit that manual breakpoints
      // hit with long tool-call chains. Always use 1h TTL to match system+tools
      // breakpoints — a 5m TTL can expire during long sub-agent execution gaps,
      // causing full cache misses even though the system+tools prefix hasn't changed.
      cache_control: { type: "ephemeral", ttl: "1h" },
    };
    if (systemBlocks) body.system = systemBlocks;
    if (adaptedTools) body.tools = adaptedTools;
    if (this.enableThinking) body.thinking = { type: "adaptive" };
    const streamEffort = options.effort ?? this.defaultEffort;
    await this.getCapabilities();
    if (streamEffort && this.supportsEffort) body.output_config = { effort: streamEffort };

    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      headers: this.headers(options.agentLabel),
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

    this.updateCooldownFromHeaders(response.headers);

    if (!response.body) throw new Error("Anthropic API returned no response body");

    const decoder = new TextDecoder();
    const reader = response.body.getReader();

    // Accumulate tool_use blocks by index
    const toolAccum = new Map<number, { id: string; name: string; inputJson: string }>();
    let hasToolUse = false;
    // Track current content block index → type
    const blockTypes = new Map<number, string>();
    // Usage accumulators (populated from message_start / message_delta events)
    let usageInputTokens = 0;
    let usageCacheReadTokens = 0;
    let usageCacheWriteTokens = 0;
    let usageOutputTokens = 0;

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

          if (eventType === "message_start") {
            const msg = parsed.message as { usage?: { input_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } } | undefined;
            if (msg?.usage) {
              usageInputTokens = msg.usage.input_tokens ?? 0;
              usageCacheReadTokens = msg.usage.cache_read_input_tokens ?? 0;
              usageCacheWriteTokens = msg.usage.cache_creation_input_tokens ?? 0;
              checkCacheReadOnResponse(options.executionId, usageCacheReadTokens);
              // Emit early usage event so input_tokens are persisted immediately.
              const earlyUsage: UsageStats = {
                inputTokens: usageInputTokens,
                outputTokens: 0,
                ...(usageCacheWriteTokens ? { cacheCreationInputTokens: usageCacheWriteTokens } : {}),
                ...(usageCacheReadTokens ? { cacheReadInputTokens: usageCacheReadTokens } : {}),
              };
              yield { type: "usage", usage: earlyUsage, costEst: 0 };
            }
            continue;
          }

          if (eventType === "message_delta") {
            const deltaUsage = (parsed.usage as { output_tokens?: number } | undefined);
            if (deltaUsage?.output_tokens) usageOutputTokens = deltaUsage.output_tokens;
            const stopReason = (parsed.delta as { stop_reason?: string } | undefined)?.stop_reason;
            const standardStopReasons = new Set(["end_turn", "tool_use", "max_tokens"]);
            if (stopReason === "max_tokens") {
              const streamMaxTokens = options.maxTokens ?? 8192;
              // Log the truncation; streaming escalation not available because tokens
              // are already yielded live. Sub-agents use turn() which does escalate.
              log("warn", `[anthropic] stream hit max_tokens at ${streamMaxTokens} — use turn() for automatic escalation`, {});
            }
            if (stopReason && !standardStopReasons.has(stopReason)) {
              yield { type: "stop_reason", reason: stopReason };
            }
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
              const costEst = logUsage(this.model, usageInputTokens, usageCacheReadTokens, usageCacheWriteTokens, usageOutputTokens, options.agentLabel);
              const finalUsage: UsageStats = {
                inputTokens: usageInputTokens,
                outputTokens: usageOutputTokens,
                ...(usageCacheWriteTokens ? { cacheCreationInputTokens: usageCacheWriteTokens } : {}),
                ...(usageCacheReadTokens ? { cacheReadInputTokens: usageCacheReadTokens } : {}),
              };
              yield { type: "usage", usage: finalUsage, costEst };
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
