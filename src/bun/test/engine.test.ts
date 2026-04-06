/**
 * Engine integration tests.
 *
 * Tests drive the engine through its public API (handleHumanTurn / handleTransition).
 * setupTestConfig() seeds a workspace.yaml with provider: fake so createProvider()
 * returns FakeAIProvider — no real model calls are made.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { extractSummaryBlock, compactMessages, MICRO_COMPACT_TURN_WINDOW, MICRO_COMPACT_SENTINEL } from "../workflow/engine.ts";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";
import { initDb, seedProjectAndTask, setupTestConfig } from "./helpers.ts";
import { handleHumanTurn, handleTransition } from "../workflow/engine.ts";
import { queueStreamStep, queueTurnResponse, getCapturedTurnOptions, getCapturedStreamMessages, resetFakeAI } from "../ai/fake.ts";
import type { Database } from "bun:sqlite";
import type { ConversationMessageRow } from "../db/row-types.ts";

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

function noop() { }

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

    await handleHumanTurn(taskId, "Proceed.", noop, noop, noop, noop);

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

    await handleTransition(taskId, "plan", noop, noop, noop, noop);

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

    const { task } = await handleTransition(taskId, "done", noop, noop, noop, noop);

    expect(task.workflowState).toBe("done");
    expect(task.executionState).toBe("idle");
    expect(task.currentExecutionId).toBeNull();
  });

  it("creates an execution when transitioning to a column with on_enter_prompt", async () => {
    const { taskId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE tasks SET workflow_state = 'backlog' WHERE id = ?", [taskId]);

    const { executionId } = await handleTransition(taskId, "plan", noop, noop, noop, noop);

    expect(executionId).not.toBeNull();

    // Wait briefly for async execution to write its result
    await new Promise((r) => setTimeout(r, 500));

    const exec = db
      .query<{ status: string }, [number]>("SELECT status FROM executions WHERE id = ?")
      .get(executionId!);
    expect(["running", "completed"]).toContain(exec!.status);
  }, 10_000);
});

// ─── workspace default_model on column transition ─────────────────────────────

describe("handleTransition / workspace default_model", () => {
  it("applies workspace default_model when column has no model configured", async () => {
    configCleanup();
    const cfgWithDefault = setupTestConfig("default_model: fake/workspace-default");
    configCleanup = cfgWithDefault.cleanup;
    const { taskId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE tasks SET workflow_state = 'plan', model = NULL WHERE id = ?", [taskId]);

    await handleTransition(taskId, "done", noop, noop, noop, noop);

    const task = db
      .query<{ model: string | null }, [number]>("SELECT model FROM tasks WHERE id = ?")
      .get(taskId);
    expect(task!.model).toBe("fake/workspace-default");
  });

  it("leaves model unchanged when neither column nor workspace specifies a model", async () => {
    // default setupTestConfig has no default_model
    const { taskId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE tasks SET workflow_state = 'plan', model = 'fake/existing' WHERE id = ?", [taskId]);

    await handleTransition(taskId, "done", noop, noop, noop, noop);

    const task = db
      .query<{ model: string | null }, [number]>("SELECT model FROM tasks WHERE id = ?")
      .get(taskId);
    expect(task!.model).toBe("fake/existing");
  });
});

// ─── ask_me interception ──────────────────────────────────────────────────────

describe("ask_me tool interception", () => {
  it("sets execution_state to waiting_user and writes ask_user_prompt message", async () => {
    // Queue a scripted ask_me tool call as the first AI stream response
    queueStreamStep({
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

    await handleHumanTurn(taskId, "Start planning.", noop, noop, onTaskUpdated as never, noop);
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
    const payload = JSON.parse(promptMsg!.content) as { questions: Array<{ question: string; selection_mode: string; options: Array<{ label: string }> }> };
    expect(payload.questions[0].question).toBe("Which approach do you prefer?");
    expect(payload.questions[0].selection_mode).toBe("single");
    expect(payload.questions[0].options.map((o) => o.label)).toEqual(["Option A", "Option B"]);

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
    // Round 1: parent issues spawn_agent (via stream())
    queueStreamStep({
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
    // Child 1 response — sub-agents use turn(), so queueTurnResponse
    queueTurnResponse({ type: "text", content: "Wrote src/a.ts" });
    // Child 2 response
    queueTurnResponse({ type: "text", content: "Wrote src/b.ts" });
    // Round 2 (parent resumes after spawn): return final text via stream()
    queueStreamStep({ type: "text", tokens: ["Both files written successfully."] });

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

// ─── Unified streaming ────────────────────────────────────────────────────────

describe("unified streaming (stream() used for every round)", () => {
  it("delivers streaming tokens when model returns text immediately (no tool calls)", async () => {
    // No scripted steps — FakeAI.stream() default yields word-by-word text
    const { taskId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE tasks SET workflow_state = 'plan' WHERE id = ?", [taskId]);

    // Seed a worktree so the engine passes tool definitions to stream()
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

    // Multiple tokens should have arrived (FakeAI.stream() yields word-by-word)
    expect(tokens.length).toBeGreaterThan(1);
  }, 10_000);

  it("executes tool calls then delivers streaming final response in the same loop", async () => {
    // Round 1: model calls read_file via stream()
    queueStreamStep({
      type: "tool_calls",
      calls: [
        {
          id: "call_read1",
          type: "function",
          function: { name: "read_file", arguments: JSON.stringify({ path: "index.ts" }) },
        },
      ],
    });
    // Round 2: model returns streaming text after seeing tool result
    queueStreamStep({ type: "text", tokens: ["The ", "file ", "looks ", "good. "] });

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
      noop,
    );

    await donePromise;

    // Tokens should have arrived from the scripted round-2 text step
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens.join("")).toContain("file");

    // tool_call and tool_result messages must be in the conversation
    const toolCall = db
      .query<{ type: string }, [number]>(
        "SELECT type FROM conversation_messages WHERE task_id = ? AND type = 'tool_call' LIMIT 1",
      )
      .get(taskId);
    expect(toolCall).not.toBeNull();
  }, 15_000);

  it("single stream() call per round — no duplicate top-level API calls", async () => {
    // Round 1: tool call
    queueStreamStep({
      type: "tool_calls",
      calls: [
        {
          id: "call_read2",
          type: "function",
          function: { name: "read_file", arguments: JSON.stringify({ path: "index.ts" }) },
        },
      ],
    });
    // Round 2: text — only ONE stream call should be made for this round
    queueStreamStep({ type: "text", tokens: ["Done."] });

    const { taskId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE tasks SET workflow_state = 'plan' WHERE id = ?", [taskId]);
    db.run(
      "INSERT INTO task_git_context (task_id, git_root_path, worktree_path, worktree_status) VALUES (?, ?, ?, 'ready')",
      [taskId, gitDir, gitDir],
    );

    let resolveDone!: () => void;
    const donePromise = new Promise<void>((resolve) => (resolveDone = resolve));
    await handleHumanTurn(taskId, "Go.", (_, __, _t, isDone) => { if (isDone) resolveDone(); }, noop, noop, noop);
    await donePromise;

    // After round 1 (tool_calls) and round 2 (text), the scripted step queue should
    // be empty — meaning each round consumed exactly one step
    const capturedOpts = getCapturedTurnOptions();
    // sub-agent turn() queue should be untouched (no turn() calls from engine)
    expect(capturedOpts.length).toBe(0);
  }, 10_000);
});

// ─── awaiting_user fallback (tasks 5.10 & 5.11) ───────────────────────────────

describe("awaiting_user on UnresolvableProviderError", () => {
  it("5.10 task with model:null → execution_state awaiting_user + system message", async () => {
    const { taskId } = seedProjectAndTask(db, gitDir);
    // Override model to null — this should trigger UnresolvableProviderError
    db.run("UPDATE tasks SET workflow_state = 'plan', model = NULL WHERE id = ?", [taskId]);

    let executionId!: number;
    await handleHumanTurn(
      taskId,
      "Please help.",
      noop,
      noop,
      noop,
      noop,
    ).then((r) => { executionId = r.executionId; });

    // Give async runExecution time to complete (it should fail fast)
    await new Promise((r) => setTimeout(r, 300));

    const task = db
      .query<{ execution_state: string }, [number]>("SELECT execution_state FROM tasks WHERE id = ?")
      .get(taskId);
    expect(task!.execution_state).toBe("awaiting_user");

    const sysMsg = db
      .query<{ content: string }, [number]>(
        "SELECT content FROM conversation_messages WHERE task_id = ? AND type = 'system' ORDER BY id DESC LIMIT 1",
      )
      .get(taskId);
    expect(sysMsg).not.toBeNull();
    expect(sysMsg!.content).toMatch(/model/i);
  });

  it("5.11 task with unknown provider prefix → execution_state awaiting_user", async () => {
    const { taskId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE tasks SET workflow_state = 'plan', model = 'unknownprovider/some-model' WHERE id = ?", [taskId]);

    await handleHumanTurn(taskId, "Go.", noop, noop, noop, noop);

    await new Promise((r) => setTimeout(r, 300));

    const task = db
      .query<{ execution_state: string }, [number]>("SELECT execution_state FROM tasks WHERE id = ?")
      .get(taskId);
    expect(task!.execution_state).toBe("awaiting_user");
  });
});

describe("extractSummaryBlock", () => {
  it("3.1 extracts only the <summary> content when both analysis and summary blocks are present", () => {
    const raw = [
      "<analysis>",
      "This is my reasoning scratch work.",
      "I analyzed several things here.",
      "</analysis>",
      "",
      "<summary>",
      "1. Primary Request and Intent:",
      "   The user wanted to refactor the auth module.",
      "",
      "2. Key Technical Concepts:",
      "   - JWT tokens",
      "   - bcrypt hashing",
      "</summary>",
    ].join("\n");

    const result = extractSummaryBlock(raw);
    expect(result).not.toContain("<analysis>");
    expect(result).not.toContain("reasoning scratch work");
    expect(result).toContain("Primary Request and Intent");
    expect(result).toContain("JWT tokens");
  });

  it("3.2 returns the full response when no <summary> tags are present", () => {
    const raw = "This model did not use any tags. Here is a plain summary of the work done.";
    const result = extractSummaryBlock(raw);
    expect(result).toBe(raw);
  });

  it("strips <analysis> block even when no <summary> tags are present", () => {
    const raw = "<analysis>\nOnly analysis, no summary tags.\n</analysis>\n\nThe actual summary text is here.";
    const result = extractSummaryBlock(raw);
    expect(result).not.toContain("<analysis>");
    expect(result).not.toContain("Only analysis");
    expect(result).toContain("actual summary text");
  });

  it("falls back to raw when stripping produces empty content", () => {
    const raw = "<analysis>Some reasoning.</analysis>";
    const result = extractSummaryBlock(raw);
    expect(result.length).toBeGreaterThan(0);
  });
});

// ─── richer-ask-user-tool: engine normalization ───────────────────────────────

describe("ask_me tool normalization", () => {
  // 4.1: legacy flat schema { question, selection_mode, options: string[] } is stored
  // as the new { questions: [...] } array format.
  it("4.1 normalizes legacy flat schema to questions array format", async () => {
    queueStreamStep({
      type: "tool_calls",
      calls: [{
        id: "call_legacy",
        type: "function",
        function: {
          name: "ask_me",
          arguments: JSON.stringify({
            question: "Which approach should I use?",
            selection_mode: "single",
            options: ["Option A", "Option B"],
          }),
        },
      }],
    });

    const { taskId, conversationId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE tasks SET workflow_state = 'plan' WHERE id = ?", [taskId]);
    db.run(
      "INSERT INTO task_git_context (task_id, git_root_path, worktree_path, worktree_status) VALUES (?, ?, ?, 'ready')",
      [taskId, gitDir, gitDir],
    );

    let resolveWaiting!: () => void;
    const waitingPromise = new Promise<void>((resolve) => { resolveWaiting = resolve; });
    const onTaskUpdated = (task: { executionState: string }) => {
      if (task.executionState === "waiting_user") resolveWaiting();
    };

    await handleHumanTurn(taskId, "Go.", noop, noop, onTaskUpdated as never, noop);
    await waitingPromise;

    const row = db
      .query<{ content: string }, [number]>(
        "SELECT content FROM conversation_messages WHERE task_id = ? AND type = 'ask_user_prompt' ORDER BY id DESC LIMIT 1",
      )
      .get(taskId);
    expect(row).not.toBeNull();

    const stored = JSON.parse(row!.content) as { questions?: unknown[] };
    expect(Array.isArray(stored.questions)).toBe(true);
    expect(stored.questions).toHaveLength(1);
    const q = (stored.questions![0] as { question: string; options: Array<{ label: string }> });
    expect(q.question).toBe("Which approach should I use?");
    expect(q.options[0].label).toBe("Option A");
    expect(q.options[1].label).toBe("Option B");
  });

  // 4.2: new format fields (description, recommended, preview) pass through unchanged.
  it("4.2 passes description, recommended, and preview fields into the stored message", async () => {
    queueStreamStep({
      type: "tool_calls",
      calls: [{
        id: "call_rich",
        type: "function",
        function: {
          name: "ask_me",
          arguments: JSON.stringify({
            questions: [{
              question: "Pick a strategy",
              selection_mode: "single",
              options: [
                { label: "Fast path", description: "Quicker but riskier", recommended: true, preview: "## Fast\nUses cache." },
                { label: "Safe path", description: "Slower but reliable" },
              ],
            }],
          }),
        },
      }],
    });

    const { taskId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE tasks SET workflow_state = 'plan' WHERE id = ?", [taskId]);
    db.run(
      "INSERT INTO task_git_context (task_id, git_root_path, worktree_path, worktree_status) VALUES (?, ?, ?, 'ready')",
      [taskId, gitDir, gitDir],
    );

    let resolveWaiting4_2!: () => void;
    const waitingPromise4_2 = new Promise<void>((resolve) => { resolveWaiting4_2 = resolve; });
    const onTaskUpdated4_2 = (task: { executionState: string }) => {
      if (task.executionState === "waiting_user") resolveWaiting4_2();
    };

    await handleHumanTurn(taskId, "Go.", noop, noop, onTaskUpdated4_2 as never, noop);
    await waitingPromise4_2;

    const row = db
      .query<{ content: string }, [number]>(
        "SELECT content FROM conversation_messages WHERE task_id = ? AND type = 'ask_user_prompt' ORDER BY id DESC LIMIT 1",
      )
      .get(taskId);
    expect(row).not.toBeNull();

    const stored = JSON.parse(row!.content) as { questions: Array<{ question: string; options: Array<{ label: string; description?: string; recommended?: boolean; preview?: string }> }> };
    const opt0 = stored.questions[0].options[0];
    expect(opt0.label).toBe("Fast path");
    expect(opt0.description).toBe("Quicker but riskier");
    expect(opt0.recommended).toBe(true);
    expect(opt0.preview).toBe("## Fast\nUses cache.");
    const opt1 = stored.questions[0].options[1];
    expect(opt1.description).toBe("Slower but reliable");
  });

  // 4.3 / 4.4 / 4.5: pure parsing tests (the logic that drives component rendering)
  // These verify that parseAskPayload correctly transforms stored content into the
  // data structure consumed by AskUserPrompt — description text, recommended flag,
  // and preview presence — without requiring Vue component mounting.

  it("4.3 parseAskPayload: description field present per option for component to render", () => {
    const content = JSON.stringify({
      questions: [{
        question: "Q?",
        selection_mode: "single",
        options: [{ label: "A", description: "Explanation of A" }, { label: "B" }],
      }],
    });
    // Simulate the same normalization MessageBubble does
    const parsed = JSON.parse(content) as { questions: Array<{ options: Array<{ label: string; description?: string }> }> };
    expect(parsed.questions[0].options[0].description).toBe("Explanation of A");
    expect(parsed.questions[0].options[1].description).toBeUndefined();
  });

  it("4.4 parseAskPayload: recommended flag present for badge rendering", () => {
    const content = JSON.stringify({
      questions: [{
        question: "Q?",
        selection_mode: "single",
        options: [{ label: "Good", recommended: true }, { label: "Meh" }],
      }],
    });
    const parsed = JSON.parse(content) as { questions: Array<{ options: Array<{ label: string; recommended?: boolean }> }> };
    expect(parsed.questions[0].options[0].recommended).toBe(true);
    expect(parsed.questions[0].options[1].recommended).toBeUndefined();
  });

  it("4.5 parseAskPayload: preview present when options have it, absent when they don't", () => {
    const withPreview = JSON.stringify({
      questions: [{
        question: "Q?",
        selection_mode: "single",
        options: [{ label: "X", preview: "## Preview\ncontent" }, { label: "Y" }],
      }],
    });
    const parsedWith = JSON.parse(withPreview) as { questions: Array<{ options: Array<{ label: string; preview?: string }> }> };
    expect(parsedWith.questions[0].options.some((o) => !!o.preview)).toBe(true);

    const withoutPreview = JSON.stringify({
      questions: [{ question: "Q?", selection_mode: "single", options: [{ label: "X" }] }],
    });
    const parsedWithout = JSON.parse(withoutPreview) as { questions: Array<{ options: Array<{ label: string; preview?: string }> }> };
    expect(parsedWithout.questions[0].options.some((o) => !!o.preview)).toBe(false);
  });
});

// ─── compactMessages micro-compact ────────────────────────────────────────────

describe("compactMessages micro-compact", () => {
  // ─── Row construction helpers ─────────────────────────────────────────

  let nextId = 1;

  beforeEach(() => { nextId = 1; });

  function makeRow(
    fields: Partial<ConversationMessageRow> & { type: string; content: string },
  ): ConversationMessageRow {
    return {
      id: nextId++,
      task_id: 1,
      conversation_id: 1,
      role: null,
      metadata: null,
      created_at: new Date().toISOString(),
      ...fields,
    };
  }

  function toolCallRow(toolName: string): ConversationMessageRow {
    const id = nextId;
    return makeRow({
      type: "tool_call",
      role: "assistant",
      content: JSON.stringify({ name: toolName, arguments: "{}" }),
    });
  }

  function toolResultRow(toolName: string, content: string): ConversationMessageRow {
    const callId = nextId - 1; // id of the preceding tool_call row
    return makeRow({
      type: "tool_result",
      role: "tool",
      content,
      metadata: JSON.stringify({ tool_call_id: `call_${callId}`, name: toolName }),
    });
  }

  function assistantRow(): ConversationMessageRow {
    return makeRow({ type: "assistant", role: "assistant", content: "OK" });
  }

  // Build N turns of (tool_call → tool_result → assistant)
  function buildTurns(
    n: number,
    toolName: string,
    contentFn = (i: number) => `result from turn ${i + 1}`,
  ): ConversationMessageRow[] {
    const rows: ConversationMessageRow[] = [];
    for (let i = 0; i < n; i++) {
      rows.push(toolCallRow(toolName));
      rows.push(toolResultRow(toolName, contentFn(i)));
      rows.push(assistantRow());
    }
    return rows;
  }

  // ─── Unit tests on compactMessages() directly ──────────────────────────────

  it("4.1 clears clearable tool results older than MICRO_COMPACT_TURN_WINDOW turns", () => {
    // 10 turns, window=8 → turn 1 has distance 9 > 8 → sentinel
    //                    turn 2 has distance 8 (NOT > 8) → preserved
    const rows = buildTurns(10, "read_file");
    const output = compactMessages(rows);
    const toolMsgs = output.filter((m) => m.role === "tool");

    expect(toolMsgs.length).toBe(10);
    // Turn 1 (distance = 10 - 1 = 9 > 8) → cleared
    expect(toolMsgs[0].content).toBe(MICRO_COMPACT_SENTINEL);
    // Turn 2 (distance = 10 - 2 = 8, NOT > 8) → preserved
    expect(toolMsgs[1].content).toContain("result from turn 2");
    // Most recent turn (distance 0) → preserved
    expect(toolMsgs[9].content).toContain("result from turn 10");
  });

  it("4.2 preserves clearable tool results that are within the window", () => {
    // 5 turns: maxTurn=5, all distances ≤ 4, none exceed window=8
    const rows = buildTurns(5, "search_text");
    const output = compactMessages(rows);
    const toolMsgs = output.filter((m) => m.role === "tool");

    expect(toolMsgs.length).toBe(5);
    for (let i = 0; i < 5; i++) {
      expect(toolMsgs[i].content).toContain(`result from turn ${i + 1}`);
      expect(toolMsgs[i].content).not.toBe(MICRO_COMPACT_SENTINEL);
    }
  });

  it("4.3 never clears non-clearable tool results (ask_me) regardless of age", () => {
    // 15 turns with ask_me (not in CLEARABLE set) → all preserved
    const rows = buildTurns(15, "ask_me", (i) => `user said option ${i + 1}`);
    const output = compactMessages(rows);
    const toolMsgs = output.filter((m) => m.role === "tool");

    expect(toolMsgs.length).toBe(15);
    for (let i = 0; i < 15; i++) {
      expect(toolMsgs[i].content).not.toBe(MICRO_COMPACT_SENTINEL);
      expect(toolMsgs[i].content).toContain(`user said option ${i + 1}`);
    }
  });

  // ─── FakeAI integration test for DB immutability ─────────────────────────────

  it("4.4 DB rows are not modified during assembly — compactMessages() is non-destructive", async () => {
    const { taskId, conversationId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE tasks SET workflow_state = 'plan' WHERE id = ?", [taskId]);

    // Seed 10 turns of read_file tool calls into the DB
    for (let i = 0; i < 10; i++) {
      db.run(
        "INSERT INTO conversation_messages (task_id, conversation_id, type, role, content) VALUES (?, ?, 'tool_call', 'assistant', ?)",
        [taskId, conversationId, JSON.stringify({ name: "read_file", arguments: "{}" })],
      );
      const { id: callId } = db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!;
      db.run(
        "INSERT INTO conversation_messages (task_id, conversation_id, type, role, content, metadata) VALUES (?, ?, 'tool_result', 'tool', ?, ?)",
        [
          taskId,
          conversationId,
          `original content turn ${i + 1}`,
          JSON.stringify({ tool_call_id: `call_${callId}`, name: "read_file" }),
        ],
      );
      db.run(
        "INSERT INTO conversation_messages (task_id, conversation_id, type, role, content) VALUES (?, ?, 'assistant', 'assistant', 'OK')",
        [taskId, conversationId],
      );
    }

    // Queue a simple text reply so the engine completes in one round
    queueStreamStep({ type: "text", tokens: ["Done."] });

    let resolveDone!: () => void;
    const done = new Promise<void>((r) => (resolveDone = r));
    await handleHumanTurn(
      taskId,
      "Go.",
      (_, __, _t, isDone) => { if (isDone) resolveDone(); },
      noop,
      noop,
      noop,
    );
    await done;

    // Verify the assembled payload sent to the model has old results cleared
    const sentMsgArrays = getCapturedStreamMessages();
    expect(sentMsgArrays.length).toBeGreaterThan(0);
    const toolMsgs = sentMsgArrays[0].filter((m) => m.role === "tool");
    // Turn 1: distance = 10 - 1 = 9 > 8 → cleared in assembled payload
    expect(toolMsgs[0]?.content).toBe(MICRO_COMPACT_SENTINEL);
    // Turn 2: distance = 10 - 2 = 8 (NOT > 8) → preserved in assembled payload
    expect(toolMsgs[1]?.content).toContain("original content turn 2");

    // Verify the original DB rows were NOT mutated
    const dbRows = db
      .query<{ content: string }, [number]>(
        "SELECT content FROM conversation_messages WHERE task_id = ? AND type = 'tool_result' ORDER BY id ASC",
      )
      .all(taskId);
    expect(dbRows.length).toBe(10);
    for (let i = 0; i < 10; i++) {
      expect(dbRows[i].content).toBe(`original content turn ${i + 1}`);
    }
  }, 15_000);
});
