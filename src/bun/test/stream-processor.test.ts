import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initDb, seedProjectAndTask, setupTestConfig } from "./helpers.ts";
import { StreamProcessor } from "../engine/stream/stream-processor.ts";
import { WriteBuffer } from "../pipeline/write-buffer.ts";
import type { RawMessageItem } from "../engine/stream/raw-message-buffer.ts";
import type { ExecutionEngine, ExecutionParams, EngineEvent, EngineResumeInput } from "../engine/types.ts";
import type { ConversationMessage } from "../../shared/rpc-types.ts";
import type { Database } from "bun:sqlite";

function noop(..._args: unknown[]): void {}

const fakeRawBuffer = new WriteBuffer<RawMessageItem>({ flushFn: () => {} });

let db: Database;
let configCleanup: () => void;
let taskId: number;
let conversationId: number;
let executionId: number;

function insertExecution(db: Database, tid: number, cid: number): number {
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

class NoopEngine implements ExecutionEngine {
  async *execute(_params: ExecutionParams): AsyncIterable<EngineEvent> {
    yield { type: "done" };
  }
  async resume(_executionId: number, _input: EngineResumeInput): Promise<void> {}
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
    const sp = new StreamProcessor(db, fakeRawBuffer, noop as never, noop as never, noop as never, noop as never, () => {});
    const signal = sp.createSignal(executionId);
    expect(signal.aborted).toBe(false);
    sp.abort(executionId);
    expect(signal.aborted).toBe(true);
  });

  it("SP-2: abortControllers cleaned up after done, subsequent createSignal returns fresh signal", async () => {
    const sp = new StreamProcessor(db, fakeRawBuffer, noop as never, noop as never, noop as never, noop as never, () => {});
    sp.createSignal(executionId);

    const engine = new NoopEngine();
    await sp.consume(taskId, conversationId, executionId, engine.execute(makeParams(taskId, conversationId, executionId)));

    sp.abort(executionId);

    const freshSignal = sp.createSignal(executionId);
    expect(freshSignal.aborted).toBe(false);

    sp.abort(executionId);
    expect(freshSignal.aborted).toBe(true);
  });

  it("SP-3: token flush on cancel mid-stream", async () => {
    let resumeFn!: () => void;
    const paused = new Promise<void>(r => { resumeFn = r; });
    let tokenYieldedFn!: () => void;
    const tokenYielded = new Promise<void>(r => { tokenYieldedFn = r; });

    class PausableEngine implements ExecutionEngine {
      async *execute(_params: ExecutionParams): AsyncIterable<EngineEvent> {
        yield { type: "token", content: "hello" };
        tokenYieldedFn();
        await paused;
        yield { type: "done" };
      }
      async resume(_executionId: number, _input: EngineResumeInput): Promise<void> {}
      cancel(_executionId: number): void {}
      async listModels() { return []; }
      async listCommands() { return []; }
    }

    const sp = new StreamProcessor(db, fakeRawBuffer, noop as never, noop as never, noop as never, noop as never, () => {});
    const signal = sp.createSignal(executionId);
    const params = makeParams(taskId, conversationId, executionId, signal);
    const engine = new PausableEngine();

    const consumePromise = sp.consume(taskId, conversationId, executionId, engine.execute(params));

    await tokenYielded;
    sp.abort(executionId);
    resumeFn();

    await consumePromise;

    const row = db.query<{ role: string; content: string; type: string }, [number]>(
      "SELECT role, content, type FROM conversation_messages WHERE conversation_id = ? AND type = 'assistant'",
    ).get(conversationId);

    expect(row).not.toBeNull();
    expect(row!.content).toContain("hello");
  });

  it("SP-4: reasoning flush on cancel mid-stream", async () => {
    let resumeFn!: () => void;
    const paused = new Promise<void>(r => { resumeFn = r; });
    let reasoningYieldedFn!: () => void;
    const reasoningYielded = new Promise<void>(r => { reasoningYieldedFn = r; });

    class PausableReasoningEngine implements ExecutionEngine {
      async *execute(_params: ExecutionParams): AsyncIterable<EngineEvent> {
        yield { type: "reasoning", content: "thinking..." };
        reasoningYieldedFn();
        await paused;
        yield { type: "done" };
      }
      async resume(_executionId: number, _input: EngineResumeInput): Promise<void> {}
      cancel(_executionId: number): void {}
      async listModels() { return []; }
      async listCommands() { return []; }
    }

    const sp = new StreamProcessor(db, fakeRawBuffer, noop as never, noop as never, noop as never, noop as never, () => {});
    const signal = sp.createSignal(executionId);
    const params = makeParams(taskId, conversationId, executionId, signal);
    const engine = new PausableReasoningEngine();

    const consumePromise = sp.consume(taskId, conversationId, executionId, engine.execute(params));

    await reasoningYielded;
    sp.abort(executionId);
    resumeFn();

    await consumePromise;

    const row = db.query<{ type: string; content: string }, [number]>(
      "SELECT type, content FROM conversation_messages WHERE conversation_id = ? AND type = 'reasoning'",
    ).get(conversationId);

    expect(row).not.toBeNull();
    expect(row!.content).toContain("thinking...");
  });

  it("SP-5: fatal error sets execution status and task execution_state to failed", async () => {
    class FatalErrorEngine implements ExecutionEngine {
      async *execute(_params: ExecutionParams): AsyncIterable<EngineEvent> {
        yield { type: "error", message: "boom", fatal: true };
      }
      async resume(_executionId: number, _input: EngineResumeInput): Promise<void> {}
      cancel(_executionId: number): void {}
      async listModels() { return []; }
      async listCommands() { return []; }
    }

    const sp = new StreamProcessor(db, fakeRawBuffer, noop as never, noop as never, noop as never, noop as never, () => {});
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

  it("SP-6: onNewMessage called once with real DB id after assistant message flush", async () => {
    class TextEngine implements ExecutionEngine {
      async *execute(_params: ExecutionParams): AsyncIterable<EngineEvent> {
        yield { type: "token", content: "hello world" };
        yield { type: "done" };
      }
      async resume(_executionId: number, _input: EngineResumeInput): Promise<void> {}
      cancel(_executionId: number): void {}
      async listModels() { return []; }
      async listCommands() { return []; }
    }

    const newMessages: ConversationMessage[] = [];
    const sp = new StreamProcessor(
      db,
      fakeRawBuffer,
      noop as never,
      noop as never,
      noop as never,
      (msg) => newMessages.push(msg),
      () => {},
    );

    await sp.consume(taskId, conversationId, executionId, new TextEngine().execute(makeParams(taskId, conversationId, executionId)));

    expect(newMessages).toHaveLength(1);
    expect(newMessages[0].content).toContain("hello world");
    expect(typeof newMessages[0].id).toBe("number");
    expect(newMessages[0].id).toBeGreaterThan(0);
  });

  it("SP-7: needs_column_prompt=1 triggers onDeferredTransition with (taskId, workflow_state) and clears flag", async () => {
    db.run("UPDATE tasks SET needs_column_prompt = 1, workflow_state = 'review' WHERE id = ?", [taskId]);

    let deferredArgs: [number, string] | null = null;
    const sp = new StreamProcessor(
      db, fakeRawBuffer, noop as never, noop as never, noop as never, noop as never,
      (tid, state) => { deferredArgs = [tid, state]; },
    );

    await sp.consume(taskId, conversationId, executionId, new NoopEngine().execute(makeParams(taskId, conversationId, executionId)));

    expect(deferredArgs).toEqual([taskId, "review"]);
    const row = db.query<{ needs_column_prompt: number }, [number]>("SELECT needs_column_prompt FROM tasks WHERE id = ?").get(taskId);
    expect(row?.needs_column_prompt).toBe(0);
  });

  it("SP-8: pending_messages rows and needs_column_prompt=0 → onPendingMessage called per row, rows deleted", async () => {
    db.run("INSERT INTO pending_messages (task_id, content) VALUES (?, ?)", [taskId, "hello"]);
    db.run("INSERT INTO pending_messages (task_id, content) VALUES (?, ?)", [taskId, "world"]);

    const delivered: string[] = [];
    const sp = new StreamProcessor(
      db, fakeRawBuffer, noop as never, noop as never, noop as never, noop as never,
      () => {},
      (_tid, msg) => { delivered.push(msg); },
    );

    await sp.consume(taskId, conversationId, executionId, new NoopEngine().execute(makeParams(taskId, conversationId, executionId)));

    expect(delivered).toEqual(["hello", "world"]);
    const remaining = db.query<{ c: number }, [number]>("SELECT COUNT(*) as c FROM pending_messages WHERE task_id = ?").get(taskId);
    expect(remaining?.c).toBe(0);
  });

  it("SP-9: no flag, no pending rows → neither drain spy called, only onTaskUpdated fires", async () => {
    let deferredCalled = false;
    let pendingCalled = false;
    let taskUpdatedCalled = false;

    const sp = new StreamProcessor(
      db, fakeRawBuffer, noop as never, noop as never,
      () => { taskUpdatedCalled = true; },
      noop as never,
      () => { deferredCalled = true; },
      () => { pendingCalled = true; },
    );

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

    const sp = new StreamProcessor(
      db, fakeRawBuffer, noop as never, noop as never, noop as never, noop as never,
      () => { deferredCalled = true; },
      () => { pendingCalled = true; },
    );

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
    const sp = new StreamProcessor(
      db, fakeRawBuffer, noop as never, noop as never,
      (task) => { capturedTask = task; },
      noop as never,
      () => {},
    );

    await sp.consume(taskId, conversationId, executionId, new NoopEngine().execute(makeParams(taskId, conversationId, executionId)));

    expect(capturedTask).not.toBeNull();
    expect(capturedTask!.worktreePath).toBe("/wt/1");
    expect(capturedTask!.worktreeStatus).toBe("ready");
    expect(capturedTask!.branchName).toBe("feature/test");
  });

  it("SP-GC-2: onTaskUpdated receives Task with null worktreePath when no task_git_context row exists", async () => {
    let capturedTask: import("../../shared/rpc-types.ts").Task | null = null;
    const sp = new StreamProcessor(
      db, fakeRawBuffer, noop as never, noop as never,
      (task) => { capturedTask = task; },
      noop as never,
      () => {},
    );

    await sp.consume(taskId, conversationId, executionId, new NoopEngine().execute(makeParams(taskId, conversationId, executionId)));

    expect(capturedTask).not.toBeNull();
    expect(capturedTask!.worktreePath).toBeNull();
  });
});

