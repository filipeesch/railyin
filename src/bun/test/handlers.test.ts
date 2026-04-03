import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";
import { initDb, seedProjectAndTask, setupTestConfig } from "./helpers.ts";
import { taskHandlers } from "../handlers/tasks.ts";
import type { Database } from "bun:sqlite";
import type { Task } from "../../shared/rpc-types.ts";

let db: Database;
let gitDir: string;
let configCleanup: () => void;

beforeEach(() => {
  db = initDb();
  const cfg = setupTestConfig();
  configCleanup = cfg.cleanup;

  gitDir = mkdtempSync(join(tmpdir(), "railyn-hdl-"));
  execSync("git init", { cwd: gitDir });
  execSync('git config user.email "t@t.com"', { cwd: gitDir });
  execSync('git config user.name "T"', { cwd: gitDir });
  writeFileSync(join(gitDir, "README.md"), "hello");
  execSync("git add . && git commit -m init", { cwd: gitDir });
});

afterEach(() => {
  rmSync(gitDir, { recursive: true, force: true });
  configCleanup();
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeHandlers() {
  const tokens: Array<{ taskId: number; token: string; done: boolean }> = [];
  const errors: Array<{ taskId: number; error: string }> = [];
  const updates: Task[] = [];

  const handlers = taskHandlers(
    (taskId, _eid, token, done) => tokens.push({ taskId, token, done }),
    (taskId, _eid, error) => errors.push({ taskId, error }),
    (task) => updates.push(task),
  );

  return { handlers, tokens, errors, updates };
}

// ─── tasks.create ─────────────────────────────────────────────────────────────

describe("tasks.create", () => {
  it("creates a task and seeds git context row", async () => {
    const { projectId, boardId } = seedProjectAndTask(db, gitDir);
    const { handlers } = makeHandlers();

    const task = await handlers["tasks.create"]({
      boardId,
      projectId,
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
    const { projectId, boardId } = seedProjectAndTask(db, gitDir);
    const { handlers } = makeHandlers();

    const task = await handlers["tasks.create"]({
      boardId,
      projectId,
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
    // Seed project with a bad git root path
    db.run(
      "INSERT INTO projects (workspace_id, name, project_path, git_root_path, default_branch) VALUES (1, 'bad', '/nonexistent', '/nonexistent', 'main')",
    );
    const projectId = (db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!).id;
    db.run("INSERT INTO boards (workspace_id, name, workflow_template_id) VALUES (1, 'b', 'delivery')");
    const boardId = (db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!).id;
    db.run("INSERT INTO conversations (task_id) VALUES (0)");
    const conversationId = (db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!).id;
    db.run(
      "INSERT INTO tasks (board_id, project_id, title, workflow_state, execution_state, conversation_id) VALUES (?, ?, 'Broken', 'backlog', 'idle', ?)",
      [boardId, projectId, conversationId],
    );
    const taskId = (db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!).id;
    db.run("UPDATE conversations SET task_id = ? WHERE id = ?", [taskId, conversationId]);

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
    const { projectId, boardId, taskId, conversationId } = seedProjectAndTask(db, gitDir);
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
