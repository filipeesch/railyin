/**
 * Unit tests for src/bun/engine/cursor/inprocess-adapter.ts
 *
 * Uses an injected fake `{ Agent, Cursor }` SDK client (see the
 * `CursorSdkClient` constructor param) instead of a real subprocess or
 * network call — this is what the in-process migration buys us over the
 * old `worker-client.test.ts`, which had to spawn a real Node subprocess.
 */

import { describe, expect, it, vi } from "vitest";
import { AgentBusyError } from "@cursor/sdk";
import type { Run, RunResult, SDKAgent, SDKCustomTool } from "@cursor/sdk";
import type { EngineEvent } from "@bun/engine/types";
import { InProcessCursorAdapter, type CursorSdkClient } from "./inprocess-adapter.ts";
import type { CursorRunConfig } from "./adapter.ts";
import type { CursorSDKMessage } from "./translate-events.ts";

function baseConfig(overrides: Partial<CursorRunConfig> = {}): CursorRunConfig {
  return {
    executionId: 1,
    taskId: 1,
    conversationId: 1,
    prompt: "test prompt",
    workingDirectory: "/tmp",
    sessionId: "cursor-1",
    ...overrides,
  };
}

async function collect(adapter: InProcessCursorAdapter, config = baseConfig()): Promise<EngineEvent[]> {
  const events: EngineEvent[] = [];
  for await (const event of adapter.run(config)) events.push(event);
  return events;
}

function makeFakeRun(overrides: {
  messages?: CursorSDKMessage[];
  waitResult?: RunResult;
  waitError?: Error;
  cancel?: () => Promise<void>;
  stream?: () => AsyncGenerator<CursorSDKMessage>;
} = {}): Run {
  const cancel = vi.fn(overrides.cancel ?? (async () => {}));
  async function* defaultStream() {
    for (const m of overrides.messages ?? []) yield m;
  }
  return {
    id: "run-1",
    agentId: "agent-1",
    stream: overrides.stream ?? defaultStream,
    wait: vi.fn(async () => {
      if (overrides.waitError) throw overrides.waitError;
      return overrides.waitResult ?? { id: "run-1", status: "finished" };
    }),
    cancel,
    status: "running",
    supports: () => true,
    unsupportedReason: () => undefined,
    conversation: async () => [],
    onDidChangeStatus: () => () => {},
  } as unknown as Run;
}

function makeFakeAgent(run: Run, overrides: { close?: () => void } = {}): SDKAgent {
  const close = vi.fn(overrides.close ?? (() => {}));
  return {
    agentId: "agent-1",
    model: undefined,
    send: vi.fn(async () => run),
    close,
    reload: async () => {},
    [Symbol.asyncDispose]: async () => {},
    listArtifacts: async () => [],
    downloadArtifact: async () => Buffer.from(""),
  } as unknown as SDKAgent;
}

function makeSdkClient(
  agent: SDKAgent,
  overrides: { resume?: () => Promise<SDKAgent>; create?: () => Promise<SDKAgent>; models?: unknown[] } = {},
): CursorSdkClient {
  return {
    Agent: {
      create: vi.fn(overrides.create ?? (async () => agent)),
      resume: vi.fn(overrides.resume ?? (async () => agent)),
    } as unknown as CursorSdkClient["Agent"],
    Cursor: {
      models: { list: vi.fn(async () => overrides.models ?? []) },
    } as unknown as CursorSdkClient["Cursor"],
  };
}

