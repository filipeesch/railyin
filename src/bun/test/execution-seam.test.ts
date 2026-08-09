/**
 * execution-seam.test.ts — BRDG-01 seam contract through the REAL executor chain.
 *
 * Drives Orchestrator → ChatExecutor → StreamProcessor with a scripted engine
 * and asserts the optional `opts?: { onEngineEvent?, onRunEnd? }` threading:
 *
 *  1. onEngineEvent fires for EVERY raw EngineEvent in exact order (incl. usage/done)
 *  2. executeChatTurn WITHOUT opts is byte-identical (no callbacks, DB statuses unchanged)
 *  3. onRunEnd fires at every terminal outcome: done / error / aborted / decision
 *
 * The scripted engine is inline (Task 1 precedes Task 3's mock-engine markers);
 * the chain itself is real — no stubs beyond the engine.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initDb, seedChatSession, setupTestConfig, makeTestRegistry } from "./helpers.ts";
import { Orchestrator } from "../engine/orchestrator.ts";
import { WorkspaceRepository } from "../db/workspace-repository.ts";
import type { Database } from "bun:sqlite";
import type { ExecutionEngine, ExecutionParams, EngineEvent, EngineResumeInput } from "../engine/types.ts";

type RunOutcome = "done" | "error" | "aborted" | "decision";

interface SeamOpts {
  onEngineEvent?: (e: EngineEvent) => void;
  onRunEnd?: (o: RunOutcome) => void;
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

  async resume(_executionId: number, _input: EngineResumeInput): Promise<void> { }
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
  it("1: onEngineEvent fires for every raw event in exact order, incl. usage and done", async () => {
    orchestrator = makeOrchestrator(new SeamEngine([
      { type: "token", content: "hello" },
      { type: "reasoning", content: "thinking" },
      { type: "tool_start", name: "read_file", callId: "call_1", arguments: "{}" },
      { type: "tool_result", name: "read_file", callId: "call_1", result: "file contents" },
      { type: "usage", inputTokens: 10, outputTokens: 5 },
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
      "token", "reasoning", "tool_start", "tool_result", "usage", "done",
    ]);
  });

  it("2: without opts — no callbacks, no crash, DB statuses unchanged (done → idle/completed)", async () => {
    orchestrator = makeOrchestrator(new SeamEngine([
      { type: "token", content: "hello" },
      { type: "usage", inputTokens: 10, outputTokens: 5 },
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

    // The user message was persisted as before.
    const msgCount = db.query<{ n: number }, [number]>(
      "SELECT COUNT(*) AS n FROM conversation_messages WHERE conversation_id = ?",
    ).get(conversationId)!;
    expect(msgCount.n).toBeGreaterThanOrEqual(1);
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
});
