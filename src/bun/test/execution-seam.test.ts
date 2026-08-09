/**
 * execution-seam.test.ts — BRDG-01 seam contract through the REAL executor chain.
 *
 * Drives Orchestrator → ChatExecutor → StreamProcessor with a scripted engine
 * and asserts the optional `opts?: { onEngineEvent?, onRunEnd? }` threading:
 *
 *  1. onEngineEvent fires for EVERY raw EngineEvent in exact order
 *  2. executeChatTurn WITHOUT opts is byte-identical (no callbacks, DB statuses unchanged)
 *  3. onRunEnd fires at every terminal outcome: done / error / aborted / decision
 *
 * The scripted engine is inline (Task 1 precedes Task 3's mock-engine markers);
 * the chain itself is real — no stubs beyond the engine.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initDb, seedChatSession, seedProjectAndTask, setupTestConfig, makeTestRegistry } from "./helpers.ts";
import { Orchestrator } from "../engine/orchestrator.ts";
import { WorkspaceRepository } from "../db/workspace-repository.ts";
import type { Database } from "bun:sqlite";
import type { ExecutionEngine, ExecutionParams, EngineEvent } from "../engine/types.ts";

type RunOutcome = "done" | "error" | "aborted" | "decision";

interface SeamOpts {
  onEngineEvent?: (e: EngineEvent) => void;
  onRunEnd?: (o: RunOutcome) => void;
  onSessionStatusChange?: (conversationId: number) => void;
}

let db: Database;
let configCleanup: () => void;
let orchestrator: Orchestrator;

function noop() { }

/** Scripted engine: yields the given events; optionally parks until aborted after the first event. */
class SeamEngine implements ExecutionEngine {
  readonly type = "scripted";
  constructor(
    private readonly events: EngineEvent[],
    private readonly parkUntilAborted = false,
    private readonly resumeThrows = false,
  ) { }

  async *execute(params: ExecutionParams): AsyncIterable<EngineEvent> {
    for (let i = 0; i < this.events.length; i++) {
      if (params.signal.aborted) return;
      if (this.parkUntilAborted && i === 1) {
        // Wait until the test cancels the execution (or a 5s failsafe).
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 5000);
          params.signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
        });
        if (params.signal.aborted) return;
      }
      yield this.events[i];
    }
  }

  async resume(_executionId: number, _input: never): Promise<void> {
    if (this.resumeThrows) throw new Error("engine session lost");
  }
  cancel(_executionId: number): void { }
  async listModels() {
    return [{ qualifiedId: "copilot/mock-model", displayName: "Mock Model", contextWindow: 128_000, enabled: true }];
  }
  async listCommands() { return []; }
}

function makeOrchestrator(engine: ExecutionEngine): Orchestrator {
  return new Orchestrator(
    db,
    makeTestRegistry(engine),
    noop,
    noop,
    new WorkspaceRepository(db),
  );
}

function makeSeamOpts() {
  const seen: EngineEvent[] = [];
  let resolveRunEnd!: (o: RunOutcome) => void;
  const runEnd = new Promise<RunOutcome>((res) => { resolveRunEnd = res; });
  const opts: SeamOpts = {
    onEngineEvent: (e) => seen.push(e),
    onRunEnd: (o) => resolveRunEnd(o),
  };
  return { opts, seen, runEnd };
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]);
}

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
}

beforeEach(() => {
  const cfg = setupTestConfig();
  configCleanup = cfg.cleanup;
  db = initDb();
});

afterEach(() => {
  configCleanup();
});