describe("InProcessCursorAdapter.run", () => {
  it("translates SDK stream messages into EngineEvents in order via translate-events.ts", async () => {
    const messages: CursorSDKMessage[] = [
      { type: "assistant", message: { content: [{ type: "text", text: "Hello" }] } },
      { type: "status", status: "RUNNING" },
    ];
    const run = makeFakeRun({ messages });
    const agent = makeFakeAgent(run);
    const adapter = new InProcessCursorAdapter({}, makeSdkClient(agent));

    expect(await collect(adapter)).toEqual([
      { type: "token", content: "Hello" },
      { type: "status", message: "RUNNING" },
      { type: "done" },
    ]);
  });

  it("maps run.wait() status:'error' to a fatal error using the SDK's string result", async () => {
    const run = makeFakeRun({ waitResult: { id: "run-1", status: "error", result: "boom" } });
    const agent = makeFakeAgent(run);
    const adapter = new InProcessCursorAdapter({}, makeSdkClient(agent));

    expect(await collect(adapter)).toEqual([
      { type: "error", message: "boom", fatal: true },
      { type: "done" },
    ]);
  });

  it("falls back to a generic message when run.wait() errors with no string result", async () => {
    const run = makeFakeRun({ waitResult: { id: "run-1", status: "error" } });
    const agent = makeFakeAgent(run);
    const adapter = new InProcessCursorAdapter({}, makeSdkClient(agent));

    expect(await collect(adapter)).toEqual([
      { type: "error", message: "Cursor agent run failed with no detail", fatal: true },
      { type: "done" },
    ]);
  });

  it("maps run.wait() throwing to a fatal error with a 'wait() threw' prefix", async () => {
    const run = makeFakeRun({ waitError: new Error("network down") });
    const agent = makeFakeAgent(run);
    const adapter = new InProcessCursorAdapter({}, makeSdkClient(agent));

    expect(await collect(adapter)).toEqual([
      { type: "error", message: "wait() threw: network down", fatal: true },
      { type: "done" },
    ]);
  });

  it("stops emitting events after abort and omits the terminal done", async () => {
    let releaseHook: () => void = () => {};
    const hook = new Promise<void>((resolve) => { releaseHook = resolve; });
    async function* stream(): AsyncGenerator<CursorSDKMessage> {
      yield { type: "assistant", message: { content: [{ type: "text", text: "first" }] } };
      await hook;
      yield { type: "assistant", message: { content: [{ type: "text", text: "late" }] } };
    }
    const run = makeFakeRun({ stream });
    const agent = makeFakeAgent(run);
    const adapter = new InProcessCursorAdapter({}, makeSdkClient(agent));

    const abort = new AbortController();
    const events: EngineEvent[] = [];
    const iterate = (async () => {
      for await (const event of adapter.run(baseConfig({ signal: abort.signal }))) {
        events.push(event);
      }
    })();

    await new Promise((r) => setTimeout(r, 0));
    abort.abort();
    releaseHook();
    await iterate;

    expect(events).toEqual([{ type: "token", content: "first" }]);
    expect(run.cancel).toHaveBeenCalled();
  });

  it("always cancels the run and closes the agent in finally, even when cancel() rejects", async () => {
    const run = makeFakeRun({ cancel: async () => { throw new Error("cancel failed"); } });
    const agent = makeFakeAgent(run);
    const adapter = new InProcessCursorAdapter({}, makeSdkClient(agent));

    await collect(adapter);

    expect(run.cancel).toHaveBeenCalledTimes(1);
    expect(agent.close).toHaveBeenCalledTimes(1);
  });

  it("also finalizes (cancel + close) when the run stream throws mid-iteration", async () => {
    async function* stream(): AsyncGenerator<CursorSDKMessage> {
      yield { type: "assistant", message: { content: [{ type: "text", text: "partial" }] } };
      throw new Error("stream exploded");
    }
    const run = makeFakeRun({ stream });
    const agent = makeFakeAgent(run);
    const adapter = new InProcessCursorAdapter({}, makeSdkClient(agent));

    const events = await collect(adapter);
    expect(events).toEqual([
      { type: "token", content: "partial" },
      { type: "error", message: "stream exploded", fatal: true },
      { type: "done" },
    ]);
    expect(run.cancel).toHaveBeenCalledTimes(1);
    expect(agent.close).toHaveBeenCalledTimes(1);
  });

  it("emits a fatal error (and logs failureKind) when the agent stays persistently busy", async () => {
    const busyAgent = {
      send: vi.fn(async () => { throw new AgentBusyError("Agent already has active run"); }),
      close: vi.fn(async () => {}),
    } as unknown as SDKAgent;
    const sdk: CursorSdkClient = {
      Agent: {
        resume: vi.fn(async () => busyAgent),
        create: vi.fn(async () => busyAgent),
      } as unknown as CursorSdkClient["Agent"],
      Cursor: { models: { list: vi.fn(async () => []) } } as unknown as CursorSdkClient["Cursor"],
    };
    const adapter = new InProcessCursorAdapter({}, sdk);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const events = await collect(adapter, baseConfig({ agentId: "agent-x" }));

    expect(events).toEqual([
      { type: "error", message: "Cursor agent remained busy after same-id recreate", fatal: true },
      { type: "done" },
    ]);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("\"failureKind\":\"persistent_busy\""));
    errorSpy.mockRestore();
  });

  it("passes registered custom tools straight through to Agent.create/resume (no proxy/callId wrapping)", async () => {
    const run = makeFakeRun();
    const agent = makeFakeAgent(run);
    const sdk = makeSdkClient(agent);
    const adapter = new InProcessCursorAdapter({}, sdk);

    const tool: SDKCustomTool = {
      description: "echoes input",
      inputSchema: { type: "object", properties: {} },
      execute: vi.fn(async (args) => `echo:${JSON.stringify(args)}`),
    };

    await collect(adapter, baseConfig({ customTools: { echo_tool: tool } }));

    expect(sdk.Agent.create).toHaveBeenCalledWith(
      expect.objectContaining({ local: expect.objectContaining({ customTools: { echo_tool: tool } }) }),
    );
    // The real SDK calls execute() directly in-process — verify the exact
    // same object (not a serialized/proxied copy) was handed over.
    const passedOptions = (sdk.Agent.create as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      local: { customTools: Record<string, SDKCustomTool> };
    };
    expect(passedOptions.local.customTools.echo_tool!.execute).toBe(tool.execute);
  });
});

