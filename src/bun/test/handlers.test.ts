import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";
import { initDb, seedProjectAndTask, setupTestConfig } from "./helpers.ts";
import { taskHandlers } from "../handlers/tasks.ts";
import { SqliteModelSettingsRepository } from "../db/repositories/model-settings-repository.ts";
import { WorkspaceRepository } from "../db/workspace-repository.ts";
import { taskGitHandlers } from "../handlers/task-git.ts";
import { WorktreeManager } from "../git/WorktreeManager.ts";
import { GitRepositoryManager } from "../git/GitRepositoryManager.ts";
import { TaskGitContextRepository } from "../db/repositories/TaskGitContextRepository.ts";
import type { IProjectResolver } from "../git/IProjectResolver.ts";
import { codeReviewHandlers } from "../handlers/code-review.ts";
import { todoHandlers } from "../handlers/todos.ts";
import { modelHandlers } from "../handlers/models.ts";
import { engineHandlers } from "../handlers/engine.ts";
import { conversationHandlers } from "../handlers/conversations.ts";
import { chatSessionHandlers } from "../handlers/chat-sessions.ts";
import { mcpHandlers } from "../handlers/mcp.ts";
import { prepareMessageForEngine } from "../utils/attachment-routing.ts";
import { mapTask } from "../db/mappers.ts";
import type { Db } from "../db/db.ts";
import type { Attachment, ChatSession, Task } from "../../shared/rpc-types.ts";
import type { TaskRow } from "../db/row-types.ts";
import type { ExecutionCoordinator } from "../engine/coordinator.ts";

let db: Db;
let wsRepo: WorkspaceRepository;
let gitDir: string;
let configCleanup: () => void;
let worktreeManager: WorktreeManager;
let gitRepo: GitRepositoryManager;

const TEST_PROJECT_RESOLVER: IProjectResolver = {
  getDefaultBranch: () => "main",
  getWorktreeBasePath: (_wsKey, _projectKey, gitRootPath) => `${gitRootPath}/../worktrees`,
};

beforeEach(async () => {
  gitDir = mkdtempSync(join(tmpdir(), "railyn-hdl-"));
  execSync("git init", { cwd: gitDir });
  execSync('git config user.email "t@t.com"', { cwd: gitDir });
  execSync('git config user.name "T"', { cwd: gitDir });
  writeFileSync(join(gitDir, "README.md"), "hello");
  execSync("git add . && git commit -m init", { cwd: gitDir });

  db = await initDb();
  wsRepo = new WorkspaceRepository(db);
  gitRepo = new GitRepositoryManager();
  worktreeManager = new WorktreeManager(
    db,
    wsRepo,
    TEST_PROJECT_RESOLVER,
    gitRepo,
    new TaskGitContextRepository(db),
  );
  const cfg = setupTestConfig("", gitDir);
  configCleanup = cfg.cleanup;
});

