/**
 * Tests for proxy cache usage extraction and the tools-dropped cache break fix.
 */

import { describe, it, expect } from "bun:test";
import { parseSseResponse, estimateOutputTokens } from "../proxy.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sseEvent(type: string, data: Record<string, unknown>): string {
  return `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
}

/** Build a minimal SSE stream with the given usage in message_start. */
function buildSseStream(opts: {
  input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens?: number;
  text?: string;
  stop_reason?: string;
  model?: string;
}): string {
  const events: string[] = [];
  events.push(sseEvent("message_start", {
    message: {
      id: "msg_test",
      type: "message",
      role: "assistant",
      content: [],
      model: opts.model ?? "claude-haiku-4-5-20251001",
      stop_reason: null,
      usage: {
        input_tokens: opts.input_tokens ?? 100,
        output_tokens: 0,
        cache_creation_input_tokens: opts.cache_creation_input_tokens ?? 0,
        cache_read_input_tokens: opts.cache_read_input_tokens ?? 0,
      },
    },
  }));
  const text = opts.text ?? "Hello";
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
    delta: { stop_reason: opts.stop_reason ?? "end_turn" },
    usage: { output_tokens: opts.output_tokens ?? 25 },
  }));
  events.push(sseEvent("message_stop", {}));
  return events.join("");
}

// ─── parseSseResponse tests ──────────────────────────────────────────────────

describe("parseSseResponse", () => {
  it("extracts output_tokens from message_delta", () => {
    const sse = buildSseStream({ output_tokens: 42 });
    const result = parseSseResponse(sse);
    expect(result.usage.output_tokens).toBe(42);
  });

  it("extracts cache_read_input_tokens from message_start (cache hit)", () => {
    const sse = buildSseStream({
      input_tokens: 500,
      cache_read_input_tokens: 30000,
      cache_creation_input_tokens: 0,
    });
    const result = parseSseResponse(sse);
    expect(result.usage.input_tokens).toBe(500);
    expect(result.usage.cache_read_input_tokens).toBe(30000);
    expect(result.usage.cache_creation_input_tokens).toBe(0);
  });

  it("extracts cache_creation_input_tokens from message_start (cache miss)", () => {
    const sse = buildSseStream({
      input_tokens: 500,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 5000,
    });
    const result = parseSseResponse(sse);
    expect(result.usage.input_tokens).toBe(500);
    expect(result.usage.cache_read_input_tokens).toBe(0);
    expect(result.usage.cache_creation_input_tokens).toBe(5000);
  });

  it("extracts model from message_start", () => {
    const sse = buildSseStream({ model: "claude-haiku-4-5-20251001" });
    const result = parseSseResponse(sse);
    expect(result.model).toBe("claude-haiku-4-5-20251001");
  });

  it("extracts text content blocks", () => {
    const sse = buildSseStream({ text: "Hello world" });
    const result = parseSseResponse(sse);
    expect(result.content_blocks.length).toBe(1);
    expect(result.content_blocks[0]).toEqual({ type: "text", text: "Hello world" });
  });

  it("extracts stop_reason from message_delta", () => {
    const sse = buildSseStream({ stop_reason: "tool_use" });
    const result = parseSseResponse(sse);
    expect(result.stop_reason).toBe("tool_use");
  });

  it("handles tool_use content blocks", () => {
    const events: string[] = [];
    events.push(sseEvent("message_start", {
      message: {
        id: "msg_test",
        type: "message",
        role: "assistant",
        content: [],
        model: "claude-haiku-4-5-20251001",
        stop_reason: null,
        usage: { input_tokens: 100, output_tokens: 0 },
      },
    }));
    events.push(sseEvent("content_block_start", {
      index: 0,
      content_block: { type: "tool_use", id: "toolu_123", name: "read_file", input: {} },
    }));
    events.push(sseEvent("content_block_delta", {
      index: 0,
      delta: { type: "input_json_delta", partial_json: '{"path":"src/index.ts"}' },
    }));
    events.push(sseEvent("content_block_stop", { index: 0 }));
    events.push(sseEvent("message_delta", {
      delta: { stop_reason: "tool_use" },
      usage: { output_tokens: 15 },
    }));
    events.push(sseEvent("message_stop", {}));

    const result = parseSseResponse(events.join(""));
    expect(result.content_blocks.length).toBe(1);
    expect(result.content_blocks[0].type).toBe("tool_use");
    if (result.content_blocks[0].type === "tool_use") {
      expect(result.content_blocks[0].name).toBe("read_file");
      expect(result.content_blocks[0].input).toEqual({ path: "src/index.ts" });
    }
  });

  it("returns zero cache tokens when not present in response", () => {
    // Build SSE without cache fields (like a non-Anthropic backend)
    const events: string[] = [];
    events.push(sseEvent("message_start", {
      message: {
        id: "msg_test",
        type: "message",
        role: "assistant",
        content: [],
        model: "local-model",
        stop_reason: null,
        usage: { input_tokens: 100, output_tokens: 0 },
      },
    }));
    events.push(sseEvent("content_block_start", {
      index: 0,
      content_block: { type: "text", text: "" },
    }));
    events.push(sseEvent("content_block_delta", {
      index: 0,
      delta: { type: "text_delta", text: "hi" },
    }));
    events.push(sseEvent("content_block_stop", { index: 0 }));
    events.push(sseEvent("message_delta", {
      delta: { stop_reason: "end_turn" },
      usage: { output_tokens: 5 },
    }));
    events.push(sseEvent("message_stop", {}));

    const result = parseSseResponse(events.join(""));
    expect(result.usage.cache_read_input_tokens).toBe(0);
    expect(result.usage.cache_creation_input_tokens).toBe(0);
    expect(result.usage.input_tokens).toBe(100);
  });

  it("handles malformed SSE gracefully", () => {
    const result = parseSseResponse("not valid sse data");
    expect(result.stop_reason).toBe("unknown");
    expect(result.content_blocks).toEqual([]);
    expect(result.usage.output_tokens).toBe(0);
  });
});

// ─── estimateOutputTokens tests ──────────────────────────────────────────────

describe("estimateOutputTokens", () => {
  it("estimates text response tokens from content length", () => {
    const tokens = estimateOutputTokens({ respond_with: "text", content: "Hello world" });
    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBe(Math.ceil("Hello world".length / 4));
  });

  it("estimates tool_use response tokens from input JSON + overhead", () => {
    const input = { path: "src/index.ts" };
    const tokens = estimateOutputTokens({
      respond_with: "tool_use",
      tool: "read_file",
      input,
    });
    expect(tokens).toBe(Math.ceil(JSON.stringify(input).length / 4) + 20);
  });
});
