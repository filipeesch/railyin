/**
 * railyin-agent.test.ts — RailyinAgent (AbstractAgent subclass) lifecycle tests
 * (RUNR-01/03, D-01). A fake ExecutionCoordinator drives onEngineEvent/onRunEnd;
 * the agent's run() must emit RUN_STARTED FIRST (with input), mapped events in
 * order, and exactly one terminal LAST (Pitfall 3).
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { EventType, type RunAgentInput } from "@ag-ui/core";
import type { BaseEvent } from "@ag-ui/client";
import { initDb, seedChatSession } from "../test/helpers.ts";
import type { Database } from "bun:sqlite";
import type { EngineEvent } from "../engine/types.ts";
import type { ExecutionCoordinator } from "../engine/coordinator.ts";
import { RailyinAgent } from "./railyin-agent.ts";

/** Collect a run's events by subscribing to the agent's observable. */
function collectRun(agent: RailyinAgent, input: RunAgentInput): Promise<BaseEvent[]> {
  return new Promise((resolve, reject) => {
    const events: BaseEvent[] = [];
    const obs = agent.run(input);
    obs.subscribe({
      next: (e) => events.push(e as BaseEvent),
      error: (err) => reject(err),
      complete: () => resolve(events),
    });
  });
}

function runInput(threadId: string, text = "hello"): RunAgentInput {
  return {
    threadId,
    runId: "run-test-1",
    state: [],
    tools: [],
    context: [],
    messages: [{ id: "u1", role: "user", content: [{ type: "text", text }] }],
  };
}

let db: Database;
let fakeCoordinator: ExecutionCoordinator;
let cancelCalls: number[];
let capturedOpts: { onEngineEvent?: (e: EngineEvent) => void; onRunEnd?: (o: "done" | "error" | "aborted" | "decision") => void } | undefined;

function makeAgent(conversationId: number): RailyinAgent {
  return new RailyinAgent(db, fakeCoordinator);
}

beforeEach(() => {
  db = initDb();
  cancelCalls = [];
  capturedOpts = undefined;
  fakeCoordinator = {
    executeTransition: async () => { throw new Error("not implemented"); },
    executeHumanTurn: async () => { throw new Error("not implemented"); },
    executeRetry: async () => { throw new Error("not implemented"); },
    executeCodeReview: async () => { throw new Error("not implemented"); },
    respondShellApprovalByExecution: async () => { throw new Error("not implemented"); },
    executeChatTurn: async (_sessionId, _conversationId, _content, _model, _mcp, _ws, _att, _ec, opts) => {
      capturedOpts = opts;
      // Drive the scripted sequence synchronously, then end the run.
      if (opts) {
        opts.onEngineEvent?.({ type: "token", content: "Hello" });
        opts.onEngineEvent?.({ type: "reasoning", content: "thinking" });
        opts.onEngineEvent?.({ type: "tool_start", name: "read_file", callId: "call_1", arguments: "{}" });
        opts.onEngineEvent?.({ type: "tool_result", name: "read_file", callId: "call_1", result: "file contents" });
        opts.onRunEnd?.("done");
      }
      return { message: { id: 1 } as never, executionId: 42 };
    },
    cancel: (executionId) => cancelCalls.push(executionId),
    listModels: async () => [],
    compactTask: async () => {},
    compactConversation: async () => {},
    listCommands: async () => [],
  };
});

afterEach(() => {
  db.close();
});