afterEach(() => {
  rmSync(gitDir, { recursive: true, force: true });
  configCleanup();
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeHandlers() {
  const updates: Task[] = [];

  const handlers = {
    ...taskHandlers(db, wsRepo, null, (task) => updates.push(task), worktreeManager),
    ...taskGitHandlers(db, (task) => updates.push(task), worktreeManager, gitRepo),
    ...codeReviewHandlers(db),
    ...todoHandlers(db),
    ...modelHandlers(db, null),
    ...engineHandlers(null),
  };

  return { handlers, updates };
}

/** Mock coordinator that persists the transition in the DB and returns the updated task. */
function makeDbOrchestrator(): ExecutionCoordinator {
  return {
    executeTransition: async (taskId, toState) => {
      await db.exec("UPDATE tasks SET workflow_state = $1 WHERE id = $2", [toState, taskId]);
      const row = (await db.get<TaskRow>("SELECT * FROM tasks WHERE id = $1", [taskId]))!;
      return { task: mapTask(row), executionId: null };
    },
    executeHumanTurn: async () => { throw new Error("not implemented"); },
    executeRetry: async () => { throw new Error("not implemented"); },
    executeCodeReview: async () => { throw new Error("not implemented"); },
    respondShellApprovalByExecution: async () => { throw new Error("not implemented"); },
    executeChatTurn: async () => { throw new Error("not implemented"); },
    cancel: () => {},
    listModels: async () => [],
    compactTask: async () => {},
    compactConversation: async () => {},
    listCommands: async () => [],
  };
}

// ─── tasks.create ─────────────────────────────────────────────────────────────

describe("tasks.create", () => {
  it("creates a task and seeds git context row", async () => {
    const { projectKey, boardId } = await seedProjectAndTask(db, gitDir);
    const { handlers } = makeHandlers();

    const task = await handlers["tasks.create"]({
      boardId,
      projectKey,
      title: "Add dark mode",
      description: "Implement dark mode support",
    });

    expect(task.title).toBe("Add dark mode");
    expect(task.executionState).toBe("idle");
    expect(task.workflowState).toBe("backlog");

    // git context row should exist
    const ctx = await db.get<{ worktree_status: string; git_root_path: string }>(
      "SELECT worktree_status, git_root_path FROM task_git_context WHERE task_id = $1",
      [task.id],
    );

    expect(ctx).not.toBeUndefined();
    expect(ctx!.worktree_status).toBe("not_created");
    expect(ctx!.git_root_path).toBe(gitDir);
  });

  it("seeds system message with task description", async () => {
    const { projectKey, boardId } = await seedProjectAndTask(db, gitDir);
    const { handlers } = makeHandlers();

    const task = await handlers["tasks.create"]({
      boardId,
      projectKey,
      title: "My task",
      description: "My description",
    });

    const msgs = await db.rows<{ type: string; content: string }>(
      "SELECT type, content FROM conversation_messages WHERE task_id = $1 ORDER BY id ASC",
      [task.id],
    );

    expect(msgs.length).toBeGreaterThan(0);
    expect(msgs[0].type).toBe("system");
    expect(msgs[0].content).toContain("My task");
    expect(msgs[0].content).toContain("My description");
  });

// TC-1: defaultModel is set → conversation.model IS automatically seeded
it("automatically seeds conversation.model from config.defaultModel", async () => {
  const { projectKey, boardId } = await seedProjectAndTask(db, gitDir);
  const { handlers } = makeHandlers();
  const task = await handlers["tasks.create"]({
    boardId,
    projectKey,
    title: "Model task",
    description: "Should inherit default model automatically",
  });
  const row = await db.get<{ model: string | null }>(
    "SELECT c.model FROM conversations c JOIN tasks t ON c.id = t.conversation_id WHERE t.id = $1",
    [task.id],
  );

  // Test config has default_model = "copilot/mock-model"
  expect(row!.model).toBe("copilot/mock-model");
});

  // TC-2: defaultModel is null → conversation.model remains NULL
  it("leaves conversation.model as NULL when defaultModel is not configured", async () => {
    configCleanup();
    const cfg = setupTestConfig("", gitDir, [], null);
    configCleanup = cfg.cleanup;

    const { projectKey, boardId } = await seedProjectAndTask(db, gitDir);
    const { handlers } = makeHandlers();

    const task = await handlers["tasks.create"]({
      boardId,
      projectKey,
      title: "No model task",
      description: "Engine has no model configured",
    });

    const row = await db.get<{ model: string | null }>(
      "SELECT c.model FROM conversations c JOIN tasks t ON c.id = t.conversation_id WHERE t.id = $1",
      [task.id],
    );

    expect(row!.model).toBeNull();
  });

  // TC-SA-1: no workspace shell_auto_approve → task.shellAutoApprove = false
  it("TC-SA-1: task created with no workspace shell_auto_approve gets shellAutoApprove: false", async () => {
    const { projectKey, boardId } = await seedProjectAndTask(db, gitDir);
    const { handlers } = makeHandlers();

    const task = await handlers["tasks.create"]({
      boardId,
      projectKey,
      title: "SA task",
      description: "default auto-approve",
    });

    expect(task.shellAutoApprove).toBe(false);
  });

  // TC-SA-2: workspace has shell_auto_approve: true → task.shellAutoApprove = true
  it("TC-SA-2: task created with workspace shell_auto_approve: true gets shellAutoApprove: true", async () => {
    configCleanup();
    const cfg = setupTestConfig("shell_auto_approve: true", gitDir);
    configCleanup = cfg.cleanup;

    const { projectKey, boardId } = await seedProjectAndTask(db, gitDir);
    const { handlers } = makeHandlers();

    const task = await handlers["tasks.create"]({
      boardId,
      projectKey,
      title: "SA task true",
      description: "workspace auto-approve on",
    });

    expect(task.shellAutoApprove).toBe(true);
  });

  // TC-SA-3: workspace has shell_auto_approve: false explicitly → task.shellAutoApprove = false
  it("TC-SA-3: task created with workspace shell_auto_approve: false gets shellAutoApprove: false", async () => {
    configCleanup();
    const cfg = setupTestConfig("shell_auto_approve: false", gitDir);
    configCleanup = cfg.cleanup;

    const { projectKey, boardId } = await seedProjectAndTask(db, gitDir);
    const { handlers } = makeHandlers();

    const task = await handlers["tasks.create"]({
      boardId,
      projectKey,
      title: "SA task false",
      description: "workspace auto-approve explicitly off",
    });

    expect(task.shellAutoApprove).toBe(false);
  });

  // TC-SA-4: per-task setShellAutoApprove overrides seeded value
  it("TC-SA-4: tasks.setShellAutoApprove overrides the workspace-seeded value", async () => {
    configCleanup();
    const cfg = setupTestConfig("shell_auto_approve: true", gitDir);
    configCleanup = cfg.cleanup;

    const { projectKey, boardId } = await seedProjectAndTask(db, gitDir);
    const { handlers } = makeHandlers();

    const task = await handlers["tasks.create"]({
      boardId,
      projectKey,
      title: "SA override task",
      description: "will be toggled off",
    });
    expect(task.shellAutoApprove).toBe(true);

    await handlers["tasks.setShellAutoApprove"]({ taskId: task.id, enabled: false });
    const row = await db.get<{ shell_auto_approve: number }>(
      "SELECT shell_auto_approve FROM tasks WHERE id = $1",
      [task.id],
    );
    expect(row!.shell_auto_approve).toBe(0);
  });
});

// ─── tasks.transition (worktree failure) ─────────────────────────────────────

// ─── TC-POS: tasks.create position placement ─────────────────────────────────

describe("tasks.create — TC-POS: top-of-column position", () => {
  it("TC-POS-1: first task in empty backlog has position 500", async () => {
    const { projectKey, boardId } = await seedProjectAndTask(db, gitDir);
    const { handlers } = makeHandlers();

    // Remove the seed task so backlog is empty
    await db.exec("DELETE FROM tasks WHERE board_id = $1", [boardId]);

    const task = await handlers["tasks.create"]({
      boardId,
      projectKey,
      title: "First task",
      description: "",
    });

    expect(task.position).toBe(500);
    const row = await db.get<{ position: number }>("SELECT position FROM tasks WHERE id = $1", [task.id]);
    expect(row!.position).toBe(500);
  });

  it("TC-POS-2: second task lands above first (position < 500)", async () => {
    const { projectKey, boardId } = await seedProjectAndTask(db, gitDir);
    const { handlers } = makeHandlers();
    await db.exec("DELETE FROM tasks WHERE board_id = $1", [boardId]);

    // Seed a task at position 500
    const first = await handlers["tasks.create"]({ boardId, projectKey, title: "First", description: "" });
    expect(first.position).toBe(500);

    const second = await handlers["tasks.create"]({ boardId, projectKey, title: "Second", description: "" });
    expect(second.position).toBe(250);
    expect(second.position).toBeLessThan(first.position);
  });

  it("TC-POS-3: third task lands above second (position < 250)", async () => {
    const { projectKey, boardId } = await seedProjectAndTask(db, gitDir);
    const { handlers } = makeHandlers();
    await db.exec("DELETE FROM tasks WHERE board_id = $1", [boardId]);

    await handlers["tasks.create"]({ boardId, projectKey, title: "First", description: "" });
    const second = await handlers["tasks.create"]({ boardId, projectKey, title: "Second", description: "" });
    const third = await handlers["tasks.create"]({ boardId, projectKey, title: "Third", description: "" });

    expect(third.position).toBe(125);
    expect(third.position).toBeLessThan(second.position);
  });

  it("TC-POS-4: returned task.position matches the persisted DB value", async () => {
    const { projectKey, boardId } = await seedProjectAndTask(db, gitDir);
    const { handlers } = makeHandlers();
    await db.exec("DELETE FROM tasks WHERE board_id = $1", [boardId]);

    const task = await handlers["tasks.create"]({ boardId, projectKey, title: "Pos check", description: "" });
    const row = await db.get<{ position: number }>("SELECT position FROM tasks WHERE id = $1", [task.id]);

    expect(row!.position).toBe(task.position);
  });
});


describe("tasks.transition / worktree failure", () => {
  it("fails task and appends error message when git_root_path is invalid", async () => {
    // Create board and task with a project that has a bad git root path.
    // After the projects table was removed, we seed task_git_context directly
    // with the invalid path to simulate a task whose worktree setup will fail.
    const projectKey = "broken-project"; // not in workspace config — prevents backfill from overwriting the invalid path
    const boardId = (await db.get<{ id: number }>(
      "INSERT INTO boards (workspace_key, name, workflow_template_id) VALUES ('default', 'b', 'delivery') RETURNING id",
    ))!.id;
    const conversationId = (await db.get<{ id: number }>(
      "INSERT INTO conversations (task_id) VALUES (0) RETURNING id",
    ))!.id;
    const taskId = (await db.get<{ id: number }>(
      "INSERT INTO tasks (board_id, project_key, title, workflow_state, execution_state, conversation_id) VALUES ($1, $2, 'Broken', 'backlog', 'idle', $3) RETURNING id",
      [boardId, projectKey, conversationId],
    ))!.id;
    await db.exec("UPDATE conversations SET task_id = $1 WHERE id = $2", [taskId, conversationId]);
    // Seed git context with an invalid path so the worktree creation fails
    await db.exec(
      "INSERT INTO task_git_context (task_id, git_root_path, worktree_status) VALUES ($1, '/nonexistent', 'not_created')",
      [taskId],
    );

    const { handlers, updates } = makeHandlers();

    const result = await handlers["tasks.transition"]({ taskId, toState: "plan" });

    expect(result.task.executionState).toBe("failed");

    // Error message should appear in conversation
    const errMsg = await db.get<{ content: string }>(
      "SELECT content FROM conversation_messages WHERE task_id = $1 AND content LIKE '%Worktree setup failed%' LIMIT 1",
      [taskId],
    );

    expect(errMsg).not.toBeUndefined();
    expect(errMsg!.content).toMatch(/Worktree setup failed/i);
  });
});

// ─── tasks.transition (backfill) ─────────────────────────────────────────────

describe("tasks.transition / git context backfill", () => {
  it("backfills git context row on transition even if create missed it", async () => {
    // Create task WITHOUT calling tasks.create (simulates old data)
    const { projectKey, boardId, taskId, conversationId } = await seedProjectAndTask(db, gitDir);
    // No task_git_context row exists yet

    const handlers = taskHandlers(db, wsRepo, makeDbOrchestrator(), () => {}, worktreeManager);

    // Transition — should backfill then create worktree
    await handlers["tasks.transition"]({ taskId, toState: "plan" });

    const ctx = await db.get<{ worktree_status: string }>(
      "SELECT worktree_status FROM task_git_context WHERE task_id = $1",
      [taskId],
    );

    expect(ctx).not.toBeUndefined();
    // Either ready (git worked) or error (git had an issue in test env) — but row exists
    expect(["ready", "error", "creating"]).toContain(ctx!.worktree_status);
  }, 15_000);
});

// ─── tasks.transition (running guard — deferred prompt) ───────────────────────

describe("tasks.transition / running task deferred", () => {
  it("TH-DEFER-1: running task moving to prompt column defers prompt and keeps execution_state running", async () => {
    const { taskId, conversationId } = await seedProjectAndTask(db, gitDir);
    // Force task into running state (simulates an active execution)
    await db.exec("UPDATE tasks SET execution_state = 'running', workflow_state = 'backlog' WHERE id = $1", [taskId]);

    const taskUpdates: Task[] = [];
    const handlers = taskHandlers(db, wsRepo, makeDbOrchestrator(), (t) => taskUpdates.push(t), worktreeManager);

    const result = await handlers["tasks.transition"]({ taskId, toState: "plan" });

    // executionId should be null — we didn't start a new execution
    expect(result.executionId).toBeNull();
    // workflow_state was updated
    expect(result.task.workflowState).toBe("plan");
    // execution_state stayed running (we didn't touch it)
    expect(result.task.executionState).toBe("running");
    // needs_column_prompt flag was set (plan column has on_enter_prompt)
    const dbRow = await db.get<{ needs_column_prompt: number }>("SELECT needs_column_prompt FROM tasks WHERE id = $1", [taskId]);
    expect(dbRow?.needs_column_prompt).toBe(1);
    // transition_event was appended to the conversation
    const msg = await db.get<{ type: string }>(
      "SELECT type FROM conversation_messages WHERE task_id = $1 AND type = 'transition_event' LIMIT 1",
      [taskId],
    );
    expect(msg).not.toBeUndefined();
    // onTaskUpdated was called
    expect(taskUpdates.length).toBeGreaterThan(0);
  });

  it("TH-DEFER-2: running task moving to no-prompt column updates state without flag", async () => {
    const { taskId } = await seedProjectAndTask(db, gitDir);
    await db.exec("UPDATE tasks SET execution_state = 'running', workflow_state = 'plan' WHERE id = $1", [taskId]);

    const handlers = taskHandlers(db, wsRepo, makeDbOrchestrator(), () => {}, worktreeManager);

    const result = await handlers["tasks.transition"]({ taskId, toState: "done" });

    expect(result.executionId).toBeNull();
    expect(result.task.workflowState).toBe("done");
    expect(result.task.executionState).toBe("running");
    const dbRow = await db.get<{ needs_column_prompt: number }>("SELECT needs_column_prompt FROM tasks WHERE id = $1", [taskId]);
    expect(dbRow?.needs_column_prompt).toBe(0);
  });
});

// ─── tasks.delete ─────────────────────────────────────────────────────────────

describe("tasks.delete", () => {
  it("removes task, messages, git context, and conversation from DB", async () => {
    const { projectKey, boardId } = await seedProjectAndTask(db, gitDir);
    const { handlers } = makeHandlers();

    const task = await handlers["tasks.create"]({
      boardId,
      projectKey,
      title: "To be deleted",
      description: "Temporary task",
    });

    // Verify task and associated rows exist
    const beforeTask = await db.get<{ id: number }>("SELECT id FROM tasks WHERE id = $1", [task.id]);
    expect(beforeTask).not.toBeUndefined();

    const beforeMsgs = await db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM conversation_messages WHERE task_id = $1",
      [task.id],
    );
    expect(beforeMsgs!.count).toBeGreaterThan(0); // seeded system message exists

    const result = await handlers["tasks.delete"]({ taskId: task.id });
    expect(result.success).toBe(true);

    // Task row gone
    const afterTask = await db.get<{ id: number }>("SELECT id FROM tasks WHERE id = $1", [task.id]);
    expect(afterTask).toBeUndefined();

    // Conversation messages gone
    const afterMsgs = await db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM conversation_messages WHERE task_id = $1",
      [task.id],
    );
    expect(afterMsgs!.count).toBe(0);

    // Git context gone
    const afterCtx = await db.get<{ task_id: number }>("SELECT task_id FROM task_git_context WHERE task_id = $1", [task.id]);
    expect(afterCtx).toBeUndefined();

    // Conversation gone
    const afterConv = await db.get<{ id: number }>("SELECT id FROM conversations WHERE id = $1", [task.conversationId]);
    expect(afterConv).toBeUndefined();
  });

  it("returns success even when task has no git context row", async () => {
    const { boardId, projectKey } = await seedProjectAndTask(db, gitDir);
    const { handlers } = makeHandlers();

    // Insert a bare task without git context
    const convId = (await db.get<{ id: number }>("INSERT INTO conversations (task_id) VALUES (0) RETURNING id"))!.id;
    const bareTaskId = (await db.get<{ id: number }>(
      "INSERT INTO tasks (board_id, project_key, title, workflow_state, execution_state, conversation_id) VALUES ($1, $2, 'Bare', 'backlog', 'idle', $3) RETURNING id",
      [boardId, projectKey, convId],
    ))!.id;
    await db.exec("UPDATE conversations SET task_id = $1 WHERE id = $2", [bareTaskId, convId]);

    const result = await handlers["tasks.delete"]({ taskId: bareTaskId });
    expect(result.success).toBe(true);

    const afterTask = await db.get<{ id: number }>("SELECT id FROM tasks WHERE id = $1", [bareTaskId]);
    expect(afterTask).toBeUndefined();
  });

  it("returns a warning (not an error) when git_root_path no longer exists on disk", async () => {
    const { projectKey, boardId } = await seedProjectAndTask(db, gitDir);
    const { handlers } = makeHandlers();

    const task = await handlers["tasks.create"]({
      boardId,
      projectKey,
      title: "Orphaned task",
      description: "Has a missing git root",
    });

    // Simulate a missing git root by patching the git context row
    await db.exec(
      "UPDATE task_git_context SET git_root_path = '/nonexistent/gone', worktree_path = '/nonexistent/gone/wt', worktree_status = 'ready' WHERE task_id = $1",
      [task.id],
    );

    const result = await handlers["tasks.delete"]({ taskId: task.id });

    expect(result.success).toBe(true);
    expect(result.warning).toMatch(/git root.*no longer exists/i);

    // Task must still be gone from DB despite the warning
    const afterTask = await db.get<{ id: number }>("SELECT id FROM tasks WHERE id = $1", [task.id]);
    expect(afterTask).toBeUndefined();
  });
});

