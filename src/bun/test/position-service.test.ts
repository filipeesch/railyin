import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Database } from "bun:sqlite";
import { initDb, seedProjectAndTask, setupTestConfig } from "./helpers.ts";
import { PositionService } from "../handlers/position-service.ts";

let db: Database;
let boardId: number;
let cleanup: () => void;

function getTaskIds(db: Database, boardId: number, col: string): number[] {
  return db
    .query<{ id: number }, [number, string]>(
      "SELECT id FROM tasks WHERE board_id = ? AND workflow_state = ? ORDER BY position ASC",
    )
    .all(boardId, col)
    .map((r) => r.id);
}

function getPositions(db: Database, boardId: number, col: string): number[] {
  return db
    .query<{ position: number }, [number, string]>(
      "SELECT position FROM tasks WHERE board_id = ? AND workflow_state = ? ORDER BY position ASC",
    )
    .all(boardId, col)
    .map((r) => r.position);
}

function insertTask(db: Database, boardId: number, col: string, position: number): number {
  const { taskId } = seedProjectAndTask(db, `/test-${Math.random()}`);
  db.run(
    "UPDATE tasks SET board_id = ?, workflow_state = ?, position = ? WHERE id = ?",
    [boardId, col, position, taskId],
  );
  return taskId;
}

beforeEach(() => {
  const cfg = setupTestConfig();
  cleanup = cfg.cleanup;
  db = initDb();
  const seed = seedProjectAndTask(db, "/test");
  boardId = db
    .query<{ board_id: number }, [number]>("SELECT board_id FROM tasks WHERE id = ?")
    .get(seed.taskId)!.board_id;
  // Remove the seed task so tests start clean
  db.run("DELETE FROM tasks WHERE id = ?", [seed.taskId]);
});

afterEach(() => {
  cleanup();
});

// ─── PS-1: rebalance renumbers with even spacing ──────────────────────────────

describe("PositionService — PS-1: rebalanceColumnPositions", () => {
  it("renumbers tasks with even 1000-step spacing when gap is < 1", () => {
    const t1 = insertTask(db, boardId, "backlog", 0);
    const t2 = insertTask(db, boardId, "backlog", 0); // same position → gap < 1

    const svc = new PositionService(db);
    svc.rebalanceColumnPositions(boardId, "backlog");

    const positions = getPositions(db, boardId, "backlog");
    expect(positions[1] - positions[0]).toBeGreaterThanOrEqual(1000);
  });

  it("skips rebalance when gaps are already sufficient", () => {
    const t1 = insertTask(db, boardId, "backlog", 1000);
    const t2 = insertTask(db, boardId, "backlog", 2000);

    const svc = new PositionService(db);
    svc.rebalanceColumnPositions(boardId, "backlog");

    const positions = getPositions(db, boardId, "backlog");
    expect(positions).toEqual([1000, 2000]); // unchanged
  });
});

// ─── PS-2: reorder moves task and preserves relative order ────────────────────

describe("PositionService — PS-2: reorderColumn", () => {
  it("assigns ascending 1000-step positions in the given order", () => {
    const t1 = insertTask(db, boardId, "backlog", 1000);
    const t2 = insertTask(db, boardId, "backlog", 2000);
    const t3 = insertTask(db, boardId, "backlog", 3000);

    // Reverse the order
    const svc = new PositionService(db);
    svc.reorderColumn(boardId, [t3, t2, t1]);

    const ids = getTaskIds(db, boardId, "backlog");
    expect(ids).toEqual([t3, t2, t1]);
  });
});

// ─── PS-3: transaction atomicity ─────────────────────────────────────────────

describe("PositionService — PS-3: reorderColumn atomicity", () => {
  it("updates all tasks atomically — partial list updates only matching tasks", () => {
    const t1 = insertTask(db, boardId, "backlog", 1000);
    const t2 = insertTask(db, boardId, "backlog", 2000);

    const svc = new PositionService(db);
    // Pass only t1 — t2 should retain its position
    svc.reorderColumn(boardId, [t1]);

    const rows = db
      .query<{ id: number; position: number }, [number]>(
        "SELECT id, position FROM tasks WHERE board_id = ? ORDER BY id ASC",
      )
      .all(boardId);

    const t2Row = rows.find((r) => r.id === t2);
    expect(t2Row!.position).toBe(2000); // unchanged
  });
});
