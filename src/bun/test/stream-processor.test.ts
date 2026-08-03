import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initDb, seedProjectAndTask, setupTestConfig } from "./helpers.ts";
import { StreamProcessor } from "../engine/stream/stream-processor.ts";
import { WriteBuffer } from "../pipeline/write-buffer.ts";
import type { RawMessageItem } from "../engine/stream/raw-message-buffer.ts";
import type { ExecutionEngine, ExecutionParams, EngineEvent, EngineResumeInput } from "../engine/types.ts";
import type { ConversationMessage } from "../../shared/rpc-types.ts";
import type { Db } from "../db/db.ts";

function noop(..._args: unknown[]): void {}

const fakeRawBuffer = new WriteBuffer<RawMessageItem>({ flushFn: () => {} });

let db: Db;
let configCleanup: () => void;
let taskId: number;
let conversationId: number;
let executionId: number;

async function insertExecution(db: Db, tid: number, cid: number): Promise<number> {
  const row = await db.get<{ id: number }>(
    "INSERT INTO executions (task_id, conversation_id, from_state, to_state, prompt_id, status, attempt) VALUES ($1, $2, 'plan', 'plan', 'human-turn', 'running', 1) RETURNING id",
    [tid, cid],
  );
  return row!.id;
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

beforeEach(async () => {
  const cfg = setupTestConfig();
  configCleanup = cfg.cleanup;
  db = await initDb();
  const seed = await seedProjectAndTask(db, "/test-git");
  taskId = seed.taskId;
  conversationId = seed.conversationId;
  executionId = await insertExecution(db, taskId, conversationId);
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

    const row = await db.get<{ role: string; content: string; type: string }>(
      "SELECT role, content, type FROM conversation_messages WHERE conversation_id = $1 AND type = 'assistant'",
      [conversationId],
    );

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

    const row = await db.get<{ type: string; content: string }>(
      "SELECT type, content FROM conversation_messages WHERE conversation_id = $1 AND type = 'reasoning'",
      [conversationId],
    );

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

    const execRow = await db.get<{ status: string }>(
      "SELECT status FROM executions WHERE id = $1",
      [executionId],
    );
    expect(execRow!.status).toBe("failed");

    const taskRow = await db.get<{ execution_state: string }>(
      "SELECT execution_state FROM tasks WHERE id = $1",
      [taskId],
    );
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
    await db.exec("UPDATE tasks SET needs_column_prompt = 1, workflow_state = 'review' WHERE id = $1", [taskId]);

    let deferredArgs: [number, string] | null = null;
    const sp = new StreamProcessor(
      db, fakeRawBuffer, noop as never, noop as never, noop as never, noop as never,
      (tid, state) => { deferredArgs = [tid, state]; },
    );

    await sp.consume(taskId, conversationId, executionId, new NoopEngine().execute(makeParams(taskId, conversationId, executionId)));

    expect(deferredArgs).toEqual([taskId, "review"]);
    const row = await db.get<{ needs_column_prompt: number }>("SELECT needs_column_prompt FROM tasks WHERE id = $1", [taskId]);
    expect(row?.needs_column_prompt).toBe(0);
  });

  it("SP-8: pending_messages rows and needs_column_prompt=0 → onPendingMessage called per row, rows deleted", async () => {
    await db.exec("INSERT INTO pending_messages (task_id, content) VALUES ($1, $2)", [taskId, "hello"]);
    await db.exec("INSERT INTO pending_messages (task_id, content) VALUES ($1, $2)", [taskId, "world"]);

    const delivered: string[] = [];
    const sp = new StreamProcessor(
      db, fakeRawBuffer, noop as never, noop as never, noop as never, noop as never,
      () => {},
      (_tid, msg) => { delivered.push(msg); },
    );

    await sp.consume(taskId, conversationId, executionId, new NoopEngine().execute(makeParams(taskId, conversationId, executionId)));

    expect(delivered).toEqual(["hello", "world"]);
    const remaining = await db.get<{ c: number }>("SELECT COUNT(*) as c FROM pending_messages WHERE task_id = $1", [taskId]);
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
    await db.exec("UPDATE tasks SET needs_column_prompt = 1, workflow_state = 'done' WHERE id = $1", [taskId]);
    await db.exec("INSERT INTO pending_messages (task_id, content) VALUES ($1, $2)", [taskId, "pending"]);

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

    const remaining = await db.get<{ c: number }>("SELECT COUNT(*) as c FROM pending_messages WHERE task_id = $1", [taskId]);
    expect(remaining?.c).toBe(1); // NOT deleted — deferred path skips pending drain
  });

  it("SP-GC-1: onTaskUpdated receives Task with worktreePath when task_git_context row exists", async () => {
    await db.exec(
      "INSERT INTO task_git_context (task_id, git_root_path, worktree_path, worktree_status, branch_name) VALUES ($1, $2, $3, $4, $5)",
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

    const row = await db.get<{ type: string; content: string }>(
      "SELECT type, content FROM conversation_messages WHERE conversation_id = $1 AND type = 'compaction_summary' ORDER BY id DESC LIMIT 1",
      [conversationId],
    );
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

    const row = await db.get<{ type: string; content: string }>(
      "SELECT type, content FROM conversation_messages WHERE conversation_id = $1 AND type = 'compaction_summary' ORDER BY id DESC LIMIT 1",
      [conversationId],
    );
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

    const rows = await db.rows<{ type: string; content: string }>(
      "SELECT type, content FROM conversation_messages WHERE conversation_id = $1 AND (type = 'compaction_summary' OR (type = 'system' AND content = 'Compacting conversation…')) ORDER BY id ASC",
      [conversationId],
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]!.type).toBe("system");
    expect(rows[1]!.type).toBe("compaction_summary");
    expect(rows[1]!.content).toBe("S");
  });
});
