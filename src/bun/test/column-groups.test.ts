import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";
import { initDb, setupTestConfig } from "./helpers.ts";
import { taskHandlers } from "../handlers/tasks.ts";
import { WorkspaceRepository } from "../db/workspace-repository.ts";
import { WorktreeManager } from "../git/WorktreeManager.ts";
import { GitRepositoryManager } from "../git/GitRepositoryManager.ts";
import { TaskGitContextRepository } from "../db/repositories/TaskGitContextRepository.ts";
import type { IProjectResolver } from "../git/IProjectResolver.ts";
import { BoardToolExecutor } from "../workflow/tools/board-tool-executor.ts";
import { executeCommonTool } from "../engine/common-tools.ts";
import type { CommonToolContext } from "../engine/types.ts";
import { TodoRepository } from "../db/todos.ts";
import { DecisionRepository } from "../db/repositories/decision-repository.ts";
import { NoteRepository } from "../db/repositories/note-repository.ts";
import type { Db } from "../db/db.ts";

let db: Db;
let gitDir: string;
let configCleanup: () => void;

const TEST_PROJECT_RESOLVER: IProjectResolver = {
  getDefaultBranch: () => "main",
  getWorktreeBasePath: (_wsKey, _projectKey, gitRootPath) => `${gitRootPath}/../worktrees`,
};

function makeWorktreeManager(db: Db) {
  const wsRepo = new WorkspaceRepository(db);
  return new WorktreeManager(db, wsRepo, TEST_PROJECT_RESOLVER, new GitRepositoryManager(), new TaskGitContextRepository(db));
}

beforeEach(async () => {
  gitDir = mkdtempSync(join(tmpdir(), "railyn-cg-"));
  execSync("git init", { cwd: gitDir });
  execSync('git config user.email "t@t.com"', { cwd: gitDir });
  execSync('git config user.name "T"', { cwd: gitDir });
  writeFileSync(join(gitDir, "README.md"), "hello");
  execSync("git add . && git commit -m init", { cwd: gitDir });

  db = await initDb();
});

