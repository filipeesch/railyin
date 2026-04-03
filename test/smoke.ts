/**
 * Smoke test — Task 11.3
 * Exercises: config load (fake) → DB migrations → board creation → task creation
 * → transition (triggers on_enter_prompt) → streaming → human message → retry
 *
 * Run with:  RAILYN_DB=:memory: RAILYN_CONFIG_DIR=./config ~/.bun/bin/bun run test/smoke.ts
 */

// ── Use in-memory DB ──────────────────────────────────────────────────────────
process.env.RAILYN_DB = ":memory:";
process.env.RAILYN_CONFIG_DIR = "./config";

import { loadConfig, getConfig } from "../src/bun/config/index.ts";
import { runMigrations, seedDefaultWorkspace } from "../src/bun/db/migrations.ts";
import { getDb } from "../src/bun/db/index.ts";
import { taskHandlers } from "../src/bun/handlers/tasks.ts";
import { boardHandlers } from "../src/bun/handlers/boards.ts";
import { projectHandlers } from "../src/bun/handlers/projects.ts";
import { conversationHandlers } from "../src/bun/handlers/conversations.ts";
import type { OnToken, OnError } from "../src/bun/workflow/engine.ts";

// ── State ─────────────────────────────────────────────────────────────────────

let pass = 0;
let fail = 0;
const errors: string[] = [];

function ok(label: string, cond: boolean, info?: unknown) {
  if (cond) {
    console.log(`  ✓  ${label}`);
    pass++;
  } else {
    console.error(`  ✗  ${label}${info !== undefined ? " — " + JSON.stringify(info) : ""}`);
    errors.push(label);
    fail++;
  }
}

// Captured stream state
const tokensByTask: Record<number, string> = {};
const streamErrors: Record<number, string> = {};
let taskUpdates = 0;

const onToken: OnToken = (taskId, _execId, token, done) => {
  if (!done) tokensByTask[taskId] = (tokensByTask[taskId] ?? "") + token;
};
const onError: OnError = (taskId, _execId, error) => {
  streamErrors[taskId] = error;
};

// ── Wait helper (poll until condition) ───────────────────────────────────────

