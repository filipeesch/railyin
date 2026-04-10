/**
 * refinement/proxy.ts
 *
 * Thin Bun.serve HTTP proxy for the Anthropic Messages API.
 * Intercepts POST /v1/messages, inspects requests, simulates cache prefix
 * behaviour, and either returns scripted mock responses or forwards to a
 * real backend (LM Studio / Anthropic cloud).
 *
 * Usage:
 *   bun refinement/proxy.ts --mode mock --port 8999
 *   bun refinement/proxy.ts --mode local --backend http://localhost:1234
 *   bun refinement/proxy.ts --mode live
 */

import { createHash, randomUUID } from "crypto";
import type { CostEstimate, ContentBlock, InspectionRecord, ProxyMode, ProviderConfig, ProviderPricing, RequestTiming, ResponseCapture, Scenario, ScriptEntry } from "./types.ts";

// ─── SHA256 helpers ───────────────────────────────────────────────────────────

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

function toolsHash(tools: Array<{ name: string; [k: string]: unknown }>): string {
  const sorted = [...tools].sort((a, b) => a.name.localeCompare(b.name));
  return sha256(JSON.stringify(sorted));
}

function systemHash(system: unknown): string {
  return sha256(JSON.stringify(system ?? ""));
}

// ─── Token estimation and cost calculation ───────────────────────────────────

interface TokenBreakdown {
  tools_tokens: number;
  system_tokens: number;
  messages_tokens: number;
}

function estimateTokens(body: AnthropicRequestBody): TokenBreakdown {
  return {
    tools_tokens: Math.ceil(JSON.stringify(body.tools ?? []).length / 4),
    system_tokens: Math.ceil(JSON.stringify(body.system ?? "").length / 4),
    messages_tokens: Math.ceil(JSON.stringify(body.messages ?? []).length / 4),
  };
}

// Anthropic Sonnet pricing per million tokens (default)
const PRICING = {
  input: 3.0,
  cache_write: 6.0,
  cache_read: 0.30,
  output: 15.0,
} as const;

function estimateCost(tokens: TokenBreakdown, cacheHit: boolean, outputTokens: number, pricing?: ProviderPricing): CostEstimate {
  const rates = pricing ?? PRICING;
  const prefixTokens = tokens.tools_tokens + tokens.system_tokens;
  const deltaTokens = tokens.messages_tokens;
  const cacheWriteTokens = cacheHit ? 0 : prefixTokens;
  const cacheReadTokens = cacheHit ? prefixTokens : 0;

  const input_cost = (deltaTokens / 1_000_000) * rates.input;
  const cache_write_cost = (cacheWriteTokens / 1_000_000) * rates.cache_write;
  const cache_read_cost = (cacheReadTokens / 1_000_000) * rates.cache_read;
  const output_cost = (outputTokens / 1_000_000) * rates.output;
  return {
    tools_tokens: tokens.tools_tokens,
    system_tokens: tokens.system_tokens,
    messages_tokens: tokens.messages_tokens,
    output_tokens: outputTokens,
    input_cost,
    cache_write_cost,
    cache_read_cost,
    output_cost,
    total_cost: input_cost + cache_write_cost + cache_read_cost + output_cost,
  };
}

/**
 * Estimate output tokens for a mock script entry.
 * tool_use: JSON size of input / 4 + 20 (tool name overhead)
 * text: content length / 4
 */
export function estimateOutputTokens(entry: ScriptEntry): number {
  if (entry.respond_with === "tool_use") {
    return Math.ceil(JSON.stringify(entry.input ?? {}).length / 4) + 20;
  }
  return Math.ceil((entry.content ?? "").length / 4);
}

// ─── SSE helpers ──────────────────────────────────────────────────────────────

