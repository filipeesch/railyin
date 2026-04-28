import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";
import { initDb, setupTestConfig } from "./helpers.ts";
import { taskHandlers } from "../handlers/tasks.ts";
import { executeCommonTool } from "../engine/common-tools.ts";
import type { CommonToolContext } from "../engine/types.ts";
import type { Database } from "bun:sqlite";

let db: Database;
let gitDir: string;
let configCleanup: () => void;

beforeEach(() => {
  gitDir = mkdtempSync(join(tmpdir(), "railyn-cg-"));
  execSync("git init", { cwd: gitDir });
  execSync('git config user.email "t@t.com"', { cwd: gitDir });
  execSync('git config user.name "T"', { cwd: gitDir });
  writeFileSync(join(gitDir, "README.md"), "hello");
  execSync("git add . && git commit -m init", { cwd: gitDir });

  db = initDb();
});

afterEach(() => {
  rmSync(gitDir, { recursive: true, force: true });
  configCleanup?.();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeHandlers() {
  return taskHandlers(null, () => {}, () => {});
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
function seedBoardWithLimit() {
  const cfg = setupTestConfig("", gitDir, [EXTRA_WORKFLOW_WITH_LIMIT]);
  configCleanup = cfg.cleanup;

  db.run("INSERT INTO boards (workspace_key, name, workflow_template_id) VALUES ('default', 'test-board', 'delivery-lim')");
  const boardId = db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!.id;

  function insertTask(state: string, position: number): number {
    db.run("INSERT INTO conversations (task_id) VALUES (0)");
    const convId = db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!.id;
    db.run(
      "INSERT INTO tasks (board_id, project_key, title, description, workflow_state, execution_state, conversation_id, position) VALUES (?, 'p', 'T', '', ?, 'idle', ?, ?)",
      [boardId, state, convId, position],
    );
    const taskId = db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!.id;
    db.run("UPDATE conversations SET task_id = ? WHERE id = ?", [taskId, convId]);
    return taskId;
  }

  return { boardId, insertTask };
}

// ─── rebalanceColumnPositions (via tasks.reorder) ────────────────────────────

describe("position rebalancing", () => {
  it("rewrites all positions to multiples of 1000 when a gap collapses below 1", async () => {
    const cfg = setupTestConfig("", gitDir);
    configCleanup = cfg.cleanup;

    db.run("INSERT INTO boards (workspace_key, name, workflow_template_id) VALUES ('default', 'test-board', 'delivery')");
    const boardId = db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!.id;

    // Insert 5 tasks into 'plan' column with collapsing float positions
    // Simulate what happens after repeated top-of-column inserts:
    //   500 → 250 → 125 → 62.5 → 31.25  (each is half of the previous min)
    const positions = [500, 250, 125, 62.5, 31.25];
    const taskIds: number[] = [];
    for (const pos of positions) {
      db.run("INSERT INTO conversations (task_id) VALUES (0)");
      const convId = db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!.id;
      db.run(
        "INSERT INTO tasks (board_id, project_key, title, description, workflow_state, execution_state, conversation_id, position) VALUES (?, 'p', 'T', '', 'plan', 'idle', ?, ?)",
        [boardId, convId, pos],
      );
      const taskId = db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!.id;
      db.run("UPDATE conversations SET task_id = ? WHERE id = ?", [taskId, convId]);
      taskIds.push(taskId);
    }

    const handlers = makeHandlers();

    // Reorder any task — this triggers rebalanceColumnPositions
    // We reorder the last task to a new position that creates a tiny gap (< 1.0)
    // The gap between 31.25 and 62.5 is 31.25, but between 31.25 and 62.5 is 31.25 (> 1)
    // Instead, insert a task at a position that creates a sub-1 gap
    db.run("UPDATE tasks SET position = 0.5 WHERE id = ?", [taskIds[taskIds.length - 1]]);

    // Now trigger rebalance by calling tasks.reorder
    await handlers["tasks.reorder"]({ taskId: taskIds[0], position: 0.4 });

    // After rebalance, all positions should be multiples of 1000
    const rows = db
      .query<{ position: number }, [number, string]>(
        "SELECT position FROM tasks WHERE board_id = ? AND workflow_state = ? ORDER BY position ASC",
      )
      .all(boardId, "plan");

    for (let i = 0; i < rows.length; i++) {
      expect(rows[i].position).toBe((i + 1) * 1000);
    }
  });

  it("does not rebalance when gaps are >= 1", async () => {
    const cfg = setupTestConfig("", gitDir);
    configCleanup = cfg.cleanup;

    db.run("INSERT INTO boards (workspace_key, name, workflow_template_id) VALUES ('default', 'test-board', 'delivery')");
    const boardId = db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!.id;

    const positions = [1000, 2000, 3000];
    const taskIds: number[] = [];
    for (const pos of positions) {
      db.run("INSERT INTO conversations (task_id) VALUES (0)");
      const convId = db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!.id;
      db.run(
        "INSERT INTO tasks (board_id, project_key, title, description, workflow_state, execution_state, conversation_id, position) VALUES (?, 'p', 'T', '', 'plan', 'idle', ?, ?)",
        [boardId, convId, pos],
      );
      const taskId = db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!.id;
      db.run("UPDATE conversations SET task_id = ? WHERE id = ?", [taskId, convId]);
      taskIds.push(taskId);
    }

    const handlers = makeHandlers();
    // Reorder to a position with adequate gap
    await handlers["tasks.reorder"]({ taskId: taskIds[0], position: 1500 });

    const rows = db
      .query<{ id: number; position: number }, [number, string]>(
        "SELECT id, position FROM tasks WHERE board_id = ? AND workflow_state = ? ORDER BY position ASC",
      )
      .all(boardId, "plan");

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
    const { boardId, insertTask } = seedBoardWithLimit();

    // Fill inprogress to limit (2)
    insertTask("inprogress", 1000);
    insertTask("inprogress", 2000);

    // Insert a backlog task to move
    const taskId = insertTask("backlog", 500);

    const handlers = makeHandlers();
    await expect(
      handlers["tasks.transition"]({ taskId, toState: "inprogress" }),
    ).rejects.toThrow(/at capacity/);
  });

  it("allows transition when column is below limit", async () => {
    const { boardId, insertTask } = seedBoardWithLimit();

    // Fill inprogress with 1 (limit is 2)
    insertTask("inprogress", 1000);

    const taskId = insertTask("backlog", 500);
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

    db.run("INSERT INTO boards (workspace_key, name, workflow_template_id) VALUES ('default', 'test-board', 'delivery')");
    const boardId = db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!.id;

    // Insert 10 tasks in 'plan' (no limit configured) and one in 'backlog'
    for (let i = 0; i < 10; i++) {
      db.run("INSERT INTO conversations (task_id) VALUES (0)");
      const convId = db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!.id;
      db.run(
        "INSERT INTO tasks (board_id, project_key, title, description, workflow_state, execution_state, conversation_id, position) VALUES (?, 'p', 'T', '', 'plan', 'idle', ?, ?)",
        [boardId, convId, (i + 1) * 1000],
      );
      const taskId = db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!.id;
      db.run("UPDATE conversations SET task_id = ? WHERE id = ?", [taskId, convId]);
    }

    db.run("INSERT INTO conversations (task_id) VALUES (0)");
    const convId2 = db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!.id;
    db.run(
      "INSERT INTO tasks (board_id, project_key, title, description, workflow_state, execution_state, conversation_id, position) VALUES (?, 'p', 'T', '', 'backlog', 'idle', ?, 500)",
      [boardId, convId2],
    );
    const taskId2 = db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!.id;
    db.run("UPDATE conversations SET task_id = ? WHERE id = ?", [taskId2, convId2]);

    const handlers = makeHandlers();
    // The limit check passes; the transition may fail for other reasons (no orchestrator in tests)
    try {
      await handlers["tasks.transition"]({ taskId: taskId2, toState: "plan" });
    } catch (err) {
      expect(String(err)).not.toMatch(/at capacity/);
    }
  });
});

// ─── Card limit enforcement (move_task agent tool) ────────────────────────────

const noop = () => { };
const makeCommonCtx = (taskId: number, boardId: number): CommonToolContext => ({
  taskId,
  boardId,
  onTransition: noop,
  onHumanTurn: noop,
  onCancel: noop,
  onTaskUpdated: noop,
});

describe("card limit enforcement in move_task", () => {
  it("returns an error string when target column is at capacity", async () => {
    const { boardId, insertTask } = seedBoardWithLimit();

    // Fill inprogress to limit (2)
    insertTask("inprogress", 1000);
    insertTask("inprogress", 2000);

    // Task to move
    const taskId = insertTask("backlog", 500);

    const result = await executeCommonTool(
      "move_task",
      { task_id: taskId, workflow_state: "inprogress" },
      makeCommonCtx(taskId, boardId),
    );

    expect(result.text).toMatch(/at capacity/);
  });

  it("succeeds when target column is below limit", async () => {
    const { boardId, insertTask } = seedBoardWithLimit();

    // Only 1 task in inprogress (limit is 2)
    insertTask("inprogress", 1000);
    const taskId = insertTask("backlog", 500);

    const result = await executeCommonTool(
      "move_task",
      { task_id: taskId, workflow_state: "inprogress" },
      makeCommonCtx(taskId, boardId),
    );

    const parsed = JSON.parse(result.text);
    expect(parsed.success).toBe(true);
    expect(parsed.workflow_state).toBe("inprogress");
  });
});