async function waitUntil(
  pred: () => boolean,
  timeoutMs = 5000,
  intervalMs = 100,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1: Config
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n── Config ───────────────────────────────────────────────────────");

const { config, error: configError } = loadConfig();
ok("loadConfig() returns no error", configError === null, configError);
ok("ai.provider is 'fake'", config?.workspace.ai.provider === "fake");
ok("At least one workflow template loaded", (config?.workflows.length ?? 0) > 0);

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2: DB migrations
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n── DB & migrations ──────────────────────────────────────────────");

runMigrations();
seedDefaultWorkspace();

const db = getDb();
const tables = db
  .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
  .all()
  .map((r) => r.name);

for (const t of ["workspaces", "projects", "boards", "tasks", "conversations",
                  "conversation_messages", "executions", "task_git_context"]) {
  ok(`Table '${t}' exists`, tables.includes(t));
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3: Project + Board setup
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n── Project & Board ──────────────────────────────────────────────");

const projH = projectHandlers();
const project = await projH["projects.register"]({
  name: "Test Project",
  projectPath: "/tmp/test-project",
  gitRootPath: "/tmp/test-project",
  defaultBranch: "main",
  slug: "test",
});
ok("Project created", project.id > 0, project);

const boardH = boardHandlers();
const cfg = getConfig();
const templateId = cfg.workflows[0]!.id;

const board = await boardH["boards.create"]({
  name: "Test Board",
  projectIds: [project.id],
  workflowTemplateId: templateId,
});
ok("Board created", board.id > 0, board);

const boards = await boardH["boards.list"]();
ok("Board.list includes created board", boards.some((b) => b.id === board.id));
ok("Board has template attached", !!boards[0]?.template);
ok("Template has columns", (boards[0]?.template.columns.length ?? 0) > 0);

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4: Task creation
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n── Task create ──────────────────────────────────────────────────");

const taskH = taskHandlers(onToken, onError);
const task = await taskH["tasks.create"]({
  boardId: board.id,
  projectId: project.id,
  title: "Implement login button",
  description: "Add a login button to the header component.",
});
ok("Task created", task.id > 0, task);
ok("Task starts in backlog", task.workflowState === "backlog");
ok("Task starts idle", task.executionState === "idle");

const convH = conversationHandlers();
const messages0 = await convH["conversations.getMessages"]({ taskId: task.id });
ok("Initial system message seeded", messages0.some((m) => m.type === "system"));

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5: Transition → triggers on_enter_prompt + streaming
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n── Transition + streaming ───────────────────────────────────────");

// Find the first non-backlog column that has on_enter_prompt
const template = cfg.workflows.find((w) => w.id === templateId)!;
const planColumn = template.columns.find((c) => !c.is_backlog && c.on_enter_prompt);
const transitionToState = planColumn?.id ?? "plan";

const { task: t2, executionId } = await taskH["tasks.transition"]({
  taskId: task.id,
  toState: transitionToState,
});
ok(`Transition to '${transitionToState}' returns updated task`, t2.workflowState === transitionToState);

const hasPrompt = !!planColumn?.on_enter_prompt;
if (hasPrompt) {
  ok("Task moves to 'running' immediately", t2.executionState === "running");
  ok("executionId returned", executionId !== null);

  // Wait for the fake AI to stream tokens
  const streamed = await waitUntil(() => !!tokensByTask[task.id], 8000);
  ok("Tokens received from fake AI", streamed, tokensByTask[task.id]);

  // Wait for execution to complete
  const completed = await waitUntil(() => {
    const row = db
      .query<{ execution_state: string }, [number]>("SELECT execution_state FROM tasks WHERE id = ?")
      .get(task.id);
    return row?.execution_state === "completed" || row?.execution_state === "failed";
  }, 8000);
  ok("Execution completed", completed);

  const finalState = db
    .query<{ execution_state: string }, [number]>("SELECT execution_state FROM tasks WHERE id = ?")
    .get(task.id)?.execution_state;
  ok("Final execution_state is 'completed'", finalState === "completed", finalState);

  // Check assistant message saved
  const msgs = await convH["conversations.getMessages"]({ taskId: task.id });
  const hasAssistant = msgs.some((m) => m.type === "assistant");
  ok("Assistant message persisted in conversation", hasAssistant);
} else {
  ok("Column has no prompt — execution stays idle", t2.executionState === "idle");
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 6: Human message → new streaming
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n── Human message ────────────────────────────────────────────────");

// Reset token accumulator
delete tokensByTask[task.id];

const { message: userMsg, executionId: humanExecId } = await taskH["tasks.sendMessage"]({
  taskId: task.id,
  content: "Please make the button blue.",
});
ok("sendMessage returns user message", userMsg.type === "user");
ok("sendMessage returns executionId", typeof humanExecId === "number");

const humanTokens = await waitUntil(() => !!tokensByTask[task.id], 8000);
ok("Tokens streamed for human message", humanTokens, tokensByTask[task.id]);

const afterHuman = await waitUntil(() => {
  const row = db
    .query<{ execution_state: string }, [number]>("SELECT execution_state FROM tasks WHERE id = ?")
    .get(task.id);
return row?.execution_state === "completed" || row?.execution_state === "failed";
}, 8000);
ok("Execution completed after human message", afterHuman);

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 7: Retry
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n── Retry ────────────────────────────────────────────────────────");

delete tokensByTask[task.id];

const { task: retried } = await taskH["tasks.retry"]({ taskId: task.id });
ok("Retry returns updated task", retried.id === task.id);

const retryTokens = await waitUntil(() => !!tokensByTask[task.id], 8000);
ok("Tokens streamed for retry", retryTokens, tokensByTask[task.id]);

const afterRetry = await waitUntil(() => {
  const row = db
    .query<{ retry_count: number; execution_state: string }, [number]>(
      "SELECT retry_count, execution_state FROM tasks WHERE id = ?",
    )
    .get(task.id);
return row?.execution_state === "completed" || row?.execution_state === "failed";
}, 8000);
ok("Retry execution completed", afterRetry);

const retryRow = db
  .query<{ retry_count: number }, [number]>("SELECT retry_count FROM tasks WHERE id = ?")
  .get(task.id);
ok("retry_count incremented", (retryRow?.retry_count ?? 0) >= 1, retryRow?.retry_count);

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 8: Conversation history
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n── Conversation history ─────────────────────────────────────────");

const finalMsgs = await convH["conversations.getMessages"]({ taskId: task.id });
ok("Multiple messages in history", finalMsgs.length > 3, finalMsgs.length);
ok("Has user messages", finalMsgs.some((m) => m.role === "user"));
ok("Has assistant messages", finalMsgs.some((m) => m.role === "assistant" || m.type === "assistant"));

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(60)}`);
console.log(`Results: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.error("Failed checks:");
  errors.forEach((e) => console.error(`  ✗ ${e}`));
  process.exit(1);
} else {
  console.log("All smoke tests passed ✓");
}
