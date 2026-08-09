/**
 * railyin-agent.test.ts — RailyinAgent (AbstractAgent subclass) lifecycle tests
 * (RUNR-01/03, D-01). A fake ExecutionCoordinator drives onEngineEvent/onRunEnd;
 * the agent's run() must emit RUN_STARTED FIRST (with input), mapped events in
 * order, and exactly one terminal LAST (Pitfall 3).
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { EventSchemas, EventType, type RunAgentInput } from "@ag-ui/core";
import type { BaseEvent } from "@ag-ui/client";
import { initDb, seedChatSession, seedProjectAndTask } from "../test/helpers.ts";
import { getDefaultWorkspaceKey } from "../workspace-context.ts";
import type { Database } from "bun:sqlite";
import type { EngineEvent } from "../engine/types.ts";
import type { ExecutionCoordinator } from "../engine/coordinator.ts";
import { RailyinAgent, resolveWorkspaceKey } from "./railyin-agent.ts";
import * as interruptRegistry from "./interrupt-registry.ts";

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

/** Resume-run input: history-only messages + the canonical RunAgentInput.resume[]. */
function resumeInput(threadId: string, resume: NonNullable<RunAgentInput["resume"]>): RunAgentInput {
  return {
    threadId,
    runId: "run-resume-1",
    state: [],
    tools: [],
    context: [],
    messages: [
      { id: "a1", role: "assistant", content: "I need your decision." },
      { id: "u1", role: "user", content: "history" },
    ],
    resume,
  };
}

/** Serialized DecisionRequestPayload used by the decision-cycle fakes. */
const DECISION_PAYLOAD = JSON.stringify({
  context: "mock context",
  questions: [{ question: "Q1", type: "exclusive", options: [{ title: "A", description: "" }] }],
});

/** Phase-5 resume payload (A1/Open Question 2 contract): the question text is
 * the __SCRIPT_DECISION__ Phase B marker — translated engineContent MUST carry
 * the formatted question (proof the engine received the decision). */
const RESUME_PAYLOAD = {
  decision: "approved",
  answers: [{ question: "Choose __DECISION_OPTION__", answer: "A", weight: "medium" }],
  generalNotes: "n",
  recordAsDecisions: true,
};

/**
 * Decision-cycle fake: drives onEngineEvent(token) →
 * onEngineEvent(decision_request) → onRunEnd("decision") synchronously inside
 * executeChatTurn, then resolves with executionId 42 (Pitfall 3 — the id is
 * minted while run.executionId is still null).
 */
function setDecisionCycleFake(): void {
  fakeCoordinator = {
    ...fakeCoordinator,
    executeChatTurn: async (_s, _c, _content, _m, _mcp, _ws, _att, _ec, opts) => {
      capturedOpts = opts;
      if (opts) {
        opts.onEngineEvent?.({ type: "token", content: "I need your decision." });
        opts.onEngineEvent?.({ type: "decision_request", payload: DECISION_PAYLOAD });
        opts.onRunEnd?.("decision");
      }
      return { message: { id: 1 } as never, executionId: 42 };
    },
  };
}

/**
 * Resume fake (chat routing): captures the TRANSLATED submission args and
 * drives the continuation (token + onRunEnd("done")) synchronously.
 */
function setResumeChatFake(): void {
  fakeCoordinator = {
    ...fakeCoordinator,
    executeChatTurn: async (_s, _c, content, _m, _mcp, ws, _att, engineContent, opts) => {
      capturedChatContent = content ?? null;
      capturedChatEngineContent = engineContent ?? null;
      capturedWorkspaceKey = ws ?? null;
      capturedOpts = opts;
      if (opts) {
        opts.onEngineEvent?.({ type: "token", content: "Decision received, continuing." });
        opts.onRunEnd?.("done");
      }
      return { message: { id: 1 } as never, executionId: 43 };
    },
  };
}

/**
 * Resume fake (task-linked routing, A6): captures the executeHumanTurn args
 * including the additive opts param.
 */