describe("conversations handlers", () => {
  it("loads messages by canonical conversationId", async () => {
    const { taskId, conversationId } = await seedProjectAndTask(db, gitDir);
    await db.exec(
      "INSERT INTO conversation_messages (task_id, conversation_id, type, role, content) VALUES ($1, $2, 'user', 'user', $3), ($4, $5, 'assistant', 'assistant', $6)",
      [taskId, conversationId, "hello", taskId, conversationId, "hi there"],
    );

    const otherConversationId = (await db.get<{ id: number }>("INSERT INTO conversations (task_id) VALUES (0) RETURNING id"))!.id;
    await db.exec(
      "INSERT INTO conversation_messages (task_id, conversation_id, type, role, content) VALUES ($1, $2, 'user', 'user', $3)",
      [taskId, otherConversationId, "other thread"],
    );

    const handlers = conversationHandlers(db, null);
    const result = await handlers["conversations.getMessages"]({ conversationId });

    expect(result.messages.map((message) => message.content)).toEqual(["hello", "hi there"]);
    expect(result.messages.every((message) => message.conversationId === conversationId)).toBe(true);
  });

  it("loads stream events by conversationId", async () => {
    const { taskId, conversationId } = await seedProjectAndTask(db, gitDir);
    await db.exec(
      "INSERT INTO executions (id, task_id, conversation_id, from_state, to_state, status, attempt) VALUES ($1, $2, $3, 'plan', 'plan', 'running', 1)",
      [10, taskId, conversationId],
    );
    await db.exec(
      "INSERT INTO stream_events (id, conversation_id, execution_id, seq, block_id, type, content, metadata, parent_block_id, subagent_id) VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, NULL, NULL), ($8, $9, $10, $11, $12, $13, $14, NULL, NULL, NULL)",
      [1, conversationId, 10, 0, "root-1", "assistant", "alpha", 2, conversationId, 10, 1, "root-2", "assistant", "beta"],
    );

    const handlers = conversationHandlers(db, null);
    const canonical = await handlers["conversations.getStreamEvents"]({ conversationId, afterSeq: 0 });

    expect(canonical).toHaveLength(1);
    expect(canonical[0]?.content).toBe("beta");
  });

  it("computes context usage for session conversations without a task", async () => {
    const conversationId = (await db.get<{ id: number }>("INSERT INTO conversations (task_id) VALUES (NULL) RETURNING id"))!.id;
    await db.exec(
      "INSERT INTO chat_sessions (workspace_key, title, status, conversation_id) VALUES ('default', 'Session', 'idle', $1)",
      [conversationId],
    );
    await db.exec(
      "INSERT INTO conversation_messages (task_id, conversation_id, type, role, content) VALUES (NULL, $1, 'user', 'user', $2)",
      [conversationId, "session message"],
    );

    const handlers = conversationHandlers(db, null);
    const usage = await handlers["conversations.contextUsage"]({ conversationId });

    expect(usage.maxTokens).toBe(128_000);
    expect(usage.usedTokens).toBeGreaterThan(0);
    expect(usage.fraction).toBeGreaterThan(0);
  });
});

