/**
 * boards.test.ts — Backend unit tests for boards handlers
 *
 * Suites:
 *   DR — DI regression
 *   BC — boards.create
 *   BL — boards.list taskCount
 *   BU — boards.update
 *   BD — boards.delete
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import type { Database } from "bun:sqlite";
import { initDb, setupTestConfig, seedProjectAndTask } from "./helpers.ts";
import { boardHandlers } from "../handlers/boards.ts";

const SECOND_WORKFLOW_YAML = `id: sprint
name: Sprint
columns:
  - id: todo
    label: Todo
`;

let cleanup: (() => void) | null = null;
let db: Database;

beforeEach(() => {
  const cfg = setupTestConfig("", undefined, [SECOND_WORKFLOW_YAML]);
  cleanup = cfg.cleanup;
  db = initDb();
});

afterEach(() => {
  cleanup?.();
  cleanup = null;
});

// ─── DR — DI regression ───────────────────────────────────────────────────────

describe("DR — DI regression", () => {
  it("DR-1: boardHandlers(db) returns handlers using injected db", async () => {
    const handlers = boardHandlers(db);
    const boards = await handlers["boards.list"]();
    expect(Array.isArray(boards)).toBe(true);
  });
});

// ─── BC — boards.create ───────────────────────────────────────────────────────

describe("BC — boards.create", () => {
  it("BC-1: returns board with taskCount 0", async () => {
    const handlers = boardHandlers(db);
    const board = await handlers["boards.create"]({
      workspaceKey: "default",
      name: "My Board",
      projectKeys: ["proj-a"],
      workflowTemplateId: "delivery",
    });
    expect(board.taskCount).toBe(0);
    expect(board.name).toBe("My Board");
    expect(board.projectKeys).toEqual(["proj-a"]);
  });

  it("BC-2: invalid workflowTemplateId falls back to first available", async () => {
    const handlers = boardHandlers(db);
    const board = await handlers["boards.create"]({
      workspaceKey: "default",
      name: "Fallback Board",
      projectKeys: [],
      workflowTemplateId: "nonexistent",
    });
    // Falls back to delivery (first workflow)
    expect(board.workflowTemplateId).toBe("delivery");
  });
});

// ─── BL — boards.list taskCount ──────────────────────────────────────────────

describe("BL — boards.list taskCount", () => {
  it("BL-1: fresh board has taskCount 0", async () => {
    const handlers = boardHandlers(db);
    await handlers["boards.create"]({ workspaceKey: "default", name: "Empty", projectKeys: [], workflowTemplateId: "delivery" });
    const boards = await handlers["boards.list"]();
    expect(boards[0]!.taskCount).toBe(0);
  });

  it("BL-2: board with 2 tasks has taskCount 2", async () => {

    const { boardId } = seedProjectAndTask(db, "");
    // Add a second task
    db.run("INSERT INTO tasks (board_id, project_key, title, description, workflow_state, execution_state, conversation_id, model) VALUES (?, 'test-project', 'Task 2', '', 'backlog', 'idle', 1, 'fake/fake')", [boardId]);
    const handlers = boardHandlers(db);
    const boards = await handlers["boards.list"]();
    const board = boards.find((b) => b.id === boardId);
    expect(board?.taskCount).toBe(2);
  });

  it("BL-3: multiple boards have independent taskCounts", async () => {

    const { boardId: b1 } = seedProjectAndTask(db, "");
    db.run("INSERT INTO boards (workspace_key, name, workflow_template_id) VALUES ('default', 'Board 2', 'delivery')");
    const b2 = (db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!).id;
    const handlers = boardHandlers(db);
    const boards = await handlers["boards.list"]();
    expect(boards.find((b) => b.id === b1)?.taskCount).toBe(1);
    expect(boards.find((b) => b.id === b2)?.taskCount).toBe(0);
  });
});

// ─── BU — boards.update ───────────────────────────────────────────────────────

describe("BU — boards.update", () => {
  async function createTestBoard() {
    const handlers = boardHandlers(db);
    return handlers["boards.create"]({ workspaceKey: "default", name: "Original", projectKeys: ["p1"], workflowTemplateId: "delivery" });
  }

  it("BU-1: name-only update leaves other fields unchanged", async () => {
    const board = await createTestBoard();
    const handlers = boardHandlers(db);
    const updated = await handlers["boards.update"]({ id: board.id, name: "Renamed" });
    expect(updated.name).toBe("Renamed");
    expect(updated.workflowTemplateId).toBe("delivery");
    expect(updated.projectKeys).toEqual(["p1"]);
  });

  it("BU-2: workflowTemplateId-only update leaves name/projectKeys unchanged", async () => {
    const board = await createTestBoard();
    const handlers = boardHandlers(db);
    const updated = await handlers["boards.update"]({ id: board.id, workflowTemplateId: "sprint" });
    expect(updated.name).toBe("Original");
    expect(updated.workflowTemplateId).toBe("sprint");
    expect(updated.projectKeys).toEqual(["p1"]);
  });

  it("BU-3: projectKeys-only update leaves name/template unchanged", async () => {
    const board = await createTestBoard();
    const handlers = boardHandlers(db);
    const updated = await handlers["boards.update"]({ id: board.id, projectKeys: ["p2", "p3"] });
    expect(updated.name).toBe("Original");
    expect(updated.workflowTemplateId).toBe("delivery");
    expect(updated.projectKeys).toEqual(["p2", "p3"]);
  });

  it("BU-4: empty projectKeys sets to empty array", async () => {
    const board = await createTestBoard();
    const handlers = boardHandlers(db);
    const updated = await handlers["boards.update"]({ id: board.id, projectKeys: [] });
    expect(updated.projectKeys).toEqual([]);
  });

  it("BU-5: invalid workflowTemplateId throws without mutating board", async () => {
    const board = await createTestBoard();
    const handlers = boardHandlers(db);
    await expect(
      handlers["boards.update"]({ id: board.id, workflowTemplateId: "nonexistent" })
    ).rejects.toThrow("nonexistent");
    // Verify board is not mutated
    const boards = await handlers["boards.list"]();
    expect(boards.find((b) => b.id === board.id)?.workflowTemplateId).toBe("delivery");
  });

  it("BU-6: non-existent id throws", async () => {
    const handlers = boardHandlers(db);
    await expect(
      handlers["boards.update"]({ id: 99999, name: "Ghost" })
    ).rejects.toThrow("99999");
  });
});

// ─── BD — boards.delete ───────────────────────────────────────────────────────

describe("BD — boards.delete", () => {
  it("BD-1: empty board is deleted successfully", async () => {
    const handlers = boardHandlers(db);
    const board = await handlers["boards.create"]({ workspaceKey: "default", name: "Temp", projectKeys: [], workflowTemplateId: "delivery" });
    await handlers["boards.delete"]({ id: board.id });
    const boards = await handlers["boards.list"]();
    expect(boards.find((b) => b.id === board.id)).toBeUndefined();
  });

  it("BD-2: board with 1 task throws with count in message", async () => {

    const { boardId } = seedProjectAndTask(db, "");
    const handlers = boardHandlers(db);
    await expect(handlers["boards.delete"]({ id: boardId })).rejects.toThrow("1");
  });

  it("BD-3: board with multiple tasks throws with correct count", async () => {

    const { boardId } = seedProjectAndTask(db, "");
    db.run("INSERT INTO tasks (board_id, project_key, title, description, workflow_state, execution_state, conversation_id, model) VALUES (?, 'test-project', 'Task 2', '', 'backlog', 'idle', 1, 'fake/fake')", [boardId]);
    const handlers = boardHandlers(db);
    await expect(handlers["boards.delete"]({ id: boardId })).rejects.toThrow("2");
  });
});
