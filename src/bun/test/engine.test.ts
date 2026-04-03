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
import { queueTurnResponse, getCapturedTurnOptions, resetFakeAI } from "../ai/fake.ts";
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
  resetFakeAI();
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

// ─── ask_me interception ──────────────────────────────────────────────────────

describe("ask_me tool interception", () => {
  it("sets execution_state to waiting_user and writes ask_user_prompt message", async () => {
    // Queue a scripted ask_me tool call as the first AI response
    queueTurnResponse({
      type: "tool_calls",
      calls: [
        {
          id: "call_ask1",
          type: "function",
          function: {
            name: "ask_me",
            arguments: JSON.stringify({
              question: "Which approach do you prefer?",
              selection_mode: "single",
              options: ["Option A", "Option B"],
            }),
          },
        },
      ],
    });

    const { taskId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE tasks SET workflow_state = 'plan' WHERE id = ?", [taskId]);

    // Provide a worktree so the engine enables the tool-call loop
    db.run(
      "INSERT INTO task_git_context (task_id, git_root_path, worktree_path, worktree_status) VALUES (?, ?, ?, 'ready')",
      [taskId, gitDir, gitDir],
    );

    // runExecution fires async; use onTaskUpdated callback to detect waiting_user state
    let resolveWaiting!: () => void;
    const waitingPromise = new Promise<void>((resolve) => { resolveWaiting = resolve; });
    const onTaskUpdated = (task: { executionState: string }) => {
      if (task.executionState === "waiting_user") resolveWaiting();
    };

    await handleHumanTurn(taskId, "Start planning.", noop, noop, onTaskUpdated as never);
    await waitingPromise;

    // Engine should have suspended — task is waiting_user
    const task = db
      .query<{ execution_state: string }, [number]>("SELECT execution_state FROM tasks WHERE id = ?")
      .get(taskId);
    expect(task!.execution_state).toBe("waiting_user");

    // An ask_user_prompt message should have been written to the conversation
    const promptMsg = db
      .query<{ type: string; content: string }, [number]>(
        "SELECT type, content FROM conversation_messages WHERE task_id = ? AND type = 'ask_user_prompt' LIMIT 1",
      )
      .get(taskId);
    expect(promptMsg).not.toBeNull();
    const payload = JSON.parse(promptMsg!.content);
    expect(payload.question).toBe("Which approach do you prefer?");
    expect(payload.selection_mode).toBe("single");
    expect(payload.options).toEqual(["Option A", "Option B"]);

    // The execution record should reflect waiting_user status
    const exec = db
      .query<{ status: string }, [number]>(
        "SELECT status FROM executions WHERE task_id = ? ORDER BY id DESC LIMIT 1",
      )
      .get(taskId);
    expect(exec!.status).toBe("waiting_user");
  });
});

// ─── Column tool resolution ───────────────────────────────────────────────────

import { resolveToolsForColumn } from "../workflow/tools.ts";
import { getChatCallCount } from "../ai/fake.ts";

describe("resolveToolsForColumn", () => {
  it("returns only named tools when column specifies a tools array", () => {
    const tools = resolveToolsForColumn(["read_file"]);
    const names = tools.map((t) => t.name);
    expect(names).toEqual(["read_file"]);
    expect(names).not.toContain("list_dir");
    expect(names).not.toContain("run_command");
  });

  it("returns the default tool set when column has no tools key", () => {
    const tools = resolveToolsForColumn(undefined);
    const names = tools.map((t) => t.name);
    expect(names).toContain("read_file");
    expect(names).toContain("list_dir");
    expect(names).toContain("run_command");
  });
});

// ─── spawn_agent interception ─────────────────────────────────────────────────

describe("spawn_agent tool interception", () => {
  it("runs child sub-agents and injects results as a tool_result message", async () => {
    // Round 1: parent issues spawn_agent
    queueTurnResponse({
      type: "tool_calls",
      calls: [
        {
          id: "call_spawn1",
          type: "function",
          function: {
            name: "spawn_agent",
            arguments: JSON.stringify({
              children: [
                { instructions: "Write a hello comment in src/a.ts", tools: ["write"] },
                { instructions: "Write a hello comment in src/b.ts", tools: ["write"] },
              ],
            }),
          },
        },
      ],
    });
    // Child 1 response (write_file call)
    queueTurnResponse({ type: "text", content: "Wrote src/a.ts" });
    // Child 2 response
    queueTurnResponse({ type: "text", content: "Wrote src/b.ts" });
    // Round 2 (parent resumes after spawn): return final text
    queueTurnResponse({ type: "text", content: "Both files written successfully." });

    const { taskId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE tasks SET workflow_state = 'plan' WHERE id = ?", [taskId]);
    // Provide a worktree so the tool-call loop is enabled
    db.run(
      "INSERT INTO task_git_context (task_id, git_root_path, worktree_path, worktree_status) VALUES (?, ?, ?, 'ready')",
      [taskId, gitDir, gitDir],
    );

    const tokens: string[] = [];
    let resolveCompleted!: () => void;
    const completedPromise = new Promise<void>((resolve) => { resolveCompleted = resolve; });
    const trackCompletion = (task: { executionState: string }) => {
      if (task.executionState === "completed") resolveCompleted();
    };

    await handleHumanTurn(taskId, "Go.", noop, noop, trackCompletion as never);
    await completedPromise;

    // Wait a tick for DB writes to flush
    await new Promise((r) => setTimeout(r, 50));

    // Final assistant message should exist (content comes from chat() streaming now)
    const assistantMsg = db
      .query<{ content: string }, [number]>(
        "SELECT content FROM conversation_messages WHERE task_id = ? AND type = 'assistant' ORDER BY id DESC LIMIT 1",
      )
      .get(taskId);
    expect(assistantMsg).not.toBeNull();
    expect(assistantMsg!.content.length).toBeGreaterThan(0);

    // A tool_result message for spawn_agent should have been persisted
    const toolResult = db
      .query<{ content: string }, [number]>(
        "SELECT content FROM conversation_messages WHERE task_id = ? AND type = 'tool_result' ORDER BY id ASC LIMIT 1",
      )
      .get(taskId);
    expect(toolResult).not.toBeNull();
    const results = JSON.parse(toolResult!.content) as string[];
    expect(results.length).toBe(2);
    expect(results[0]).toContain("Wrote src/a.ts");
    expect(results[1]).toContain("Wrote src/b.ts");
  }, 15_000);
});

// ─── Streaming via chat() ─────────────────────────────────────────────────────

describe("streaming (chat() always used for final response)", () => {
  it("calls chat() even when tools are enabled and model returns text immediately (no tool calls)", async () => {
    // FakeAI.turn() will return text right away (no tool call scripted) — the engine
    // must still route to chat() (true streaming) rather than replaying the turn's
    // text synchronously.
    const { taskId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE tasks SET workflow_state = 'plan' WHERE id = ?", [taskId]);

    // Seed a worktree so the engine enters the tool-call loop (tools.length > 0)
    db.run(
      "INSERT INTO task_git_context (task_id, git_root_path, worktree_path, worktree_status) VALUES (?, ?, ?, 'ready')",
      [taskId, gitDir, gitDir],
    );

    const tokens: string[] = [];
    let resolveDone!: () => void;
    const donePromise = new Promise<void>((resolve) => (resolveDone = resolve));

    await handleHumanTurn(
      taskId,
      "What is the plan?",
      (_, __, token, isDone) => {
        if (isDone) resolveDone();
        else tokens.push(token);
      },
      noop,
      noop,
    );

    await donePromise;

    // chat() must have been invoked (proves true streaming path was taken)
    expect(getChatCallCount()).toBeGreaterThan(0);
    // Multiple tokens should have arrived (FakeAI.chat yields word-by-word)
    expect(tokens.length).toBeGreaterThan(1);
  }, 10_000);

  it("calls chat() after tool calls are resolved, delivering streaming tokens", async () => {
    // Round 1: model calls a tool
    queueTurnResponse({
      type: "tool_calls",
      calls: [
        {
          id: "call_read1",
          type: "function",
          function: { name: "read_file", arguments: JSON.stringify({ path: "index.ts" }) },
        },
      ],
    });
    // Round 2: model returns text after seeing tool result — engine must stream via chat()
    queueTurnResponse({ type: "text", content: "The file looks good." });

    const { taskId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE tasks SET workflow_state = 'plan' WHERE id = ?", [taskId]);

    db.run(
      "INSERT INTO task_git_context (task_id, git_root_path, worktree_path, worktree_status) VALUES (?, ?, ?, 'ready')",
      [taskId, gitDir, gitDir],
    );

    const tokens: string[] = [];
    let resolveDone!: () => void;
    const donePromise = new Promise<void>((resolve) => (resolveDone = resolve));

    await handleHumanTurn(
      taskId,
      "Read the main file.",
      (_, __, token, isDone) => {
        if (isDone) resolveDone();
        else tokens.push(token);
      },
      noop,
      noop,
    );

    await donePromise;

    // chat() must have been called for the streaming final response
    expect(getChatCallCount()).toBeGreaterThan(0);
    // Tokens should have arrived progressively
    expect(tokens.length).toBeGreaterThan(1);

    // tool_call and tool_result messages must be in the conversation
    const toolCall = db
      .query<{ type: string }, [number]>(
        "SELECT type FROM conversation_messages WHERE task_id = ? AND type = 'tool_call' LIMIT 1",
      )
      .get(taskId);
    expect(toolCall).not.toBeNull();
  }, 15_000);
});