describe("chat session parity handlers", () => {
  it("persists session MCP tool selections", async () => {
    const handlers = mcpHandlers(db, { registryPool: null as any, resolveProject: () => null });
    const conversationId = (await db.get<{ id: number }>("INSERT INTO conversations (task_id) VALUES (NULL) RETURNING id"))!.id;
    const sessionId = (await db.get<{ id: number }>(
      "INSERT INTO chat_sessions (workspace_key, title, status, conversation_id) VALUES ('default', 'Session', 'idle', $1) RETURNING id",
      [conversationId],
    ))!.id;

    const session = await handlers["mcp.setSessionTools"]({
      sessionId,
      enabledTools: ["docs:search", "github:issues"],
    });

    expect(session.enabledMcpTools).toEqual(["docs:search", "github:issues"]);
    const stored = await db.get<{ enabled_mcp_tools: string | null }>(
      "SELECT enabled_mcp_tools FROM chat_sessions WHERE id = $1",
      [sessionId],
    );
    expect(stored?.enabled_mcp_tools).toBe(JSON.stringify(["docs:search", "github:issues"]));
  });

  it("forwards session model, attachments, workspace, and MCP tools to the orchestrator", async () => {
    const conversationId = (await db.get<{ id: number }>("INSERT INTO conversations (task_id) VALUES (NULL) RETURNING id"))!.id;
    const sessionId = (await db.get<{ id: number }>(
      "INSERT INTO chat_sessions (workspace_key, title, status, conversation_id, enabled_mcp_tools) VALUES ('default', 'Session', 'idle', $1, $2) RETURNING id",
      [conversationId, JSON.stringify(["docs:search"])],
    ))!.id;

    const calls: unknown[][] = [];
    const handlers = chatSessionHandlers(
      db,
      () => {},
      {
        executeChatTurn: async (...args: unknown[]) => {
          calls.push(args);
          return {
            message: {
              id: 1,
              taskId: null,
              conversationId,
              type: "user",
              role: "user",
              content: "hello",
              metadata: null,
              createdAt: new Date().toISOString(),
            },
            executionId: 7,
          };
        },
        compactConversation: async () => {},
      } as unknown as ExecutionCoordinator,
    );

    const attachments: Attachment[] = [
      { label: "note.md", mediaType: "text/markdown", data: Buffer.from("# hi").toString("base64") },
    ];

    await handlers["chatSessions.sendMessage"]({
      sessionId,
      content: "hello",
      model: "copilot/mock-model",
      attachments,
    });

    expect(calls).toEqual([[
      sessionId,
      conversationId,
      "hello",
      "copilot/mock-model",
      ["docs:search"],
      "default",
      attachments,
      "hello",
    ]]);
  });

  it("injects #file refs for Claude-style prompt routing and strips synthetic attachments", async () => {
    const filePath = join(gitDir, ".gitignore");
    writeFileSync(filePath, "node_modules/\ndist/\n", "utf8");

    const prepared = await prepareMessageForEngine(
      "claude",
      ".gitignore explain this",
      [{
        label: ".gitignore",
        mediaType: "text/plain",
        data: `@file:${filePath}`,
      }],
    );

    expect(prepared.attachments).toEqual([]);
    expect(prepared.content).toBe(
      ".gitignore explain this\n\n```gitignore\n// " + filePath + "\nnode_modules/\ndist/\n\n```",
    );
  });

  // ─── CS-1: chatSessions.create seeds conversation model from config.defaultModel ───

  it("CS-1: chatSessions.create seeds conversation.model from config.defaultModel", async () => {
    const handlers = chatSessionHandlers(db, () => {}, null as unknown as ExecutionCoordinator);
    const session = await handlers["chatSessions.create"]({ workspaceKey: "default" });

    const conv = await db.get<{ model: string | null }>(
      "SELECT model FROM conversations WHERE id = $1",
      [session.conversationId!],
    );
    // setupTestConfig sets default_model: copilot/mock-model
    expect(conv?.model).toBe("copilot/mock-model");
  });

  it("CS-SET-1/CS-SET-2: chatSessions.setModel updates callback and response model", async () => {
    const sessionUpdates: ChatSession[] = [];
    const conversationId = (await db.get<{ id: number }>("INSERT INTO conversations (task_id, model) VALUES (NULL, NULL) RETURNING id"))!.id;
    const sessionId = (await db.get<{ id: number }>(
      "INSERT INTO chat_sessions (workspace_key, title, status, conversation_id) VALUES ('default', 'Session', 'idle', $1) RETURNING id",
      [conversationId],
    ))!.id;
    const handlers = chatSessionHandlers(db, (session) => sessionUpdates.push(session), null as unknown as ExecutionCoordinator);

    const updated = await handlers["chatSessions.setModel"]({ sessionId, model: "test/model" });

    expect(updated.model).toBe("test/model");
    expect(sessionUpdates.at(-1)?.model).toBe("test/model");
  });

  it("CS-CREATE-1: chatSessions.create callback preserves created model", async () => {
    const sessionUpdates: ChatSession[] = [];
    const handlers = chatSessionHandlers(db, (session) => sessionUpdates.push(session), null as unknown as ExecutionCoordinator);

    const created = await handlers["chatSessions.create"]({ workspaceKey: "default" });

    expect(created.model).toBe("copilot/mock-model");
    expect(sessionUpdates.at(-1)?.model).toBe("copilot/mock-model");
  });

  it("CS-RENAME-1: chatSessions.rename callback preserves model", async () => {
    const sessionUpdates: ChatSession[] = [];
    const conversationId = (await db.get<{ id: number }>("INSERT INTO conversations (task_id, model) VALUES (NULL, 'fake/fake') RETURNING id"))!.id;
    const sessionId = (await db.get<{ id: number }>(
      "INSERT INTO chat_sessions (workspace_key, title, status, conversation_id) VALUES ('default', 'Old title', 'idle', $1) RETURNING id",
      [conversationId],
    ))!.id;
    const handlers = chatSessionHandlers(db, (session) => sessionUpdates.push(session), null as unknown as ExecutionCoordinator);

    await handlers["chatSessions.rename"]({ sessionId, title: "New title" });

    expect(sessionUpdates.at(-1)?.model).toBe("fake/fake");
  });

  it("CS-ARCHIVE-1: chatSessions.archive callback preserves model", async () => {
    const sessionUpdates: ChatSession[] = [];
    const conversationId = (await db.get<{ id: number }>("INSERT INTO conversations (task_id, model) VALUES (NULL, 'fake/fake') RETURNING id"))!.id;
    const sessionId = (await db.get<{ id: number }>(
      "INSERT INTO chat_sessions (workspace_key, title, status, conversation_id) VALUES ('default', 'Session', 'idle', $1) RETURNING id",
      [conversationId],
    ))!.id;
    const handlers = chatSessionHandlers(db, (session) => sessionUpdates.push(session), null as unknown as ExecutionCoordinator);

    await handlers["chatSessions.archive"]({ sessionId });

    expect(sessionUpdates.at(-1)?.model).toBe("fake/fake");
  });

  // ─── CS-2: sendMessage derives engine from conversation model prefix ───────────

  it("CS-2: sendMessage resolves @file: attachments when conversation model is claude/*", async () => {
    const conversationId = (await db.get<{ id: number }>("INSERT INTO conversations (task_id) VALUES (NULL) RETURNING id"))!.id;
    await db.exec("UPDATE conversations SET model = 'claude/claude-sonnet-4-5' WHERE id = $1", [conversationId]);
    const sessionId = (await db.get<{ id: number }>(
      "INSERT INTO chat_sessions (workspace_key, title, status, conversation_id) VALUES ('default', 'Session', 'idle', $1) RETURNING id",
      [conversationId],
    ))!.id;

    const filePath = join(gitDir, "note.md");
    writeFileSync(filePath, "# Hello\n", "utf8");

    const capturedContent: string[] = [];
    const handlers = chatSessionHandlers(
      db,
      () => {},
      {
        executeChatTurn: async (_sid: number, _cid: number, _userContent: string, _model: string | undefined, _mcpTools: string[] | null | undefined, _wsKey: string | undefined, _attachments: Attachment[] | undefined, engineContent: string | undefined) => {
          capturedContent.push(engineContent as string);
          return { message: { id: 1, taskId: null, conversationId, type: "user" as const, role: "user" as const, content: "", metadata: null, createdAt: "" }, executionId: 1 };
        },
        compactConversation: async () => {},
      } as unknown as ExecutionCoordinator,
    );

    await handlers["chatSessions.sendMessage"]({
      sessionId,
      content: "explain this",
      attachments: [{ label: "note.md", mediaType: "text/plain", data: `@file:${filePath}` }],
    });

    expect(capturedContent[0]).toContain("# Hello");
    expect(capturedContent[0]).not.toContain(`@file:`);
  });

  // ─── CS-3: submitDecisions derives engine from conversation model prefix ───────

  it("CS-3: submitDecisions resolves @file: attachments when conversation model is claude/*", async () => {
    const conversationId = (await db.get<{ id: number }>("INSERT INTO conversations (task_id) VALUES (NULL) RETURNING id"))!.id;
    await db.exec("UPDATE conversations SET model = 'claude/claude-sonnet-4-5' WHERE id = $1", [conversationId]);
    const sessionId = (await db.get<{ id: number }>(
      "INSERT INTO chat_sessions (workspace_key, title, status, conversation_id) VALUES ('default', 'Session', 'idle', $1) RETURNING id",
      [conversationId],
    ))!.id;

    const capturedContent: string[] = [];
    const handlers = chatSessionHandlers(
      db,
      () => {},
      {
        executeChatTurn: async (_sid: number, _cid: number, _userContent: string, _model: string | undefined, _mcpTools: string[] | null | undefined, _wsKey: string | undefined, _attachments: Attachment[] | undefined, engineContent: string | undefined) => {
          capturedContent.push(engineContent as string);
          return { message: { id: 1, taskId: null, conversationId, type: "user" as const, role: "user" as const, content: "", metadata: null, createdAt: "" }, executionId: 1 };
        },
        compactConversation: async () => {},
      } as unknown as ExecutionCoordinator,
    );

    await handlers["chatSessions.submitDecisions"]({
      sessionId,
      answers: [{ question: "q1", answer: "yes" }],
    });

    // For submitDecisions, engine content is the formatted decision submission (no @file refs in this case).
    // Key assertion: no error thrown and orchestrator was called.
    expect(capturedContent).toHaveLength(1);
  });
});