function sseEvent(type: string, data: Record<string, unknown>): string {
  return `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
}

function generateMockSse(entry: ScriptEntry, usage: {
  input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}): string {
  const msgId = `msg_mock_${randomUUID().slice(0, 8)}`;
  const blockId = `toolu_${randomUUID().slice(0, 8)}`;

  const events: string[] = [];

  // message_start
  events.push(sseEvent("message_start", {
    message: {
      id: msgId,
      type: "message",
      role: "assistant",
      content: [],
      model: "mock",
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens: usage.input_tokens ?? 100,
        output_tokens: 0,
        cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
        cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
      },
    },
  }));

  if (entry.respond_with === "tool_use" && entry.tool) {
    const inputStr = JSON.stringify(entry.input ?? {});
    events.push(sseEvent("content_block_start", {
      index: 0,
      content_block: { type: "tool_use", id: blockId, name: entry.tool, input: {} },
    }));
    events.push(sseEvent("content_block_delta", {
      index: 0,
      delta: { type: "input_json_delta", partial_json: inputStr },
    }));
    events.push(sseEvent("content_block_stop", { index: 0 }));
    events.push(sseEvent("message_delta", {
      delta: { stop_reason: "tool_use", stop_sequence: null },
      usage: { output_tokens: 10 },
    }));
  } else {
    // text response (default)
    const text = entry.content ?? "Done.";
    events.push(sseEvent("content_block_start", {
      index: 0,
      content_block: { type: "text", text: "" },
    }));
    events.push(sseEvent("content_block_delta", {
      index: 0,
      delta: { type: "text_delta", text },
    }));
    events.push(sseEvent("content_block_stop", { index: 0 }));
    events.push(sseEvent("message_delta", {
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: { output_tokens: text.length },
    }));
  }

  events.push(sseEvent("message_stop", {}));
  return events.join("");
}

function fallbackMockSse(): string {
  return generateMockSse({ respond_with: "text", content: "No script loaded." }, {});
}

// ─── SSE response parser ──────────────────────────────────────────────────────

/**
 * Parse accumulated SSE text into a ResponseCapture.
 * Handles multi-chunk streaming by joining all accumulated text first.
 */
export function parseSseResponse(accumulated: string): ResponseCapture {
  try {
    const lines = accumulated.split("\n");
    const events: Array<{ type: string; data: Record<string, unknown> }> = [];

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        try {
          const data = JSON.parse(line.slice(6));
          if (data.type) events.push({ type: data.type, data });
        } catch { /* skip malformed */ }
      }
    }

    let stop_reason = "unknown";
    let output_tokens = 0;
    let input_tokens = 0;
    let cache_creation_input_tokens = 0;
    let cache_read_input_tokens = 0;
    let model = "unknown";
    const content_blocks: ContentBlock[] = [];

    // Track per-block state for streaming reconstruction
    const blockAccumulators: Record<number, { type: string; id?: string; name?: string; text?: string; json?: string; thinking?: string }> = {};

    for (const event of events) {
      if (event.type === "message_start") {
        const msg = (event.data.message ?? {}) as Record<string, unknown>;
        model = (msg.model as string) ?? "unknown";
        // Extract real usage from message_start (Anthropic includes cache tokens here)
        const usage = (msg.usage ?? {}) as Record<string, unknown>;
        input_tokens = (usage.input_tokens as number) ?? 0;
        cache_creation_input_tokens = (usage.cache_creation_input_tokens as number) ?? 0;
        cache_read_input_tokens = (usage.cache_read_input_tokens as number) ?? 0;
      } else if (event.type === "content_block_start") {
        const idx = (event.data.index as number) ?? 0;
        const cb = (event.data.content_block ?? {}) as Record<string, unknown>;
        blockAccumulators[idx] = { type: (cb.type as string) ?? "text", id: cb.id as string, name: cb.name as string };
      } else if (event.type === "content_block_delta") {
        const idx = (event.data.index as number) ?? 0;
        const delta = (event.data.delta ?? {}) as Record<string, unknown>;
        const acc = blockAccumulators[idx];
        if (!acc) continue;
        if (delta.type === "text_delta") {
          acc.text = (acc.text ?? "") + ((delta.text as string) ?? "");
        } else if (delta.type === "input_json_delta") {
          acc.json = (acc.json ?? "") + ((delta.partial_json as string) ?? "");
        } else if (delta.type === "thinking_delta") {
          acc.thinking = (acc.thinking ?? "") + ((delta.thinking as string) ?? "");
        } else {
          console.log(`[proxy:delta] unknown delta type: ${delta.type} — data: ${JSON.stringify(delta).slice(0, 200)}`);
        }
      } else if (event.type === "content_block_stop") {
        const idx = (event.data.index as number) ?? 0;
        const acc = blockAccumulators[idx];
        if (!acc) continue;
        if (acc.type === "text") {
          content_blocks.push({ type: "text", text: acc.text ?? "" });
        } else if (acc.type === "tool_use") {
          let input: unknown = {};
          try { if (acc.json) input = JSON.parse(acc.json); } catch { /* keep empty */ }
          content_blocks.push({ type: "tool_use", id: acc.id ?? "", name: acc.name ?? "", input });
        } else if (acc.type === "thinking") {
          const thinkingText = acc.thinking ?? "";
          content_blocks.push({ type: "thinking", thinking: thinkingText });
          if (thinkingText) {
            const preview = thinkingText.length > 500 ? thinkingText.slice(0, 500) + " …" : thinkingText;
            console.log(`[thinking] block ${idx} (${thinkingText.length} chars):\n${preview}`);
          } else {
            console.log(`[thinking] block ${idx} — empty thinking text (acc: ${JSON.stringify(acc).slice(0, 200)})`);
          }
        } else {
          console.log(`[proxy:block] unknown block type: ${acc.type} — acc: ${JSON.stringify(acc).slice(0, 200)}`);
        }
      } else if (event.type === "message_delta") {
        const delta = (event.data.delta ?? {}) as Record<string, unknown>;
        stop_reason = (delta.stop_reason as string) ?? stop_reason;
        const usage = (event.data.usage ?? {}) as Record<string, unknown>;
        output_tokens = (usage.output_tokens as number) ?? 0;
      } else if (![ "message_start", "message_stop", "ping", "content_block_start", "content_block_delta", "content_block_stop", "message_delta" ].includes(event.type)) {
        console.log(`[proxy:event] unknown event type: ${event.type} — data: ${JSON.stringify(event.data).slice(0, 200)}`);
      }
    }

    if (output_tokens > 0 && content_blocks.length === 0) {
      console.log(`[proxy:empty] ${output_tokens} output tokens but 0 content blocks — stop_reason: ${stop_reason}, accumulators: ${JSON.stringify(blockAccumulators).slice(0, 400)}`);
    }

    return { stop_reason, content_blocks, usage: { output_tokens, input_tokens, cache_creation_input_tokens, cache_read_input_tokens }, model };
  } catch {
    return { stop_reason: "unknown", content_blocks: [], usage: { output_tokens: 0 }, model: "unknown" };
  }
}

/** Synthesize a ResponseCapture from a mock script entry (for uniform capture format). */
function synthesizeResponseCapture(entry: ScriptEntry, outputTokens: number): ResponseCapture {
  if (entry.respond_with === "tool_use" && entry.tool) {
    return {
      stop_reason: "tool_use",
      content_blocks: [{ type: "tool_use", id: `toolu_mock`, name: entry.tool, input: entry.input ?? {} }],
      usage: { output_tokens: outputTokens },
      model: "mock",
    };
  }
  return {
    stop_reason: "end_turn",
    content_blocks: [{ type: "text", text: entry.content ?? "Done." }],
    usage: { output_tokens: outputTokens },
    model: "mock",
  };
}

// ─── Proxy state ──────────────────────────────────────────────────────────────

export interface ProxyState {
  records: InspectionRecord[];
  requestCounter: number;
  /** SHA256 combo → first request_id that set it */
  prefixMap: Map<string, number>;
  scenario: Scenario | null;
  /** Which script entry is next (mock mode) */
  turnCounter: number;
  /** Full parsed request bodies + captured responses for per-request analysis. */
  rawExchanges: Array<{ request_id: number; body: unknown; response?: ResponseCapture }>;
}

export function createState(): ProxyState {
  return { records: [], requestCounter: 0, prefixMap: new Map(), scenario: null, turnCounter: 0, rawExchanges: [] };
}

// ─── Core request handler ─────────────────────────────────────────────────────

interface AnthropicRequestBody {
  model?: string;
  tools?: Array<{ name: string; [k: string]: unknown }>;
  system?: unknown;
  messages?: unknown[];
  max_tokens?: number;
  stream?: boolean;
}

// ─── OpenAI-compat translation ────────────────────────────────────────────────

/** Strip cache_control fields recursively (not supported by OpenAI). */
function stripCacheControl(v: unknown): unknown {
  if (!v || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(stripCacheControl);
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (k !== "cache_control") out[k] = stripCacheControl(val);
  }
  return out;
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return (content as Array<Record<string, unknown>>)
      .filter((b) => b.type === "text")
      .map((b) => b.text as string ?? "")
      .join("");
  }
  return "";
}

interface OAIMessage {
  role: string;
  content: string | null;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

function anthropicMessagesToOpenAI(body: AnthropicRequestBody): { messages: OAIMessage[]; tools: unknown[] } {
  const messages: OAIMessage[] = [];

  // System prompt
  const systemText = contentToText(body.system);
  if (systemText) messages.push({ role: "system", content: systemText });

  for (const rawMsg of body.messages ?? []) {
    const msg = rawMsg as Record<string, unknown>;
    const role = msg.role as string;
    const content = msg.content;

    if (role === "user") {
      if (Array.isArray(content)) {
        const toolResults = (content as Array<Record<string, unknown>>).filter((b) => b.type === "tool_result");
        const textBlocks = (content as Array<Record<string, unknown>>).filter((b) => b.type === "text");
        for (const tr of toolResults) {
          messages.push({
            role: "tool",
            content: typeof tr.content === "string" ? tr.content : contentToText(tr.content),
            tool_call_id: tr.tool_use_id as string,
          });
        }
        const text = textBlocks.map((b) => b.text as string ?? "").join("");
        if (text) messages.push({ role: "user", content: text });
      } else {
        messages.push({ role: "user", content: contentToText(content) });
      }
    } else if (role === "assistant") {
      if (Array.isArray(content)) {
        const textBlocks = (content as Array<Record<string, unknown>>).filter((b) => b.type === "text");
        const toolUse = (content as Array<Record<string, unknown>>).filter((b) => b.type === "tool_use");
        const text = textBlocks.map((b) => b.text as string ?? "").join("") || null;
        const tool_calls = toolUse.map((b) => ({
          id: b.id as string,
          type: "function" as const,
          function: { name: b.name as string, arguments: JSON.stringify(b.input ?? {}) },
        }));
        messages.push({ role: "assistant", content: text, tool_calls: tool_calls.length > 0 ? tool_calls : undefined });
      } else {
        messages.push({ role: "assistant", content: contentToText(content) });
      }
    }
  }

  const tools = (body.tools ?? []).map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: (t as Record<string, unknown>).description,
      parameters: (t as Record<string, unknown>).input_schema ?? {},
    },
  }));

  return { messages, tools };
}

function oaiSseEvent(type: string, data: Record<string, unknown>): Uint8Array {
  const line = `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  return new TextEncoder().encode(line);
}

