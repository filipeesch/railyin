/**
 * Provider integration tests (tasks 5.1–5.9).
 *
 * Uses `Bun.serve()` to create local mock HTTP servers that speak the Anthropic
 * and OpenAI-compatible wire formats. No real network calls are made.
 */

import { describe, it, expect, afterEach, beforeEach } from "bun:test";
import { adaptMessages, adaptTools, AnthropicProvider } from "../ai/anthropic.ts";
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
    expect(system).toBe("You are helpful.");
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
    expect(system).toContain("Instruction A.");
    expect(system).toContain("Instruction B.");
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