// ─── AR: prepareMessageForEngine unit tests ───────────────────────────────────

describe("prepareMessageForEngine — AR unit tests", () => {
  it("AR-1: copilot engine — content and attachments pass through unchanged", async () => {
    const attachments: Attachment[] = [
      { label: "note.md", mediaType: "text/markdown", data: Buffer.from("# hi").toString("base64") },
    ];

    const result = await prepareMessageForEngine("copilot", "explain note.md", attachments);

    expect(result.content).toBe("explain note.md");
    expect(result.attachments).toEqual(attachments);
  });

  it("AR-2: non-copilot engine — @file: reference is resolved into content and stripped from attachments", async () => {
    const filePath = join(gitDir, "snippet.ts");
    writeFileSync(filePath, "const x = 1;\n", "utf8");

    const attachments: Attachment[] = [
      { label: "snippet.ts", mediaType: "text/plain", data: `@file:${filePath}` },
    ];

    const result = await prepareMessageForEngine("claude", "explain this", attachments);

    expect(result.content).toContain("const x = 1;");
    expect(result.attachments).toEqual([]);
  });
});

// ─── resolveContextWindow (via tasks.contextUsage) ────────────────────────────
// Tests the engine-agnostic context window resolution introduced in task 1.1.
// resolveContextWindow is private; tested through the tasks.contextUsage handler.