/** Translate OpenAI streaming response into Anthropic SSE and pipe to writer.
 *  Returns the ResponseCapture equivalent for logging. */
async function translateOpenAIStream(
  oaiBody: ReadableStream<Uint8Array>,
  writer: WritableStreamDefaultWriter<Uint8Array>,
  msgId: string,
  model: string,
): Promise<{ responseCapture: ResponseCapture; first_byte_at: number; last_byte_at: number }> {
  const decoder = new TextDecoder();
  const contentBlocks: ContentBlock[] = [];

  // Block state
  let thinkingIdx = -1;
  let textIdx = -1;
  // OpenAI tool_calls index → Anthropic block index
  const toolCallIdxMap = new Map<number, { anthropicIdx: number; id: string; name: string; args: string }>();
  let nextBlockIdx = 0;

  let stopReason = "end_turn";
  let outputTokens = 0;
  let inputTokens = 0;
  let first_byte_at = 0;
  let buffer = "";

  // Emit message_start
  writer.write(oaiSseEvent("message_start", {
    message: {
      id: msgId, type: "message", role: "assistant", content: [],
      model, stop_reason: null, stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  }));
  writer.write(oaiSseEvent("ping", {}));

  const reader = oaiBody.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (first_byte_at === 0) first_byte_at = Date.now();
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data: ")) continue;
        const jsonStr = trimmed.slice(6);
        if (jsonStr === "[DONE]") continue;
        let chunk: Record<string, unknown>;
        try { chunk = JSON.parse(jsonStr); } catch { continue; }

        const choice = (chunk.choices as Array<Record<string, unknown>>)?.[0];
        const delta = (choice?.delta ?? {}) as Record<string, unknown>;
        const finishReason = choice?.finish_reason as string | null;
        const usage = chunk.usage as Record<string, unknown> | undefined;

        // reasoning_content → thinking block
        if (delta.reasoning_content) {
          if (thinkingIdx === -1) {
            thinkingIdx = nextBlockIdx++;
            writer.write(oaiSseEvent("content_block_start", {
              index: thinkingIdx, content_block: { type: "thinking", thinking: "" },
            }));
          }
          writer.write(oaiSseEvent("content_block_delta", {
            index: thinkingIdx, delta: { type: "thinking_delta", thinking: delta.reasoning_content },
          }));
        }

        // content → text block
        if (delta.content) {
          // Close thinking block if open (reasoning ended, text starting)
          if (thinkingIdx !== -1 && textIdx === -1) {
            writer.write(oaiSseEvent("content_block_stop", { index: thinkingIdx }));
          }
          if (textIdx === -1) {
            textIdx = nextBlockIdx++;
            writer.write(oaiSseEvent("content_block_start", {
              index: textIdx, content_block: { type: "text", text: "" },
            }));
          }
          writer.write(oaiSseEvent("content_block_delta", {
            index: textIdx, delta: { type: "text_delta", text: delta.content },
          }));
        }

        // tool_calls → tool_use blocks
        if (delta.tool_calls) {
          // Close thinking if open
          if (thinkingIdx !== -1 && textIdx === -1 && toolCallIdxMap.size === 0) {
            writer.write(oaiSseEvent("content_block_stop", { index: thinkingIdx }));
          }
          // Close text if open
          if (textIdx !== -1) {
            writer.write(oaiSseEvent("content_block_stop", { index: textIdx }));
          }
          for (const tc of delta.tool_calls as Array<Record<string, unknown>>) {
            const oaiIdx = tc.index as number;
            const fn = (tc.function ?? {}) as Record<string, unknown>;
            if (!toolCallIdxMap.has(oaiIdx)) {
              const aIdx = nextBlockIdx++;
              const id = (tc.id as string) ?? `toolu_${oaiIdx}`;
              const name = (fn.name as string) ?? "";
              toolCallIdxMap.set(oaiIdx, { anthropicIdx: aIdx, id, name, args: "" });
              writer.write(oaiSseEvent("content_block_start", {
                index: aIdx, content_block: { type: "tool_use", id, name, input: {} },
              }));
            }
            if (fn.arguments) {
              const entry = toolCallIdxMap.get(oaiIdx)!;
              entry.args += fn.arguments as string;
              writer.write(oaiSseEvent("content_block_delta", {
                index: entry.anthropicIdx, delta: { type: "input_json_delta", partial_json: fn.arguments },
              }));
            }
          }
        }

        if (finishReason) {
          stopReason = finishReason === "tool_calls" ? "tool_use" : "end_turn";
        }
        if (usage) {
          inputTokens = (usage.prompt_tokens as number) ?? 0;
          outputTokens = (usage.completion_tokens as number) ?? 0;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  const last_byte_at = Date.now();

  // Close all open blocks
  if (thinkingIdx !== -1 && textIdx === -1 && toolCallIdxMap.size === 0) {
    writer.write(oaiSseEvent("content_block_stop", { index: thinkingIdx }));
  }
  if (textIdx !== -1) {
    writer.write(oaiSseEvent("content_block_stop", { index: textIdx }));
  }
  for (const [, entry] of toolCallIdxMap) {
    writer.write(oaiSseEvent("content_block_stop", { index: entry.anthropicIdx }));
  }

  writer.write(oaiSseEvent("message_delta", {
    delta: { stop_reason: stopReason, stop_sequence: null },
    usage: { output_tokens: outputTokens },
  }));
  writer.write(oaiSseEvent("message_stop", {}));
  writer.close().catch(() => {});

  // Build content blocks array for capture
  if (thinkingIdx !== -1) contentBlocks.push({ type: "thinking", thinking: "[streamed]" });
  if (textIdx !== -1) contentBlocks.push({ type: "text", text: "[streamed]" });
  for (const [, entry] of toolCallIdxMap) {
    let input: unknown = {};
    try { if (entry.args) input = JSON.parse(entry.args); } catch { /* keep empty */ }
    contentBlocks.push({ type: "tool_use", id: entry.id, name: entry.name, input });
  }

  const responseCapture: ResponseCapture = {
    stop_reason: stopReason,
    content_blocks: contentBlocks,
    usage: { output_tokens: outputTokens, input_tokens: inputTokens },
    model,
  };

  return { responseCapture, first_byte_at: first_byte_at || last_byte_at, last_byte_at };
}

async function handleOpenAICompatRequest(
  _req: Request,
  provider: ProviderConfig,
  body: AnthropicRequestBody,
  record: InspectionRecord,
  state: ProxyState,
  reqId: number,
  request_received_at: number,
): Promise<Response> {
  const backendUrl = provider.backendUrl ?? "";
  const { messages, tools } = anthropicMessagesToOpenAI(body);
  const strippedMessages = stripCacheControl(messages) as OAIMessage[];

  // Use model_key (e.g. "qwen/qwen3.5-35b-a3b") as the actual backend model ID.
  // body.model is the qualified engine model (e.g. "openai-qwen35-35b/qwen3.5-35b-a3b").
  const backendModel = provider.model_key ?? (body.model?.includes("/") ? body.model.split("/").slice(1).join("/") : body.model) ?? "default";

  // Cap max_tokens so input + output fits within context_length (if configured).
  let maxTokens = body.max_tokens ?? 8192;
  if (provider.context_length) {
    // Rough token count: sum of message string lengths / 4
    const inputEst = JSON.stringify(strippedMessages).length >> 2;
    const available = provider.context_length - inputEst - 256; // 256 safety margin
    if (available < maxTokens) maxTokens = Math.max(512, available);
  }

  const oaiBody: Record<string, unknown> = {
    model: backendModel,
    messages: strippedMessages,
    tools: tools.length > 0 ? tools : undefined,
    max_tokens: maxTokens,
    stream: true,
  };
  // Pass context length override to LM Studio (overrides loaded model context window).
  if (provider.context_length) oaiBody.num_ctx = provider.context_length;

  const oaiBodyStr = JSON.stringify(oaiBody);
  const oaiBodyBytes = new TextEncoder().encode(oaiBodyStr);

  const headers = new Headers({
    "content-type": "application/json",
    "content-length": oaiBodyBytes.length.toString(),
    "accept-encoding": "identity",
  });
  if (provider.api_key) headers.set("authorization", `Bearer ${provider.api_key}`);

  const backendResp = await fetch(`${backendUrl}/v1/chat/completions`, {
    method: "POST",
    headers,
    body: oaiBodyBytes,
  });

  if (!backendResp.ok || !backendResp.body) {
    const errText = await backendResp.text().catch(() => "no body");
    console.error(`[proxy:openai] backend error ${backendResp.status}: ${errText.slice(0, 200)}`);
    return new Response(errText, { status: backendResp.status, headers: { "Content-Type": "application/json" } });
  }

  const msgId = `msg_oai_${reqId}`;
  const model = body.model ?? "unknown";
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();

  (async () => {
    const { responseCapture, first_byte_at, last_byte_at } = await translateOpenAIStream(
      backendResp.body!, writer, msgId, model,
    );

    const timing: RequestTiming = {
      request_received_at,
      first_byte_at,
      last_byte_at,
      ttfb_ms: first_byte_at - request_received_at,
      duration_ms: last_byte_at - request_received_at,
    };

    // Patch record cost with actual output tokens
    if (responseCapture.usage.output_tokens > 0) {
      const rates = provider.pricing ?? PRICING;
      record.cost.output_tokens = responseCapture.usage.output_tokens;
      record.cost.output_cost = (responseCapture.usage.output_tokens / 1_000_000) * rates.output;
      record.cost.total_cost = record.cost.input_cost + record.cost.cache_write_cost +
        record.cost.cache_read_cost + record.cost.output_cost;
    }
    if (responseCapture.usage.input_tokens) {
      const rates = provider.pricing ?? PRICING;
      record.cost.messages_tokens = responseCapture.usage.input_tokens;
      record.cost.input_cost = (responseCapture.usage.input_tokens / 1_000_000) * rates.input;
    }

    record.response = responseCapture;
    record.timing = timing;
    state.rawExchanges.push({ request_id: reqId, body, response: responseCapture });

    // Log thinking summary
    const thinkingBlock = responseCapture.content_blocks.find((b) => b.type === "thinking");
    if (thinkingBlock) {
      console.log(`[openai:thinking] block present — ${responseCapture.content_blocks.length} total blocks`);
    }
    if (responseCapture.usage.output_tokens > 0 && responseCapture.content_blocks.length === 0) {
      console.log(`[proxy:empty] ${responseCapture.usage.output_tokens} output tokens but 0 content blocks (openai mode)`);
    }
  })().catch((e) => {
    console.error("[proxy:openai] stream translation error:", e);
    writer.close().catch(() => {});
  });

  return new Response(readable, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}

async function handleRequest(
  req: Request,
  provider: ProviderConfig,
  state: ProxyState,
): Promise<Response> {
  if (req.method !== "POST" || new URL(req.url).pathname !== "/v1/messages") {
    return new Response("Not found", { status: 404 });
  }

  // ── Timing: request received ──
  const request_received_at = Date.now();

  // Clone body for inspection before forwarding
  const rawBody = await req.text();
  let body: AnthropicRequestBody = {};
  try {
    body = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  // ── Inspection ──
  state.requestCounter += 1;
  const reqId = state.requestCounter;
  const tHash = toolsHash(body.tools ?? []);
  const sHash = systemHash(body.system);
  const cacheControlPresent = rawBody.includes('"cache_control"');
  const prefixKey = `${tHash}:${sHash}`;
  const label = req.headers.get("x-agent-label") ?? "parent";

  // ── Cache simulation ──
  const cacheHit = state.prefixMap.has(prefixKey);
  if (!cacheHit) {
    state.prefixMap.set(prefixKey, reqId);
  }

  // ── Token estimation ──
  const tokens = estimateTokens(body);
  const prefixTokens = tokens.tools_tokens + tokens.system_tokens;
  const deltaTokens = tokens.messages_tokens;

  // ── Synthetic usage (derived from token estimates) ──
  const syntheticUsage = cacheHit
    ? { cache_read_input_tokens: prefixTokens, cache_creation_input_tokens: 0, input_tokens: deltaTokens }
    : { cache_read_input_tokens: 0, cache_creation_input_tokens: prefixTokens, input_tokens: deltaTokens };

  const isMock = provider.type === "mock";

  // ── Mock mode: get script entry to estimate output tokens ──
  let mockEntry: ScriptEntry | null = null;
  if (isMock) {
    const script = state.scenario?.script?.filter((e) => !e.role || e.role !== "user") ?? [];
    mockEntry = script[state.turnCounter] ?? { respond_with: "text", content: "Script exhausted." };
    state.turnCounter += 1;
  }

  const outputTokens = mockEntry ? estimateOutputTokens(mockEntry) : 0;
  const cost = estimateCost(tokens, cacheHit, outputTokens, provider.pricing);

  const record: InspectionRecord = {
    request_id: reqId,
    tools_count: body.tools?.length ?? 0,
    tools_names: (body.tools ?? []).map((t) => t.name),
    tools_hash: tHash,
    system_hash: sHash,
    cache_control_present: cacheControlPresent,
    max_tokens: body.max_tokens ?? 0,
    message_count: body.messages?.length ?? 0,
    timestamp: new Date().toISOString(),
    cache_hit: cacheHit,
    label,
    model: body.model ?? "unknown",
    cost,
  };
  state.records.push(record);

  console.log(JSON.stringify({ ...record, provider_id: provider.id }));

  // ── Mock mode: return scripted response ──
  if (isMock) {
    const sseBody = mockEntry!.respond_with
      ? generateMockSse(mockEntry!, syntheticUsage)
      : fallbackMockSse();

    // Synthesize response capture and timing for uniform format
    const responseCapture = synthesizeResponseCapture(mockEntry!, outputTokens);
    record.response = responseCapture;
    record.timing = {
      request_received_at,
      first_byte_at: request_received_at,
      last_byte_at: request_received_at,
      ttfb_ms: 0,
      duration_ms: 0,
    };
    state.rawExchanges.push({ request_id: reqId, body, response: responseCapture });

    return new Response(sseBody, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  }

  // ── OpenAI-compat mode: translate Anthropic → OpenAI → Anthropic ──
  if (provider.type === "openai") {
    return handleOpenAICompatRequest(req, provider, body, record, state, reqId, request_received_at);
  }

  // ── Local / live mode: forward to backend ──
  const backendUrl = provider.backendUrl ?? "";
  // Restore explicit Content-Length so Bun uses identity framing (not chunked).
  const bodyBytes = new TextEncoder().encode(rawBody);
  // Hop-by-hop headers must not be forwarded by a proxy (RFC 7230 §6.1).
  // Use a Headers instance for proper case-insensitive deduplication.
  const HOP_BY_HOP = new Set(["host", "content-length", "connection", "keep-alive",
    "proxy-authenticate", "proxy-authorization", "te", "trailers", "transfer-encoding", "upgrade"]);
  const forwardHeaders = new Headers();
  forwardHeaders.set("content-type", "application/json");
  forwardHeaders.set("content-length", bodyBytes.length.toString());
  for (const [k, v] of req.headers.entries()) {
    if (!HOP_BY_HOP.has(k.toLowerCase()) && k.toLowerCase() !== "content-type") {
      forwardHeaders.set(k, v);
    }
  }
  // Override x-api-key with the real key from provider config (the engine sends
  // a fake "refinement-harness" key — the real one lives in providers.yaml).
  if (provider.type === "anthropic" && provider.api_key) {
    forwardHeaders.set("x-api-key", provider.api_key);
  }
  // Disable compression: Anthropic may return gzip-encoded SSE. The proxy
  // streams bytes verbatim back to the engine, which would then try to
  // decompress an already-decompressed (or doubly-encoded) stream → ZlibError.
  forwardHeaders.set("accept-encoding", "identity");

  const backendResp = await fetch(`${backendUrl}/v1/messages`, {
    method: "POST",
    headers: forwardHeaders,
    body: bodyBytes,
  });

  if (!backendResp.ok) {
    const errText = await backendResp.text();
    console.error(`[proxy] backend error ${backendResp.status}: ${errText.slice(0, 200)}`);
    return new Response(errText, { status: backendResp.status, headers: { "Content-Type": "application/json" } });
  }

  if (!backendResp.body) {
    return new Response("No response from backend", { status: 502 });
  }

  // SSE passthrough with chunk accumulation for response capture + timing
  if (backendResp.headers.get("content-type")?.includes("text/event-stream")) {
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();
    const chunks: string[] = [];
    let first_byte_at = 0;

    (async () => {
      const reader = backendResp.body!.getReader();
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });

          // Record timing of first byte
          if (first_byte_at === 0) {
            first_byte_at = Date.now();
          }

          // Accumulate for response parsing
          chunks.push(chunk);

          // Pass through real API response unmodified — real Anthropic cache
          // tokens are preserved for accurate cost tracking.
          await writer.write(encoder.encode(chunk));
        }
      } finally {
        // ── Stream ended: capture response, timing, patch cost ──
        const last_byte_at = Date.now();
        const resolved_first_byte = first_byte_at || last_byte_at;
        const timing: RequestTiming = {
          request_received_at,
          first_byte_at: resolved_first_byte,
          last_byte_at,
          ttfb_ms: resolved_first_byte - request_received_at,
          duration_ms: last_byte_at - request_received_at,
        };

        const accumulated = chunks.join("");
        const responseCapture = parseSseResponse(accumulated);

        // Use real API usage when available (non-mock providers report real
        // cache_read/cache_creation/input tokens from Anthropic's response).
        const realUsage = responseCapture.usage;
        const hasRealUsage = (realUsage.input_tokens ?? 0) > 0
          || (realUsage.cache_creation_input_tokens ?? 0) > 0
          || (realUsage.cache_read_input_tokens ?? 0) > 0;

        if (hasRealUsage) {
          // Recalculate cost from real Anthropic usage numbers
          const rates = provider.pricing ?? PRICING;
          const realInput = realUsage.input_tokens ?? 0;
          const realCacheWrite = realUsage.cache_creation_input_tokens ?? 0;
          const realCacheRead = realUsage.cache_read_input_tokens ?? 0;
          const realOutput = realUsage.output_tokens;

          record.cost.messages_tokens = realInput;
          record.cost.output_tokens = realOutput;
          record.cost.input_cost = (realInput / 1_000_000) * rates.input;
          record.cost.cache_write_cost = (realCacheWrite / 1_000_000) * rates.cache_write;
          record.cost.cache_read_cost = (realCacheRead / 1_000_000) * rates.cache_read;
          record.cost.output_cost = (realOutput / 1_000_000) * rates.output;
          record.cost.total_cost =
            record.cost.input_cost +
            record.cost.cache_write_cost +
            record.cost.cache_read_cost +
            record.cost.output_cost;
        } else if (realUsage.output_tokens > 0) {
          // Fallback: at least patch output tokens (mock or incomplete response)
          const outputRate = provider.pricing?.output ?? PRICING.output;
          record.cost.output_tokens = realUsage.output_tokens;
          record.cost.output_cost = (realUsage.output_tokens / 1_000_000) * outputRate;
          record.cost.total_cost =
            record.cost.input_cost +
            record.cost.cache_write_cost +
            record.cost.cache_read_cost +
            record.cost.output_cost;
        }

        record.response = responseCapture;
        record.timing = timing;
        state.rawExchanges.push({ request_id: reqId, body, response: responseCapture });

        writer.close().catch(() => {});
      }
    })();

    const respHeaders = new Headers(backendResp.headers);
    return new Response(readable, { status: backendResp.status, headers: respHeaders });
  }

  // Non-SSE: pure passthrough (no response capture for non-streaming)
  state.rawExchanges.push({ request_id: reqId, body });
  return new Response(backendResp.body, {
    status: backendResp.status,
    headers: backendResp.headers,
  });
}

// ─── createProxy ──────────────────────────────────────────────────────────────

const DEFAULT_BACKENDS: Record<string, string> = {
  mock: "",
  local: "http://localhost:1234",
  live: "https://api.anthropic.com",
};

export interface ProxyOptions {
  /** Full provider config — preferred. Determines type, backendUrl, and pricing. */
  provider?: ProviderConfig;
  /** Legacy mode string (mock/local/live). Used when provider is not set. */
  mode?: ProxyMode;
  port?: number;
  backendUrl?: string;
}

export function createProxy(options: ProxyOptions): {
  server: ReturnType<typeof Bun.serve>;
  state: ProxyState;
  loadScenario(scenario: Scenario): void;
  resetState(): void;
} {
  const { port = 8999, backendUrl } = options;

  // Resolve provider config — if not provided, synthesize from legacy mode/backendUrl
  const provider: ProviderConfig = options.provider ?? (() => {
    const legacyMode = options.mode ?? "mock";
    const resolvedBackend = backendUrl ?? DEFAULT_BACKENDS[legacyMode] ?? "";
    // Map legacy mode to provider type
    const type = legacyMode === "mock" ? "mock"
      : legacyMode === "local" ? "lmstudio"
      : "anthropic";
    return { id: `legacy-${legacyMode}`, type, backendUrl: resolvedBackend };
  })();

  const resolvedBackend = provider.backendUrl ?? "";
  const state = createState();

  const server = Bun.serve({
    port,
    idleTimeout: 255, // max allowed by Bun — LLM responses can be slow
    fetch(req) {
      return handleRequest(req, provider, state);
    },
  });

  // Forward backend to the forwarding section — need it in handleRequest
  // The provider.backendUrl is used inside handleRequest directly
  void resolvedBackend; // suppress unused warning

  return {
    server,
    state,
    loadScenario(scenario) {
      state.scenario = scenario;
      state.turnCounter = 0;
    },
    resetState() {
      state.records = [];
      state.rawExchanges = [];
      state.prefixMap = new Map();
      state.scenario = null;
      state.turnCounter = 0;
      state.requestCounter = 0;
    },
  };
}

// ─── CLI entry point ──────────────────────────────────────────────────────────

if (import.meta.main) {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i !== -1 && i + 1 < args.length ? args[i + 1] : undefined;
  };
  const mode = (get("--mode") ?? "mock") as ProxyMode;
  const port = parseInt(get("--port") ?? "8999", 10);
  const backendUrl = get("--backend");

  const { server } = createProxy({ mode, port, backendUrl });
  const resolvedBackend = backendUrl ?? DEFAULT_BACKENDS[mode] ?? "(none)";
  console.log(`[proxy] listening on http://localhost:${server.port} mode=${mode} backend=${resolvedBackend}`);
}