function setResumeTaskFake(): void {
  fakeCoordinator = {
    ...fakeCoordinator,
    executeHumanTurn: async (taskId, content, _att, engineContent, opts) => {
      capturedHumanTurnArgs = { taskId, content, engineContent: engineContent ?? undefined, opts };
      if (opts) {
        opts.onEngineEvent?.({ type: "token", content: "Decision received, continuing." });
        opts.onRunEnd?.("done");
      }
      return { message: { id: 1 } as never, executionId: 44 };
    },
  };
}

/** Seed the decision-paused DB state: a 'waiting_user' executions row with the
 * registry's executionId (the orphan stream-processor.ts:494-506 writes and no
 * existing code closes — Pitfall 2). */
function seedWaitingUserRow(conversationId: number, executionId: number): void {
  db.run(
    "INSERT INTO executions (id, conversation_id, from_state, to_state, status) VALUES (?, ?, 'backlog', 'plan', 'waiting_user')",
    [executionId, conversationId],
  );
}

/** Run one full decision cycle (fake) so the registry holds an OPEN interrupt
 * with the resolved executionId attached via the .then hook. */
async function openPendingDecision(conversationId: number): Promise<string> {
  const threadId = String(conversationId);
  setDecisionCycleFake(); // BEFORE makeAgent — the agent captures the fake by reference
  const agent = makeAgent(conversationId);
  const events = await collectRun(agent, runInput(threadId));
  expect(events[events.length - 1].type).toBe(EventType.RUN_FINISHED);
  const id = (events[events.length - 1] as unknown as { outcome: { interrupts: Array<{ id: string }> } })
    .outcome.interrupts[0].id;
  expect(interruptRegistry.get(threadId)?.executionId).toBe(42); // .then hook ran
  return id;
}

let db: Database;
let fakeCoordinator: ExecutionCoordinator;
let cancelCalls: number[];
let capturedWorkspaceKey: string | null;
let capturedOpts: { onEngineEvent?: (e: EngineEvent) => void; onRunEnd?: (o: "done" | "error" | "aborted" | "decision") => void } | undefined;
let capturedChatContent: string | null;
let capturedChatEngineContent: string | null;
let capturedHumanTurnArgs: { taskId: number; content: string; engineContent: string | undefined; opts: unknown } | null;

function makeAgent(conversationId: number): RailyinAgent {
  return new RailyinAgent(db, fakeCoordinator);
}

