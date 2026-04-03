/**
 * Engine integration tests.
 *
 * Tests drive the engine through its public API (handleHumanTurn / handleTransition).
 * setupTestConfig() seeds a workspace.yaml with provider: fake so createProvider()
 * returns FakeAIProvider — no real model calls are made.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";
import { initDb, seedProjectAndTask, setupTestConfig } from "./helpers.ts";
import { handleHumanTurn, handleTransition } from "../workflow/engine.ts";
import type { Database } from "bun:sqlite";

let db: Database;
let gitDir: string;
let configCleanup: () => void;

beforeEach(() => {
  // Config must be set up before initDb so getConfig() resolves to fake provider
  const cfg = setupTestConfig();
  configCleanup = cfg.cleanup;
  db = initDb();

  gitDir = mkdtempSync(join(tmpdir(), "railyn-eng-"));
  execSync("git init", { cwd: gitDir });
  execSync('git config user.email "t@t.com"', { cwd: gitDir });
  execSync('git config user.name "T"', { cwd: gitDir });
  writeFileSync(join(gitDir, "index.ts"), "export const a = 1;");
  execSync("git add . && git commit -m init", { cwd: gitDir });
});

afterEach(() => {
  rmSync(gitDir, { recursive: true, force: true });
  configCleanup();
});

function noop() {}

// ─── handleHumanTurn ─────────────────────────────────────────────────────────

describe("handleHumanTurn", () => {
  it("appends user message and writes assistant message to DB", async () => {
    const { taskId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE tasks SET workflow_state = 'plan' WHERE id = ?", [taskId]);

    const tokens: string[] = [];
    let resolveDone!: () => void;
    const donePromise = new Promise<void>((resolve) => (resolveDone = resolve));

    await handleHumanTurn(
      taskId,
      "What should I do first?",
      (_, __, token, isDone) => { if (isDone) resolveDone(); else tokens.push(token); },
      noop,
      noop,
    );

    await donePromise;

    expect(tokens.join("").length).toBeGreaterThan(0);

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

  it("marks execution as completed", async () => {
    const { taskId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE tasks SET workflow_state = 'plan' WHERE id = ?", [taskId]);

    let resolveDone!: () => void;
    const donePromise = new Promise<void>((resolve) => (resolveDone = resolve));

    await handleHumanTurn(
      taskId,
      "Go.",
      (_, __, _t, isDone) => { if (isDone) resolveDone(); },
      noop,
      noop,
    );

    await donePromise;

    const exec = db
      .query<{ status: string }, [number]>(
        "SELECT status FROM executions WHERE task_id = ? ORDER BY id DESC LIMIT 1",
      )
      .get(taskId);
    expect(exec!.status).toBe("completed");
  });

  it("creates an execution record for the human turn", async () => {
    const { taskId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE tasks SET workflow_state = 'plan' WHERE id = ?", [taskId]);

    const before = db
      .query<{ n: number }, [number]>("SELECT count(*) as n FROM executions WHERE task_id = ?")
      .get(taskId)!.n;

    await handleHumanTurn(taskId, "Proceed.", noop, noop, noop);

    const after = db
      .query<{ n: number }, [number]>("SELECT count(*) as n FROM executions WHERE task_id = ?")
      .get(taskId)!.n;

    expect(after).toBe(before + 1);
  });
});

// ─── handleTransition ────────────────────────────────────────────────────────

describe("handleTransition", () => {
  it("updates workflow_state and appends a transition_event message", async () => {
    const { taskId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE tasks SET workflow_state = 'backlog' WHERE id = ?", [taskId]);

    await handleTransition(taskId, "plan", noop, noop, noop);

    const task = db
      .query<{ workflow_state: string }, [number]>("SELECT workflow_state FROM tasks WHERE id = ?")
      .get(taskId);
    expect(task!.workflow_state).toBe("plan");

    const event = db
      .query<{ type: string }, [number]>(
        "SELECT type FROM conversation_messages WHERE task_id = ? AND type = 'transition_event' LIMIT 1",
      )
      .get(taskId);
    expect(event).not.toBeNull();
  });

  it("leaves execution_state idle when column has no on_enter_prompt", async () => {
    const { taskId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE tasks SET workflow_state = 'plan' WHERE id = ?", [taskId]);

    const { task } = await handleTransition(taskId, "done", noop, noop, noop);

    expect(task.workflowState).toBe("done");
    expect(task.executionState).toBe("idle");
    expect(task.currentExecutionId).toBeNull();
  });

  it("creates an execution when transitioning to a column with on_enter_prompt", async () => {
    const { taskId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE tasks SET workflow_state = 'backlog' WHERE id = ?", [taskId]);

    const { executionId } = await handleTransition(taskId, "plan", noop, noop, noop);

    expect(executionId).not.toBeNull();

    // Wait briefly for async execution to write its result
    await new Promise((r) => setTimeout(r, 500));

    const exec = db
      .query<{ status: string }, [number]>("SELECT status FROM executions WHERE id = ?")
      .get(executionId!);
    expect(["running", "completed"]).toContain(exec!.status);
  }, 10_000);
});