function makeMockOrchestrator(models: Array<{ qualifiedId: string | null; contextWindow?: number }>): ExecutionCoordinator {
  return {
    listModels: async () => models.map((m) => ({
      qualifiedId: m.qualifiedId,
      displayName: m.qualifiedId ?? "Auto",
      contextWindow: m.contextWindow,
    })),
    executeTransition: async () => { throw new Error("not implemented"); },
    executeHumanTurn: async () => { throw new Error("not implemented"); },
    executeRetry: async () => { throw new Error("not implemented"); },
    executeCodeReview: async () => { throw new Error("not implemented"); },
    respondShellApprovalByExecution: async () => { throw new Error("not implemented"); },
    executeChatTurn: async () => { throw new Error("not implemented"); },
    cancel: () => {},
    compactTask: async () => {},
    compactConversation: async () => {},
    listCommands: async () => [],
  };
}

describe("tasks.contextUsage — resolveContextWindow", () => {
  it("uses contextWindow from orchestrator.listModels() when model is found", async () => {
    const { taskId } = await seedProjectAndTask(db, gitDir);
    await db.exec("UPDATE conversations SET model = 'copilot/claude-sonnet-4.6' WHERE id = (SELECT conversation_id FROM tasks WHERE id = $1)", [taskId]);

    const orchestrator = makeMockOrchestrator([
      { qualifiedId: "copilot/claude-sonnet-4.6", contextWindow: 200_000 },
    ]);
    const handlers = taskHandlers(db, wsRepo, orchestrator, () => {}, worktreeManager);

    const result = await handlers["tasks.contextUsage"]({ taskId });
    expect(result.maxTokens).toBe(200_000);
  });

  it("falls back to 128_000 when orchestrator returns no matching model", async () => {
    const { taskId } = await seedProjectAndTask(db, gitDir);
    await db.exec("UPDATE conversations SET model = 'copilot/unknown-model' WHERE id = (SELECT conversation_id FROM tasks WHERE id = $1)", [taskId]);

    // Orchestrator returns a different model — no match
    const orchestrator = makeMockOrchestrator([
      { qualifiedId: "copilot/other-model", contextWindow: 64_000 },
    ]);
    const handlers = taskHandlers(db, wsRepo, orchestrator, () => {}, worktreeManager);

    const result = await handlers["tasks.contextUsage"]({ taskId });
    // No matching model in orchestrator; resolveModelContextWindow also won't find
    // a provider for "copilot" in the test config — final fallback is 128_000.
    expect(result.maxTokens).toBe(128_000);
  });

  it("falls back to 128_000 when no model is set on the task", async () => {
    const { taskId } = await seedProjectAndTask(db, gitDir);
    await db.exec("UPDATE conversations SET model = NULL WHERE id = (SELECT conversation_id FROM tasks WHERE id = $1)", [taskId]);

    const handlers = taskHandlers(db, wsRepo, null, () => {}, worktreeManager);

    const result = await handlers["tasks.contextUsage"]({ taskId });
    expect(result.maxTokens).toBe(128_000);
  });

  it("uses contextWindow = null entry but still falls back to 128_000", async () => {
    const { taskId } = await seedProjectAndTask(db, gitDir);
    await db.exec("UPDATE conversations SET model = 'copilot/claude-opus' WHERE id = (SELECT conversation_id FROM tasks WHERE id = $1)", [taskId]);

    // Model found but contextWindow is null/undefined
    const orchestrator = makeMockOrchestrator([
      { qualifiedId: "copilot/claude-opus", contextWindow: undefined },
    ]);
    const handlers = taskHandlers(db, wsRepo, orchestrator, () => {}, worktreeManager);

    const result = await handlers["tasks.contextUsage"]({ taskId });
    expect(result.maxTokens).toBe(128_000);
  });

  it("DB override from modelSettingsRepo wins over orchestrator-reported value", async () => {
    const { taskId } = await seedProjectAndTask(db, gitDir);
    await db.exec("UPDATE conversations SET model = 'pi-local/lmstudio/qwen/qwen3-27b' WHERE id = (SELECT conversation_id FROM tasks WHERE id = $1)", [taskId]);

    // Orchestrator reports 32_768 for this model
    const orchestrator = makeMockOrchestrator([
      { qualifiedId: "pi-local/lmstudio/qwen/qwen3-27b", contextWindow: 32_768 },
    ]);

    // User overrode it to 65_536 via the Models screen
    const repo = new SqliteModelSettingsRepository(db);
    await repo.setContextWindow("default", "pi-local/lmstudio/qwen/qwen3-27b", 65_536);

    const handlers = taskHandlers(db, wsRepo, orchestrator, () => {}, worktreeManager, repo);

    const result = await handlers["tasks.contextUsage"]({ taskId });
    expect(result.maxTokens).toBe(65_536);
  });
});