describe("InProcessCursorAdapter stall watchdog", () => {
  it("does not affect a healthy run that completes well before the (shortened) stall threshold", async () => {
    const messages: CursorSDKMessage[] = [
      { type: "assistant", message: { content: [{ type: "text", text: "Hello" }] } },
      { type: "status", status: "RUNNING" },
    ];
    const run = makeFakeRun({ messages });
    const agent = makeFakeAgent(run);
    const adapter = new InProcessCursorAdapter({}, makeSdkClient(agent), 500);

    expect(await collect(adapter)).toEqual([
      { type: "token", content: "Hello" },
      { type: "status", message: "RUNNING" },
      { type: "done" },
    ]);
  });

  it("yields a single fatal stall error and omits the terminal done when the stream hangs past the threshold", async () => {
    let releaseHook: () => void = () => {};
    const hook = new Promise<void>((resolve) => { releaseHook = resolve; });
    async function* stream(): AsyncGenerator<CursorSDKMessage> {
      yield { type: "assistant", message: { content: [{ type: "text", text: "first" }] } };
      await hook; // never released in this test — the stream truly never advances
      yield { type: "assistant", message: { content: [{ type: "text", text: "late" }] } };
    }
    const run = makeFakeRun({ stream });
    const agent = makeFakeAgent(run);
    const adapter = new InProcessCursorAdapter({}, makeSdkClient(agent), 25);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const events = await collect(adapter);

      expect(events).toEqual([
        { type: "token", content: "first" },
        { type: "error", message: expect.stringContaining("stalled"), fatal: true },
      ]);
      expect(run.cancel).toHaveBeenCalled();
    } finally {
      releaseHook();
      errorSpy.mockRestore();
    }
  });

  it("resets the stall timer on every SDK message, so cumulative stream duration can exceed the threshold", async () => {
    async function* stream(): AsyncGenerator<CursorSDKMessage> {
      for (let i = 0; i < 5; i++) {
        await new Promise((r) => setTimeout(r, 20));
        yield { type: "assistant", message: { content: [{ type: "text", text: `chunk-${i}` }] } };
      }
    }
    const run = makeFakeRun({ stream });
    const agent = makeFakeAgent(run);
    const adapter = new InProcessCursorAdapter({}, makeSdkClient(agent), 100);

    const events = await collect(adapter);

    expect(events).toEqual([
      { type: "token", content: "chunk-0" },
      { type: "token", content: "chunk-1" },
      { type: "token", content: "chunk-2" },
      { type: "token", content: "chunk-3" },
      { type: "token", content: "chunk-4" },
      { type: "done" },
    ]);
  });

  it("does not yield a stalled error when abort wins a near-simultaneous race against the stall timeout", async () => {
    let releaseHook: () => void = () => {};
    const hook = new Promise<void>((resolve) => { releaseHook = resolve; });
    async function* stream(): AsyncGenerator<CursorSDKMessage> {
      yield { type: "assistant", message: { content: [{ type: "text", text: "first" }] } };
      await hook;
      yield { type: "assistant", message: { content: [{ type: "text", text: "late" }] } };
    }
    const run = makeFakeRun({ stream });
    const agent = makeFakeAgent(run);
    const adapter = new InProcessCursorAdapter({}, makeSdkClient(agent), 20);

    const abort = new AbortController();
    const events: EngineEvent[] = [];
    const iterate = (async () => {
      for await (const event of adapter.run(baseConfig({ signal: abort.signal }))) {
        events.push(event);
      }
    })();

    // Abort right around when the 20ms stall threshold would elapse.
    await new Promise((r) => setTimeout(r, 15));
    abort.abort();
    releaseHook();
    await iterate;

    expect(events).toEqual([{ type: "token", content: "first" }]);
    expect(events.some((e) => e.type === "error" && e.message.includes("stalled"))).toBe(false);
    expect(events).not.toContainEqual({ type: "done" });
    expect(run.cancel).toHaveBeenCalled();
  });

  it("still yields the fatal stall error even when run.cancel() rejects during the stall", async () => {
    let releaseHook: () => void = () => {};
    const hook = new Promise<void>((resolve) => { releaseHook = resolve; });
    async function* stream(): AsyncGenerator<CursorSDKMessage> {
      yield { type: "assistant", message: { content: [{ type: "text", text: "first" }] } };
      await hook; // never released — simulates a hung stream
    }
    const run = makeFakeRun({ stream, cancel: async () => { throw new Error("cancel failed"); } });
    const agent = makeFakeAgent(run);
    const adapter = new InProcessCursorAdapter({}, makeSdkClient(agent), 25);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const events = await collect(adapter);

      expect(events).toEqual([
        { type: "token", content: "first" },
        { type: "error", message: expect.stringContaining("stalled"), fatal: true },
      ]);
      expect(run.cancel).toHaveBeenCalled();
    } finally {
      releaseHook();
      errorSpy.mockRestore();
    }
  });
});