afterEach(() => {
  rmSync(gitDir, { recursive: true, force: true });
  configCleanup?.();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeHandlers() {
  return taskHandlers(db, new WorkspaceRepository(db), null, () => {}, makeWorktreeManager(db));
}

const EXTRA_WORKFLOW_WITH_LIMIT = `id: delivery-lim
name: Delivery Limited
columns:
  - id: backlog
    label: Backlog
    is_backlog: true
  - id: inprogress
    label: In Progress
    limit: 2
  - id: done
    label: Done
`;

/** Seed a board with the delivery-with-limit workflow template. */
async function seedBoardWithLimit() {
  const cfg = setupTestConfig("", gitDir, [EXTRA_WORKFLOW_WITH_LIMIT]);
  configCleanup = cfg.cleanup;

  const board = await db.get<{ id: number }>("INSERT INTO boards (workspace_key, name, workflow_template_id) VALUES ('default', 'test-board', 'delivery-lim') RETURNING id");
  const boardId = board!.id;

  async function insertTask(state: string, position: number): Promise<number> {
    const conv = await db.get<{ id: number }>("INSERT INTO conversations (task_id) VALUES (0) RETURNING id");
    const convId = conv!.id;
    const task = await db.get<{ id: number }>(
      "INSERT INTO tasks (board_id, project_key, title, description, workflow_state, execution_state, conversation_id, position) VALUES ($1, 'p', 'T', '', $2, 'idle', $3, $4) RETURNING id",
      [boardId, state, convId, position],
    );
    const taskId = task!.id;
    await db.exec("UPDATE conversations SET task_id = $1 WHERE id = $2", [taskId, convId]);
    return taskId;
  }

  return { boardId, insertTask };
}

// ─── rebalanceColumnPositions (via tasks.reorder) ────────────────────────────

describe("position rebalancing", () => {
  it("rewrites all positions to multiples of 1000 when a gap collapses below 1", async () => {
    const cfg = setupTestConfig("", gitDir);
    configCleanup = cfg.cleanup;

    const board = await db.get<{ id: number }>("INSERT INTO boards (workspace_key, name, workflow_template_id) VALUES ('default', 'test-board', 'delivery') RETURNING id");
    const boardId = board!.id;

    // Insert 5 tasks into 'plan' column with collapsing float positions
    // Simulate what happens after repeated top-of-column inserts:
    //   500 → 250 → 125 → 62.5 → 31.25  (each is half of the previous min)
    const positions = [500, 250, 125, 62.5, 31.25];
    const taskIds: number[] = [];
    for (const pos of positions) {
      const conv = await db.get<{ id: number }>("INSERT INTO conversations (task_id) VALUES (0) RETURNING id");
      const convId = conv!.id;
      const task = await db.get<{ id: number }>(
        "INSERT INTO tasks (board_id, project_key, title, description, workflow_state, execution_state, conversation_id, position) VALUES ($1, 'p', 'T', '', 'plan', 'idle', $2, $3) RETURNING id",
        [boardId, convId, pos],
      );
      const taskId = task!.id;
      await db.exec("UPDATE conversations SET task_id = $1 WHERE id = $2", [taskId, convId]);
      taskIds.push(taskId);
    }

    const handlers = makeHandlers();

    // Reorder any task — this triggers rebalanceColumnPositions
    // We reorder the last task to a new position that creates a tiny gap (< 1.0)
    // The gap between 31.25 and 62.5 is 31.25, but between 31.25 and 62.5 is 31.25 (> 1)
    // Instead, insert a task at a position that creates a sub-1 gap
    await db.exec("UPDATE tasks SET position = 0.5 WHERE id = $1", [taskIds[taskIds.length - 1]]);

    // Now trigger rebalance by calling tasks.reorder
    await handlers["tasks.reorder"]({ taskId: taskIds[0], position: 0.4 });

    // After rebalance, all positions should be multiples of 1000
    const rows = await db.rows<{ position: number }>(
      "SELECT position FROM tasks WHERE board_id = $1 AND workflow_state = $2 ORDER BY position ASC",
      [boardId, "plan"],
    );

    for (let i = 0; i < rows.length; i++) {
      expect(rows[i].position).toBe((i + 1) * 1000);
    }
  });

  it("does not rebalance when gaps are >= 1", async () => {
    const cfg = setupTestConfig("", gitDir);
    configCleanup = cfg.cleanup;

    const board = await db.get<{ id: number }>("INSERT INTO boards (workspace_key, name, workflow_template_id) VALUES ('default', 'test-board', 'delivery') RETURNING id");
    const boardId = board!.id;

    const positions = [1000, 2000, 3000];
    const taskIds: number[] = [];
    for (const pos of positions) {
      const conv = await db.get<{ id: number }>("INSERT INTO conversations (task_id) VALUES (0) RETURNING id");
      const convId = conv!.id;
      const task = await db.get<{ id: number }>(
        "INSERT INTO tasks (board_id, project_key, title, description, workflow_state, execution_state, conversation_id, position) VALUES ($1, 'p', 'T', '', 'plan', 'idle', $2, $3) RETURNING id",
        [boardId, convId, pos],
      );
      const taskId = task!.id;
      await db.exec("UPDATE conversations SET task_id = $1 WHERE id = $2", [taskId, convId]);
      taskIds.push(taskId);
    }

    const handlers = makeHandlers();
    // Reorder to a position with adequate gap
    await handlers["tasks.reorder"]({ taskId: taskIds[0], position: 1500 });

    const rows = await db.rows<{ id: number; position: number }>(
      "SELECT id, position FROM tasks WHERE board_id = $1 AND workflow_state = $2 ORDER BY position ASC",
      [boardId, "plan"],
    );

    // The reordered task (taskIds[0]) is now at 1500 — no rebalance needed
    const positions2 = rows.map((r) => r.position);
    expect(positions2).toContain(1500);
    // Positions are NOT rewritten to 1000, 2000, 3000 since gaps are fine
    expect(positions2).not.toEqual([1000, 2000, 3000]);
  });
});

// ─── Card limit enforcement (tasks.transition) ────────────────────────────────

describe("card limit enforcement in tasks.transition", () => {
  it("throws an error when the target column is at capacity", async () => {
    const { boardId, insertTask } = await seedBoardWithLimit();

    // Fill inprogress to limit (2)
    await insertTask("inprogress", 1000);
    await insertTask("inprogress", 2000);

    // Insert a backlog task to move
    const taskId = await insertTask("backlog", 500);

    const handlers = makeHandlers();
    await expect(
      handlers["tasks.transition"]({ taskId, toState: "inprogress" }),
    ).rejects.toThrow(/at capacity/);
  });

  it("allows transition when column is below limit", async () => {
    const { boardId, insertTask } = await seedBoardWithLimit();

    // Fill inprogress with 1 (limit is 2)
    await insertTask("inprogress", 1000);

    const taskId = await insertTask("backlog", 500);
    const handlers = makeHandlers();
    // The limit check passes; transition may fail later for other reasons (no orchestrator in tests)
    // We only assert that no "at capacity" error is thrown
    try {
      await handlers["tasks.transition"]({ taskId, toState: "inprogress" });
    } catch (err) {
      expect(String(err)).not.toMatch(/at capacity/);
    }
  });

  it("allows transition when column has no limit", async () => {
    const cfg = setupTestConfig("", gitDir);
    configCleanup = cfg.cleanup;

    const board = await db.get<{ id: number }>("INSERT INTO boards (workspace_key, name, workflow_template_id) VALUES ('default', 'test-board', 'delivery') RETURNING id");
    const boardId = board!.id;

    // Insert 10 tasks in 'plan' (no limit configured) and one in 'backlog'
    for (let i = 0; i < 10; i++) {
      const conv = await db.get<{ id: number }>("INSERT INTO conversations (task_id) VALUES (0) RETURNING id");
      const convId = conv!.id;
      const task = await db.get<{ id: number }>(
        "INSERT INTO tasks (board_id, project_key, title, description, workflow_state, execution_state, conversation_id, position) VALUES ($1, 'p', 'T', '', 'plan', 'idle', $2, $3) RETURNING id",
        [boardId, convId, (i + 1) * 1000],
      );
      const taskId = task!.id;
      await db.exec("UPDATE conversations SET task_id = $1 WHERE id = $2", [taskId, convId]);
    }

    const conv2 = await db.get<{ id: number }>("INSERT INTO conversations (task_id) VALUES (0) RETURNING id");
    const convId2 = conv2!.id;
    const task2 = await db.get<{ id: number }>(
      "INSERT INTO tasks (board_id, project_key, title, description, workflow_state, execution_state, conversation_id, position) VALUES ($1, 'p', 'T', '', 'backlog', 'idle', $2, 500) RETURNING id",
      [boardId, convId2],
    );
    const taskId2 = task2!.id;
    await db.exec("UPDATE conversations SET task_id = $1 WHERE id = $2", [taskId2, convId2]);

    const handlers = makeHandlers();
    // The limit check passes; the transition may fail for other reasons (no orchestrator in tests)
    try {
      await handlers["tasks.transition"]({ taskId: taskId2, toState: "plan" });
    } catch (err) {
      expect(String(err)).not.toMatch(/at capacity/);
    }
  });
});

// ─── Card limit enforcement (move_card agent tool) ────────────────────────────

const noop = () => { };
const makeCommonCtx = (taskId: number, boardId: number): CommonToolContext => ({
  task: { id: taskId, boardId, conversationId: 0 },
  workspaceKey: "default",
  repos: {
    todos: new TodoRepository(db),
    decisions: new DecisionRepository(db),
    notes: new NoteRepository(db),
    boardTools: new BoardToolExecutor(db, new WorkspaceRepository(db)),
  },
  workflow: {
    onTransition: noop,
    onHumanTurn: noop,
    onCancel: noop,
    onTaskUpdated: noop,
  },
  runtime: {},
});

describe("card limit enforcement in move_card", () => {
  it("returns an error string when target column is at capacity", async () => {
    const { boardId, insertTask } = await seedBoardWithLimit();

    // Fill inprogress to limit (2)
    await insertTask("inprogress", 1000);
    await insertTask("inprogress", 2000);

    // Task to move
    const taskId = await insertTask("backlog", 500);

    const result = await executeCommonTool(
      "move_card",
      { task_id: taskId, workflow_state: "inprogress" },
      makeCommonCtx(taskId, boardId),
    );

    expect(result.text).toMatch(/at capacity/);
  });

  it("succeeds when target column is below limit", async () => {
    const { boardId, insertTask } = await seedBoardWithLimit();

    // Only 1 task in inprogress (limit is 2)
    await insertTask("inprogress", 1000);
    const taskId = await insertTask("backlog", 500);

    const result = await executeCommonTool(
      "move_card",
      { task_id: taskId, workflow_state: "inprogress" },
      makeCommonCtx(taskId, boardId),
    );

    const parsed = JSON.parse(result.text);
    expect(parsed.success).toBe(true);
    expect(parsed.workflow_state).toBe("inprogress");
  });
});
