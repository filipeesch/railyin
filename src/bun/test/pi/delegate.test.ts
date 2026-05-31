/**
 * Tests for buildDelegateTool.
 *
 * Uses a mock ChildSessionFactory — no real Pi SDK sessions are created.
 */

import { describe, test, expect } from "bun:test";
import { buildDelegateTool } from "../../engine/pi/tools/delegate.ts";
import type { DelegateToolOptions } from "../../engine/pi/tools/delegate.ts";
import type { ChildSessionFactory, ChildSessionHandle } from "../../engine/pi/child-session.ts";
import { ProviderLimiterRegistry } from "../../engine/pi/provider-limiter.ts";
import type { PiEngineConfig } from "../../config/index.ts";
import type { EngineEvent } from "../../engine/types.ts";
import type { AgentTool } from "@earendil-works/pi-agent-core";

// ─── MockChildSession ─────────────────────────────────────────────────────────

type SessionCallback = (event: any) => void;

class MockChildSession {
  private callback: SessionCallback | null = null;
  readonly agent = {
    state: {
      thinkingLevel: "off" as string,
      messages: [] as Array<{ role: string; content: Array<{ type: string; text?: string }> }>,
    },
  };

  constructor(
    private readonly jobId: string,
    private readonly response: string | Error,
  ) {}

  subscribe(cb: SessionCallback): () => void {
    this.callback = cb;
    return () => { this.callback = null; };
  }

  async prompt(_text: string): Promise<void> {
    if (this.response instanceof Error) {
      throw this.response;
    }
    // Emit a tool_execution_start event so DL-6 can verify forwarding
    this.callback?.({
      type: "tool_execution_start",
      toolName: "read",
      toolCallId: `child-call-${this.jobId}`,
      args: {},
    });
    this.callback?.({
      type: "tool_execution_end",
      toolName: "read",
      toolCallId: `child-call-${this.jobId}`,
      result: { content: [{ type: "text", text: "read result" }] },
      isError: false,
    });
    // Set messages so the delegate tool can extract the result text
    this.agent.state.messages = [
      {
        role: "assistant",
        content: [{ type: "text", text: this.response as string }],
      },
    ];
  }

  dispose(): void {}
  abort(): void {}
}

// ─── Factory helpers ──────────────────────────────────────────────────────────

function makeChildFactory(response: string | Error): ChildSessionFactory {
  return async (opts): Promise<ChildSessionHandle> => {
    const session = new MockChildSession(opts.jobId, response);
    return { session: session as any, dispose: () => {} };
  };
}

function makeOpts(
  overrides: Partial<DelegateToolOptions> = {},
  emittedEvents: EngineEvent[] = [],
): DelegateToolOptions {
  const registry = new ProviderLimiterRegistry();
  registry.register("myProvider", 8, 5000);

  const delegateEmitRef: { emit?: (e: EngineEvent) => void } = {};
  delegateEmitRef.emit = (e) => emittedEvents.push(e);

  const config: PiEngineConfig = { type: "pi" };
  const model = { provider: "myProvider", id: "test-model", contextWindow: 4096 } as any;

  return {
    limiterRegistry: registry,
    parentModel: model,
    parentCwd: "/test-cwd",
    engineConfig: config,
    delegateEmitRef,
    childSessionFactory: makeChildFactory("hello from child"),
    buildChildTools: () => [],
    ...overrides,
  };
}