describe("InProcessCursorAdapter.listModels", () => {
  it("returns an empty array and warns when no API key is configured", async () => {
    const run = makeFakeRun();
    const agent = makeFakeAgent(run);
    const sdk = makeSdkClient(agent);
    const adapter = new InProcessCursorAdapter({}, sdk);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const previousKey = process.env.CURSOR_API_KEY;
    delete process.env.CURSOR_API_KEY;

    try {
      const models = await adapter.listModels("/tmp");
      expect(models).toEqual([]);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("no api_key configured"));
      expect(sdk.Cursor.models.list).not.toHaveBeenCalled();
    } finally {
      if (previousKey !== undefined) process.env.CURSOR_API_KEY = previousKey;
      warnSpy.mockRestore();
    }
  });

  it("maps SDK models to CursorSdkModelInfo with the expected fields", async () => {
    const run = makeFakeRun();
    const agent = makeFakeAgent(run);
    const sdk = makeSdkClient(agent, {
      models: [
        {
          id: "claude-sonnet-4-6",
          displayName: "Claude Sonnet 4.6",
          description: "desc",
          supportsThinking: true,
          variants: [{ params: [], displayName: "Fast" }],
          parameters: [{ id: "effort", values: [{ value: "low" }] }],
        },
      ],
    });
    const adapter = new InProcessCursorAdapter({ apiKey: "test-key" }, sdk);

    const models = await adapter.listModels("/tmp");
    expect(models).toEqual([
      {
        value: "claude-sonnet-4-6",
        displayName: "Claude Sonnet 4.6",
        description: "desc",
        supportsThinking: true,
        variants: [{ params: [], displayName: "Fast" }],
        parameters: [{ id: "effort", values: [{ value: "low" }] }],
      },
    ]);
    expect(sdk.Cursor.models.list).toHaveBeenCalledWith({ apiKey: "test-key" });
  });
});

describe("InProcessCursorAdapter.listCommands", () => {
  it("always returns an empty array (DB-path resolution lives in CursorEngine, not the adapter)", async () => {
    const run = makeFakeRun();
    const agent = makeFakeAgent(run);
    const adapter = new InProcessCursorAdapter({}, makeSdkClient(agent));
    expect(await adapter.listCommands("/tmp")).toEqual([]);
  });
});

describe("InProcessCursorAdapter.shutdownAll", () => {
  it("cancels and closes all active runs", async () => {
    let releaseHook: () => void = () => {};
    const hook = new Promise<void>((resolve) => { releaseHook = resolve; });
    async function* stream(): AsyncGenerator<CursorSDKMessage> {
      await hook;
    }
    const run = makeFakeRun({ stream });
    const agent = makeFakeAgent(run);
    const adapter = new InProcessCursorAdapter({}, makeSdkClient(agent));

    const events: EngineEvent[] = [];
    const iterate = (async () => {
      for await (const event of adapter.run(baseConfig())) events.push(event);
    })();

    await new Promise((r) => setTimeout(r, 0));
    await adapter.shutdownAll();
    releaseHook();
    await iterate;

    expect(run.cancel).toHaveBeenCalled();
    expect(agent.close).toHaveBeenCalled();
  });
});