describe("SP-COMPACT: compaction_done content persistence", () => {
  function makeSummaryEngine(events: EngineEvent[]): ExecutionEngine {
    return {
      async *execute(_params: ExecutionParams): AsyncIterable<EngineEvent> {
        for (const e of events) yield e;
      },
      async resume() {},
      cancel() {},
      async listModels() { return []; },
      async listCommands() { return []; },
    };
  }

  function makeProcessor(onMsg: (m: ConversationMessage) => void = noop) {
    return new StreamProcessor(
      db, fakeRawBuffer, noop as never, noop as never, noop as never, onMsg,
      noop as never, noop as never,
    );
  }

  it("SP-COMPACT-1: compaction_done with summary → DB row has matching content", async () => {
    const sp = makeProcessor();
    const engine = makeSummaryEngine([
      { type: "compaction_done", summary: "Summarised 40 messages." },
      { type: "done" },
    ]);
    await sp.consume(taskId, conversationId, executionId, engine.execute(makeParams(taskId, conversationId, executionId)));

    const row = db.query<{ type: string; content: string }, [number]>(
      "SELECT type, content FROM conversation_messages WHERE conversation_id = ? AND type = 'compaction_summary' ORDER BY id DESC LIMIT 1",
    ).get(conversationId);
    expect(row).toBeDefined();
    expect(row!.content).toBe("Summarised 40 messages.");
  });

  it("SP-COMPACT-2: compaction_done without summary → DB row has empty content", async () => {
    const sp = makeProcessor();
    const engine = makeSummaryEngine([
      { type: "compaction_done" },
      { type: "done" },
    ]);
    await sp.consume(taskId, conversationId, executionId, engine.execute(makeParams(taskId, conversationId, executionId)));

    const row = db.query<{ type: string; content: string }, [number]>(
      "SELECT type, content FROM conversation_messages WHERE conversation_id = ? AND type = 'compaction_summary' ORDER BY id DESC LIMIT 1",
    ).get(conversationId);
    expect(row).toBeDefined();
    expect(row!.content).toBe("");
  });

  it("SP-COMPACT-3: compaction_start then compaction_done → two rows in order", async () => {
    const sp = makeProcessor();
    const engine = makeSummaryEngine([
      { type: "compaction_start" },
      { type: "compaction_done", summary: "S" },
      { type: "done" },
    ]);
    await sp.consume(taskId, conversationId, executionId, engine.execute(makeParams(taskId, conversationId, executionId)));

    const rows = db.query<{ type: string; content: string }, [number]>(
      "SELECT type, content FROM conversation_messages WHERE conversation_id = ? AND (type = 'compaction_summary' OR (type = 'system' AND content = 'Compacting conversation…')) ORDER BY id ASC",
    ).all(conversationId);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.type).toBe("system");
    expect(rows[1]!.type).toBe("compaction_summary");
    expect(rows[1]!.content).toBe("S");
  });
});
