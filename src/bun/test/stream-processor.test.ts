import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initDb, seedChatSession, seedProjectAndTask, setupTestConfig } from "./helpers.ts";
import { StreamProcessor } from "../engine/stream/stream-processor.ts";
import type { ExecutionEngine, ExecutionParams, EngineEvent } from "../engine/types.ts";
import type { Database } from "bun:sqlite";

function noop(..._args: unknown[]): void {}

let db: Database;
let configCleanup: () => void;
let taskId: number;
let conversationId: number;
let executionId: number;

function insertExecution(db: Database, tid: number | null, cid: number): number {
  db.run(
    "INSERT INTO executions (task_id, conversation_id, from_state, to_state, prompt_id, status, attempt) VALUES (?, ?, 'plan', 'plan', 'human-turn', 'running', 1)",
    [tid, cid],
  );
  return (db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!).id;
}

function makeParams(tid: number | null, cid: number, eid: number, signal?: AbortSignal): ExecutionParams {
  return {
    executionId: eid,
    taskId: tid,
    conversationId: cid,
    prompt: "test prompt",
    workingDirectory: "/test",
    model: "test/model",
    signal: signal ?? new AbortController().signal,
  };
}

/** 07-01 ctor helper: (db, onToken, onError, onTaskUpdated[, onDeferredTransition, onPendingMessage]) */
function makeProcessor(
  overrides: {
    onToken?: (t: number | null, c: number, e: number, tok: string, done: boolean, isReasoning?: boolean, isStatus?: boolean) => void;
    onTaskUpdated?: (t: unknown) => void;
    onDeferredTransition?: (taskId: number, toState: string) => void;
    onPendingMessage?: (taskId: number, message: string) => void;
  } = {},
): StreamProcessor {
  return new StreamProcessor(
    db,
    overrides.onToken ?? (noop as never),
    noop as never,
    (overrides.onTaskUpdated ?? noop) as never,
    overrides.onDeferredTransition ?? (() => {}),
    overrides.onPendingMessage ?? (() => {}),
  );
}

class NoopEngine implements ExecutionEngine {
  readonly type = "scripted";
  async *execute(_params: ExecutionParams): AsyncIterable<EngineEvent> {
    yield { type: "done" };
  }
  async resume(_executionId: number, _input: never): Promise<void> {}
  cancel(_executionId: number): void {}
  async listModels() { return []; }
  async listCommands() { return []; }
}

beforeEach(() => {
  const cfg = setupTestConfig();
  configCleanup = cfg.cleanup;
  db = initDb();
  const seed = seedProjectAndTask(db, "/test-git");
  taskId = seed.taskId;
  conversationId = seed.conversationId;
  executionId = insertExecution(db, taskId, conversationId);
});

afterEach(() => {
  configCleanup();
});

