import { describe, expect, it } from "vitest";
import type { EngineEvent } from "@bun/engine/types";
import type { SDKCustomTool } from "@cursor/sdk";
import {
  MockCursorSdkAdapter,
  askUser,
  callTool,
  fatalError,
  reasoning,
  statusMessage,
  token,
  toolResult,
  toolStart,
  waitForAbort,
} from "./mocks";

function baseRunConfig(overrides: Partial<Parameters<MockCursorSdkAdapter["run"]>[0]> = {}) {
  return {
    executionId: 1,
    taskId: 1,
    conversationId: 1,
    prompt: "test",
    workingDirectory: "/tmp",
    sessionId: "cursor-1",
    ...overrides,
  };
}

async function collect(adapter: MockCursorSdkAdapter, config = baseRunConfig()): Promise<EngineEvent[]> {
  const events: EngineEvent[] = [];
  for await (const event of adapter.run(config)) events.push(event);
  return events;
}

describe("MockCursorSdkAdapter", () => {
  it("yields a terminal done when a turn has no steps", async () => {
    const adapter = new MockCursorSdkAdapter().queueTurn({ steps: [] });
    expect(await collect(adapter)).toEqual([{ type: "done" }]);
  });

  it("emits token, reasoning, and status steps in order", async () => {
    const adapter = new MockCursorSdkAdapter().queueTurn({
      steps: [reasoning("plan"), token("Hello"), token(" world"), statusMessage("ready")],
    });
    expect(await collect(adapter)).toEqual([
      { type: "reasoning", content: "plan" },
      { type: "token", content: "Hello" },
      { type: "token", content: " world" },
      { type: "status", message: "ready" },
      { type: "done" },
    ]);
  });

  it("emits tool_start and tool_result with matching callId", async () => {
    const adapter = new MockCursorSdkAdapter().queueTurn({
      steps: [
        toolStart("call-1", "create_card", { title: "x" }),
        toolResult("call-1", "ok"),
        token("done"),
      ],
    });
    const events = await collect(adapter);
    expect(events[0]).toMatchObject({ type: "tool_start", name: "create_card", callId: "call-1" });
    expect(events[1]).toMatchObject({ type: "tool_result", result: "ok", callId: "call-1", isError: false });
    expect(events.at(-1)).toEqual({ type: "done" });
  });

  it("rejects when no turn is queued", async () => {
    const adapter = new MockCursorSdkAdapter();
    await expect((async () => { for await (const _e of adapter.run(baseRunConfig())) {} })()).rejects.toThrow(
      "No mock cursor turn queued",
    );
  });

  it("re-throws a turn's sendError before streaming", async () => {
    const adapter = new MockCursorSdkAdapter().queueTurn({
      sendError: new Error("connection refused"),
      steps: [],
    });
    await expect((async () => { for await (const _e of adapter.run(baseRunConfig())) {} })()).rejects.toThrow(
      "connection refused",
    );
  });

  it("yields an error event for the `error` step and stops", async () => {
    const adapter = new MockCursorSdkAdapter().queueTurn({
      steps: [token("partial"), fatalError("kaboom")],
    });
    const events = await collect(adapter);
    expect(events).toEqual([
      { type: "token", content: "partial" },
      { type: "error", message: "kaboom", fatal: true },
    ]);
  });

  it("stops streaming and omits done when the signal aborts during waitForAbort", async () => {
    const abort = new AbortController();
    const adapter = new MockCursorSdkAdapter().queueTurn({ steps: [token("a"), waitForAbort()] });

    const collected: EngineEvent[] = [];
    const iter = adapter.run(baseRunConfig({ signal: abort.signal }));
    const consume = (async () => {
      for await (const e of iter) collected.push(e);
    })();

    // Let the first token + waitForAbort settle before we abort.
    await new Promise((r) => setTimeout(r, 0));
    abort.abort();
    await consume;

    expect(collected).toEqual([{ type: "token", content: "a" }]);
  });

  describe("§6.2.3 suspend-loop", () => {
    it("invokes a custom tool via callTool; the tool's onSuspend side-effect aborts the run", async () => {
      // Fake decision_request tool: it calls a captured `onSuspend(payload)`
      // and aborts the externally-supplied combined abort signal, mirroring
      // how buildCursorTools wires onSuspend into the real custom-tool execute.
      const abort = new AbortController();
      let suspendPayload: string | null = null;
      const decisionTool: SDKCustomTool = {
        description: "request a decision",
        inputSchema: { type: "object", properties: {} },
        execute: async (args: unknown) => {
          suspendPayload = JSON.stringify(args);
          abort.abort();
          return "suspended";
        },
      };

      const adapter = new MockCursorSdkAdapter().queueTurn({
        steps: [
          token("thinking..."),
          callTool("decision_request", { questions: [{ question: "A or B?" }] }),
          // Anything after the suspend should NOT be emitted — the next loop
          // iteration sees the aborted signal and stops.
          token("should-not-appear"),
        ],
      });

      const events = await collect(adapter, baseRunConfig({
        signal: abort.signal,
        customTools: { decision_request: decisionTool },
      }));

      expect(suspendPayload).toBe('{"questions":[{"question":"A or B?"}]}');
      expect(events).toEqual([{ type: "token", content: "thinking..." }]);
    });
  });

  describe("listModels / listCommands", () => {
    it("returns the default mock model unless overridden", async () => {
      const adapter = new MockCursorSdkAdapter();
      const models = await adapter.listModels("/tmp");
      expect(models[0]?.value).toBe("mock-model");
      expect(adapter.trace.listModelsCalls).toBe(1);
    });

    it("returns the configured models when setModels is called", async () => {
      const adapter = new MockCursorSdkAdapter().setModels([
        { value: "claude-sonnet-4-6", displayName: "Sonnet", supportsThinking: true },
      ]);
      const models = await adapter.listModels("/tmp");
      expect(models).toEqual([
        { value: "claude-sonnet-4-6", displayName: "Sonnet", supportsThinking: true },
      ]);
    });

    it("returns no slash commands", async () => {
      const adapter = new MockCursorSdkAdapter();
      expect(await adapter.listCommands("/tmp")).toEqual([]);
    });
  });

  describe("askUser step", () => {
    it("emits an ask_user event with the supplied payload", async () => {
      const adapter = new MockCursorSdkAdapter().queueTurn({
        steps: [token("Need input"), askUser('{"question":"clarify"}')],
      });
      const events = await collect(adapter);
      expect(events).toEqual([
        { type: "token", content: "Need input" },
        { type: "ask_user", payload: '{"question":"clarify"}' },
        { type: "done" },
      ]);
    });
  });

  describe("trace counters", () => {
    it("records run, cancel, and shutdown calls", async () => {
      const adapter = new MockCursorSdkAdapter().queueTurn({ steps: [token("hi")] });
      await collect(adapter);
      await adapter.cancel(1);
      await adapter.shutdownAll();
      expect(adapter.trace.runCalls).toBe(1);
      expect(adapter.trace.cancelCalls).toBe(1);
      expect(adapter.trace.shutdownCalls).toBe(1);
      expect(adapter.trace.runConfigs[0]?.sessionId).toBe("cursor-1");
    });
  });
});
