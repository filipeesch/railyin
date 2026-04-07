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
import type { CostEstimate, InspectionRecord, ProxyMode, Scenario, ScriptEntry } from "./types.ts";

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

// Anthropic Sonnet pricing per million tokens
const PRICING = {
  input: 3.0,
  cache_write: 6.0,
  cache_read: 0.30,
  output: 15.0,
} as const;

function estimateCost(tokens: TokenBreakdown, cacheHit: boolean, outputTokens: number): CostEstimate {
  const prefixTokens = tokens.tools_tokens + tokens.system_tokens;
  const deltaTokens = tokens.messages_tokens;
  const cacheWriteTokens = cacheHit ? 0 : prefixTokens;
  const cacheReadTokens = cacheHit ? prefixTokens : 0;

  const input_cost = (deltaTokens / 1_000_000) * PRICING.input;
  const cache_write_cost = (cacheWriteTokens / 1_000_000) * PRICING.cache_write;
  const cache_read_cost = (cacheReadTokens / 1_000_000) * PRICING.cache_read;
  const output_cost = (outputTokens / 1_000_000) * PRICING.output;
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

// ─── Proxy state ──────────────────────────────────────────────────────────────

export interface ProxyState {
  records: InspectionRecord[];
  requestCounter: number;
  /** SHA256 combo → first request_id that set it */
  prefixMap: Map<string, number>;
  scenario: Scenario | null;
  /** Which script entry is next (mock mode) */
  turnCounter: number;
  /** Full parsed request bodies for per-request analysis. */
  rawRequests: Array<{ request_id: number; body: unknown }>;
}

export function createState(): ProxyState {
  return { records: [], requestCounter: 0, prefixMap: new Map(), scenario: null, turnCounter: 0, rawRequests: [] };
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
  mode: ProxyMode,
  backendUrl: string,
  state: ProxyState,
): Promise<Response> {
  if (req.method !== "POST" || new URL(req.url).pathname !== "/v1/messages") {
    return new Response("Not found", { status: 404 });
  }

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

  // ── Mock mode: get script entry to estimate output tokens ──
  let mockEntry: ScriptEntry | null = null;
  if (mode === "mock") {
    const script = state.scenario?.script?.filter((e) => !e.role || e.role !== "user") ?? [];
    mockEntry = script[state.turnCounter] ?? { respond_with: "text", content: "Script exhausted." };
    state.turnCounter += 1;
  }

  const outputTokens = mockEntry ? estimateOutputTokens(mockEntry) : 0;
  const cost = estimateCost(tokens, cacheHit, outputTokens);

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
  state.rawRequests.push({ request_id: reqId, body });

  console.log(JSON.stringify({ ...record, mode }));

  // ── Mock mode: return scripted response ──
  if (mode === "mock") {
    const sseBody = mockEntry!.respond_with
      ? generateMockSse(mockEntry!, syntheticUsage)
      : fallbackMockSse();

    return new Response(sseBody, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  }

  // ── Local / live mode: forward to backend ──
  const forwardHeaders: Record<string, string> = { "Content-Type": "application/json" };
  for (const [k, v] of req.headers.entries()) {
    if (k.toLowerCase() !== "host" && k.toLowerCase() !== "content-length") {
      forwardHeaders[k] = v;
    }
  }

  const backendResp = await fetch(`${backendUrl}/v1/messages`, {
    method: "POST",
    headers: forwardHeaders,
    body: rawBody,
  });

  if (!backendResp.body) {
    return new Response("No response from backend", { status: 502 });
  }

  // SSE passthrough — inject synthetic usage into message_start for local mode
  if (mode === "local" && backendResp.headers.get("content-type")?.includes("text/event-stream")) {
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();
    let injected = false;

    (async () => {
      const reader = backendResp.body!.getReader();
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          let chunk = decoder.decode(value, { stream: true });
          // Inject cache usage stats into the first message_start event
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
        writer.close().catch(() => {});
      }
    })();

    const respHeaders = new Headers(backendResp.headers);
    return new Response(readable, { status: backendResp.status, headers: respHeaders });
  }

  // Live mode or non-SSE: pure passthrough
  return new Response(backendResp.body, {
    status: backendResp.status,
    headers: backendResp.headers,
  });
}

// ─── createProxy ──────────────────────────────────────────────────────────────

const DEFAULT_BACKENDS: Record<ProxyMode, string> = {
  mock: "",
  local: "http://localhost:1234",
  live: "https://api.anthropic.com",
};

export interface ProxyOptions {
  mode: ProxyMode;
  port?: number;
  backendUrl?: string;
}

export function createProxy(options: ProxyOptions): {
  server: ReturnType<typeof Bun.serve>;
  state: ProxyState;
  loadScenario(scenario: Scenario): void;
  resetState(): void;
} {
  const { mode, port = 8999, backendUrl } = options;
  const resolvedBackend = backendUrl ?? DEFAULT_BACKENDS[mode];
  const state = createState();

  const server = Bun.serve({
    port,
    fetch(req) {
      return handleRequest(req, mode, resolvedBackend, state);
    },
  });

  return {
    server,
    state,
    loadScenario(scenario) {
      state.scenario = scenario;
      state.turnCounter = 0;
    },
    resetState() {
      state.records = [];
      state.rawRequests = [];
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
  console.log(`[proxy] listening on http://localhost:${server.port} mode=${mode} backend=${backendUrl ?? (DEFAULT_BACKENDS[mode] || "(none)")}`);
}