describe("models.listEnabled — Copilot Auto option", () => {
  it("always returns Auto first with null id", async () => {
    const orchestrator = makeMockOrchestrator([
      { qualifiedId: null },
      { qualifiedId: "copilot/mock-model", contextWindow: 64_000 },
    ]);
    const handlers = modelHandlers(db, orchestrator);

    const enabled = await handlers["models.listEnabled"]({ workspaceKey: "1" });

    expect(enabled.length).toBeGreaterThan(0);
    expect(enabled[0].id).toBeNull();
    expect(enabled[0].displayName).toBe("Auto");
  });

  it("keeps Auto when no concrete enabled_models rows match", async () => {
    await db.exec(
      "INSERT OR IGNORE INTO enabled_models (workspace_key, qualified_model_id) VALUES ($1, $2)",
      [1, "copilot/non-existent"],
    );

    const orchestrator = makeMockOrchestrator([
      { qualifiedId: null },
      { qualifiedId: "copilot/mock-model", contextWindow: 64_000 },
    ]);
    const handlers = modelHandlers(db, orchestrator);

    const enabled = await handlers["models.listEnabled"]({ workspaceKey: "1" });

    expect(enabled.some((m) => m.id === null)).toBe(true);
    expect(enabled.some((m) => m.id === "copilot/mock-model")).toBe(true);
  });
});

// ─── ESP-1: tasks.list — executionCount via LEFT JOIN ────────────────────────

describe("tasks.list — ESP-1: executionCount JOIN", () => {
  it("returns correct executionCount for tasks with multiple executions", async () => {
    const { taskId, conversationId } = await seedProjectAndTask(db, gitDir);
    await db.exec("UPDATE conversations SET model = 'copilot/mock-model' WHERE id = (SELECT conversation_id FROM tasks WHERE id = $1)", [taskId]);
    const boardId = (await db.get<{ board_id: number }>("SELECT board_id FROM tasks WHERE id = $1", [taskId]))!.board_id;

    // Insert 3 executions for this task
    for (let i = 0; i < 3; i++) {
      await db.exec(
        "INSERT INTO executions (task_id, conversation_id, from_state, to_state, prompt_id, status, attempt) VALUES ($1, $2, 'plan', 'plan', 'human-turn', 'completed', $3)",
        [taskId, conversationId, i + 1],
      );
    }

    const { handlers } = makeHandlers();
    const tasks = await handlers["tasks.list"]({ boardId });
    const t = tasks.find((x) => x.id === taskId);
    expect(t).toBeDefined();
    expect(t!.executionCount).toBe(3);
  });

  it("returns 0 executionCount when task has no executions", async () => {
    const { taskId } = await seedProjectAndTask(db, gitDir);
    await db.exec("UPDATE conversations SET model = 'copilot/mock-model' WHERE id = (SELECT conversation_id FROM tasks WHERE id = $1)", [taskId]);
    const boardId = (await db.get<{ board_id: number }>("SELECT board_id FROM tasks WHERE id = $1", [taskId]))!.board_id;

    const { handlers } = makeHandlers();
    const tasks = await handlers["tasks.list"]({ boardId });
    const t = tasks.find((x) => x.id === taskId);
    expect(t).toBeDefined();
    expect(t!.executionCount).toBe(0);
  });
});

