/**
 * Provider integration tests (tasks 5.1–5.9).
 *
 * Uses `Bun.serve()` to create local mock HTTP servers that speak the Anthropic
 * and OpenAI-compatible wire formats. No real network calls are made.
 */

import { describe, it, expect, afterEach, beforeEach } from "bun:test";
import { adaptMessages, adaptTools, AnthropicProvider, isEmptyAssistantMessage } from "../ai/anthropic.ts";
import { resolveProvider, UnresolvableProviderError, clearProviderCache, listOpenAICompatibleModels } from "../ai/index.ts";
import { OpenAICompatibleProvider } from "../ai/openai-compatible.ts";
import type { ProviderConfig } from "../config/index.ts";
import type { AIMessage, AIToolDefinition } from "../ai/types.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fakeProviders(overrides: Partial<ProviderConfig>[] = []): ProviderConfig[] {
  return [
    { id: "fake", type: "fake" } as ProviderConfig,
    ...overrides,
  ];
}

/** Build a minimal SSE chunk string the Anthropic streaming endpoint would emit. */
function anthropicSse(events: Array<{ type: string; data: Record<string, unknown> }>): string {
  return events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify({ type: e.type, ...e.data })}\n\n`).join("");
}

beforeEach(() => clearProviderCache());
afterEach(() => clearProviderCache());

// ─────────────────────────────────────────────────────────────────────────────
// 5.1 & 5.2 — resolveProvider
// ─────────────────────────────────────────────────────────────────────────────

describe("resolveProvider", () => {
  it("5.1 returns the correct provider and bare model for a known provider", () => {
    const providers = fakeProviders([{ id: "lmstudio", type: "lmstudio", base_url: "http://localhost:1234/v1" } as ProviderConfig]);
    const { model } = resolveProvider("lmstudio/qwen3-8b", providers);
    expect(model).toBe("qwen3-8b");
  });

  it("5.1 resolves fake provider for qualified 'fake/fake'", () => {
    const { provider, model } = resolveProvider("fake/fake", fakeProviders());
    expect(model).toBe("fake");
    expect(typeof provider.stream).toBe("function");
  });

  it("5.2 throws UnresolvableProviderError for null model", () => {
    expect(() => resolveProvider(null, fakeProviders())).toThrow(UnresolvableProviderError);
  });

  it("5.2 throws UnresolvableProviderError for empty string", () => {
    expect(() => resolveProvider("", fakeProviders())).toThrow(UnresolvableProviderError);
  });

  it("5.2 throws UnresolvableProviderError for model with no slash", () => {
    expect(() => resolveProvider("qwen3-8b", fakeProviders())).toThrow(UnresolvableProviderError);
  });

  it("5.2 throws UnresolvableProviderError for unknown provider prefix", () => {
    expect(() => resolveProvider("openai/gpt-4o", fakeProviders())).toThrow(UnresolvableProviderError);
    expect(() => resolveProvider("openai/gpt-4o", fakeProviders())).toThrow(/openai/);
  });

  it("5.1 caches the provider instance between calls", () => {
    const providers = fakeProviders();
    const { provider: a } = resolveProvider("fake/fake", providers);
    const { provider: b } = resolveProvider("fake/fake", providers);
    expect(a).toBe(b); // same reference
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5.7 — adaptMessages: system message extraction
// ─────────────────────────────────────────────────────────────────────────────

describe("adaptMessages — system extraction (5.7)", () => {
  it("moves system messages to the system field", () => {
    const messages: AIMessage[] = [
      { role: "system", content: "You are helpful." },
      { role: "user", content: "Hello" },
    ];
    const { system, messages: adapted } = adaptMessages(messages);
    expect(Array.isArray(system)).toBe(true);
    expect(system![0].type).toBe("text");
    expect(system![0].text).toBe("You are helpful.");
    expect(adapted).toHaveLength(1);
    expect(adapted[0].role).toBe("user");
  });

  it("concatenates multiple system messages", () => {
    const messages: AIMessage[] = [
      { role: "system", content: "Instruction A." },
      { role: "system", content: "Instruction B." },
      { role: "user", content: "Go." },
    ];
    const { system } = adaptMessages(messages);
    expect(Array.isArray(system)).toBe(true);
    expect(system![0].text).toContain("Instruction A.");
    expect(system![0].text).toContain("Instruction B.");
  });

  it("returns undefined system when no system messages", () => {
    const messages: AIMessage[] = [{ role: "user", content: "Hi" }];
    const { system } = adaptMessages(messages);
    expect(system).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5.8 — adaptMessages: tool result mapping
// ─────────────────────────────────────────────────────────────────────────────

describe("adaptMessages — tool result mapping (5.8)", () => {
  it("converts role:tool to role:user with tool_result block", () => {
    const messages: AIMessage[] = [
      { role: "user", content: "Call a tool." },
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "call_1", type: "function", function: { name: "read_file", arguments: "{}" } }],
      },
      { role: "tool", content: "file contents here", tool_call_id: "call_1" },
    ];
    const { messages: adapted } = adaptMessages(messages);
    const toolResultMsg = adapted.find((m) => Array.isArray(m.content) && (m.content as Array<{ type: string }>).some((b) => b.type === "tool_result"));
    expect(toolResultMsg).not.toBeUndefined();
    expect(toolResultMsg!.role).toBe("user");
    const block = (toolResultMsg!.content as Array<{ type: string; tool_use_id: string; content: string }>).find((b) => b.type === "tool_result");
    expect(block!.tool_use_id).toBe("call_1");
    expect(block!.content).toContain("file contents here");
  });

  it("maps assistant tool_calls to tool_use content blocks", () => {
    const messages: AIMessage[] = [
      {
        role: "assistant",
        content: null,
        tool_calls: [
          { id: "t1", type: "function", function: { name: "list_dir", arguments: '{"path":"/"}' } },
        ],
      },
    ];
    const { messages: adapted } = adaptMessages(messages);
    expect(adapted).toHaveLength(1);
    expect(adapted[0].role).toBe("assistant");
    const blocks = adapted[0].content as Array<{ type: string; id: string; name: string }>;
    expect(Array.isArray(blocks)).toBe(true);
    const toolUse = blocks.find((b) => b.type === "tool_use");
    expect(toolUse!.id).toBe("t1");
    expect(toolUse!.name).toBe("list_dir");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// adaptTools
// ─────────────────────────────────────────────────────────────────────────────

describe("adaptTools", () => {
  it("maps parameters to input_schema", () => {
    const tools: AIToolDefinition[] = [
      {
        name: "read_file",
        description: "Read a file",
        parameters: {
          type: "object",
          properties: { path: { type: "string", description: "File path" } },
          required: ["path"],
        },
      },
    ];
    const adapted = adaptTools(tools);
    expect(adapted).toHaveLength(1);
    expect(adapted[0].input_schema.properties).toEqual(tools[0].parameters.properties);
    expect(adapted[0].input_schema.required).toEqual(["path"]);
  });

  it("3.1 sets strict: true on all output tools", () => {
    const tools: AIToolDefinition[] = [
      {
        name: "tool_a",
        description: "Tool A",
        parameters: { type: "object", properties: { x: { type: "string", description: "x" } }, required: ["x"] },
      },
      {
        name: "tool_b",
        description: "Tool B",
        parameters: { type: "object", properties: { y: { type: "number", description: "y" } }, required: [] },
      },
    ];
    const adapted = adaptTools(tools);
    for (const tool of adapted) {
      expect(tool.strict).toBe(true);
    }
  });

  it("3.2 sets additionalProperties: false on all input_schema objects", () => {
    const tools: AIToolDefinition[] = [
      {
        name: "tool_a",
        description: "Tool A",
        parameters: { type: "object", properties: { x: { type: "string", description: "x" } }, required: ["x"] },
      },
      {
        name: "tool_b",
        description: "Tool B",
        parameters: { type: "object", properties: { y: { type: "number", description: "y" } }, required: [] },
      },
    ];
    const adapted = adaptTools(tools);
    for (const tool of adapted) {
      expect(tool.input_schema.additionalProperties).toBe(false);
    }
  });

  it("3.3 last tool gets cache_control when cacheTtl is set", () => {
    const tools: AIToolDefinition[] = [
      {
        name: "tool_a",
        description: "A",
        parameters: { type: "object", properties: { x: { type: "string", description: "x" } }, required: ["x"] },
      },
      {
        name: "tool_b",
        description: "B",
        parameters: { type: "object", properties: { y: { type: "string", description: "y" } }, required: ["y"] },
      },
    ];
    const adapted5m = adaptTools(tools, "5m");
    expect(adapted5m[0].cache_control).toBeUndefined();
    expect(adapted5m[1].cache_control).toEqual({ type: "ephemeral" });

    const adapted1h = adaptTools(tools, "1h");
    expect(adapted1h[1].cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
  });

  it("3.4 no cache_control on any tool when cacheTtl is absent", () => {
    const tools: AIToolDefinition[] = [
      {
        name: "tool_a",
        description: "A",
        parameters: { type: "object", properties: { x: { type: "string", description: "x" } }, required: ["x"] },
      },
    ];
    const adapted = adaptTools(tools);
    expect(adapted[0].cache_control).toBeUndefined();
  });

  it("3.5 injects additionalProperties: false on nested object properties", () => {
    const tools: AIToolDefinition[] = [
      {
        name: "tool_nested",
        description: "Tool with nested object",
        parameters: {
          type: "object",
          properties: {
            meta: {
              type: "object",
              description: "Nested metadata",
              properties: { key: { type: "string", description: "A key" } },
            },
          },
          required: ["meta"],
        },
      },
    ];
    const adapted = adaptTools(tools);
    const nestedMeta = (adapted[0].input_schema.properties as Record<string, Record<string, unknown>>)["meta"];
    expect(nestedMeta.additionalProperties).toBe(false);
  });

  it("3.6 injects additionalProperties: false on objects nested inside array items", () => {
    const tools: AIToolDefinition[] = [
      {
        name: "tool_array",
        description: "Tool with array of objects",
        parameters: {
          type: "object",
          properties: {
            items: {
              type: "array",
              description: "Array of items",
              items: {
                type: "object",
                properties: { label: { type: "string", description: "Label" } },
                required: ["label"],
              },
            },
          },
          required: ["items"],
        },
      },
    ];
    const adapted = adaptTools(tools);
    const arrayProp = (adapted[0].input_schema.properties as Record<string, Record<string, unknown>>)["items"];
    const arrayItems = arrayProp.items as Record<string, unknown>;
    expect(arrayItems.additionalProperties).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4.1–4.3 — Prompt caching: adaptMessages() cache breakpoints
// ─────────────────────────────────────────────────────────────────────────────

describe("adaptMessages — prompt caching (4.1–4.3)", () => {
  it("4.1 system is an array and the last block carries cache_control", () => {
    const messages: AIMessage[] = [
      { role: "system", content: "You are a helpful assistant with many capabilities." },
      { role: "user", content: "Hello" },
    ];
    const { system } = adaptMessages(messages);
    expect(Array.isArray(system)).toBe(true);
    expect(system!.length).toBeGreaterThan(0);
    const lastBlock = system![system!.length - 1];
    expect(lastBlock.cache_control).toEqual({ type: "ephemeral" });
  });

  it("4.2 conversation breakpoint on 5th-from-last user message", () => {
    // Build 8 user messages (tool-loop style)
    const longContent = "a".repeat(200);
    const messages: AIMessage[] = [];
    for (let i = 0; i < 8; i++) {
      messages.push({ role: "user", content: longContent });
      messages.push({ role: "assistant", content: `reply ${i}` });
    }
    const { messages: adapted } = adaptMessages(messages);
    const userMsgs = adapted.filter((m) => m.role === "user");
    // 5th-from-last user message index in userMsgs = 8 - 5 = 3
    const targetIdx = Math.max(0, userMsgs.length - 5);
    const targetMsg = userMsgs[targetIdx];
    expect(Array.isArray(targetMsg.content)).toBe(true);
    const blocks = targetMsg.content as Array<{ type: string; cache_control?: { type: string } }>;
    const lastBlock = blocks[blocks.length - 1];
    expect(lastBlock.cache_control).toEqual({ type: "ephemeral" });
  });

  it("4.2 conversation breakpoint falls back to earliest user message for short conversations", () => {
    const longContent = "a".repeat(200);
    const messages: AIMessage[] = [
      { role: "user", content: longContent },
      { role: "assistant", content: "reply" },
      { role: "user", content: longContent },
    ];
    const { messages: adapted } = adaptMessages(messages);
    const firstUser = adapted[0];
    expect(Array.isArray(firstUser.content)).toBe(true);
    const blocks = firstUser.content as Array<{ type: string; cache_control?: { type: string } }>;
    expect(blocks[blocks.length - 1].cache_control).toEqual({ type: "ephemeral" });
  });

  it("4.2 conversation breakpoint is set even for short user messages (sub-agent case)", () => {
    // Short content (< 100 chars) should still get cache_control — Anthropic silently
    // ignores it if below minimum cacheable tokens, but there is no penalty.
    const messages: AIMessage[] = [
      { role: "user", content: "short" },
      { role: "assistant", content: "reply" },
    ];
    const { messages: adapted } = adaptMessages(messages);
    const firstUser = adapted[0];
    expect(Array.isArray(firstUser.content)).toBe(true);
    const blocks = firstUser.content as Array<{ type: string; cache_control?: unknown }>;
    expect(blocks[blocks.length - 1].cache_control).toEqual({ type: "ephemeral" });
  });

  it("4.3 no system messages produces undefined system", () => {
    const messages: AIMessage[] = [{ role: "user", content: "Hi" }];
    const { system } = adaptMessages(messages);
    expect(system).toBeUndefined();
  });

  it("4.3 system with content produces a single-block array with cache_control", () => {
    const messages: AIMessage[] = [
      { role: "system", content: "Be concise." },
      { role: "user", content: "Go." },
    ];
    const { system } = adaptMessages(messages);
    expect(Array.isArray(system)).toBe(true);
    expect(system!.length).toBe(1);
    expect(system![0].cache_control).toEqual({ type: "ephemeral" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3.1–3.2 — Extended cache TTL: adaptMessages() respects cacheTtl param
// ─────────────────────────────────────────────────────────────────────────────

describe("adaptMessages — extended cache TTL (3.1–3.2)", () => {
  it("3.1 cache_control has no ttl field when cacheTtl is absent", () => {
    const messages: AIMessage[] = [
      { role: "system", content: "You are helpful." },
      { role: "user", content: "Hello" },
    ];
    const { system } = adaptMessages(messages);
    expect(system![0].cache_control).toEqual({ type: "ephemeral" });
    expect(system![0].cache_control!.ttl).toBeUndefined();
  });

  it("3.1 cache_control has no ttl field when cacheTtl is '5m'", () => {
    const messages: AIMessage[] = [
      { role: "system", content: "You are helpful." },
      { role: "user", content: "Hello" },
    ];
    const { system } = adaptMessages(messages, "5m");
    expect(system![0].cache_control).toEqual({ type: "ephemeral" });
    expect(system![0].cache_control!.ttl).toBeUndefined();
  });

  it("3.2 cache_control includes ttl: '1h' when cacheTtl is '1h'", () => {
    const messages: AIMessage[] = [
      { role: "system", content: "You are helpful." },
      { role: "user", content: "Hello" },
    ];
    const { system } = adaptMessages(messages, "1h");
    expect(system![0].cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
  });

  it("3.2 conversation breakpoint also gets ttl: '1h' when cacheTtl is '1h'", () => {
    const longContent = "a".repeat(200);
    const messages: AIMessage[] = [
      { role: "user", content: longContent },
      { role: "assistant", content: "reply" },
    ];
    const { messages: adapted } = adaptMessages(messages, "1h");
    const firstUser = adapted[0];
    const blocks = firstUser.content as Array<{ type: string; cache_control?: { type: string; ttl?: string } }>;
    expect(blocks[blocks.length - 1].cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5.3 — AnthropicProvider.stream(): text-only response
// ─────────────────────────────────────────────────────────────────────────────

describe("AnthropicProvider.stream() — text-only (5.3)", () => {
  let server: ReturnType<typeof Bun.serve>;

  afterEach(() => { server?.stop(true); });

  it("yields token events then done for a text-only SSE response", async () => {
    server = Bun.serve({
      port: 0,
      fetch() {
        const body = anthropicSse([
          { type: "message_start", data: { message: { id: "msg_1", type: "message" } } },
          { type: "content_block_start", data: { index: 0, content_block: { type: "text", text: "" } } },
          { type: "content_block_delta", data: { index: 0, delta: { type: "text_delta", text: "Hello" } } },
          { type: "content_block_delta", data: { index: 0, delta: { type: "text_delta", text: " world" } } },
          { type: "content_block_stop", data: { index: 0 } },
          { type: "message_stop", data: {} },
        ]);
        return new Response(body, {
          headers: { "Content-Type": "text/event-stream" },
        });
      },
    });

    const provider = new AnthropicProvider("test-key", "claude-test", `http://localhost:${server.port}`);
    const events: Array<{ type: string; content?: string }> = [];
    for await (const event of provider.stream([{ role: "user", content: "Hi" }])) {
      events.push(event);
    }

    const tokens = events.filter((e) => e.type === "token");
    expect(tokens.map((e) => e.content).join("")).toBe("Hello world");
    expect(events.at(-1)?.type).toBe("done");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5.4 — AnthropicProvider.stream(): tool-call response