beforeEach(() => {
  db = initDb();
  // Module-level registry — reset between tests (Pattern 6: no cross-test leakage).
  interruptRegistry.reset();
  cancelCalls = [];
  capturedWorkspaceKey = null;
  capturedOpts = undefined;
  capturedChatContent = null;
  capturedChatEngineContent = null;
  capturedHumanTurnArgs = null;
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
      executeChatTurn: async (_s, _c, _content, _m, _mcp, _ws, _att, _ec, opts) => {
        executeChatTurnCalls += 1;
        opts?.onRunEnd?.("done");
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
      executeChatTurn: async (_s, _c, _content, _m, _mcp, _ws, _att, _ec, opts) => {
        executeChatTurnCalls += 1;
        opts?.onRunEnd?.("done");
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

  test("12: decision_request ends the run with RUN_FINISHED outcome.interrupt — RUN_STARTED first, text block, terminal LAST, never a RUN_ERROR (D-01/D-06)", async () => {
    const { conversationId } = seedChatSession(db);
    setDecisionCycleFake();
    const agent = makeAgent(conversationId);
    const events = await collectRun(agent, runInput(String(conversationId)));

    const types = events.map((e) => e.type);
    expect(types[0]).toBe(EventType.RUN_STARTED);
    expect(types[1]).toBe(EventType.TEXT_MESSAGE_START);
    expect(types[types.length - 1]).toBe(EventType.RUN_FINISHED);
    // Exactly one terminal; the interrupt is a NORMAL completion (D-03).
    expect(types.filter((t) => t === EventType.RUN_FINISHED || t === EventType.RUN_ERROR)).toHaveLength(1);
    expect(types).not.toContain(EventType.RUN_ERROR);

    const terminal = events[events.length - 1] as unknown as {
      outcome?: { type: string; interrupts?: Array<{ id: string; reason: string; message?: string; metadata?: unknown }> };
    };
    expect(terminal.outcome?.type).toBe("interrupt");
    const interrupt = terminal.outcome?.interrupts?.[0];
    expect(interrupt?.reason).toBe("decision_request");
    expect(interrupt?.id).toMatch(/^decision-\d+-\d+$/);
    expect(interrupt?.message).toBe("mock context");
    expect(interrupt?.metadata).toEqual(JSON.parse(DECISION_PAYLOAD));
  });

  test("13: the interrupt terminal zod-parses via EventSchemas (RUNR-08 — installed schemas ARE the contract)", async () => {
    const { conversationId } = seedChatSession(db);
    setDecisionCycleFake();
    const agent = makeAgent(conversationId);
    const events = await collectRun(agent, runInput(String(conversationId)));

    for (const event of events) {
      const parsed = EventSchemas.safeParse(event);
      expect(parsed.success).toBe(true);
    }
    const terminal = events[events.length - 1] as unknown as { outcome?: { type: string } };
    expect(terminal.outcome?.type).toBe("interrupt");
  });

  test("14: registry lifecycle — hasOpen true after the cycle; per-thread seq mints decision-<conv>-1/-2 (Pitfall 3/A3)", async () => {
    const { conversationId } = seedChatSession(db);
    const threadId = String(conversationId);
    setDecisionCycleFake();
    const agent = makeAgent(conversationId);

    const events1 = await collectRun(agent, runInput(threadId));
    expect(interruptRegistry.hasOpen(threadId)).toBe(true);
    const id1 = (events1[events1.length - 1] as unknown as { outcome: { interrupts: Array<{ id: string }> } }).outcome.interrupts[0].id;
    expect(id1).toBe(`decision-${conversationId}-1`);

    // clear removes the entry but KEEPS the per-thread seq — next batch mints -2.
    interruptRegistry.clear(threadId);
    const events2 = await collectRun(agent, runInput(threadId));
    const id2 = (events2[events2.length - 1] as unknown as { outcome: { interrupts: Array<{ id: string }> } }).outcome.interrupts[0].id;
    expect(id2).toBe(`decision-${conversationId}-2`);

    // A second thread mints its own seq from 1.
    const { conversationId: conversation2 } = seedChatSession(db);
    const agent2 = makeAgent(conversation2);
    const events3 = await collectRun(agent2, runInput(String(conversation2)));
    const id3 = (events3[events3.length - 1] as unknown as { outcome: { interrupts: Array<{ id: string }> } }).outcome.interrupts[0].id;
    expect(id3).toBe(`decision-${conversation2}-1`);
  });

  test("15: interrupt id is executionId-independent; updateExecutionId runs after executeChatTurn resolves (Pitfall 3)", async () => {
    const { conversationId } = seedChatSession(db);
    const threadId = String(conversationId);
    setDecisionCycleFake();
    const agent = makeAgent(conversationId);
    const events = await collectRun(agent, runInput(threadId));

    // The fake drives onRunEnd synchronously — executionId is still null when
    // the id is minted; the id must not be executionId-derived.
    const terminal = events[events.length - 1] as unknown as { outcome: { interrupts: Array<{ id: string }> } };
    const id = terminal.outcome.interrupts[0].id;
    expect(id).toMatch(/^decision-\d+-\d+$/);
    expect(id).not.toContain("undefined");

    // The .then hook attaches the resolved executionId to the registry entry.
    expect(interruptRegistry.get(threadId)?.executionId).toBe(42);
    expect(interruptRegistry.get(threadId)?.payload).toBe(DECISION_PAYLOAD);
  });

  test("16: malformed decision_request payload → metadata undefined + message fallback, still wire-valid (T-03-01)", async () => {
    const { conversationId } = seedChatSession(db);
    fakeCoordinator = {
      ...fakeCoordinator,
      executeChatTurn: async (_s, _c, _content, _m, _mcp, _ws, _att, _ec, opts) => {
        capturedOpts = opts;
        if (opts) {
          opts.onEngineEvent?.({ type: "token", content: "I need your decision." });
          opts.onEngineEvent?.({ type: "decision_request", payload: "not-json{{{" });
          opts.onRunEnd?.("decision");
        }
        return { message: { id: 1 } as never, executionId: 42 };
      },
    };
    const agent = makeAgent(conversationId);
    const events = await collectRun(agent, runInput(String(conversationId)));

    expect(events[events.length - 1].type).toBe(EventType.RUN_FINISHED);
    const terminal = events[events.length - 1] as unknown as {
      outcome: { type: string; interrupts: Array<{ metadata?: unknown; message?: string }> };
    };
    expect(terminal.outcome.type).toBe("interrupt");
    expect(terminal.outcome.interrupts[0].metadata).toBeUndefined();
    expect(terminal.outcome.interrupts[0].message).toBe("A decision is required.");
    const parsed = EventSchemas.safeParse(events[events.length - 1]);
    expect(parsed.success).toBe(true);
  });

  test("17: D-04 — an open pending interrupt blocks a non-resume run with THREAD_BUSY + precise message; executeChatTurn never called", async () => {
    const { conversationId } = seedChatSession(db);
    interruptRegistry.register(conversationId, DECISION_PAYLOAD); // open pending interrupt
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

    const events = await collectRun(agent, runInput(String(conversationId)));
    expect(executeChatTurnCalls).toBe(0);
    expect(events[0].type).toBe(EventType.RUN_STARTED);
    expect(events[events.length - 1].type).toBe(EventType.RUN_ERROR);
    expect(events[events.length - 1]).toMatchObject({
      code: "THREAD_BUSY",
      message: "A decision interrupt is pending for this thread",
    });
  });

  test("18: D-04 — no open entry → the run proceeds normally (RUN_FINISHED, no RUN_ERROR)", async () => {
    const { conversationId } = seedChatSession(db);
    const agent = makeAgent(conversationId);
    const events = await collectRun(agent, runInput(String(conversationId)));
    expect(events[events.length - 1].type).toBe(EventType.RUN_FINISHED);
    expect(events.filter((e) => e.type === EventType.RUN_ERROR)).toHaveLength(0);
  });

  test("19: Pitfall 5 — decision_request without onRunEnd still ends with the interrupt terminal, never a plain RUN_FINISHED or RUN_ERROR", async () => {
    const { conversationId } = seedChatSession(db);
    fakeCoordinator = {
      ...fakeCoordinator,
      executeChatTurn: async (_s, _c, _content, _m, _mcp, _ws, _att, _ec, opts) => {
        capturedOpts = opts;
        if (opts) {
          opts.onEngineEvent?.({ type: "token", content: "I need your decision." });
          opts.onEngineEvent?.({ type: "decision_request", payload: DECISION_PAYLOAD });
          // NO onRunEnd — non-standard coordinator / pause-path return.
        }
        return { message: { id: 1 } as never, executionId: 42 };
      },
    };
    const agent = makeAgent(conversationId);
    const events = await collectRun(agent, runInput(String(conversationId)));

    expect(events.filter((e) => e.type === EventType.RUN_ERROR)).toHaveLength(0);
    expect(events[events.length - 1].type).toBe(EventType.RUN_FINISHED);
    const terminal = events[events.length - 1] as unknown as {
      outcome?: { type: string; interrupts?: Array<{ id: string; reason: string; message?: string }> };
    };
    expect(terminal.outcome?.type).toBe("interrupt");
    expect(terminal.outcome?.interrupts?.[0]?.reason).toBe("decision_request");
    expect(terminal.outcome?.interrupts?.[0]?.message).toBe("mock context");
    // The decision is registered as pending — resumable, not swallowed.
    expect(interruptRegistry.hasOpen(String(conversationId))).toBe(true);
  });
});

describe("resume branch (D-05/D-07 — 03-02)", () => {
  test("R1: full resume cycle — translated submission reaches the executor, continuation streams, registry cleared, old row finalized (Pitfalls 2/8)", async () => {
    const { conversationId } = seedChatSession(db);
    const threadId = String(conversationId);
    // Decision-paused state: the orphaned waiting_user row (Pitfall 2 — the
    // stream-processor writes it DURING the decision run) + open registry
    // entry with executionId 42 attached.
    const interruptId = await openPendingDecision(conversationId);
    seedWaitingUserRow(conversationId, 42);

    setResumeChatFake();
    const agent = makeAgent(conversationId);
    const events = await collectRun(
      agent,
      resumeInput(threadId, [{ interruptId, status: "resolved", payload: RESUME_PAYLOAD }]),
    );

    // RUN_STARTED FIRST, RUN_FINISHED LAST, no error.
    const types = events.map((e) => e.type);
    expect(types[0]).toBe(EventType.RUN_STARTED);
    expect(types[types.length - 1]).toBe(EventType.RUN_FINISHED);
    expect(types).not.toContain(EventType.RUN_ERROR);

    // The fake received the TRANSLATED submission: formatted question text in
    // userContent + the hidden record_decision instruction in engineContent
    // (proves translateResumeToSubmission → buildDecisionSubmission delivery).
    expect(capturedChatContent).toContain("**Q [MEDIUM]:** Choose __DECISION_OPTION__");
    expect(capturedChatEngineContent).toContain("Choose __DECISION_OPTION__");
    expect(capturedChatEngineContent).toContain("record_decision");
    // The branch resolves its own workspaceKey — never undefined (TDZ guard).
    expect(capturedWorkspaceKey).toBe("default");

    // Pitfall 8: registry cleared after delivery started.
    expect(interruptRegistry.hasOpen(threadId)).toBe(false);
    // Pitfall 2: the orphaned row was finalized to 'completed'.
    const row = db.query<{ status: string }, [number]>(
      "SELECT status FROM executions WHERE id = ?",
    ).get(42)!;
    expect(row.status).toBe("completed");
  });

  test("R2: D-05 validation — unknown id / partial resume / extra unknown id → RUN_ERROR INVALID_INTERRUPT, no executor call", async () => {
    const { conversationId } = seedChatSession(db);
    const threadId = String(conversationId);
    const interruptId = await openPendingDecision(conversationId);
    const agent = makeAgent(conversationId);

    // Unknown interruptId.
    let executeChatTurnCalls = 0;
    fakeCoordinator = {
      ...fakeCoordinator,
      executeChatTurn: async (_s, _c, _content, _m, _mcp, _ws, _att, _ec, opts) => {
        executeChatTurnCalls += 1;
        opts?.onRunEnd?.("done");
        return { message: { id: 1 } as never, executionId: 1 };
      },
    };
    agent.orchestrator = fakeCoordinator;
    let events = await collectRun(
      agent,
      resumeInput(threadId, [{ interruptId: "decision-999-99", status: "resolved", payload: RESUME_PAYLOAD }]),
    );
    expect(executeChatTurnCalls).toBe(0);
    expect(events[events.length - 1].type).toBe(EventType.RUN_ERROR);
    expect(events[events.length - 1]).toMatchObject({ code: "INVALID_INTERRUPT" });

    // Partial resume — the open interrupt is NOT addressed (another id only).
    events = await collectRun(
      agent,
      resumeInput(threadId, [{ interruptId: `decision-${conversationId}-99`, status: "resolved", payload: RESUME_PAYLOAD }]),
    );
    expect(executeChatTurnCalls).toBe(0);
    expect(events[events.length - 1]).toMatchObject({ code: "INVALID_INTERRUPT" });

    // Extra unknown id alongside the valid one.
    events = await collectRun(
      agent,
      resumeInput(threadId, [
        { interruptId, status: "resolved", payload: RESUME_PAYLOAD },
        { interruptId: "decision-888-88", status: "resolved", payload: RESUME_PAYLOAD },
      ]),
    );
    expect(executeChatTurnCalls).toBe(0);
    expect(events[events.length - 1]).toMatchObject({ code: "INVALID_INTERRUPT" });
    // The open entry survived the failed validations — the client can retry.
    expect(interruptRegistry.hasOpen(threadId)).toBe(true);
  });

  test("R3: cancelled resume (A4) — registry cleared, row 'cancelled', plain RUN_FINISHED, no engine call; follow-up run succeeds", async () => {
    const { conversationId } = seedChatSession(db);
    const threadId = String(conversationId);
    const interruptId = await openPendingDecision(conversationId);
    seedWaitingUserRow(conversationId, 42);
    const agent = makeAgent(conversationId);

    let executeChatTurnCalls = 0;
    fakeCoordinator = {
      ...fakeCoordinator,
      executeChatTurn: async (_s, _c, _content, _m, _mcp, _ws, _att, _ec, opts) => {
        executeChatTurnCalls += 1;
        opts?.onRunEnd?.("done");
        return { message: { id: 1 } as never, executionId: 1 };
      },
    };
    agent.orchestrator = fakeCoordinator;

    const events = await collectRun(
      agent,
      resumeInput(threadId, [{ interruptId, status: "cancelled" }]),
    );
    // Plain RUN_FINISHED — NO engine call (A4: dismissal delivers nothing).
    expect(events[events.length - 1].type).toBe(EventType.RUN_FINISHED);
    expect(executeChatTurnCalls).toBe(0);
    expect(interruptRegistry.hasOpen(threadId)).toBe(false);
    const row = db.query<{ status: string }, [number]>(
      "SELECT status FROM executions WHERE id = ?",
    ).get(42)!;
    expect(row.status).toBe("cancelled");

    // The thread is NOT wedged — a subsequent plain run succeeds.
    const followUp = await collectRun(agent, runInput(threadId, "hello"));
    expect(executeChatTurnCalls).toBe(1);
    expect(followUp[followUp.length - 1].type).toBe(EventType.RUN_FINISHED);
  });

  test("R4: Pitfall 1 — the resume run bypasses the advisory lock; a plain run against the same waiting_user row still gets THREAD_BUSY", async () => {
    const { conversationId } = seedChatSession(db);
    const threadId = String(conversationId);
    const interruptId = await openPendingDecision(conversationId);
    seedWaitingUserRow(conversationId, 42);

    setResumeChatFake();
    const agent = makeAgent(conversationId);
    const events = await collectRun(
      agent,
      resumeInput(threadId, [{ interruptId, status: "resolved", payload: RESUME_PAYLOAD }]),
    );
    expect(events[events.length - 1].type).toBe(EventType.RUN_FINISHED);
    expect(events).not.toContain(EventType.RUN_ERROR);

    // Regression (03-01 Task 3): a plain run against a fresh waiting_user row
    // (no open registry entry) is still rejected by the advisory lock.
    db.run(
      "INSERT INTO executions (conversation_id, from_state, to_state, status) VALUES (?, 'backlog', 'plan', 'waiting_user')",
      [conversationId],
    );
    let executeChatTurnCalls = 0;
    fakeCoordinator = {
      ...fakeCoordinator,
      executeChatTurn: async (_s, _c, _content, _m, _mcp, _ws, _att, _ec, opts) => {
        executeChatTurnCalls += 1;
        opts?.onRunEnd?.("done");
        return { message: { id: 1 } as never, executionId: 1 };
      },
    };
    agent.orchestrator = fakeCoordinator;
    const events2 = await collectRun(agent, runInput(threadId, "hello"));
    expect(executeChatTurnCalls).toBe(0);
    expect(events2[events2.length - 1]).toMatchObject({ code: "THREAD_BUSY" });
  });

  test("R5: Pitfall 2 wedge gone — after a resolved resume, a NEW plain run delivers (no THREAD_BUSY)", async () => {
    const { conversationId } = seedChatSession(db);
    const threadId = String(conversationId);
    const interruptId = await openPendingDecision(conversationId);
    seedWaitingUserRow(conversationId, 42);

    setResumeChatFake();
    const agent = makeAgent(conversationId);
    const resumeEvents = await collectRun(
      agent,
      resumeInput(threadId, [{ interruptId, status: "resolved", payload: RESUME_PAYLOAD }]),
    );
    expect(resumeEvents[resumeEvents.length - 1].type).toBe(EventType.RUN_FINISHED);

    // The old row is now 'completed' — a plain run no longer wedges.
    let executeChatTurnCalls = 0;
    fakeCoordinator = {
      ...fakeCoordinator,
      executeChatTurn: async (_s, _c, _content, _m, _mcp, _ws, _att, _ec, opts) => {
        executeChatTurnCalls += 1;
        opts?.onRunEnd?.("done");
        return { message: { id: 1 } as never, executionId: 1 };
      },
    };
    agent.orchestrator = fakeCoordinator;
    const followUp = await collectRun(agent, runInput(threadId, "hello"));
    expect(executeChatTurnCalls).toBe(1);
    expect(followUp[followUp.length - 1].type).toBe(EventType.RUN_FINISHED);
  });

  test("R6: duplicate resume — the second run gets INVALID_INTERRUPT (registry cleared after first delivery started)", async () => {
    const { conversationId } = seedChatSession(db);
    const threadId = String(conversationId);
    const interruptId = await openPendingDecision(conversationId);

    setResumeChatFake();
    const agent = makeAgent(conversationId);
    const first = await collectRun(
      agent,
      resumeInput(threadId, [{ interruptId, status: "resolved", payload: RESUME_PAYLOAD }]),
    );
    expect(first[first.length - 1].type).toBe(EventType.RUN_FINISHED);
    expect(interruptRegistry.hasOpen(threadId)).toBe(false);

    // Replay of the same resume id — the entry cleared → INVALID_INTERRUPT.
    let executeChatTurnCalls = 0;
    fakeCoordinator = {
      ...fakeCoordinator,
      executeChatTurn: async (_s, _c, _content, _m, _mcp, _ws, _att, _ec, opts) => {
        executeChatTurnCalls += 1;
        opts?.onRunEnd?.("done");
        return { message: { id: 1 } as never, executionId: 1 };
      },
    };
    agent.orchestrator = fakeCoordinator;
    const second = await collectRun(
      agent,
      resumeInput(threadId, [{ interruptId, status: "resolved", payload: RESUME_PAYLOAD }]),
    );
    expect(executeChatTurnCalls).toBe(0);
    expect(second[second.length - 1]).toMatchObject({ code: "INVALID_INTERRUPT" });
  });

  test("R7: routing — task-linked conversation → executeHumanTurn with translated args + opts; chat → executeChatTurn", async () => {
    // Task-linked conversation.
    const seeded = seedProjectAndTask(db, "/tmp/x");
    const taskThreadId = String(seeded.conversationId);
    const taskInterruptId = await openPendingDecision(seeded.conversationId);
    setResumeTaskFake();
    const agent = makeAgent(seeded.conversationId);
    const taskEvents = await collectRun(
      agent,
      resumeInput(taskThreadId, [{ interruptId: taskInterruptId, status: "resolved", payload: RESUME_PAYLOAD }]),
    );
    expect(taskEvents[taskEvents.length - 1].type).toBe(EventType.RUN_FINISHED);
    expect(capturedHumanTurnArgs).not.toBeNull();
    expect(capturedHumanTurnArgs!.taskId).toBe(seeded.taskId);
    expect(capturedHumanTurnArgs!.content).toContain("**Q [MEDIUM]:** Choose __DECISION_OPTION__");
    expect(capturedHumanTurnArgs!.engineContent).toContain("record_decision");
    // A6: opts reached executeHumanTurn.
    expect(capturedHumanTurnArgs!.opts).toBeDefined();
    expect(interruptRegistry.hasOpen(taskThreadId)).toBe(false);

    // Chat conversation → executeChatTurn.
    const { conversationId } = seedChatSession(db);
    const chatThreadId = String(conversationId);
    const chatInterruptId = await openPendingDecision(conversationId);
    setResumeChatFake();
    const chatAgent = makeAgent(conversationId);
    const chatEvents = await collectRun(
      chatAgent,
      resumeInput(chatThreadId, [{ interruptId: chatInterruptId, status: "resolved", payload: RESUME_PAYLOAD }]),
    );
    expect(chatEvents[chatEvents.length - 1].type).toBe(EventType.RUN_FINISHED);
    expect(capturedChatContent).toContain("Choose __DECISION_OPTION__");
    expect(capturedWorkspaceKey).toBe("default");
  });

  test("R8: resolved resume without answers → RUN_ERROR INVALID_PAYLOAD, no executor call, entry survives for retry", async () => {
    const { conversationId } = seedChatSession(db);
    const threadId = String(conversationId);
    const interruptId = await openPendingDecision(conversationId);
    const agent = makeAgent(conversationId);

    let executeChatTurnCalls = 0;
    fakeCoordinator = {
      ...fakeCoordinator,
      executeChatTurn: async (_s, _c, _content, _m, _mcp, _ws, _att, _ec, opts) => {
        executeChatTurnCalls += 1;
        opts?.onRunEnd?.("done");
        return { message: { id: 1 } as never, executionId: 1 };
      },
    };
    agent.orchestrator = fakeCoordinator;

    const events = await collectRun(
      agent,
      resumeInput(threadId, [{ interruptId, status: "resolved", payload: { decision: "approved" } }]),
    );
    expect(executeChatTurnCalls).toBe(0);
    expect(events[events.length - 1].type).toBe(EventType.RUN_ERROR);
    expect(events[events.length - 1]).toMatchObject({ code: "INVALID_PAYLOAD" });
    // CR-01: the rejection precedes RUN_STARTED — exactly ONE RUN_STARTED for
    // this run (verifyEvents rejects a second RUN_STARTED while a run is
    // active, so a spec-compliant client must see the RUN_ERROR, not a throw).
    expect(events.filter((e) => e.type === EventType.RUN_STARTED)).toHaveLength(1);
    // Delivery never started — the entry stays open so the client can retry
    // with a proper payload (Pitfall 8: clear only after delivery starts).
    expect(interruptRegistry.hasOpen(threadId)).toBe(true);
  });

  test("R9: machine-fast resume race — a registry entry WITHOUT the attached executionId still finalizes the waiting_user row via the DB fallback (03-03 e2e 15/13)", async () => {
    const { conversationId } = seedChatSession(db);
    const threadId = String(conversationId);
    // The interrupt terminal reached the client but the executeChatTurn .then
    // hook has NOT run yet (the real-wire race e2e test 15 exposes): the entry
    // is registered with executionId null — resolveDecisionExecutionId must
    // fall back to the durable waiting_user row.
    const interruptId = interruptRegistry.register(conversationId, DECISION_PAYLOAD);
    seedWaitingUserRow(conversationId, 42);

    setResumeChatFake();
    const agent = makeAgent(conversationId);

    // Cancelled resume: the row finalizes 'cancelled' via the DB lookup — the
    // thread stays usable afterward (no wedge).
    const cancelEvents = await collectRun(
      agent,
      resumeInput(threadId, [{ interruptId, status: "cancelled" }]),
    );
    expect(cancelEvents[cancelEvents.length - 1].type).toBe(EventType.RUN_FINISHED);
    expect(interruptRegistry.hasOpen(threadId)).toBe(false);
    const row = db.query<{ status: string }, [number]>("SELECT status FROM executions WHERE id = ?").get(42)!;
    expect(row.status).toBe("cancelled");

    // Resolved resume: the old waiting_user row finalizes 'completed' BEFORE
    // delivery even though the registry never attached the executionId.
    const interruptId2 = interruptRegistry.register(conversationId, DECISION_PAYLOAD);
    seedWaitingUserRow(conversationId, 43);
    const resumeEvents = await collectRun(
      agent,
      resumeInput(threadId, [{ interruptId: interruptId2, status: "resolved", payload: RESUME_PAYLOAD }]),
    );
    expect(resumeEvents[resumeEvents.length - 1].type).toBe(EventType.RUN_FINISHED);
    const row2 = db.query<{ status: string }, [number]>("SELECT status FROM executions WHERE id = ?").get(43)!;
    expect(row2.status).toBe("completed");
  });
});