describe("executeChatTurn seam (onEngineEvent/onRunEnd)", () => {
  it("1: onEngineEvent fires for every raw event in exact order, incl. done", async () => {
    orchestrator = makeOrchestrator(new SeamEngine([
      { type: "token", content: "hello" },
      { type: "reasoning", content: "thinking" },
      { type: "tool_start", name: "read_file", callId: "call_1", arguments: "{}" },
      { type: "tool_result", name: "read_file", callId: "call_1", result: "file contents" },
      { type: "done" },
    ]));
    const { opts, seen, runEnd } = makeSeamOpts();
    const { sessionId, conversationId } = seedChatSession(db);

    const { executionId } = await orchestrator.executeChatTurn(
      sessionId, conversationId, "hello", undefined, null, undefined, undefined, undefined, opts,
    );
    expect(executionId).toBeGreaterThan(0);
    expect(await withTimeout(runEnd, 4000, "onRunEnd")).toBe("done");

    expect(seen.map((e) => e.type)).toEqual([
      "token", "reasoning", "tool_start", "tool_result", "done",
    ]);
  });

  it("2: without opts — no callbacks, no crash, DB statuses unchanged (done → idle/completed)", async () => {
    orchestrator = makeOrchestrator(new SeamEngine([
      { type: "token", content: "hello" },
      { type: "done" },
    ]));
    const { sessionId, conversationId } = seedChatSession(db);

    const { executionId } = await orchestrator.executeChatTurn(sessionId, conversationId, "hello");
    expect(executionId).toBeGreaterThan(0);

    // Stream completes asynchronously (runNonNative is fire-and-forget) — poll the DB.
    await waitFor(() => {
      const row = db.query<{ status: string }, [number]>(
        "SELECT status FROM executions WHERE id = ?",
      ).get(executionId);
      return row?.status === "completed";
    });

    const execRow = db.query<{ status: string }, [number]>(
      "SELECT status FROM executions WHERE id = ?",
    ).get(executionId)!;
    expect(execRow.status).toBe("completed");

    const sessRow = db.query<{ status: string }, [number]>(
      "SELECT status FROM chat_sessions WHERE conversation_id = ?",
    ).get(conversationId)!;
    expect(sessRow.status).toBe("idle");

    // 07-01 (Task 4): zero conversation_messages writes — the run persisted
    // nothing to the frozen table.
    const msgCount = db.query<{ n: number }, [number]>(
      "SELECT COUNT(*) AS n FROM conversation_messages WHERE conversation_id = ?",
    ).get(conversationId)!;
    expect(msgCount.n).toBe(0);
  });

  it("3a: done outcome → onRunEnd('done')", async () => {
    orchestrator = makeOrchestrator(new SeamEngine([{ type: "token", content: "hi" }, { type: "done" }]));
    const { opts, runEnd } = makeSeamOpts();
    const { sessionId, conversationId } = seedChatSession(db);

    await orchestrator.executeChatTurn(
      sessionId, conversationId, "hello", undefined, null, undefined, undefined, undefined, opts,
    );
    expect(await withTimeout(runEnd, 4000, "onRunEnd")).toBe("done");
  });

  it("3b: fatal error event → onRunEnd('error')", async () => {
    orchestrator = makeOrchestrator(new SeamEngine([
      { type: "token", content: "hi" },
      { type: "error", message: "scripted failure", fatal: true },
    ]));
    const { opts, runEnd } = makeSeamOpts();
    const { sessionId, conversationId } = seedChatSession(db);

    await orchestrator.executeChatTurn(
      sessionId, conversationId, "hello", undefined, null, undefined, undefined, undefined, opts,
    );
    expect(await withTimeout(runEnd, 4000, "onRunEnd")).toBe("error");
  });

  it("3c: abort mid-stream (orchestrator.cancel) → onRunEnd('aborted')", async () => {
    orchestrator = makeOrchestrator(new SeamEngine(
      [{ type: "token", content: "first" }, { type: "done" }],
      true, // park until aborted after the first event
    ));
    const { opts, seen, runEnd } = makeSeamOpts();
    const { sessionId, conversationId } = seedChatSession(db);

    const { executionId } = await orchestrator.executeChatTurn(
      sessionId, conversationId, "hello", undefined, null, undefined, undefined, undefined, opts,
    );
    expect(executionId).toBeGreaterThan(0);

    // Wait until the first event arrived, then abort mid-stream.
    await waitFor(() => seen.length > 0);
    orchestrator.cancel(executionId);

    expect(await withTimeout(runEnd, 4000, "onRunEnd")).toBe("aborted");
  });

  it("3d: decision_request event → onRunEnd('decision')", async () => {
    orchestrator = makeOrchestrator(new SeamEngine([
      { type: "decision_request", payload: "{}" },
    ]));
    const { opts, runEnd } = makeSeamOpts();
    const { sessionId, conversationId } = seedChatSession(db);

    await orchestrator.executeChatTurn(
      sessionId, conversationId, "hello", undefined, null, undefined, undefined, undefined, opts,
    );
    expect(await withTimeout(runEnd, 4000, "onRunEnd")).toBe("decision");
  });

  it("3e: 07-01 — decision_request (session run) fires onSessionStatusChange, sets chat_sessions waiting_user, and writes NOTHING to conversation_messages", async () => {
    orchestrator = makeOrchestrator(new SeamEngine([
      { type: "token", content: "I need your decision." },
      { type: "decision_request", payload: "{}" },
    ]));
    const { opts, runEnd } = makeSeamOpts();
    const statusChanges: number[] = [];
    opts.onSessionStatusChange = (cid) => statusChanges.push(cid);
    const { sessionId, conversationId } = seedChatSession(db);

    await orchestrator.executeChatTurn(
      sessionId, conversationId, "hello", undefined, null, undefined, undefined, undefined, opts,
    );
    expect(await withTimeout(runEnd, 4000, "onRunEnd")).toBe("decision");

    // The session-status callback fired for this conversation (replacement for
    // the message.new push that previously drove the sidebar's waiting_user).
    expect(statusChanges).toEqual([conversationId]);

    // chat_sessions moved to waiting_user (the new write replaces the push).
    const sessRow = db.query<{ status: string }, [number]>(
      "SELECT status FROM chat_sessions WHERE conversation_id = ?",
    ).get(conversationId)!;
    expect(sessRow.status).toBe("waiting_user");

    // Frozen-table proof: the assistant text preceding the decision is NOT
    // persisted anymore — zero conversation_messages writes during the run
    // (the user message row is written by the executor before consume()).
    const msgs = db.query<{ type: string }, [number]>(
      "SELECT type FROM conversation_messages WHERE conversation_id = ?",
    ).all(conversationId);
    const assistant = msgs.find((m) => m.type === "assistant");
    expect(assistant).toBeUndefined();
  });

  it("4: onSessionStatusChange fires on the done path for a session run (taskId == null)", async () => {
    orchestrator = makeOrchestrator(new SeamEngine([
      { type: "token", content: "hi" },
      { type: "done" },
    ]));
    const { opts, runEnd } = makeSeamOpts();
    const statusChanges: number[] = [];
    opts.onSessionStatusChange = (cid) => statusChanges.push(cid);
    const { sessionId, conversationId } = seedChatSession(db);

    await orchestrator.executeChatTurn(
      sessionId, conversationId, "hello", undefined, null, undefined, undefined, undefined, opts,
    );
    expect(await withTimeout(runEnd, 4000, "onRunEnd")).toBe("done");

    // consume() wrote chat_sessions 'idle' and fired the callback once.
    expect(statusChanges).toEqual([conversationId]);
    const sessRow = db.query<{ status: string }, [number]>(
      "SELECT status FROM chat_sessions WHERE conversation_id = ?",
    ).get(conversationId)!;
    expect(sessRow.status).toBe("idle");
  });

  it("5: onSessionStatusChange does NOT fire for task-bound runs (no chat_sessions write)", async () => {
    orchestrator = makeOrchestrator(new SeamEngine([
      { type: "token", content: "hi" },
      { type: "done" },
    ]));
    const { opts, runEnd } = makeSeamOpts();
    const statusChanges: number[] = [];
    opts.onSessionStatusChange = (cid) => statusChanges.push(cid);
    const { taskId } = seedProjectAndTask(db, "/tmp/x");

    await orchestrator.executeHumanTurn(taskId, "hello", undefined, undefined, opts);
    expect(await withTimeout(runEnd, 4000, "onRunEnd")).toBe("done");

    expect(statusChanges).toEqual([]);
  });
});