describe("StreamProcessor", () => {
  it("SP-1: createSignal / abort round-trip", () => {
    const sp = makeProcessor();
    const signal = sp.createSignal(executionId);
    expect(signal.aborted).toBe(false);
    sp.abort(executionId);
    expect(signal.aborted).toBe(true);
  });

  it("SP-2: abortControllers cleaned up after done, subsequent createSignal returns fresh signal", async () => {
    const sp = makeProcessor();
    sp.createSignal(executionId);

    const engine = new NoopEngine();
    await sp.consume(taskId, conversationId, executionId, engine.execute(makeParams(taskId, conversationId, executionId)));

    sp.abort(executionId);

    const freshSignal = sp.createSignal(executionId);
    expect(freshSignal.aborted).toBe(false);

    sp.abort(executionId);
    expect(freshSignal.aborted).toBe(true);
  });

  it("SP-3: 07-01 — cancel mid-stream preserves the DB lifecycle triad (task waiting_user, execution cancelled) and writes zero conversation_messages", async () => {
    let resumeFn!: () => void;
    const paused = new Promise<void>(r => { resumeFn = r; });
    let tokenYieldedFn!: () => void;
    const tokenYielded = new Promise<void>(r => { tokenYieldedFn = r; });

    class PausableEngine implements ExecutionEngine {
      readonly type = "scripted";
      async *execute(_params: ExecutionParams): AsyncIterable<EngineEvent> {
        yield { type: "token", content: "hello" };
        tokenYieldedFn();
        await paused;
        yield { type: "done" };
      }
      async resume(_executionId: number, _input: never): Promise<void> {}
      cancel(_executionId: number): void {}
      async listModels() { return []; }
      async listCommands() { return []; }
    }

    const sp = makeProcessor();
    const signal = sp.createSignal(executionId);
    const params = makeParams(taskId, conversationId, executionId, signal);
    const engine = new PausableEngine();

    const consumePromise = sp.consume(taskId, conversationId, executionId, engine.execute(params));

    await tokenYielded;
    sp.abort(executionId);
    resumeFn();

    await consumePromise;

    const execRow = db.query<{ status: string }, [number]>(
      "SELECT status FROM executions WHERE id = ?",
    ).get(executionId);
    expect(execRow!.status).toBe("cancelled");

    const taskRow = db.query<{ execution_state: string }, [number]>(
      "SELECT execution_state FROM tasks WHERE id = ?",
    ).get(taskId);
    expect(taskRow!.execution_state).toBe("waiting_user");

    // Frozen-table proof: no assistant message row was written on cancel.
    const rows = db.query<{ type: string }, [number]>(
      "SELECT type FROM conversation_messages WHERE conversation_id = ? AND type = 'assistant'",
    ).all(conversationId);
    expect(rows).toHaveLength(0);
  });

  it("SP-4: 07-01 — cancel mid-reasoning likewise writes zero conversation_messages", async () => {
    let resumeFn!: () => void;
    const paused = new Promise<void>(r => { resumeFn = r; });
    let reasoningYieldedFn!: () => void;
    const reasoningYielded = new Promise<void>(r => { reasoningYieldedFn = r; });

    class PausableReasoningEngine implements ExecutionEngine {
      readonly type = "scripted";
      async *execute(_params: ExecutionParams): AsyncIterable<EngineEvent> {
        yield { type: "reasoning", content: "thinking..." };
        reasoningYieldedFn();
        await paused;
        yield { type: "done" };
      }
      async resume(_executionId: number, _input: never): Promise<void> {}
      cancel(_executionId: number): void {}
      async listModels() { return []; }
      async listCommands() { return []; }
    }

    const sp = makeProcessor();
    const signal = sp.createSignal(executionId);
    const params = makeParams(taskId, conversationId, executionId, signal);
    const engine = new PausableReasoningEngine();

    const consumePromise = sp.consume(taskId, conversationId, executionId, engine.execute(params));

    await reasoningYielded;
    sp.abort(executionId);
    resumeFn();

    await consumePromise;

    const execRow = db.query<{ status: string }, [number]>(
      "SELECT status FROM executions WHERE id = ?",
    ).get(executionId);
    expect(execRow!.status).toBe("cancelled");

    const rows = db.query<{ type: string }, [number]>(
      "SELECT type FROM conversation_messages WHERE conversation_id = ? AND type = 'reasoning'",
    ).all(conversationId);
    expect(rows).toHaveLength(0);
  });

  it("SP-5: fatal error sets execution status and task execution_state to failed", async () => {
    class FatalErrorEngine implements ExecutionEngine {
      readonly type = "scripted";
      async *execute(_params: ExecutionParams): AsyncIterable<EngineEvent> {
        yield { type: "error", message: "boom", fatal: true };
      }
      async resume(_executionId: number, _input: never): Promise<void> {}
      cancel(_executionId: number): void {}
      async listModels() { return []; }
      async listCommands() { return []; }
    }

    const sp = makeProcessor();
    const engine = new FatalErrorEngine();
    const params = makeParams(taskId, conversationId, executionId);

    await sp.consume(taskId, conversationId, executionId, engine.execute(params));

    const execRow = db.query<{ status: string }, [number]>(
      "SELECT status FROM executions WHERE id = ?",
    ).get(executionId);
    expect(execRow!.status).toBe("failed");

    const taskRow = db.query<{ execution_state: string }, [number]>(
      "SELECT execution_state FROM tasks WHERE id = ?",
    ).get(taskId);
    expect(taskRow!.execution_state).toBe("failed");
  });

  it("SP-6: 07-01 — a token+done run completes the execution and writes zero conversation_messages rows", async () => {
    class TextEngine implements ExecutionEngine {
      readonly type = "scripted";
      async *execute(_params: ExecutionParams): AsyncIterable<EngineEvent> {
        yield { type: "token", content: "hello world" };
        yield { type: "done" };
      }
      async resume(_executionId: number, _input: never): Promise<void> {}
      cancel(_executionId: number): void {}
      async listModels() { return []; }
      async listCommands() { return []; }
    }

    const sp = makeProcessor();
    await sp.consume(taskId, conversationId, executionId, new TextEngine().execute(makeParams(taskId, conversationId, executionId)));

    const execRow = db.query<{ status: string }, [number]>(
      "SELECT status FROM executions WHERE id = ?",
    ).get(executionId);
    expect(execRow!.status).toBe("completed");

    const rows = db.query<{ type: string }, [number]>(
      "SELECT type FROM conversation_messages WHERE conversation_id = ?",
    ).all(conversationId);
    expect(rows).toHaveLength(0);
  });

  it("SP-7: needs_column_prompt=1 triggers onDeferredTransition with (taskId, workflow_state) and clears flag", async () => {
    db.run("UPDATE tasks SET needs_column_prompt = 1, workflow_state = 'review' WHERE id = ?", [taskId]);

    let deferredArgs: [number, string] | null = null;
    const sp = makeProcessor({ onDeferredTransition: (tid, state) => { deferredArgs = [tid, state]; } });

    await sp.consume(taskId, conversationId, executionId, new NoopEngine().execute(makeParams(taskId, conversationId, executionId)));

    expect(deferredArgs).toEqual([taskId, "review"]);
    const row = db.query<{ needs_column_prompt: number }, [number]>("SELECT needs_column_prompt FROM tasks WHERE id = ?").get(taskId);
    expect(row?.needs_column_prompt).toBe(0);
  });

  it("SP-8: pending_messages rows and needs_column_prompt=0 → onPendingMessage called per row, rows deleted", async () => {
    db.run("INSERT INTO pending_messages (task_id, content) VALUES (?, ?)", [taskId, "hello"]);
    db.run("INSERT INTO pending_messages (task_id, content) VALUES (?, ?)", [taskId, "world"]);

    const delivered: string[] = [];
    const sp = makeProcessor({ onPendingMessage: (_tid, msg) => { delivered.push(msg); } });

    await sp.consume(taskId, conversationId, executionId, new NoopEngine().execute(makeParams(taskId, conversationId, executionId)));

    expect(delivered).toEqual(["hello", "world"]);
    const remaining = db.query<{ c: number }, [number]>("SELECT COUNT(*) as c FROM pending_messages WHERE task_id = ?").get(taskId);
    expect(remaining?.c).toBe(0);
  });

  it("SP-9: no flag, no pending rows → neither drain spy called, only onTaskUpdated fires", async () => {
    let deferredCalled = false;
    let pendingCalled = false;
    let taskUpdatedCalled = false;

    const sp = makeProcessor({
      onTaskUpdated: () => { taskUpdatedCalled = true; },
      onDeferredTransition: () => { deferredCalled = true; },
      onPendingMessage: () => { pendingCalled = true; },
    });

    await sp.consume(taskId, conversationId, executionId, new NoopEngine().execute(makeParams(taskId, conversationId, executionId)));

    expect(deferredCalled).toBe(false);
    expect(pendingCalled).toBe(false);
    expect(taskUpdatedCalled).toBe(true);
  });

  it("SP-10: needs_column_prompt=1 AND pending_messages → only onDeferredTransition fires; onPendingMessage NOT called", async () => {
    db.run("UPDATE tasks SET needs_column_prompt = 1, workflow_state = 'done' WHERE id = ?", [taskId]);
    db.run("INSERT INTO pending_messages (task_id, content) VALUES (?, ?)", [taskId, "pending"]);

    let deferredCalled = false;
    let pendingCalled = false;

    const sp = makeProcessor({
      onDeferredTransition: () => { deferredCalled = true; },
      onPendingMessage: () => { pendingCalled = true; },
    });

    await sp.consume(taskId, conversationId, executionId, new NoopEngine().execute(makeParams(taskId, conversationId, executionId)));

    expect(deferredCalled).toBe(true);
    expect(pendingCalled).toBe(false);

    const remaining = db.query<{ c: number }, [number]>("SELECT COUNT(*) as c FROM pending_messages WHERE task_id = ?").get(taskId);
    expect(remaining?.c).toBe(1); // NOT deleted — deferred path skips pending drain
  });

  it("SP-GC-1: onTaskUpdated receives Task with worktreePath when task_git_context row exists", async () => {
    db.run(
      "INSERT INTO task_git_context (task_id, git_root_path, worktree_path, worktree_status, branch_name) VALUES (?, ?, ?, ?, ?)",
      [taskId, "/tmp/git-root", "/wt/1", "ready", "feature/test"],
    );

    let capturedTask: import("../../shared/rpc-types.ts").Task | null = null;
    const sp = makeProcessor({ onTaskUpdated: (task) => { capturedTask = task as import("../../shared/rpc-types.ts").Task; } });

    await sp.consume(taskId, conversationId, executionId, new NoopEngine().execute(makeParams(taskId, conversationId, executionId)));

    expect(capturedTask).not.toBeNull();
    expect(capturedTask!.worktreePath).toBe("/wt/1");
    expect(capturedTask!.worktreeStatus).toBe("ready");
    expect(capturedTask!.branchName).toBe("feature/test");
  });

  it("SP-GC-2: onTaskUpdated receives Task with null worktreePath when no task_git_context row exists", async () => {
    let capturedTask: import("../../shared/rpc-types.ts").Task | null = null;
    const sp = makeProcessor({ onTaskUpdated: (task) => { capturedTask = task as import("../../shared/rpc-types.ts").Task; } });

    await sp.consume(taskId, conversationId, executionId, new NoopEngine().execute(makeParams(taskId, conversationId, executionId)));

    expect(capturedTask).not.toBeNull();
    expect(capturedTask!.worktreePath).toBeNull();
  });

  it("SP-11: onSessionStatusChange fires on the done path for a session run (taskId == null)", async () => {
    const { conversationId: sessionCid } = seedChatSession(db);
    const sessionExecutionId = insertExecution(db, null, sessionCid);

    const statusChanges: number[] = [];
    const opts = { onSessionStatusChange: (cid: number) => statusChanges.push(cid) };

    const sp = makeProcessor();
    await sp.consume(null, sessionCid, sessionExecutionId, new NoopEngine().execute(makeParams(null, sessionCid, sessionExecutionId)), opts);

    expect(statusChanges).toEqual([sessionCid]);

    const sessRow = db.query<{ status: string }, [number]>(
      "SELECT status FROM chat_sessions WHERE conversation_id = ?",
    ).get(sessionCid);
    expect(sessRow!.status).toBe("idle");

    const execRow = db.query<{ status: string }, [number]>(
      "SELECT status FROM executions WHERE id = ?",
    ).get(sessionExecutionId);
    expect(execRow!.status).toBe("completed");
  });

  it("SP-12: onSessionStatusChange fires on the decision path and chat_sessions becomes waiting_user", async () => {
    const { conversationId: sessionCid } = seedChatSession(db);
    const sessionExecutionId = insertExecution(db, null, sessionCid);

    class DecisionEngine implements ExecutionEngine {
      readonly type = "scripted";
      async *execute(_params: ExecutionParams): AsyncIterable<EngineEvent> {
        yield { type: "decision_request", payload: "{}" };
      }
      async resume(_executionId: number, _input: never): Promise<void> {}
      cancel(_executionId: number): void {}
      async listModels() { return []; }
      async listCommands() { return []; }
    }

    const statusChanges: number[] = [];
    const opts = { onSessionStatusChange: (cid: number) => statusChanges.push(cid) };

    const sp = makeProcessor();
    await sp.consume(null, sessionCid, sessionExecutionId, new DecisionEngine().execute(makeParams(null, sessionCid, sessionExecutionId)), opts);

    expect(statusChanges).toEqual([sessionCid]);

    const sessRow = db.query<{ status: string }, [number]>(
      "SELECT status FROM chat_sessions WHERE conversation_id = ?",
    ).get(sessionCid);
    expect(sessRow!.status).toBe("waiting_user");

    const execRow = db.query<{ status: string }, [number]>(
      "SELECT status FROM executions WHERE id = ?",
    ).get(sessionExecutionId);
    expect(execRow!.status).toBe("waiting_user");
  });
});
