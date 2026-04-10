/**
 * Task 9.1: Native engine E2E tests via Orchestrator.
 *
 * Tests drive the engine through the Orchestrator public API
 * (executeTransition / executeHumanTurn / executeRetry / executeCodeReview / cancel)
 * using the fake AI provider — no real model calls are made.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";
import { initDb, seedProjectAndTask, setupTestConfig } from "./helpers.ts";
import { Orchestrator } from "../engine/orchestrator.ts";
import { NativeEngine } from "../engine/native/engine.ts";
import { queueTurnResponse, queueStreamStep, resetFakeAI } from "../ai/fake.ts";
import type { Database } from "bun:sqlite";
import type { Task, ConversationMessage } from "../../shared/rpc-types.ts";

let db: Database;
let gitDir: string;
let configCleanup: () => void;
let orchestrator: Orchestrator;

function noop() {}

const tokens: string[] = [];
const taskUpdates: Task[] = [];
const newMessages: ConversationMessage[] = [];

function makeOrchestrator(): Orchestrator {
  tokens.length = 0;
  taskUpdates.length = 0;
  newMessages.length = 0;

  return new Orchestrator(
    new NativeEngine(),
    (_taskId, _execId, token, done) => { if (!done) tokens.push(token); },
    noop,
    (task) => taskUpdates.push(task),
    (msg) => newMessages.push(msg),
  );
}

beforeEach(() => {
  const cfg = setupTestConfig();
  configCleanup = cfg.cleanup;
  db = initDb();

  gitDir = mkdtempSync(join(tmpdir(), "railyn-orch-"));
  execSync("git init", { cwd: gitDir });
  execSync('git config user.email "t@t.com"', { cwd: gitDir });
  execSync('git config user.name "T"', { cwd: gitDir });
  writeFileSync(join(gitDir, "index.ts"), "export const a = 1;");
  execSync("git add . && git commit -m init", { cwd: gitDir });

  orchestrator = makeOrchestrator();
});

afterEach(() => {
  rmSync(gitDir, { recursive: true, force: true });
  configCleanup();
  resetFakeAI();
});

// ─── executeTransition ───────────────────────────────────────────────────────

describe("Orchestrator.executeTransition", () => {
  it("updates workflow_state via native engine", async () => {
    const { taskId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE tasks SET workflow_state = 'backlog' WHERE id = ?", [taskId]);

    const { task } = await orchestrator.executeTransition(taskId, "plan");

    expect(task.workflowState).toBe("plan");

    const row = db
      .query<{ workflow_state: string }, [number]>("SELECT workflow_state FROM tasks WHERE id = ?")
      .get(taskId);
    expect(row!.workflow_state).toBe("plan");
  });

  it("creates a transition_event message", async () => {
    const { taskId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE tasks SET workflow_state = 'backlog' WHERE id = ?", [taskId]);

    await orchestrator.executeTransition(taskId, "plan");

    const event = db
      .query<{ type: string }, [number]>(
        "SELECT type FROM conversation_messages WHERE task_id = ? AND type = 'transition_event' LIMIT 1",
      )
      .get(taskId);
    expect(event).not.toBeNull();
  });

  it("returns null executionId for columns without on_enter_prompt", async () => {
    const { taskId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE tasks SET workflow_state = 'plan' WHERE id = ?", [taskId]);

    const { executionId } = await orchestrator.executeTransition(taskId, "done");

    expect(executionId).toBeNull();
  });

  it("creates an execution for columns with on_enter_prompt", async () => {
    const { taskId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE tasks SET workflow_state = 'backlog' WHERE id = ?", [taskId]);

    const { executionId } = await orchestrator.executeTransition(taskId, "plan");

    expect(executionId).not.toBeNull();
    expect(typeof executionId).toBe("number");
  }, 10_000);
});

// ─── executeHumanTurn ────────────────────────────────────────────────────────

describe("Orchestrator.executeHumanTurn", () => {
  it("appends user + assistant messages to DB", async () => {
    const { taskId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE tasks SET workflow_state = 'plan' WHERE id = ?", [taskId]);

    let resolveDone!: () => void;
    const donePromise = new Promise<void>((resolve) => (resolveDone = resolve));

    const origOnToken = orchestrator["onToken"];
    // @ts-expect-error — patching private for test
    orchestrator["onToken"] = (taskId: number, execId: number, token: string, done: boolean) => {
      if (done) resolveDone();
      origOnToken(taskId, execId, token, done);
    };

    await orchestrator.executeHumanTurn(taskId, "What should I do first?");
    await donePromise;

    const userMsg = db
      .query<{ content: string }, [number]>(
        "SELECT content FROM conversation_messages WHERE task_id = ? AND type = 'user' ORDER BY id DESC LIMIT 1",
      )
      .get(taskId);
    expect(userMsg!.content).toBe("What should I do first?");

    const assistantMsg = db
      .query<{ content: string }, [number]>(
        "SELECT content FROM conversation_messages WHERE task_id = ? AND type = 'assistant' ORDER BY id DESC LIMIT 1",
      )
      .get(taskId);
    expect(assistantMsg!.content.length).toBeGreaterThan(0);
  });

  it("creates an execution record", async () => {
    const { taskId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE tasks SET workflow_state = 'plan' WHERE id = ?", [taskId]);

    const before = db
      .query<{ n: number }, [number]>("SELECT count(*) as n FROM executions WHERE task_id = ?")
      .get(taskId)!.n;

    await orchestrator.executeHumanTurn(taskId, "Go.");

    const after = db
      .query<{ n: number }, [number]>("SELECT count(*) as n FROM executions WHERE task_id = ?")
      .get(taskId)!.n;
    expect(after).toBe(before + 1);
  });

  it("returns message and executionId", async () => {
    const { taskId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE tasks SET workflow_state = 'plan' WHERE id = ?", [taskId]);

    const { message, executionId } = await orchestrator.executeHumanTurn(taskId, "Hello.");

    expect(message).toBeDefined();
    expect(message.taskId).toBe(taskId);
    expect(typeof executionId).toBe("number");
  });
});

// ─── executeRetry ─────────────────────────────────────────────────────────────

describe("Orchestrator.executeRetry", () => {
  it("creates a new execution", async () => {
    const { taskId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE tasks SET workflow_state = 'plan' WHERE id = ?", [taskId]);
    // Seed a prior execution so retry has something to retry
    db.run(
      "INSERT INTO executions (task_id, from_state, to_state, status) VALUES (?, 'backlog', 'plan', 'failed')",
      [taskId],
    );
    const execBefore = db
      .query<{ id: number }, [number]>(
        "SELECT id FROM executions WHERE task_id = ? ORDER BY id DESC LIMIT 1",
      )
      .get(taskId)!.id;
    db.run("UPDATE tasks SET current_execution_id = ? WHERE id = ?", [execBefore, taskId]);

    const { executionId } = await orchestrator.executeRetry(taskId);

    expect(typeof executionId).toBe("number");
    expect(executionId).not.toBe(execBefore);
  }, 10_000);
});

// ─── cancel ──────────────────────────────────────────────────────────────────

describe("Orchestrator.cancel", () => {
  it("cancels an in-progress execution without throwing", async () => {
    const { taskId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE tasks SET workflow_state = 'plan' WHERE id = ?", [taskId]);

    // Start a human turn and immediately cancel
    const turnPromise = orchestrator.executeHumanTurn(taskId, "Start processing.");
    const { executionId } = await turnPromise;

    // cancel should not throw
    expect(() => orchestrator.cancel(executionId)).not.toThrow();
  });

  it("is a no-op for unknown execution IDs", () => {
    expect(() => orchestrator.cancel(99999)).not.toThrow();
  });
});

// ─── listModels ──────────────────────────────────────────────────────────────

describe("Orchestrator.listModels", () => {
  it("returns an array of EngineModelInfo", async () => {
    const models = await orchestrator.listModels();
    expect(Array.isArray(models)).toBe(true);
    for (const m of models) {
      expect(typeof m.qualifiedId).toBe("string");
      expect(m.qualifiedId.length).toBeGreaterThan(0);
      expect(m.contextWindow === null || typeof m.contextWindow === "number").toBe(true);
    }
  });
});