describe("executeHumanTurn seam (A6 — additive opts?: ChatTurnOpts)", () => {
  it("1: fresh-turn path — opts fires onEngineEvent for every raw event in exact order and onRunEnd('done') at completion", async () => {
    orchestrator = makeOrchestrator(new SeamEngine([
      { type: "token", content: "hello" },
      { type: "reasoning", content: "thinking" },
      { type: "tool_start", name: "read_file", callId: "call_1", arguments: "{}" },
      { type: "tool_result", name: "read_file", callId: "call_1", result: "file contents" },
      { type: "done" },
    ]));
    const { taskId } = seedProjectAndTask(db, "/tmp/x");
    const { opts, seen, runEnd } = makeSeamOpts();

    const { executionId } = await orchestrator.executeHumanTurn(
      taskId, "hello", undefined, undefined, opts,
    );
    expect(executionId).toBeGreaterThan(0);
    expect(await withTimeout(runEnd, 4000, "onRunEnd")).toBe("done");

    expect(seen.map((e) => e.type)).toEqual([
      "token", "reasoning", "tool_start", "tool_result", "done",
    ]);
  });

  it("2: absent opts — no callbacks, no crash, DB statuses unchanged (task 'running' → 'completed')", async () => {
    orchestrator = makeOrchestrator(new SeamEngine([
      { type: "token", content: "hello" },
      { type: "done" },
    ]));
    const { taskId } = seedProjectAndTask(db, "/tmp/x");

    const { executionId } = await orchestrator.executeHumanTurn(taskId, "hello");
    expect(executionId).toBeGreaterThan(0);

    // Stream completes asynchronously — poll the DB.
    await waitFor(() => {
      const row = db.query<{ status: string }, [number]>(
        "SELECT status FROM executions WHERE id = ?",
      ).get(executionId);
      return row?.status === "completed";
    });

    const execRow = db.query<{ status: string }, [number]>(
      "SELECT status FROM executions WHERE id = ?",
    ).get(executionId)!;
    expect(execRow.status).toBe("completed");

    const taskRow = db.query<{ execution_state: string }, [number]>(
      "SELECT execution_state FROM tasks WHERE id = ?",
    ).get(taskId)!;
    expect(taskRow.execution_state).toBe("completed");
  });

  it("3: fallback path — engine.resume() throws at resume time → new-execution fallback runNonNative still receives opts and streams events", async () => {
    orchestrator = makeOrchestrator(new SeamEngine(
      [{ type: "token", content: "fallback" }, { type: "done" }],
      false,
      true, // resume throws → engine session lost → new-execution fallback
    ));
    const { taskId, conversationId } = seedProjectAndTask(db, "/tmp/x");

    // Seed the resume-time state: task parked at waiting_user with a live
    // execution row (the decision-paused state the resume branch produces).
    db.run(
      "INSERT INTO executions (task_id, conversation_id, from_state, to_state, status) VALUES (?, ?, 'plan', 'plan', 'waiting_user')",
      [taskId, conversationId],
    );
    const oldExecutionId = (db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!).id;
    db.run(
      "UPDATE tasks SET execution_state = 'waiting_user', current_execution_id = ? WHERE id = ?",
      [oldExecutionId, taskId],
    );

    const { opts, seen, runEnd } = makeSeamOpts();
    const { executionId } = await orchestrator.executeHumanTurn(
      taskId, "hello", undefined, undefined, opts,
    );

    // The fallback created a NEW execution (not the seeded one).
    expect(executionId).not.toBe(oldExecutionId);
    expect(await withTimeout(runEnd, 4000, "onRunEnd")).toBe("done");
    expect(seen.map((e) => e.type)).toEqual(["token", "done"]);

    // The new execution completed; the old row was finalized as 'failed'.
    const newRow = db.query<{ status: string }, [number]>(
      "SELECT status FROM executions WHERE id = ?",
    ).get(executionId)!;
    expect(newRow.status).toBe("completed");
    const oldRow = db.query<{ status: string }, [number]>(
      "SELECT status FROM executions WHERE id = ?",
    ).get(oldExecutionId)!;
    expect(oldRow.status).toBe("failed");
  });

  it("4: IN-03 — a row already finalized to 'completed' (decision resume) is not overwritten with 'failed' by the fallback", async () => {
    orchestrator = makeOrchestrator(new SeamEngine(
      [{ type: "token", content: "fallback" }, { type: "done" }],
      false,
      true, // resume throws → fallback path
    ));
    const { taskId, conversationId } = seedProjectAndTask(db, "/tmp/x");

    // Decision-resume state: the AG-UI resume branch already finalized the old
    // waiting_user row to 'completed' BEFORE calling executeHumanTurn; the
    // task is still parked at waiting_user (the branch does not touch it).
    db.run(
      "INSERT INTO executions (task_id, conversation_id, from_state, to_state, status) VALUES (?, ?, 'plan', 'plan', 'completed')",
      [taskId, conversationId],
    );
    const oldExecutionId = (db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!).id;
    db.run(
      "UPDATE tasks SET execution_state = 'waiting_user', current_execution_id = ? WHERE id = ?",
      [oldExecutionId, taskId],
    );

    const { opts, seen, runEnd } = makeSeamOpts();
    const { executionId } = await orchestrator.executeHumanTurn(
      taskId, "hello", undefined, undefined, opts,
    );

    // The fallback still created a NEW execution (the continuation works).
    expect(executionId).not.toBe(oldExecutionId);
    expect(await withTimeout(runEnd, 4000, "onRunEnd")).toBe("done");
    expect(seen.map((e) => e.type)).toEqual(["token", "done"]);

    // The historical row keeps its truthful 'completed' terminal — the
    // fallback's failed update was a no-op (status filter).
    const oldRow = db.query<{ status: string }, [number]>(
      "SELECT status FROM executions WHERE id = ?",
    ).get(oldExecutionId)!;
    expect(oldRow.status).toBe("completed");
  });
});