// ─────────────────────────────────────────────────────────────────────────────

describe("AnthropicProvider.stream() — tool call (5.4)", () => {
  let server: ReturnType<typeof Bun.serve>;

  afterEach(() => { server?.stop(true); });

  it("yields a tool_calls event for a tool_use SSE response", async () => {
    server = Bun.serve({
      port: 0,
      fetch() {
        const body = anthropicSse([
          { type: "message_start", data: { message: {} } },
          { type: "content_block_start", data: { index: 0, content_block: { type: "tool_use", id: "tu_1", name: "read_file" } } },
          { type: "content_block_delta", data: { index: 0, delta: { type: "input_json_delta", partial_json: '{"pa' } } },
          { type: "content_block_delta", data: { index: 0, delta: { type: "input_json_delta", partial_json: 'th":"/"}' } } },
          { type: "content_block_stop", data: { index: 0 } },
          { type: "message_stop", data: {} },
        ]);
        return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
      },
    });

    const provider = new AnthropicProvider("test-key", "claude-test", `http://localhost:${server.port}`);
    const events: Array<{ type: string; calls?: Array<{ function: { name: string; arguments: string } }> }> = [];
    for await (const event of provider.stream([{ role: "user", content: "List files." }])) {
      events.push(event as typeof events[0]);
    }

    const toolEvent = events.find((e) => e.type === "tool_calls");
    expect(toolEvent).not.toBeUndefined();
    expect(toolEvent!.calls).toHaveLength(1);
    expect(toolEvent!.calls![0].function.name).toBe("read_file");
    const args = JSON.parse(toolEvent!.calls![0].function.arguments);
    expect(args.path).toBe("/");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5.5 — AnthropicProvider.stream(): extended thinking
// ─────────────────────────────────────────────────────────────────────────────

describe("AnthropicProvider.stream() — extended thinking (5.5)", () => {
  let server: ReturnType<typeof Bun.serve>;

  afterEach(() => { server?.stop(true); });

  it("yields reasoning events before text tokens", async () => {
    server = Bun.serve({
      port: 0,
      fetch() {
        const body = anthropicSse([
          { type: "message_start", data: { message: {} } },
          { type: "content_block_start", data: { index: 0, content_block: { type: "thinking" } } },
          { type: "content_block_delta", data: { index: 0, delta: { type: "thinking_delta", thinking: "Let me think..." } } },
          { type: "content_block_stop", data: { index: 0 } },
          { type: "content_block_start", data: { index: 1, content_block: { type: "text", text: "" } } },
          { type: "content_block_delta", data: { index: 1, delta: { type: "text_delta", text: "Answer." } } },
          { type: "content_block_stop", data: { index: 1 } },
          { type: "message_stop", data: {} },
        ]);
        return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
      },
    });

    const provider = new AnthropicProvider("test-key", "claude-test", `http://localhost:${server.port}`);
    const events: Array<{ type: string; content?: string }> = [];
    for await (const event of provider.stream([{ role: "user", content: "Think." }])) {
      events.push(event);
    }

    const reasoningIdx = events.findIndex((e) => e.type === "reasoning");
    const tokenIdx = events.findIndex((e) => e.type === "token");
    expect(reasoningIdx).not.toBe(-1);
    expect(tokenIdx).not.toBe(-1);
    expect(reasoningIdx).toBeLessThan(tokenIdx);
    expect(events[reasoningIdx].content).toBe("Let me think...");
    expect(events[tokenIdx].content).toBe("Answer.");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5.6 — AnthropicProvider.turn(): tool_use non-streaming response
// ─────────────────────────────────────────────────────────────────────────────

describe("AnthropicProvider.turn() — tool_use (5.6)", () => {
  let server: ReturnType<typeof Bun.serve>;

  afterEach(() => { server?.stop(true); });

  it("returns a tool_calls AITurnResult from a non-streaming response", async () => {
    server = Bun.serve({
      port: 0,
      fetch() {
        const responseBody = {
          id: "msg_1",
          type: "message",
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tu_1",
              name: "write_file",
              input: { path: "/tmp/out.txt", content: "hello" },
            },
          ],
          stop_reason: "tool_use",
        };
        return Response.json(responseBody);
      },
    });

    const provider = new AnthropicProvider("test-key", "claude-test", `http://localhost:${server.port}`);
    const result = await provider.turn([{ role: "user", content: "Write a file." }]);

    expect(result.type).toBe("tool_calls");
    if (result.type !== "tool_calls") throw new Error("unexpected type");
    expect(result.calls).toHaveLength(1);
    expect(result.calls[0].function.name).toBe("write_file");
    const args = JSON.parse(result.calls[0].function.arguments);
    expect(args.path).toBe("/tmp/out.txt");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// stop-reason-handling: stream() and turn() stop reason propagation
// ─────────────────────────────────────────────────────────────────────────────

describe("AnthropicProvider — stop reason handling", () => {
  let server: ReturnType<typeof Bun.serve>;

  afterEach(() => { server?.stop(true); });

  it("5.1 stream() yields stop_reason event when Anthropic returns refusal", async () => {
    server = Bun.serve({
      port: 0,
      fetch() {
        const body = anthropicSse([
          { type: "message_start", data: { message: {} } },
          { type: "content_block_start", data: { index: 0, content_block: { type: "text", text: "" } } },
          { type: "content_block_stop", data: { index: 0 } },
          { type: "message_delta", data: { delta: { stop_reason: "refusal" } } },
          { type: "message_stop", data: {} },
        ]);
        return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
      },
    });

    const provider = new AnthropicProvider("test-key", "claude-test", `http://localhost:${server.port}`);
    const events: Array<{ type: string; reason?: string }> = [];
    for await (const event of provider.stream([{ role: "user", content: "Hi" }])) {
      events.push(event as typeof events[0]);
    }

    const stopReasonEvent = events.find((e) => e.type === "stop_reason");
    expect(stopReasonEvent).not.toBeUndefined();
    expect(stopReasonEvent!.reason).toBe("refusal");
    expect(events.at(-1)?.type).toBe("done");
  });

  it("5.2 stream() yields stop_reason event when Anthropic returns model_context_window_exceeded", async () => {
    server = Bun.serve({
      port: 0,
      fetch() {
        const body = anthropicSse([
          { type: "message_start", data: { message: {} } },
          { type: "content_block_start", data: { index: 0, content_block: { type: "text", text: "" } } },
          { type: "content_block_stop", data: { index: 0 } },
          { type: "message_delta", data: { delta: { stop_reason: "model_context_window_exceeded" } } },
          { type: "message_stop", data: {} },
        ]);
        return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
      },
    });

    const provider = new AnthropicProvider("test-key", "claude-test", `http://localhost:${server.port}`);
    const events: Array<{ type: string; reason?: string }> = [];
    for await (const event of provider.stream([{ role: "user", content: "Hi" }])) {
      events.push(event as typeof events[0]);
    }

    const stopReasonEvent = events.find((e) => e.type === "stop_reason");
    expect(stopReasonEvent).not.toBeUndefined();
    expect(stopReasonEvent!.reason).toBe("model_context_window_exceeded");
  });

  it("5.3 stream() does NOT yield stop_reason event for end_turn", async () => {
    server = Bun.serve({
      port: 0,
      fetch() {
        const body = anthropicSse([
          { type: "message_start", data: { message: {} } },
          { type: "content_block_start", data: { index: 0, content_block: { type: "text", text: "" } } },
          { type: "content_block_delta", data: { index: 0, delta: { type: "text_delta", text: "Hi!" } } },
          { type: "content_block_stop", data: { index: 0 } },
          { type: "message_delta", data: { delta: { stop_reason: "end_turn" } } },
          { type: "message_stop", data: {} },
        ]);
        return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
      },
    });

    const provider = new AnthropicProvider("test-key", "claude-test", `http://localhost:${server.port}`);
    const events: Array<{ type: string }> = [];
    for await (const event of provider.stream([{ role: "user", content: "Hi" }])) {
      events.push(event);
    }

    expect(events.some((e) => e.type === "stop_reason")).toBe(false);
  });

  it("5.4 turn() includes stopReason in result when API returns refusal", async () => {
    server = Bun.serve({
      port: 0,
      fetch() {
        return Response.json({
          id: "msg_1",
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: "" }],
          stop_reason: "refusal",
        });
      },
    });

    const provider = new AnthropicProvider("test-key", "claude-test", `http://localhost:${server.port}`);
    const result = await provider.turn([{ role: "user", content: "Do something harmful." }]);

    expect(result.type).toBe("text");
    if (result.type !== "text") throw new Error("unexpected type");
    expect(result.stopReason).toBe("refusal");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5.9 — models.list multi-provider aggregation
// ─────────────────────────────────────────────────────────────────────────────

describe("listOpenAICompatibleModels (5.9)", () => {
  let server: ReturnType<typeof Bun.serve>;

  afterEach(() => { server?.stop(true); });

  it("fetches models from an OpenAI-compatible /v1/models endpoint", async () => {
    server = Bun.serve({
      port: 0,
      fetch(req) {
        if (req.url.includes("/v1/models")) {
          return Response.json({
            data: [
              { id: "model-a", context_length: 8192 },
              { id: "model-b", context_length: 32768 },
            ],
          });
        }
        return new Response("Not found", { status: 404 });
      },
    });

    const config: ProviderConfig = {
      id: "myserver",
      type: "openai-compatible",
      base_url: `http://localhost:${server.port}/v1`,
    } as ProviderConfig;

    const models = await listOpenAICompatibleModels(config);
    expect(models.length).toBeGreaterThanOrEqual(2);
    const a = models.find((m) => m.id === "model-a");
    expect(a?.contextWindow).toBe(8192);
  });

  it("falls back to /v1/models when LM Studio native API returns non-200", async () => {
    server = Bun.serve({
      port: 0,
      fetch(req) {
        if (req.url.includes("/api/v1/models")) {
          return new Response("Not LM Studio", { status: 404 });
        }
        if (req.url.includes("/v1/models")) {
          return Response.json({ data: [{ id: "fallback-model" }] });
        }
        return new Response("Not found", { status: 404 });
      },
    });

    const config: ProviderConfig = {
      id: "server",
      type: "openai-compatible",
      base_url: `http://localhost:${server.port}/v1`,
    } as ProviderConfig;

    const models = await listOpenAICompatibleModels(config);
    expect(models.some((m) => m.id === "fallback-model")).toBe(true);
  });
});

// ─── OpenAICompatibleProvider — provider_args passthrough ─────────────────────

/** Minimal SSE "done" response for OpenAI-compatible streaming endpoints. */
function openaiDoneStream(): Response {
  const body = "data: [DONE]\n\n";
  return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
}

/** Minimal JSON response for non-streaming OpenAI-compatible endpoints. */
function openaiTurnResponse(content = "hello"): Response {
  return Response.json({
    id: "chatcmpl-test",
    object: "chat.completion",
    choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });
}

describe("OpenAICompatibleProvider — provider_args passthrough", () => {
  let server: ReturnType<typeof Bun.serve> | null = null;
  afterEach(() => { server?.stop(true); server = null; });

  it("forwards provider_args as body.provider in stream()", async () => {
    let capturedBody: Record<string, unknown> | null = null;

    server = Bun.serve({
      port: 0,
      async fetch(req) {
        capturedBody = await req.json() as Record<string, unknown>;
        return openaiDoneStream();
      },
    });

    const providerArgs = { ignore: ["google-vertex", "azure"] };
    const provider = new OpenAICompatibleProvider(
      `http://localhost:${server.port}`,
      "test-key",
      "test-model",
      providerArgs,
    );

    const messages: AIMessage[] = [{ role: "user", content: [{ type: "text", text: "hello" }] }];
    // drain the stream
    for await (const _ of provider.stream(messages)) { /* noop */ }

    expect(capturedBody?.provider).toEqual(providerArgs);
  });

  it("forwards provider_args as body.provider in turn()", async () => {
    let capturedBody: Record<string, unknown> | null = null;

    server = Bun.serve({
      port: 0,
      async fetch(req) {
        capturedBody = await req.json() as Record<string, unknown>;
        return openaiTurnResponse();
      },
    });

    const providerArgs = { only: ["anthropic"] };
    const provider = new OpenAICompatibleProvider(
      `http://localhost:${server.port}`,
      "test-key",
      "test-model",
      providerArgs,
    );

    const messages: AIMessage[] = [{ role: "user", content: [{ type: "text", text: "hello" }] }];
    await provider.turn(messages);

    expect(capturedBody?.provider).toEqual(providerArgs);
  });

  it("omits body.provider when provider_args is not set in stream()", async () => {
    let capturedBody: Record<string, unknown> | null = null;

    server = Bun.serve({
      port: 0,
      async fetch(req) {
        capturedBody = await req.json() as Record<string, unknown>;
        return openaiDoneStream();
      },
    });

    const provider = new OpenAICompatibleProvider(
      `http://localhost:${server.port}`,
      "test-key",
      "test-model",
      // no provider_args
    );

    const messages: AIMessage[] = [{ role: "user", content: [{ type: "text", text: "hello" }] }];
    for await (const _ of provider.stream(messages)) { /* noop */ }

    expect(capturedBody).not.toBeNull();
    expect(Object.keys(capturedBody!)).not.toContain("provider");
  });

  it("omits body.provider when provider_args is not set in turn()", async () => {
    let capturedBody: Record<string, unknown> | null = null;

    server = Bun.serve({
      port: 0,
      async fetch(req) {
        capturedBody = await req.json() as Record<string, unknown>;
        return openaiTurnResponse();
      },
    });

    const provider = new OpenAICompatibleProvider(
      `http://localhost:${server.port}`,
      "test-key",
      "test-model",
      // no provider_args
    );

    const messages: AIMessage[] = [{ role: "user", content: [{ type: "text", text: "hello" }] }];
    await provider.turn(messages);

    expect(capturedBody).not.toBeNull();
    expect(Object.keys(capturedBody!)).not.toContain("provider");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// isEmptyAssistantMessage helper
// ─────────────────────────────────────────────────────────────────────────────

describe("isEmptyAssistantMessage", () => {
  it("returns true for assistant with null content and no tool_calls", () => {
    expect(isEmptyAssistantMessage({ role: "assistant", content: null as unknown as string })).toBe(true);
  });

  it("returns true for assistant with empty-string content and no tool_calls", () => {
    expect(isEmptyAssistantMessage({ role: "assistant", content: "" })).toBe(true);
  });

  it("returns true for assistant with whitespace-only content and no tool_calls", () => {
    expect(isEmptyAssistantMessage({ role: "assistant", content: "   " })).toBe(true);
  });

  it("returns false for assistant with non-empty content", () => {
    expect(isEmptyAssistantMessage({ role: "assistant", content: "Hello" })).toBe(false);
  });

  it("returns false for assistant with tool_calls but no content", () => {
    expect(isEmptyAssistantMessage({
      role: "assistant",
      content: "",
      tool_calls: [{ id: "call_1", type: "function", function: { name: "tool", arguments: "{}" } }],
    })).toBe(false);
  });

  it("returns false for user messages", () => {
    expect(isEmptyAssistantMessage({ role: "user", content: "" })).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// adaptMessages: orphaned empty assistant message filtering
// ─────────────────────────────────────────────────────────────────────────────

describe("adaptMessages — orphaned empty assistant filter", () => {
  it("removes empty-content assistant messages before adaptation", () => {
    const messages: AIMessage[] = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "" },
      { role: "user", content: "Say something" },
      { role: "assistant", content: "Sure!" },
    ];
    const { messages: adapted } = adaptMessages(messages);
    const assistantMsgs = adapted.filter((m) => m.role === "assistant");
    expect(assistantMsgs.length).toBe(1);
    expect(assistantMsgs[0].content).toBe("Sure!");
  });

  it("keeps valid assistant messages with tool_calls even when content is empty", () => {
    const messages: AIMessage[] = [
      { role: "user", content: "Run tool" },
      {
        role: "assistant",
        content: "",
        tool_calls: [{ id: "call_1", type: "function", function: { name: "my_tool", arguments: "{}" } }],
      },
    ];
    const { messages: adapted } = adaptMessages(messages);
    const assistantMsgs = adapted.filter((m) => m.role === "assistant");
    expect(assistantMsgs.length).toBe(1);
    const blocks = assistantMsgs[0].content as Array<{ type: string }>;
    expect(Array.isArray(blocks)).toBe(true);
    expect(blocks.some((b) => b.type === "tool_use")).toBe(true);
  });

  it("preserves a message array with no orphans unchanged (count)", () => {
    const messages: AIMessage[] = [
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello!" },
    ];
    const { messages: adapted } = adaptMessages(messages);
    expect(adapted.length).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AnthropicProvider: thinking body field
// ─────────────────────────────────────────────────────────────────────────────

describe("AnthropicProvider — thinking body field", () => {
  let server: ReturnType<typeof Bun.serve>;
  let capturedBody: Record<string, unknown> | null = null;

  afterEach(() => { server?.stop(true); capturedBody = null; });

  function simpleSse(): string {
    return anthropicSse([
      { type: "message_start", data: { message: { id: "m1", type: "message" } } },
      { type: "content_block_start", data: { index: 0, content_block: { type: "text" } } },
      { type: "content_block_delta", data: { index: 0, delta: { type: "text_delta", text: "hi" } } },
      { type: "content_block_stop", data: { index: 0 } },
      { type: "message_stop", data: {} },
    ]);
  }

  it("does NOT include thinking in the body when enableThinking is false (default)", async () => {
    server = Bun.serve({
      port: 0,
      async fetch(req) {
        capturedBody = await req.json() as Record<string, unknown>;
        return new Response(simpleSse(), { headers: { "Content-Type": "text/event-stream" } });
      },
    });
    const provider = new AnthropicProvider("key", "claude-test", `http://localhost:${server.port}`);
    for await (const _e of provider.stream([{ role: "user", content: "hi" }])) { /* drain */ }
    expect(capturedBody).not.toBeNull();
    expect(capturedBody!.thinking).toBeUndefined();
  });

  it("includes thinking: { type: 'adaptive' } in the body when enableThinking is true", async () => {
    server = Bun.serve({
      port: 0,
      async fetch(req) {
        capturedBody = await req.json() as Record<string, unknown>;
        return new Response(simpleSse(), { headers: { "Content-Type": "text/event-stream" } });
      },
    });
    const provider = new AnthropicProvider("key", "claude-test", `http://localhost:${server.port}`, undefined, true);
    for await (const _e of provider.stream([{ role: "user", content: "hi" }])) { /* drain */ }
    expect(capturedBody).not.toBeNull();
    expect(capturedBody!.thinking).toEqual({ type: "adaptive" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AnthropicProvider: effort config (3.1–3.3)
// ─────────────────────────────────────────────────────────────────────────────

describe("AnthropicProvider — effort config", () => {
  let server: ReturnType<typeof Bun.serve>;
  let capturedBody: Record<string, unknown> | null = null;

  afterEach(() => { server?.stop(true); capturedBody = null; });

  function simpleSse(): string {
    return anthropicSse([
      { type: "message_start", data: { message: { id: "m1", type: "message" } } },
      { type: "content_block_start", data: { index: 0, content_block: { type: "text" } } },
      { type: "content_block_delta", data: { index: 0, delta: { type: "text_delta", text: "hi" } } },
      { type: "content_block_stop", data: { index: 0 } },
      { type: "message_stop", data: {} },
    ]);
  }

  it("3.1 uses defaultEffort from config when no explicit effort given", async () => {
    server = Bun.serve({
      port: 0,
      async fetch(req) {
        capturedBody = await req.json() as Record<string, unknown>;
        return new Response(simpleSse(), { headers: { "Content-Type": "text/event-stream" } });
      },
    });
    // Pass "medium" as defaultEffort (6th constructor arg)
    const provider = new AnthropicProvider("key", "claude-test", `http://localhost:${server.port}`, undefined, false, "medium");
    for await (const _e of provider.stream([{ role: "user", content: "hi" }])) { /* drain */ }
    expect(capturedBody).not.toBeNull();
    expect(capturedBody!.output_config).toEqual({ effort: "medium" });
  });

  it("3.2 explicit AICallOptions.effort overrides config defaultEffort", async () => {
    server = Bun.serve({
      port: 0,
      async fetch(req) {
        capturedBody = await req.json() as Record<string, unknown>;
        return new Response(simpleSse(), { headers: { "Content-Type": "text/event-stream" } });
      },
    });
    const provider = new AnthropicProvider("key", "claude-test", `http://localhost:${server.port}`, undefined, false, "medium");
    for await (const _e of provider.stream([{ role: "user", content: "hi" }], { effort: "low" })) { /* drain */ }
    expect(capturedBody).not.toBeNull();
    expect(capturedBody!.output_config).toEqual({ effort: "low" });
  });

  it("3.3 no output_config when no config effort and no explicit effort", async () => {
    server = Bun.serve({
      port: 0,
      async fetch(req) {
        capturedBody = await req.json() as Record<string, unknown>;
        return new Response(simpleSse(), { headers: { "Content-Type": "text/event-stream" } });
      },
    });
    const provider = new AnthropicProvider("key", "claude-test", `http://localhost:${server.port}`);
    for await (const _e of provider.stream([{ role: "user", content: "hi" }])) { /* drain */ }
    expect(capturedBody).not.toBeNull();
    expect(capturedBody!.output_config).toBeUndefined();
  });
});
