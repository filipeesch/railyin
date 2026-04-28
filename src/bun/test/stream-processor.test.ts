import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
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
    const sp = new StreamProcessor(db, fakeRawBuffer, noop as never, noop as never, noop as never, noop as never);
    const signal = sp.createSignal(executionId);
    expect(signal.aborted).toBe(false);
    sp.abort(executionId);
    expect(signal.aborted).toBe(true);
  });

  it("SP-2: abortControllers cleaned up after done, subsequent createSignal returns fresh signal", async () => {
    const sp = new StreamProcessor(db, fakeRawBuffer, noop as never, noop as never, noop as never, noop as never);
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

    const sp = new StreamProcessor(db, fakeRawBuffer, noop as never, noop as never, noop as never, noop as never);
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

    const sp = new StreamProcessor(db, fakeRawBuffer, noop as never, noop as never, noop as never, noop as never);
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

    const sp = new StreamProcessor(db, fakeRawBuffer, noop as never, noop as never, noop as never, noop as never);
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
    );

    await sp.consume(taskId, conversationId, executionId, new TextEngine().execute(makeParams(taskId, conversationId, executionId)));

    expect(newMessages).toHaveLength(1);
    expect(newMessages[0].content).toContain("hello world");
    expect(typeof newMessages[0].id).toBe("number");
    expect(newMessages[0].id).toBeGreaterThan(0);
  });
});
