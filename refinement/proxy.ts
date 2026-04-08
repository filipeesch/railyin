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
    let model = "unknown";
    const content_blocks: ContentBlock[] = [];

    // Track per-block state for streaming reconstruction
    const blockAccumulators: Record<number, { type: string; id?: string; name?: string; text?: string; json?: string; thinking?: string }> = {};

    for (const event of events) {
      if (event.type === "message_start") {
        const msg = (event.data.message ?? {}) as Record<string, unknown>;
        model = (msg.model as string) ?? "unknown";
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
          content_blocks.push({ type: "thinking", thinking: acc.thinking ?? "" });
        }
      } else if (event.type === "message_delta") {
        const delta = (event.data.delta ?? {}) as Record<string, unknown>;
        stop_reason = (delta.stop_reason as string) ?? stop_reason;
        const usage = (event.data.usage ?? {}) as Record<string, unknown>;
        output_tokens = (usage.output_tokens as number) ?? 0;
      }
    }

    return { stop_reason, content_blocks, usage: { output_tokens }, model };
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
    let injected = false;
    let first_byte_at = 0;

    (async () => {
      const reader = backendResp.body!.getReader();
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          let chunk = decoder.decode(value, { stream: true });

          // Record timing of first byte
          if (first_byte_at === 0) {
            first_byte_at = Date.now();
          }

          // Accumulate for response parsing
          chunks.push(chunk);

          // Inject synthetic cache usage into the first message_start event
          if (!injected && chunk.includes('"message_start"')) {
            injected = true;
            try {
              chunk = chunk.replace(
                /"usage":\s*\{[^}]*\}/,
                `"usage":{"input_tokens":${syntheticUsage.input_tokens},"output_tokens":0,"cache_creation_input_tokens":${syntheticUsage.cache_creation_input_tokens},"cache_read_input_tokens":${syntheticUsage.cache_read_input_tokens}}`,
              );
            } catch { /* leave chunk as-is */ }
          }

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

        // Patch output_tokens and recalculate cost with real value
        const realOutputTokens = responseCapture.usage.output_tokens;
        if (realOutputTokens > 0) {
          const outputRate = provider.pricing?.output ?? PRICING.output;
          record.cost.output_tokens = realOutputTokens;
          record.cost.output_cost = (realOutputTokens / 1_000_000) * outputRate;
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