describe("RailyinAgent", () => {
  test("1: run() emits RUN_STARTED FIRST (with input), mapped events in order, RUN_FINISHED LAST", async () => {
    const { conversationId } = seedChatSession(db);
    const agent = makeAgent(conversationId);
    const input = runInput(String(conversationId), "hello");
    const events = await collectRun(agent, input);

    const types = events.map((e) => e.type);
    expect(types[0]).toBe(EventType.RUN_STARTED);
    expect(types[types.length - 1]).toBe(EventType.RUN_FINISHED);
    expect(types as unknown[]).toEqual([
      EventType.RUN_STARTED,
      "TEXT_MESSAGE_START",
      "TEXT_MESSAGE_CONTENT",
      "TEXT_MESSAGE_END",
      "REASONING_MESSAGE_START",
      "REASONING_MESSAGE_CONTENT",
      "REASONING_MESSAGE_END",
      "TOOL_CALL_START",
      "TOOL_CALL_ARGS",
      "TOOL_CALL_END",
      "TOOL_CALL_RESULT",
      EventType.RUN_FINISHED,
    ]);

    const started = events[0] as unknown as { threadId: string; runId: string; input: RunAgentInput };
    expect(started.threadId).toBe(String(conversationId));
    expect(started.runId).toBe("run-test-1");
    // RUN_STARTED carries the input so the runner's persisted user turn matches the wire.
    expect(started.input?.messages[0]).toMatchObject({ role: "user" });
  });

  test("2: clone() re-attaches injected deps (Pitfall 1)", async () => {
    const { conversationId } = seedChatSession(db);
    const agent = makeAgent(conversationId);
    const clone = agent.clone() as RailyinAgent;
    expect(clone.orchestrator).toBe(fakeCoordinator);
    expect(clone).not.toBe(agent);
    // The clone's run works — deps are live.
    const events = await collectRun(clone, runInput(String(conversationId)));
    expect(events[0].type).toBe(EventType.RUN_STARTED);
    expect(events[events.length - 1].type).toBe(EventType.RUN_FINISHED);
  });

  test("3: abortRun() routes to coordinator.cancel(executionId)", async () => {
    const { conversationId } = seedChatSession(db);
    const agent = makeAgent(conversationId);
    // Start a run (fake returns executionId 42 synchronously).
    const obs = agent.run(runInput(String(conversationId)));
    await new Promise((resolve) => setTimeout(resolve, 0));
    obs.subscribe({ next: () => {}, error: () => {}, complete: () => {} });
    agent.abortRun();
    expect(cancelCalls).toContain(42);
  });

  test("4: stream completes without onRunEnd → completion guard appends RUN_FINISHED (Pitfall 3)", async () => {
    const { conversationId } = seedChatSession(db);
    // Fake drives onEngineEvent but NEVER calls onRunEnd (pause path).
    fakeCoordinator = {
      ...fakeCoordinator,
      executeChatTurn: async (_s, _c, _content, _m, _mcp, _ws, _att, _ec, opts) => {
        capturedOpts = opts;
        if (opts) {
          opts.onEngineEvent?.({ type: "token", content: "Hello" });
          opts.onEngineEvent?.({ type: "ask_user", payload: "{}" });
          // no onRunEnd — consume ended via pause path
        }
        return { message: { id: 1 } as never, executionId: 7 };
      },
    };
    const agent = makeAgent(conversationId);
    const events = await collectRun(agent, runInput(String(conversationId)));

    const types = events.map((e) => e.type);
    expect(types[0]).toBe(EventType.RUN_STARTED);
    expect(types[types.length - 1]).toBe(EventType.RUN_FINISHED);
    expect(types.filter((t) => t === EventType.RUN_ERROR)).toHaveLength(0);
  });

  test("5: unknown conversation → RUN_ERROR without calling executeChatTurn", async () => {
    const agent = makeAgent(999_999); // no such conversation
    let executeChatTurnCalls = 0;
    const realFake = fakeCoordinator;
    fakeCoordinator = {
      ...realFake,
      executeChatTurn: async () => {
        executeChatTurnCalls += 1;
        return { message: { id: 1 } as never, executionId: 1 };
      },
    };
    agent.orchestrator = fakeCoordinator;

    const events = await collectRun(agent, runInput("999999", "hello"));
    expect(executeChatTurnCalls).toBe(0);
    expect(events[0].type).toBe(EventType.RUN_STARTED);
    expect(events[events.length - 1].type).toBe(EventType.RUN_ERROR);
    expect(events[events.length - 1]).toMatchObject({ code: "THREAD_NOT_FOUND" });
  });

  test("6: non-numeric threadId → RUN_ERROR without any DB or executor side effect (T-02-01)", async () => {
    const agent = makeAgent(1);
    let executeChatTurnCalls = 0;
    fakeCoordinator = {
      ...fakeCoordinator,
      executeChatTurn: async () => {
        executeChatTurnCalls += 1;
        return { message: { id: 1 } as never, executionId: 1 };
      },
    };
    agent.orchestrator = fakeCoordinator;

    const events = await collectRun(agent, runInput("../../etc/passwd", "hello"));
    expect(executeChatTurnCalls).toBe(0);
    expect(events[events.length - 1].type).toBe(EventType.RUN_ERROR);
  });
});
