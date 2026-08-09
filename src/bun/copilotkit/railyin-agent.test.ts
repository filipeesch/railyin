/**
 * railyin-agent.test.ts — RailyinAgent (AbstractAgent subclass) lifecycle tests
 * (RUNR-01/03, D-01). A fake ExecutionCoordinator drives onEngineEvent/onRunEnd;
 * the agent's run() must emit RUN_STARTED FIRST (with input), mapped events in
 * order, and exactly one terminal LAST (Pitfall 3).
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { EventType, type RunAgentInput } from "@ag-ui/core";
import type { BaseEvent } from "@ag-ui/client";
import { initDb, seedChatSession, seedProjectAndTask } from "../test/helpers.ts";
import { getDefaultWorkspaceKey } from "../workspace-context.ts";
import type { Database } from "bun:sqlite";
import type { EngineEvent } from "../engine/types.ts";
import type { ExecutionCoordinator } from "../engine/coordinator.ts";
import { RailyinAgent, resolveWorkspaceKey } from "./railyin-agent.ts";

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
let capturedWorkspaceKey: string | null;
let capturedOpts: { onEngineEvent?: (e: EngineEvent) => void; onRunEnd?: (o: "done" | "error" | "aborted" | "decision") => void } | undefined;

function makeAgent(conversationId: number): RailyinAgent {
  return new RailyinAgent(db, fakeCoordinator);
}

beforeEach(() => {
  db = initDb();
  cancelCalls = [];
  capturedWorkspaceKey = null;
  capturedOpts = undefined;
  fakeCoordinator = {
    executeTransition: async () => { throw new Error("not implemented"); },
    executeHumanTurn: async () => { throw new Error("not implemented"); },
    executeRetry: async () => { throw new Error("not implemented"); },
    executeCodeReview: async () => { throw new Error("not implemented"); },
    respondShellApprovalByExecution: async () => { throw new Error("not implemented"); },
    executeChatTurn: async (_sessionId, _conversationId, _content, _model, _mcp, ws, _att, _ec, opts) => {
      capturedWorkspaceKey = ws ?? null;
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

  test("3: abortRun() routes to coordinator.cancel(executionId); late abort after completion is a no-op (IN-02)", async () => {
    const { conversationId } = seedChatSession(db);
    const agent = makeAgent(conversationId);

    // Part 1: the run COMPLETES (default fake drives onRunEnd('done')) — a
    // late abortRun must NOT cancel the stale executionId (IN-02 clears
    // activeRun at the terminal).
    const completedEvents = await collectRun(agent, runInput(String(conversationId)));
    expect(completedEvents[completedEvents.length - 1].type).toBe(EventType.RUN_FINISHED);
    const cancelCountAfterCompletion = cancelCalls.length;
    agent.abortRun();
    expect(cancelCalls.length).toBe(cancelCountAfterCompletion);

    // Part 2: the run stays ACTIVE (fake never calls onRunEnd) — abortRun
    // reaches the orchestrator with the live executionId.
    fakeCoordinator = {
      ...fakeCoordinator,
      executeChatTurn: async (_s, _c, _content, _m, _mcp, _ws, _att, _ec, opts) => {
        capturedOpts = opts;
        if (opts) opts.onEngineEvent?.({ type: "token", content: "thinking" });
        return { message: { id: 1 } as never, executionId: 42 };
      },
    };
    agent.orchestrator = fakeCoordinator;
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

  test("4a: abort mid-token closes open text/reasoning blocks BEFORE the terminal (WR-01)", async () => {
    const { conversationId } = seedChatSession(db);
    // stream-processor's abort path flushes accumulators and calls
    // onRunEnd("aborted") WITHOUT a closing done engine event — the text
    // block is still open when finish() runs.
    fakeCoordinator = {
      ...fakeCoordinator,
      executeChatTurn: async (_s, _c, _content, _m, _mcp, _ws, _att, _ec, opts) => {
        capturedOpts = opts;
        if (opts) {
          opts.onEngineEvent?.({ type: "token", content: "partial" });
          opts.onEngineEvent?.({ type: "reasoning", content: "think" });
          opts.onRunEnd?.("aborted");
        }
        return { message: { id: 1 } as never, executionId: 42 };
      },
    };
    const agent = makeAgent(conversationId);
    const events = await collectRun(agent, runInput(String(conversationId)));
    const types = events.map((e) => e.type);

    // Both END events must precede the terminal — no active message when
    // RUN_FINISHED is emitted (verifyEvents contract).
    const textEnd = types.indexOf(EventType.TEXT_MESSAGE_END);
    const reasoningEnd = types.indexOf(EventType.REASONING_MESSAGE_END);
    const finished = types.lastIndexOf(EventType.RUN_FINISHED);
    expect(textEnd).toBeGreaterThan(-1);
    expect(reasoningEnd).toBeGreaterThan(-1);
    expect(textEnd).toBeLessThan(finished);
    expect(reasoningEnd).toBeLessThan(finished);
    expect(types[types.length - 1]).toBe(EventType.RUN_FINISHED);
  });

  test("4b: abort with an open tool call synthesizes its RESULT before the terminal (WR-01 + D-09)", async () => {
    const { conversationId } = seedChatSession(db);
    fakeCoordinator = {
      ...fakeCoordinator,
      executeChatTurn: async (_s, _c, _content, _m, _mcp, _ws, _att, _ec, opts) => {
        capturedOpts = opts;
        if (opts) {
          opts.onEngineEvent?.({ type: "token", content: "partial" });
          opts.onEngineEvent?.({ type: "tool_start", name: "bash", callId: "call_1", arguments: "{}" });
          // abort — no tool_result, no done
          opts.onRunEnd?.("aborted");
        }
        return { message: { id: 1 } as never, executionId: 43 };
      },
    };
    const agent = makeAgent(conversationId);
    const events = await collectRun(agent, runInput(String(conversationId)));
    const types = events.map((e) => e.type);

    const textEnd = types.indexOf(EventType.TEXT_MESSAGE_END);
    const resultIdx = types.indexOf(EventType.TOOL_CALL_RESULT);
    const finished = types.lastIndexOf(EventType.RUN_FINISHED);
    expect(textEnd).toBeGreaterThan(-1);
    expect(resultIdx).toBeGreaterThan(-1);
    // END + synthesized RESULT both precede the terminal.
    expect(textEnd).toBeLessThan(finished);
    expect(resultIdx).toBeLessThan(finished);
    expect(types[types.length - 1]).toBe(EventType.RUN_FINISHED);
  });

  test("4c: async engine stream ending without a terminal completes with RUN_FINISHED (WR-02, no wedge)", async () => {
    const { conversationId } = seedChatSession(db);
    // Real-engine shape: events dispatch ASYNCHRONOUSLY (after executeChatTurn
    // resolves) and the stream ends without a terminal — the Pi engine's
    // non-fatal-error-then-return path. The old dispatch-scoped guard never
    // fired here, wedging the thread ("Thread already running" forever).
    fakeCoordinator = {
      ...fakeCoordinator,
      executeChatTurn: async (_s, _c, _content, _m, _mcp, _ws, _att, _ec, opts) => {
        capturedOpts = opts;
        setTimeout(() => {
          opts?.onEngineEvent?.({ type: "token", content: "Hi" });
          // stream ends — no onRunEnd, no done event (fatal:false error).
          opts?.onEngineEvent?.({ type: "error", message: "transient", fatal: false });
        }, 10);
        return { message: { id: 1 } as never, executionId: 42 };
      },
    };
    const agent = makeAgent(conversationId);
    const events = await collectRun(agent, runInput(String(conversationId)));

    const types = events.map((e) => e.type);
    expect(types[0]).toBe(EventType.RUN_STARTED);
    expect(types[types.length - 1]).toBe(EventType.RUN_FINISHED);
    // The async text block is closed before the terminal (WR-01 shape).
    const textEnd = types.indexOf(EventType.TEXT_MESSAGE_END);
    expect(textEnd).toBeGreaterThan(-1);
    expect(textEnd).toBeLessThan(types.lastIndexOf(EventType.RUN_FINISHED));
  });

  test("4d: async ask_user pause (engine returns, no onRunEnd) completes with RUN_FINISHED (WR-02)", async () => {
    const { conversationId } = seedChatSession(db);
    fakeCoordinator = {
      ...fakeCoordinator,
      executeChatTurn: async (_s, _c, _content, _m, _mcp, _ws, _att, _ec, opts) => {
        capturedOpts = opts;
        setTimeout(() => {
          opts?.onEngineEvent?.({ type: "token", content: "Hi" });
          // pause-path return: ask_user is the last event, no onRunEnd.
          opts?.onEngineEvent?.({ type: "ask_user", payload: "{}" });
        }, 10);
        return { message: { id: 1 } as never, executionId: 44 };
      },
    };
    const agent = makeAgent(conversationId);
    const events = await collectRun(agent, runInput(String(conversationId)));
    const types = events.map((e) => e.type);
    expect(types[types.length - 1]).toBe(EventType.RUN_FINISHED);
    expect(types.filter((t) => t === EventType.RUN_ERROR)).toHaveLength(0);
  });

  test("4e: Pi pre-flight failure (executionId -1, no events) completes with RUN_FINISHED (WR-02)", async () => {
    const { conversationId } = seedChatSession(db);
    fakeCoordinator = {
      ...fakeCoordinator,
      executeChatTurn: async () => {
        // chat-executor's Pi pre-flight fail-fast: no events, no onRunEnd.
        return { message: { id: 1 } as never, executionId: -1 };
      },
    };
    const agent = makeAgent(conversationId);
    const events = await collectRun(agent, runInput(String(conversationId)));

    expect(events[0].type).toBe(EventType.RUN_STARTED);
    expect(events[events.length - 1].type).toBe(EventType.RUN_FINISHED);
    // Exactly one terminal, never a hang.
    expect(events.filter((e) => e.type === EventType.RUN_FINISHED || e.type === EventType.RUN_ERROR)).toHaveLength(1);
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

  test("7: resolver task-linked branch — board.workspace_key wins over default (RUNR-03)", async () => {
    const { conversationId } = seedProjectAndTask(db, "/tmp/x", { workspaceKey: "ws-task" });
    const agent = makeAgent(conversationId);

    const events = await collectRun(agent, runInput(String(conversationId), "hello"));
    expect(capturedWorkspaceKey).toBe("ws-task");
    expect(events[events.length - 1].type).toBe(EventType.RUN_FINISHED);
  });

  test("8: resolver session branch — chat_sessions.workspace_key wins for standalone conversations (RUNR-03)", async () => {
    const { conversationId } = seedChatSession(db, { workspaceKey: "ws-session" });
    const agent = makeAgent(conversationId);

    const events = await collectRun(agent, runInput(String(conversationId), "hello"));
    expect(capturedWorkspaceKey).toBe("ws-session");
    expect(events[events.length - 1].type).toBe(EventType.RUN_FINISHED);
  });

  test("9: resolver default branch — neither task nor session → getDefaultWorkspaceKey() (RUNR-03)", async () => {
    // Bare conversation: no task row, no chat_sessions row.
    db.run("INSERT INTO conversations (task_id) VALUES (NULL)");
    const conversationId = (db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!).id;
    const agent = makeAgent(conversationId);

    const events = await collectRun(agent, runInput(String(conversationId), "hello"));
    expect(capturedWorkspaceKey).toBe(getDefaultWorkspaceKey());
    expect(events[events.length - 1].type).toBe(EventType.RUN_FINISHED);
  });

  test("10: advisory cross-path lock — active executions row → RUN_ERROR THREAD_BUSY without executeChatTurn; completed row never blocks (RUNR-04)", async () => {
    const { conversationId } = seedChatSession(db);
    let executeChatTurnCalls = 0;
    fakeCoordinator = {
      ...fakeCoordinator,
      executeChatTurn: async (_s, _c, _content, _m, _mcp, _ws, _att, _ec, opts) => {
        executeChatTurnCalls += 1;
        opts?.onRunEnd?.("done");
        return { message: { id: 1 } as never, executionId: 1 };
      },
    };
    const agent = makeAgent(conversationId);
    agent.orchestrator = fakeCoordinator;

    // 'running' row → rejected before any executor work.
    db.run(
      "INSERT INTO executions (conversation_id, from_state, to_state, status) VALUES (?, 'backlog', 'plan', 'running')",
      [conversationId],
    );
    const events = await collectRun(agent, runInput(String(conversationId), "hello"));
    expect(executeChatTurnCalls).toBe(0);
    expect(events[0].type).toBe(EventType.RUN_STARTED);
    expect(events[events.length - 1].type).toBe(EventType.RUN_ERROR);
    expect(events[events.length - 1]).toMatchObject({ code: "THREAD_BUSY" });

    // 'waiting_user' row also rejects.
    db.run("DELETE FROM executions");
    db.run(
      "INSERT INTO executions (conversation_id, from_state, to_state, status) VALUES (?, 'plan', 'done', 'waiting_user')",
      [conversationId],
    );
    const events2 = await collectRun(agent, runInput(String(conversationId), "hello"));
    expect(executeChatTurnCalls).toBe(0);
    expect(events2[events2.length - 1]).toMatchObject({ code: "THREAD_BUSY" });

    // 'completed' row → never blocks; the run proceeds normally.
    db.run("DELETE FROM executions");
    db.run(
      "INSERT INTO executions (conversation_id, from_state, to_state, status) VALUES (?, 'backlog', 'done', 'completed')",
      [conversationId],
    );
    const events3 = await collectRun(agent, runInput(String(conversationId), "hello"));
    expect(executeChatTurnCalls).toBe(1);
    expect(events3[events3.length - 1].type).toBe(EventType.RUN_FINISHED);
  });

  test("11: unknown conversation — resolver returns null; run() → RUN_ERROR THREAD_NOT_FOUND, executeChatTurn never called (T-02-15)", async () => {
    expect(resolveWorkspaceKey(db, 999_999)).toBeNull();

    let executeChatTurnCalls = 0;
    fakeCoordinator = {
      ...fakeCoordinator,
      executeChatTurn: async (_s, _c, _content, _m, _mcp, _ws, _att, _ec, _opts) => {
        executeChatTurnCalls += 1;
        return { message: { id: 1 } as never, executionId: 1 };
      },
    };
    const agent = makeAgent(999_999);
    agent.orchestrator = fakeCoordinator;

    const events = await collectRun(agent, runInput("999999", "hello"));
    expect(executeChatTurnCalls).toBe(0);
    expect(events[0].type).toBe(EventType.RUN_STARTED);
    expect(events[events.length - 1].type).toBe(EventType.RUN_ERROR);
    expect(events[events.length - 1]).toMatchObject({ code: "THREAD_NOT_FOUND" });
  });
});