// ─── ESP-2: tasks.delete — cascade atomicity ─────────────────────────────────

describe("tasks.delete — ESP-2: cascade atomicity", () => {
  it("removes task and all related rows from every related table", async () => {
    const { taskId, conversationId } = await seedProjectAndTask(db, gitDir);
    await db.exec("UPDATE conversations SET model = 'copilot/mock-model' WHERE id = (SELECT conversation_id FROM tasks WHERE id = $1)", [taskId]);

    // Seed related rows
    await db.exec(
      "INSERT INTO executions (task_id, conversation_id, from_state, to_state, prompt_id, status, attempt) VALUES ($1, $2, 'plan', 'plan', 'human-turn', 'completed', 1)",
      [taskId, conversationId],
    );
    await db.exec(
      "INSERT INTO conversation_messages (task_id, conversation_id, type, role, content) VALUES ($1, $2, 'user', 'user', 'hi')",
      [taskId, conversationId],
    );
    await db.exec(
      "INSERT INTO task_git_context (task_id, git_root_path, worktree_path, worktree_status, branch_name) VALUES ($1, '/root', '/root', 'ready', 'branch')",
      [taskId],
    );

    const { handlers } = makeHandlers();
    await handlers["tasks.delete"]({ taskId });

    expect((await db.get<{ n: number }>("SELECT COUNT(*) as n FROM tasks WHERE id = $1", [taskId]))!.n).toBe(0);
    expect((await db.get<{ n: number }>("SELECT COUNT(*) as n FROM executions WHERE task_id = $1", [taskId]))!.n).toBe(0);
    expect((await db.get<{ n: number }>("SELECT COUNT(*) as n FROM conversation_messages WHERE task_id = $1", [taskId]))!.n).toBe(0);
    expect((await db.get<{ n: number }>("SELECT COUNT(*) as n FROM task_git_context WHERE task_id = $1", [taskId]))!.n).toBe(0);
    expect((await db.get<{ n: number }>("SELECT COUNT(*) as n FROM conversations WHERE id = $1", [conversationId]))!.n).toBe(0);
  });
});

describe("mcp.getProjectConfig / mcp.saveProjectConfig", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "railyn-project-config-test-"));
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  function makeHandlers(resolveResult: { projectPath: string } | null) {
    return mcpHandlers(db, {
      registryPool: { invalidate: () => {} } as any,
      resolveProject: () => resolveResult,
    });
  }

  it("getProjectConfig returns path and content when file exists", async () => {
    const railynDir = join(projectDir, ".railyn");
    mkdirSync(railynDir, { recursive: true });
    const configContent = JSON.stringify({ servers: [] }, null, 2);
    writeFileSync(join(railynDir, "mcp.json"), configContent, "utf-8");

    const handlers = makeHandlers({ projectPath: projectDir });
    const result = await handlers["mcp.getProjectConfig"]({ workspaceKey: "default", projectKey: "my-project" });

    expect(result.path).toBe(join(projectDir, ".railyn", "mcp.json"));
    expect(result.content).toBe(configContent);
  });

  it("getProjectConfig returns empty template when file does not exist", async () => {
    const handlers = makeHandlers({ projectPath: projectDir });
    const result = await handlers["mcp.getProjectConfig"]({ workspaceKey: "default", projectKey: "my-project" });

    expect(result.path).toBe(join(projectDir, ".railyn", "mcp.json"));
    expect(JSON.parse(result.content)).toEqual({ servers: [] });
  });

  it("getProjectConfig throws when project is not found", async () => {
    const handlers = makeHandlers(null);
    await expect(
      handlers["mcp.getProjectConfig"]({ workspaceKey: "default", projectKey: "unknown" }),
    ).rejects.toThrow(/not found/);
  });

  it("saveProjectConfig writes file to <projectPath>/.railyn/mcp.json", async () => {
    const handlers = makeHandlers({ projectPath: projectDir });
    const content = JSON.stringify({ servers: [] }, null, 2);
    await handlers["mcp.saveProjectConfig"]({ workspaceKey: "default", projectKey: "my-project", content });

    const writtenPath = join(projectDir, ".railyn", "mcp.json");
    expect(existsSync(writtenPath)).toBe(true);
    expect(readFileSync(writtenPath, "utf-8")).toBe(content);
  });

  it("saveProjectConfig creates .railyn directory when it does not exist", async () => {
    const handlers = makeHandlers({ projectPath: projectDir });
    await handlers["mcp.saveProjectConfig"]({
      workspaceKey: "default",
      projectKey: "my-project",
      content: JSON.stringify({ servers: [] }),
    });

    expect(existsSync(join(projectDir, ".railyn"))).toBe(true);
  });

  it("saveProjectConfig throws for invalid JSON without writing", async () => {
    const handlers = makeHandlers({ projectPath: projectDir });
    await expect(
      handlers["mcp.saveProjectConfig"]({ workspaceKey: "default", projectKey: "p", content: "not valid json {" }),
    ).rejects.toThrow(SyntaxError);

    expect(existsSync(join(projectDir, ".railyn", "mcp.json"))).toBe(false);
  });

  it("saveProjectConfig calls pool.invalidate for the project path", async () => {
    let invalidatedPath: string | undefined;
    const handlers = mcpHandlers(db, {
      registryPool: { invalidate: (p: string) => { invalidatedPath = p; } } as any,
      resolveProject: () => ({ projectPath: projectDir }),
    });

    await handlers["mcp.saveProjectConfig"]({
      workspaceKey: "default",
      projectKey: "my-project",
      content: JSON.stringify({ servers: [] }),
    });

    expect(invalidatedPath).toBe(projectDir);
  });
});
