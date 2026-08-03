import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Db } from "../db/db.ts";
import { initDb, seedProjectAndTask, setupTestConfig } from "./helpers.ts";
import { PositionService } from "../handlers/position-service.ts";

let db: Db;
let boardId: number;
let cleanup: () => void;

async function getTaskIds(db: Db, boardId: number, col: string): Promise<number[]> {
  const rows = await db.rows<{ id: number }>(
    "SELECT id FROM tasks WHERE board_id = $1 AND workflow_state = $2 ORDER BY position ASC",
    [boardId, col],
  );
  return rows.map((r) => r.id);
}

async function getPositions(db: Db, boardId: number, col: string): Promise<number[]> {
  const rows = await db.rows<{ position: number }>(
    "SELECT position FROM tasks WHERE board_id = $1 AND workflow_state = $2 ORDER BY position ASC",
    [boardId, col],
  );
  return rows.map((r) => r.position);
}

async function insertTask(db: Db, boardId: number, col: string, position: number): Promise<number> {
  const { taskId } = await seedProjectAndTask(db, `/test-${Math.random()}`);
  await db.exec(
    "UPDATE tasks SET board_id = $1, workflow_state = $2, position = $3 WHERE id = $4",
    [boardId, col, position, taskId],
  );
  return taskId;
}

beforeEach(async () => {
  const cfg = setupTestConfig();
  cleanup = cfg.cleanup;
  db = await initDb();
  const seed = await seedProjectAndTask(db, "/test");
  const seedRow = await db.get<{ board_id: number }>("SELECT board_id FROM tasks WHERE id = $1", [seed.taskId]);
  boardId = seedRow!.board_id;
  // Remove the seed task so tests start clean
  await db.exec("DELETE FROM tasks WHERE id = $1", [seed.taskId]);
});

afterEach(() => {
  cleanup();
});

// ─── PS-1: rebalance renumbers with even spacing ──────────────────────────────

describe("PositionService — PS-1: rebalanceColumnPositions", () => {
  it("renumbers tasks with even 1000-step spacing when gap is < 1", async () => {
    const t1 = await insertTask(db, boardId, "backlog", 0);
    const t2 = await insertTask(db, boardId, "backlog", 0); // same position → gap < 1

    const svc = new PositionService(db);
    await svc.rebalanceColumnPositions(boardId, "backlog");

    const positions = await getPositions(db, boardId, "backlog");
    expect(positions[1] - positions[0]).toBeGreaterThanOrEqual(1000);
  });

  it("skips rebalance when gaps are already sufficient", async () => {
    const t1 = await insertTask(db, boardId, "backlog", 1000);
    const t2 = await insertTask(db, boardId, "backlog", 2000);

    const svc = new PositionService(db);
    await svc.rebalanceColumnPositions(boardId, "backlog");

    const positions = await getPositions(db, boardId, "backlog");
    expect(positions).toEqual([1000, 2000]); // unchanged
  });
});

// ─── PS-2: reorder moves task and preserves relative order ────────────────────

describe("PositionService — PS-2: reorderColumn", () => {
  it("assigns ascending 1000-step positions in the given order", async () => {
    const t1 = await insertTask(db, boardId, "backlog", 1000);
    const t2 = await insertTask(db, boardId, "backlog", 2000);
    const t3 = await insertTask(db, boardId, "backlog", 3000);

    // Reverse the order
    const svc = new PositionService(db);
    await svc.reorderColumn(boardId, [t3, t2, t1]);

    const ids = await getTaskIds(db, boardId, "backlog");
    expect(ids).toEqual([t3, t2, t1]);
  });
});

// ─── PS-4: getTopPosition ─────────────────────────────────────────────────────

describe("PositionService — PS-4: getTopPosition", () => {
  it("PS-4.1: returns MIN(position)/2 for a non-empty column", async () => {
    await insertTask(db, boardId, "backlog", 500);
    await insertTask(db, boardId, "backlog", 1000);
    await insertTask(db, boardId, "backlog", 2000);

    const svc = new PositionService(db);
    expect(await svc.getTopPosition(boardId, "backlog")).toBe(250);
  });

  it("PS-4.2: returns 500 for an empty column", async () => {
    const svc = new PositionService(db);
    expect(await svc.getTopPosition(boardId, "backlog")).toBe(500);
  });

  it("PS-4.3: returns position/2 when column has a single task", async () => {
    await insertTask(db, boardId, "backlog", 300);

    const svc = new PositionService(db);
    expect(await svc.getTopPosition(boardId, "backlog")).toBe(150);
  });

  it("PS-4.4: is isolated per board — ignores tasks on other boards", async () => {
    // Board A: task at 100
    await insertTask(db, boardId, "backlog", 100);

    // Board B: create a separate board and task at 1000
    const boardBSeed = await seedProjectAndTask(db, `/test-board-b-${Math.random()}`);
    const boardBRow = await db.get<{ board_id: number }>("SELECT board_id FROM tasks WHERE id = $1", [boardBSeed.taskId]);
    const boardBId = boardBRow!.board_id;
    await db.exec("UPDATE tasks SET position = 1000 WHERE id = $1", [boardBSeed.taskId]);

    const svc = new PositionService(db);
    // Board B's top position should use its own min (1000), not board A's (100)
    expect(await svc.getTopPosition(boardBId, "backlog")).toBe(500);
  });
});

// ─── PS-3: transaction atomicity ─────────────────────────────────────────────

describe("PositionService — PS-3: reorderColumn atomicity", () => {
  it("updates all tasks atomically — partial list updates only matching tasks", async () => {
    const t1 = await insertTask(db, boardId, "backlog", 1000);
    const t2 = await insertTask(db, boardId, "backlog", 2000);

    const svc = new PositionService(db);
    // Pass only t1 — t2 should retain its position
    await svc.reorderColumn(boardId, [t1]);

    const rows = await db.rows<{ id: number; position: number }>(
      "SELECT id, position FROM tasks WHERE board_id = $1 ORDER BY id ASC",
      [boardId],
    );

    const t2Row = rows.find((r) => r.id === t2);
    expect(t2Row!.position).toBe(2000); // unchanged
  });
});
