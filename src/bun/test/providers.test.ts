/**
 * Provider integration tests (tasks 5.1–5.9).
 *
 * Uses `Bun.serve()` to create local mock HTTP servers that speak the Anthropic
 * and OpenAI-compatible wire formats. No real network calls are made.
 */

import { describe, it, expect, afterEach, beforeEach } from "bun:test";
import { adaptMessages, adaptTools, AnthropicProvider } from "../ai/anthropic.ts";
import { OpenAICompatibleProvider } from "../ai/openai-compatible.ts";
import { resolveProvider, UnresolvableProviderError, clearProviderCache, listOpenAICompatibleModels } from "../ai/index.ts";
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
    // system is now a block array with prompt-caching headers
    expect(Array.isArray(system)).toBe(true);
    expect(system!.length).toBe(1);
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

// ─────────────────────────────────────────────────────────────────────────────
// two-stage-json-parse — safeParseJSON via stream()
// ─────────────────────────────────────────────────────────────────────────────

describe("two-stage-json-parse — double-encoded tool arguments", () => {
  let server: ReturnType<typeof Bun.serve>;
  afterEach(() => { server?.stop(true); });

  it("corrects double-encoded JSON tool arguments emitted by the model", async () => {
    // The model emits input_json_delta fragments that, when concatenated, form a
    // JSON string whose top-level value is ITSELF a JSON string (double-encoding).
    const doubleEncoded = JSON.stringify('{"path":"/tmp/out.txt"}'); // '"{\\"path\\":\\"/tmp/out.txt\\"}"'
    server = Bun.serve({
      port: 0,
      fetch() {
        const body = anthropicSse([
          { type: "message_start", data: { message: { usage: { input_tokens: 10 } } } },
          { type: "content_block_start", data: { index: 0, content_block: { type: "tool_use", id: "tu_1", name: "write_file" } } },
          { type: "content_block_delta", data: { index: 0, delta: { type: "input_json_delta", partial_json: doubleEncoded } } },
          { type: "content_block_stop", data: { index: 0 } },
          { type: "message_delta", data: { usage: { output_tokens: 5 } } },
          { type: "message_stop", data: {} },
        ]);
        return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
      },
    });

    const provider = new AnthropicProvider("test-key", "claude-test", `http://localhost:${server.port}`);
    const events: Array<{ type: string; calls?: Array<{ function: { arguments: string } }> }> = [];
    for await (const event of provider.stream([{ role: "user", content: "Write a file." }])) {
      events.push(event as typeof events[0]);
    }

    const toolEvent = events.find((e) => e.type === "tool_calls");
    expect(toolEvent).not.toBeUndefined();
    const args = JSON.parse(toolEvent!.calls![0].function.arguments);
    // After safeParseJSON, the result should be the inner object, not the string
    expect(typeof args).toBe("object");
    expect(args.path).toBe("/tmp/out.txt");
  });

  it("passes through correctly-encoded JSON arguments without modification", async () => {
    const correctJson = '{"path":"/tmp/out.txt"}';
    server = Bun.serve({
      port: 0,
      fetch() {
        const body = anthropicSse([
          { type: "message_start", data: { message: {} } },
          { type: "content_block_start", data: { index: 0, content_block: { type: "tool_use", id: "tu_1", name: "read_file" } } },
          { type: "content_block_delta", data: { index: 0, delta: { type: "input_json_delta", partial_json: correctJson } } },
          { type: "content_block_stop", data: { index: 0 } },
          { type: "message_stop", data: {} },
        ]);
        return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
      },
    });

    const provider = new AnthropicProvider("test-key", "claude-test", `http://localhost:${server.port}`);
    const events: Array<{ type: string; calls?: Array<{ function: { arguments: string } }> }> = [];
    for await (const event of provider.stream([{ role: "user", content: "Read a file." }])) {
      events.push(event as typeof events[0]);
    }

    const toolEvent = events.find((e) => e.type === "tool_calls");
    expect(toolEvent).not.toBeUndefined();
    const args = JSON.parse(toolEvent!.calls![0].function.arguments);
    expect(args.path).toBe("/tmp/out.txt");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// thinking-block-orphan-detection
// ─────────────────────────────────────────────────────────────────────────────

describe("thinking-block-orphan-detection — empty assistant message filtering", () => {
  it("removes empty assistant messages with no content and no tool_calls", () => {
    const messages: AIMessage[] = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "" },      // orphan — no text, no tool calls
      { role: "assistant", content: "I'm here" }, // real assistant response follows
    ];
    const { messages: adapted } = adaptMessages(messages);
    // The empty assistant message should be filtered out; the real one remains
    expect(adapted).toHaveLength(2);
    expect(adapted[0].role).toBe("user");
    expect(adapted[1].role).toBe("assistant");
    expect(typeof adapted[1].content === "string" && adapted[1].content).toContain("I'm here");
  });

  it("removes assistant messages with null content and no tool_calls", () => {
    const messages: AIMessage[] = [
      { role: "user", content: "go" },
      { role: "assistant", content: null },   // orphan
      { role: "assistant", content: "Done!" }, // real assistant message follows
    ];
    const { messages: adapted } = adaptMessages(messages);
    expect(adapted).toHaveLength(2);
    expect(adapted[1].role).toBe("assistant");
    expect(typeof adapted[1].content === "string" && adapted[1].content).toContain("Done!");
  });

  it("preserves non-empty assistant messages", () => {
    const messages: AIMessage[] = [
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello there!" },
    ];
    const { messages: adapted } = adaptMessages(messages);
    expect(adapted).toHaveLength(2);
    expect(adapted[1].role).toBe("assistant");
  });

  it("preserves empty assistant messages that have tool_calls", () => {
    const messages: AIMessage[] = [
      { role: "user", content: "List files." },
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "c1", type: "function", function: { name: "ls", arguments: "{}" } }],
      },
    ];
    const { messages: adapted } = adaptMessages(messages);
    const asst = adapted.find((m) => m.role === "assistant");
    expect(asst).not.toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// tool-error-flag — is_error propagation in Anthropic wire format
// ─────────────────────────────────────────────────────────────────────────────

describe("tool-error-flag — is_error in tool_result block", () => {
  it("sets is_error:true on Anthropic tool_result block when msg.isError is set", () => {
    const messages: AIMessage[] = [
      { role: "user", content: "Run tool." },
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "c1", type: "function", function: { name: "read", arguments: "{}" } }],
      },
      { role: "tool", content: "Error: file not found", tool_call_id: "c1", isError: true },
    ];
    const { messages: adapted } = adaptMessages(messages);
    const toolResultMsg = adapted.find((m) => Array.isArray(m.content) && (m.content as Array<{ type: string }>).some((b) => b.type === "tool_result"));
    expect(toolResultMsg).not.toBeUndefined();
    const block = (toolResultMsg!.content as Array<{ type: string; is_error?: boolean }>).find((b) => b.type === "tool_result");
    expect(block!.is_error).toBe(true);
  });

  it("does not set is_error on successful tool results", () => {
    const messages: AIMessage[] = [
      { role: "user", content: "Run tool." },
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "c1", type: "function", function: { name: "read", arguments: "{}" } }],
      },
      { role: "tool", content: "file contents here", tool_call_id: "c1" },
    ];
    const { messages: adapted } = adaptMessages(messages);
    const toolResultMsg = adapted.find((m) => Array.isArray(m.content) && (m.content as Array<{ type: string }>).some((b) => b.type === "tool_result"));
    const block = (toolResultMsg!.content as Array<{ type: string; is_error?: boolean }>).find((b) => b.type === "tool_result");
    expect(block!.is_error).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// consecutive-user-message-merging
// ─────────────────────────────────────────────────────────────────────────────

describe("consecutive-user-message-merging — Anthropic adaptMessages", () => {
  it("merges two consecutive plain user messages into one", () => {
    const messages: AIMessage[] = [
      { role: "user", content: "Part A" },
      { role: "user", content: "Part B" },
    ];
    const { messages: adapted } = adaptMessages(messages);
    expect(adapted).toHaveLength(1);
    expect(adapted[0].role).toBe("user");
    expect(typeof adapted[0].content === "string" && adapted[0].content).toContain("Part A");
    expect(typeof adapted[0].content === "string" && adapted[0].content).toContain("Part B");
  });

  it("merges two consecutive assistant text messages into one", () => {
    const messages: AIMessage[] = [
      { role: "assistant", content: "Hello" },
      { role: "assistant", content: "World" },
    ];
    const { messages: adapted } = adaptMessages(messages);
    expect(adapted).toHaveLength(1);
    expect(adapted[0].role).toBe("assistant");
  });

  it("does not merge user and assistant messages", () => {
    const messages: AIMessage[] = [
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello" },
      { role: "user", content: "Bye" },
    ];
    const { messages: adapted } = adaptMessages(messages);
    expect(adapted).toHaveLength(3);
  });
});

describe("consecutive-user-message-merging — OpenAI-compatible normalizeMessages", () => {
  let server: ReturnType<typeof Bun.serve>;
  afterEach(() => { server?.stop(true); });

  it("sends a single merged user message when two consecutive user messages are present", async () => {
    const capturedBodies: string[] = [];
    server = Bun.serve({
      port: 0,
      async fetch(req) {
        capturedBodies.push(await req.text());
        return Response.json({
          choices: [{ message: { content: "ok", tool_calls: null }, finish_reason: "stop" }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        });
      },
    });

    const provider = new OpenAICompatibleProvider(`http://localhost:${server.port}`, "", "test-model");
    const messages: AIMessage[] = [
      { role: "user", content: "Hello" },
      { role: "user", content: "World" },
    ];
    await provider.turn(messages);

    const body = JSON.parse(capturedBodies[0]) as { messages: Array<{ role: string; content: string }> };
    // normalizeMessages should have merged the two user messages into one
    expect(body.messages.filter((m) => m.role === "user")).toHaveLength(1);
    expect(body.messages.find((m) => m.role === "user")!.content).toContain("Hello");
    expect(body.messages.find((m) => m.role === "user")!.content).toContain("World");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// usage-token-tracking — Anthropic
// ─────────────────────────────────────────────────────────────────────────────

describe("usage-token-tracking — Anthropic stream()", () => {
  let server: ReturnType<typeof Bun.serve>;
  afterEach(() => { server?.stop(true); });

  it("emits a usage event merging message_start input tokens and message_delta output tokens", async () => {
    server = Bun.serve({
      port: 0,
      fetch() {
        const body = anthropicSse([
          { type: "message_start", data: { message: { usage: { input_tokens: 42, cache_creation_input_tokens: 5, cache_read_input_tokens: 3 } } } },
          { type: "content_block_start", data: { index: 0, content_block: { type: "text", text: "" } } },
          { type: "content_block_delta", data: { index: 0, delta: { type: "text_delta", text: "Hi" } } },
          { type: "content_block_stop", data: { index: 0 } },
          { type: "message_delta", data: { usage: { output_tokens: 17 } } },
          { type: "message_stop", data: {} },
        ]);
        return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
      },
    });

    const provider = new AnthropicProvider("test-key", "claude-test", `http://localhost:${server.port}`);
    const events: Array<{ type: string; usage?: { inputTokens: number; outputTokens: number; cacheCreationInputTokens?: number; cacheReadInputTokens?: number } }> = [];
    for await (const event of provider.stream([{ role: "user", content: "Hi" }])) {
      events.push(event as typeof events[0]);
    }

    const usageEvent = events.find((e) => e.type === "usage");
    expect(usageEvent).not.toBeUndefined();
    expect(usageEvent!.usage!.inputTokens).toBe(42);
    expect(usageEvent!.usage!.outputTokens).toBe(17);
    expect(usageEvent!.usage!.cacheCreationInputTokens).toBe(5);
    expect(usageEvent!.usage!.cacheReadInputTokens).toBe(3);
    // usage event should come before done
    const usageIdx = events.findIndex((e) => e.type === "usage");
    const doneIdx = events.findIndex((e) => e.type === "done");
    expect(usageIdx).toBeLessThan(doneIdx);
  });
});

describe("usage-token-tracking — Anthropic turn()", () => {
  let server: ReturnType<typeof Bun.serve>;
  afterEach(() => { server?.stop(true); });

  it("populates usage on the AITurnResult from the non-streaming response", async () => {
    server = Bun.serve({
      port: 0,
      fetch() {
        return Response.json({
          content: [{ type: "text", text: "Hello" }],
          usage: { input_tokens: 30, output_tokens: 8, cache_creation_input_tokens: 2, cache_read_input_tokens: 0 },
        });
      },
    });

    const provider = new AnthropicProvider("test-key", "claude-test", `http://localhost:${server.port}`);
    const result = await provider.turn([{ role: "user", content: "Hi" }]);
    expect(result.usage).not.toBeUndefined();
    expect(result.usage!.inputTokens).toBe(30);
    expect(result.usage!.outputTokens).toBe(8);
    expect(result.usage!.cacheCreationInputTokens).toBe(2);
  });
});

describe("usage-token-tracking — OpenAI-compatible", () => {
  let server: ReturnType<typeof Bun.serve>;
  afterEach(() => { server?.stop(true); });

  it("emits a usage event from the final SSE chunk with usage field", async () => {
    server = Bun.serve({
      port: 0,
      fetch() {
        const lines = [
          `data: ${JSON.stringify({ choices: [{ delta: { content: "Hello" }, finish_reason: null }] })}\n\n`,
          `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 20, completion_tokens: 6 } })}\n\n`,
          "data: [DONE]\n\n",
        ].join("");
        return new Response(lines, { headers: { "Content-Type": "text/event-stream" } });
      },
    });

    const provider = new OpenAICompatibleProvider(`http://localhost:${server.port}`, "", "test-model");
    const events: Array<{ type: string; usage?: { inputTokens: number; outputTokens: number } }> = [];
    for await (const event of provider.stream([{ role: "user", content: "Hello" }])) {
      events.push(event as typeof events[0]);
    }

    const usageEvent = events.find((e) => e.type === "usage");
    expect(usageEvent).not.toBeUndefined();
    expect(usageEvent!.usage!.inputTokens).toBe(20);
    expect(usageEvent!.usage!.outputTokens).toBe(6);
  });

  it("populates usage on AITurnResult from non-streaming response", async () => {
    server = Bun.serve({
      port: 0,
      fetch() {
        return Response.json({
          choices: [{ message: { content: "ok", tool_calls: null }, finish_reason: "stop" }],
          usage: { prompt_tokens: 15, completion_tokens: 3 },
        });
      },
    });

    const provider = new OpenAICompatibleProvider(`http://localhost:${server.port}`, "", "test-model");
    const result = await provider.turn([{ role: "user", content: "Hi" }]);
    expect(result.usage).not.toBeUndefined();
    expect(result.usage!.inputTokens).toBe(15);
    expect(result.usage!.outputTokens).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// prompt-caching — system blocks and conversation breakpoint
// ─────────────────────────────────────────────────────────────────────────────

describe("prompt-caching — system message block array", () => {
  it("returns system as a block array with cache_control on the last block", () => {
    const messages: AIMessage[] = [
      { role: "system", content: "Be helpful." },
      { role: "user", content: "Hi" },
    ];
    const { system } = adaptMessages(messages);
    expect(Array.isArray(system)).toBe(true);
    expect(system!.length).toBeGreaterThan(0);
    expect(system![system!.length - 1].cache_control).toEqual({ type: "ephemeral" });
  });

  it("returns undefined system when no system messages are present", () => {
    const messages: AIMessage[] = [{ role: "user", content: "Hi" }];
    const { system } = adaptMessages(messages);
    expect(system).toBeUndefined();
  });

  it("single system block carries cache_control", () => {
    const messages: AIMessage[] = [
      { role: "system", content: "Instructions." },
      { role: "user", content: "Go" },
    ];
    const { system } = adaptMessages(messages);
    expect(system).toHaveLength(1);
    expect(system![0].cache_control).toEqual({ type: "ephemeral" });
    expect(system![0].text).toBe("Instructions.");
  });
});

describe("prompt-caching — conversation history breakpoint", () => {
  /**
   * Build a conversation with N user/assistant round-trip pairs plus a final user message.
   * Returns the adapted messages array.
   */
  function buildConversation(userTurns: number): ReturnType<typeof adaptMessages>["messages"] {
    const msgs: AIMessage[] = [];
    for (let i = 0; i < userTurns; i++) {
      msgs.push({ role: "user", content: `User turn ${i + 1}` });
      msgs.push({ role: "assistant", content: `Assistant turn ${i + 1}` });
    }
    msgs.push({ role: "user", content: "Final user message" });
    return adaptMessages(msgs).messages;
  }

  it("places the cache breakpoint at the 5th-from-last user message when there are 6+ user turns", () => {
    // With 6 user turns, the 5th-from-last is turn 2 (turns: 1,2,3,4,5,final)
    const adapted = buildConversation(5); // 5 pairs + 1 final = 6 user msgs
    // The 5th-from-last user message (index from end: 5th) should have cache_control
    const userMsgs = adapted.filter((m) => m.role === "user");
    expect(userMsgs.length).toBe(6);
    const fifth = userMsgs[userMsgs.length - 5]; // 5th from last
    const lastBlock = Array.isArray(fifth.content)
      ? (fifth.content as Array<{ cache_control?: unknown }>)[((fifth.content as unknown[]).length) - 1]
      : null;
    expect(lastBlock?.cache_control).toEqual({ type: "ephemeral" });
  });

  it("does not apply a breakpoint when there are fewer than 5 user messages", () => {
    const adapted = buildConversation(2); // 2 pairs + 1 final = 3 user msgs
    const cacheMarked = adapted.filter((m) => {
      if (!Array.isArray(m.content)) return false;
      return (m.content as Array<{ cache_control?: unknown }>).some((b) => b.cache_control);
    });
    expect(cacheMarked).toHaveLength(0);
  });
});
