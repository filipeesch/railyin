import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";
import { initDb, seedProjectAndTask, setupTestConfig } from "./helpers.ts";
import { taskHandlers } from "../handlers/tasks.ts";
import { conversationHandlers } from "../handlers/conversations.ts";
import { chatSessionHandlers } from "../handlers/chat-sessions.ts";
import { mcpHandlers } from "../handlers/mcp.ts";
import { prepareMessageForEngine } from "../utils/attachment-routing.ts";
import type { Database } from "bun:sqlite";
import type { Attachment, Task } from "../../shared/rpc-types.ts";
import type { ExecutionCoordinator } from "../engine/coordinator.ts";

let db: Database;
let gitDir: string;
let configCleanup: () => void;

beforeEach(() => {
  gitDir = mkdtempSync(join(tmpdir(), "railyn-hdl-"));
  execSync("git init", { cwd: gitDir });
  execSync('git config user.email "t@t.com"', { cwd: gitDir });
  execSync('git config user.name "T"', { cwd: gitDir });
  writeFileSync(join(gitDir, "README.md"), "hello");
  execSync("git add . && git commit -m init", { cwd: gitDir });

  db = initDb();
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

  const handlers = taskHandlers(
    null,
    (task) => updates.push(task),
    () => {},
  );

  return { handlers, updates };
}

// ─── tasks.create ─────────────────────────────────────────────────────────────

describe("tasks.create", () => {
  it("creates a task and seeds git context row", async () => {
    const { projectKey, boardId } = seedProjectAndTask(db, gitDir);
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
    const ctx = db
      .query<{ worktree_status: string; git_root_path: string }, [number]>(
        "SELECT worktree_status, git_root_path FROM task_git_context WHERE task_id = ?",
      )
      .get(task.id);

    expect(ctx).not.toBeNull();
    expect(ctx!.worktree_status).toBe("not_created");
    expect(ctx!.git_root_path).toBe(gitDir);
  });

  it("seeds system message with task description", async () => {
    const { projectKey, boardId } = seedProjectAndTask(db, gitDir);
    const { handlers } = makeHandlers();

    const task = await handlers["tasks.create"]({
      boardId,
      projectKey,
      title: "My task",
      description: "My description",
    });

    const msgs = db
      .query<{ type: string; content: string }, [number]>(
        "SELECT type, content FROM conversation_messages WHERE task_id = ? ORDER BY id ASC",
      )
      .all(task.id);

    expect(msgs.length).toBeGreaterThan(0);
    expect(msgs[0].type).toBe("system");
    expect(msgs[0].content).toContain("My task");
    expect(msgs[0].content).toContain("My description");
  });
});

// ─── tasks.transition (worktree failure) ─────────────────────────────────────

describe("tasks.transition / worktree failure", () => {
  it("fails task and appends error message when git_root_path is invalid", async () => {
    // Create board and task with a project that has a bad git root path.
    // After the projects table was removed, we seed task_git_context directly
    // with the invalid path to simulate a task whose worktree setup will fail.
    const projectKey = "test-project";
    db.run("INSERT INTO boards (workspace_key, name, workflow_template_id) VALUES ('default', 'b', 'delivery')");
    const boardId = (db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!).id;
    db.run("INSERT INTO conversations (task_id) VALUES (0)");
    const conversationId = (db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!).id;
    db.run(
      "INSERT INTO tasks (board_id, project_key, title, workflow_state, execution_state, conversation_id) VALUES (?, ?, 'Broken', 'backlog', 'idle', ?)",
      [boardId, projectKey, conversationId],
    );
    const taskId = (db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!).id;
    db.run("UPDATE conversations SET task_id = ? WHERE id = ?", [taskId, conversationId]);
    // Seed git context with an invalid path so the worktree creation fails
    db.run(
      "INSERT INTO task_git_context (task_id, git_root_path, worktree_status) VALUES (?, '/nonexistent', 'not_created')",
      [taskId],
    );

    const { handlers, updates } = makeHandlers();

    const result = await handlers["tasks.transition"]({ taskId, toState: "plan" });

    expect(result.task.executionState).toBe("failed");

    // Error message should appear in conversation
    const errMsg = db
      .query<{ content: string }, [number]>(
        "SELECT content FROM conversation_messages WHERE task_id = ? AND content LIKE '%Worktree setup failed%' LIMIT 1",
      )
      .get(taskId);

    expect(errMsg).not.toBeNull();
    expect(errMsg!.content).toMatch(/Worktree setup failed/i);
  });
});

// ─── tasks.transition (backfill) ─────────────────────────────────────────────

describe("tasks.transition / git context backfill", () => {
  it("backfills git context row on transition even if create missed it", async () => {
    // Create task WITHOUT calling tasks.create (simulates old data)
    const { projectKey, boardId, taskId, conversationId } = seedProjectAndTask(db, gitDir);
    // No task_git_context row exists yet

    const { handlers } = makeHandlers();

    // Transition — should backfill then create worktree
    await handlers["tasks.transition"]({ taskId, toState: "plan" });

    const ctx = db
      .query<{ worktree_status: string }, [number]>(
        "SELECT worktree_status FROM task_git_context WHERE task_id = ?",
      )
      .get(taskId);

    expect(ctx).not.toBeNull();
    // Either ready (git worked) or error (git had an issue in test env) — but row exists
    expect(["ready", "error", "creating"]).toContain(ctx!.worktree_status);
  }, 15_000);
});

// ─── tasks.delete ─────────────────────────────────────────────────────────────

describe("tasks.delete", () => {
  it("removes task, messages, git context, and conversation from DB", async () => {
    const { projectKey, boardId } = seedProjectAndTask(db, gitDir);
    const { handlers } = makeHandlers();

    const task = await handlers["tasks.create"]({
      boardId,
      projectKey,
      title: "To be deleted",
      description: "Temporary task",
    });

    // Verify task and associated rows exist
    const beforeTask = db.query<{ id: number }, [number]>("SELECT id FROM tasks WHERE id = ?").get(task.id);
    expect(beforeTask).not.toBeNull();

    const beforeMsgs = db
      .query<{ count: number }, [number]>(
        "SELECT COUNT(*) AS count FROM conversation_messages WHERE task_id = ?",
      )
      .get(task.id);
    expect(beforeMsgs!.count).toBeGreaterThan(0); // seeded system message exists

    const result = await handlers["tasks.delete"]({ taskId: task.id });
    expect(result.success).toBe(true);

    // Task row gone
    const afterTask = db.query<{ id: number }, [number]>("SELECT id FROM tasks WHERE id = ?").get(task.id);
    expect(afterTask).toBeNull();

    // Conversation messages gone
    const afterMsgs = db
      .query<{ count: number }, [number]>(
        "SELECT COUNT(*) AS count FROM conversation_messages WHERE task_id = ?",
      )
      .get(task.id);
    expect(afterMsgs!.count).toBe(0);

    // Git context gone
    const afterCtx = db
      .query<{ task_id: number }, [number]>("SELECT task_id FROM task_git_context WHERE task_id = ?")
      .get(task.id);
    expect(afterCtx).toBeNull();

    // Conversation gone
    const afterConv = db
      .query<{ id: number }, [number]>("SELECT id FROM conversations WHERE id = ?")
      .get(task.conversationId);
    expect(afterConv).toBeNull();
  });

  it("returns success even when task has no git context row", async () => {
    const { boardId, projectKey } = seedProjectAndTask(db, gitDir);
    const { handlers } = makeHandlers();

    // Insert a bare task without git context
    db.run("INSERT INTO conversations (task_id) VALUES (0)");
    const convId = (db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!).id;
    db.run(
      "INSERT INTO tasks (board_id, project_key, title, workflow_state, execution_state, conversation_id) VALUES (?, ?, 'Bare', 'backlog', 'idle', ?)",
      [boardId, projectKey, convId],
    );
    const bareTaskId = (db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!).id;
    db.run("UPDATE conversations SET task_id = ? WHERE id = ?", [bareTaskId, convId]);

    const result = await handlers["tasks.delete"]({ taskId: bareTaskId });
    expect(result.success).toBe(true);

    const afterTask = db.query<{ id: number }, [number]>("SELECT id FROM tasks WHERE id = ?").get(bareTaskId);
    expect(afterTask).toBeNull();
  });

  it("returns a warning (not an error) when git_root_path no longer exists on disk", async () => {
    const { projectKey, boardId } = seedProjectAndTask(db, gitDir);
    const { handlers } = makeHandlers();

    const task = await handlers["tasks.create"]({
      boardId,
      projectKey,
      title: "Orphaned task",
      description: "Has a missing git root",
    });

    // Simulate a missing git root by patching the git context row
    db.run(
      "UPDATE task_git_context SET git_root_path = '/nonexistent/gone', worktree_path = '/nonexistent/gone/wt', worktree_status = 'ready' WHERE task_id = ?",
      [task.id],
    );

    const result = await handlers["tasks.delete"]({ taskId: task.id });

    expect(result.success).toBe(true);
    expect(result.warning).toMatch(/git root.*no longer exists/i);

    // Task must still be gone from DB despite the warning
    const afterTask = db.query<{ id: number }, [number]>("SELECT id FROM tasks WHERE id = ?").get(task.id);
    expect(afterTask).toBeNull();
  });
});

describe("conversations handlers", () => {
  it("loads messages by canonical conversationId", async () => {
    const { taskId, conversationId } = seedProjectAndTask(db, gitDir);
    db.run(
      "INSERT INTO conversation_messages (task_id, conversation_id, type, role, content) VALUES (?, ?, 'user', 'user', ?), (?, ?, 'assistant', 'assistant', ?)",
      [taskId, conversationId, "hello", taskId, conversationId, "hi there"],
    );

    db.run("INSERT INTO conversations (task_id) VALUES (0)");
    const otherConversationId = (db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!).id;
    db.run(
      "INSERT INTO conversation_messages (task_id, conversation_id, type, role, content) VALUES (?, ?, 'user', 'user', ?)",
      [taskId, otherConversationId, "other thread"],
    );

    const handlers = conversationHandlers(null);
    const messages = await handlers["conversations.getMessages"]({ conversationId });

    expect(messages.map((message) => message.content)).toEqual(["hello", "hi there"]);
    expect(messages.every((message) => message.conversationId === conversationId)).toBe(true);
  });

  it("keeps taskId as a backward-compatible alias for message reads", async () => {
    const { taskId, conversationId } = seedProjectAndTask(db, gitDir);
    db.run(
      "INSERT INTO conversation_messages (task_id, conversation_id, type, role, content) VALUES (?, ?, 'assistant', 'assistant', ?)",
      [taskId, conversationId, "from alias"],
    );

    const handlers = conversationHandlers(null);
    const messages = await handlers["conversations.getMessages"]({ taskId });

    expect(messages).toHaveLength(1);
    expect(messages[0]?.conversationId).toBe(conversationId);
    expect(messages[0]?.content).toBe("from alias");
  });

  it("loads stream events by conversationId and preserves taskId alias", async () => {
    const { taskId, conversationId } = seedProjectAndTask(db, gitDir);
    db.run(
      "INSERT INTO stream_events (id, task_id, conversation_id, execution_id, seq, block_id, type, content, metadata, parent_block_id, subagent_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL), (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)",
      [1, taskId, conversationId, 10, 0, "root-1", "assistant", "alpha", 2, taskId, conversationId, 10, 1, "root-2", "assistant", "beta"],
    );

    const handlers = conversationHandlers(null);
    const canonical = await handlers["conversations.getStreamEvents"]({ conversationId, afterSeq: 0 });
    const aliased = await handlers["conversations.getStreamEvents"]({ taskId, afterSeq: -1 });

    expect(canonical).toHaveLength(1);
    expect(canonical[0]?.content).toBe("beta");
    expect(aliased).toHaveLength(2);
    expect(aliased.map((event) => event.content)).toEqual(["alpha", "beta"]);
  });

  it("computes context usage for session conversations without a task", async () => {
    db.run("INSERT INTO conversations (task_id) VALUES (NULL)");
    const conversationId = (db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!).id;
    db.run(
      "INSERT INTO chat_sessions (workspace_key, title, status, conversation_id) VALUES ('default', 'Session', 'idle', ?)",
      [conversationId],
    );
    db.run(
      "INSERT INTO conversation_messages (task_id, conversation_id, type, role, content) VALUES (NULL, ?, 'user', 'user', ?)",
      [conversationId, "session message"],
    );

    const handlers = conversationHandlers(null);
    const usage = await handlers["conversations.contextUsage"]({ conversationId });

    expect(usage.maxTokens).toBe(128_000);
    expect(usage.usedTokens).toBeGreaterThan(0);
    expect(usage.fraction).toBeGreaterThan(0);
  });
});

describe("chat session parity handlers", () => {
  it("persists session MCP tool selections", async () => {
    const handlers = mcpHandlers();
    db.run("INSERT INTO conversations (task_id) VALUES (NULL)");
    const conversationId = (db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!).id;
    db.run(
      "INSERT INTO chat_sessions (workspace_key, title, status, conversation_id) VALUES ('default', 'Session', 'idle', ?)",
      [conversationId],
    );
    const sessionId = (db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!).id;

    const session = await handlers["mcp.setSessionTools"]({
      sessionId,
      enabledTools: ["docs:search", "github:issues"],
    });

    expect(session.enabledMcpTools).toEqual(["docs:search", "github:issues"]);
    const stored = db.query<{ enabled_mcp_tools: string | null }, [number]>(
      "SELECT enabled_mcp_tools FROM chat_sessions WHERE id = ?",
    ).get(sessionId);
    expect(stored?.enabled_mcp_tools).toBe(JSON.stringify(["docs:search", "github:issues"]));
  });

  it("forwards session model, attachments, workspace, and MCP tools to the orchestrator", async () => {
    db.run("INSERT INTO conversations (task_id) VALUES (NULL)");
    const conversationId = (db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!).id;
    db.run(
      "INSERT INTO chat_sessions (workspace_key, title, status, conversation_id, enabled_mcp_tools) VALUES ('default', 'Session', 'idle', ?, ?)",
      [conversationId, JSON.stringify(["docs:search"])],
    );
    const sessionId = (db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!).id;

    const calls: unknown[][] = [];
    const handlers = chatSessionHandlers(
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
    cancel: () => {},
  };
}

describe("tasks.contextUsage — resolveContextWindow", () => {
  it("uses contextWindow from orchestrator.listModels() when model is found", async () => {
    const { taskId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE tasks SET model = 'copilot/claude-sonnet-4.6' WHERE id = ?", [taskId]);

    const orchestrator = makeMockOrchestrator([
      { qualifiedId: "copilot/claude-sonnet-4.6", contextWindow: 200_000 },
    ]);
    const handlers = taskHandlers(orchestrator, () => {}, () => {});

    const result = await handlers["tasks.contextUsage"]({ taskId });
    expect(result.maxTokens).toBe(200_000);
  });

  it("falls back to 128_000 when orchestrator returns no matching model", async () => {
    const { taskId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE tasks SET model = 'copilot/unknown-model' WHERE id = ?", [taskId]);

    // Orchestrator returns a different model — no match
    const orchestrator = makeMockOrchestrator([
      { qualifiedId: "copilot/other-model", contextWindow: 64_000 },
    ]);
    const handlers = taskHandlers(orchestrator, () => {}, () => {});

    const result = await handlers["tasks.contextUsage"]({ taskId });
    // No matching model in orchestrator; resolveModelContextWindow also won't find
    // a provider for "copilot" in the test config — final fallback is 128_000.
    expect(result.maxTokens).toBe(128_000);
  });

  it("falls back to 128_000 when no model is set on the task", async () => {
    const { taskId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE tasks SET model = NULL WHERE id = ?", [taskId]);

    const handlers = taskHandlers(null, () => {}, () => {});

    const result = await handlers["tasks.contextUsage"]({ taskId });
    expect(result.maxTokens).toBe(128_000);
  });

  it("uses contextWindow = null entry but still falls back to 128_000", async () => {
    const { taskId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE tasks SET model = 'copilot/claude-opus' WHERE id = ?", [taskId]);

    // Model found but contextWindow is null/undefined
    const orchestrator = makeMockOrchestrator([
      { qualifiedId: "copilot/claude-opus", contextWindow: undefined },
    ]);
    const handlers = taskHandlers(orchestrator, () => {}, () => {});

    const result = await handlers["tasks.contextUsage"]({ taskId });
    expect(result.maxTokens).toBe(128_000);
  });
});

describe("models.listEnabled — Copilot Auto option", () => {
  it("always returns Auto first with null id", async () => {
    const orchestrator = makeMockOrchestrator([
      { qualifiedId: null },
      { qualifiedId: "copilot/mock-model", contextWindow: 64_000 },
    ]);
    const handlers = taskHandlers(orchestrator, () => {}, () => {});

    const enabled = await handlers["models.listEnabled"]({ workspaceId: 1 });

    expect(enabled.length).toBeGreaterThan(0);
    expect(enabled[0].id).toBeNull();
    expect(enabled[0].displayName).toBe("Auto");
  });

  it("keeps Auto when no concrete enabled_models rows match", async () => {
    db.run(
      "INSERT OR IGNORE INTO enabled_models (workspace_key, qualified_model_id) VALUES (?, ?)",
      [1, "copilot/non-existent"],
    );

    const orchestrator = makeMockOrchestrator([
      { qualifiedId: null },
      { qualifiedId: "copilot/mock-model", contextWindow: 64_000 },
    ]);
    const handlers = taskHandlers(orchestrator, () => {}, () => {});

    const enabled = await handlers["models.listEnabled"]({ workspaceId: 1 });

    expect(enabled.some((m) => m.id === null)).toBe(true);
    expect(enabled.some((m) => m.id === "copilot/mock-model")).toBe(true);
  });
});