// Minimal harness context
const fakeHarnessCtx: any = { undoStack: null, worktreePath: "/test-cwd" };

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("buildDelegateTool", () => {
  test("DL-1: single task — executes child prompt, returns digest with result text", async () => {
    const tools = buildDelegateTool(fakeHarnessCtx, makeOpts());
    expect(tools).toHaveLength(1);
    const tool = tools[0];

    const result = await tool.execute("call-1", { tasks: [{ id: "job-a", prompt: "do something" }] }, undefined);
    const text = result.content.find((c) => c.type === "text")!.text as string;

    expect(text).toContain("job-a");
    expect(text).toContain("hello from child");
  });

  test("DL-2: three tasks with concurrency 2 — all three complete, digest has all three jobs", async () => {
    const config: PiEngineConfig = {
      type: "pi",
      harness: { delegate: { max_per_call: 5, max_concurrency: 2 } },
    };
    const opts = makeOpts({ engineConfig: config });
    const tools = buildDelegateTool(fakeHarnessCtx, opts);
    const tool = tools[0];

    const result = await tool.execute("call-2", {
      tasks: [
        { id: "job-1", prompt: "task 1" },
        { id: "job-2", prompt: "task 2" },
        { id: "job-3", prompt: "task 3" },
      ],
    }, undefined);

    const text = result.content.find((c) => c.type === "text")!.text as string;
    expect(text).toContain("job-1");
    expect(text).toContain("job-2");
    expect(text).toContain("job-3");
    expect(text).toContain("hello from child");
  });

  test("DL-3: max_per_call exceeded — returns error without spawning any children", async () => {
    let factoryCalled = false;
    const config: PiEngineConfig = {
      type: "pi",
      harness: { delegate: { max_per_call: 2 } },
    };
    const childFactory: ChildSessionFactory = async (opts) => {
      factoryCalled = true;
      return { session: new MockChildSession(opts.jobId, "ok") as any, dispose: () => {} };
    };
    const opts = makeOpts({ engineConfig: config, childSessionFactory: childFactory });
    const tools = buildDelegateTool(fakeHarnessCtx, opts);
    const tool = tools[0];

    const result = await tool.execute("call-3", {
      tasks: [
        { id: "j1", prompt: "p1" },
        { id: "j2", prompt: "p2" },
        { id: "j3", prompt: "p3" },
      ],
    }, undefined);

    expect(factoryCalled).toBe(false);
    expect((result.content.find((c) => c.type === "text")!.text as string).toLowerCase()).toMatch(/error|too many/);
  });

  test("DL-4: one child throws — digest shows error for that job, other jobs succeed", async () => {
    let callIdx = 0;
    const childFactory: ChildSessionFactory = async (opts) => {
      const idx = callIdx++;
      const response = idx === 1 ? new Error("child boom") : "success";
      return { session: new MockChildSession(opts.jobId, response) as any, dispose: () => {} };
    };
    const opts = makeOpts({ childSessionFactory: childFactory });
    const tools = buildDelegateTool(fakeHarnessCtx, opts);
    const tool = tools[0];

    const result = await tool.execute("call-4", {
      tasks: [
        { id: "ok-1", prompt: "do fine" },
        { id: "err-1", prompt: "do fail" },
        { id: "ok-2", prompt: "do fine too" },
      ],
    }, undefined);

    const text = result.content.find((c) => c.type === "text")!.text as string;
    expect(text).toContain("ok-1");
    expect(text).toContain("err-1");
    expect(text).toContain("ok-2");
    expect(text).toContain("success");
    expect(text).toContain("child boom");
  });

  test("DL-5: abort signal — when signal fires before tasks run, remaining queued tasks report AbortError", async () => {
    // Create a 1-slot provider so second task must queue behind first
    const registry = new ProviderLimiterRegistry();
    registry.register("myProvider", 1, 5000);

    // The first child will block until we resolve it
    let unblock!: () => void;
    const block = new Promise<void>((r) => { unblock = r; });

    const childFactory: ChildSessionFactory = async (opts) => {
      const session: any = {
        agent: { state: { thinkingLevel: "off", messages: [] } },
        subscribe: (cb: any) => () => {},
        prompt: async (_text: string) => {
          await block;
          session.agent.state.messages = [{ role: "assistant", content: [{ type: "text", text: "done" }] }];
        },
        dispose: () => {},
        abort: () => {},
      };
      return { session, dispose: () => {} };
    };

    const ac = new AbortController();
    const emitted: EngineEvent[] = [];
    const opts = makeOpts({ childSessionFactory: childFactory, limiterRegistry: registry }, emitted);
    const tools = buildDelegateTool(fakeHarnessCtx, opts);
    const tool = tools[0];

    const executePromise = tool.execute("call-5", {
      tasks: [
        { id: "slow", prompt: "slow task" },
        { id: "queued", prompt: "queued task" },
      ],
    }, ac.signal);

    // Let first task start, then abort
    await new Promise((r) => setTimeout(r, 20));
    ac.abort();
    unblock();

    const result = await executePromise;
    const text = result.content.find((c) => c.type === "text")!.text as string;
    // At least one job should mention an error (the aborted/queued one)
    expect(text).toMatch(/error|abort/i);
  });

  test("DL-6: child tool events are forwarded as isInternal with parentCallId = toolCallId", async () => {
    const emitted: EngineEvent[] = [];
    const opts = makeOpts({}, emitted);
    const tools = buildDelegateTool(fakeHarnessCtx, opts);
    const tool = tools[0];

    const toolCallId = "call-6";
    await tool.execute(toolCallId, { tasks: [{ id: "fwd-job", prompt: "do it" }] }, undefined);

    const internalEvents = emitted.filter((e) => (e as any).isInternal === true);
    expect(internalEvents.length).toBeGreaterThan(0);
    for (const ev of internalEvents) {
      expect((ev as any).parentCallId).toBe(toolCallId);
    }
  });

  test("DL-7: delegate group is NOT in child tool list (buildChildTools receives groups without 'delegate')", async () => {
    const receivedGroups: string[][] = [];
    const opts = makeOpts({
      buildChildTools: (groups) => {
        receivedGroups.push(groups);
        return [];
      },
    });
    const tools = buildDelegateTool(fakeHarnessCtx, opts);
    const tool = tools[0];

    await tool.execute("call-7", {
      tasks: [{ id: "d-job", prompt: "work", tools: ["read", "delegate"] }],
    }, undefined);

    expect(receivedGroups.length).toBeGreaterThan(0);
    for (const groups of receivedGroups) {
      expect(groups).not.toContain("delegate");
    }
  });

  test("DL-8: disabled via config (enabled: false) — buildDelegateTool returns empty array", () => {
    const config: PiEngineConfig = {
      type: "pi",
      harness: { delegate: { enabled: false } },
    };
    const tools = buildDelegateTool(fakeHarnessCtx, makeOpts({ engineConfig: config }));
    expect(tools).toHaveLength(0);
  });

  test("DL-9: duplicate task ids — returns error, no children spawned", async () => {
    let spawnCount = 0;
    const factory: ChildSessionFactory = async () => {
      spawnCount++;
      throw new Error("should not be called");
    };
    const [tool] = buildDelegateTool(fakeHarnessCtx, makeOpts({ childSessionFactory: factory }));
    const result = await tool.execute("call-9", {
      tasks: [
        { id: "same", prompt: "p1" },
        { id: "same", prompt: "p2" },
      ],
    }, undefined);

    const text = (result.content[0] as { text: string }).text;
    expect(text).toMatch(/duplicate/i);
    expect(text).toContain("same");
    expect(spawnCount).toBe(0);
  });

  test("DL-10: empty task id — returns error, no children spawned", async () => {
    let spawnCount = 0;
    const factory: ChildSessionFactory = async () => {
      spawnCount++;
      throw new Error("should not be called");
    };
    const [tool] = buildDelegateTool(fakeHarnessCtx, makeOpts({ childSessionFactory: factory }));
    const result = await tool.execute("call-10", {
      tasks: [{ id: "", prompt: "p1" }],
    }, undefined);

    const text = (result.content[0] as { text: string }).text;
    expect(text).toMatch(/empty/i);
    expect(spawnCount).toBe(0);
  });

  test("DL-11: disallowed tool group in task.tools — returns error naming rejected group", async () => {
    let spawnCount = 0;
    const factory: ChildSessionFactory = async () => {
      spawnCount++;
      throw new Error("should not be called");
    };
    const config: PiEngineConfig = {
      type: "pi",
      harness: { delegate: { allow_tools: ["read"] } },
    };
    const [tool] = buildDelegateTool(fakeHarnessCtx, makeOpts({ childSessionFactory: factory, engineConfig: config }));
    const result = await tool.execute("call-11", {
      tasks: [{ id: "t1", prompt: "p1", tools: ["shell"] }],
    }, undefined);

    const text = (result.content[0] as { text: string }).text;
    expect(text).toMatch(/disallowed/i);
    expect(text).toContain("shell");
    expect(spawnCount).toBe(0);
  });
});
