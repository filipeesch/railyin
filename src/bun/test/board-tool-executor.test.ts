/**
 * board-tool-executor.test.ts — Integration tests for BoardToolExecutor
 *
 * Suites:
 *   BE-1  constructor satisfies IBoardToolExecutor
 *   BE-2  execGetTask returns task data for known id
 *   BE-3  execGetTask returns error string for unknown id
 *   BE-4  execCreateTask inserts into injected (in-memory) DB
 *   BE-5  execMoveTask updates workflow_state in injected DB
 *   BE-6  execMessageTask invokes onHumanTurn for idle task
 *   BE-7  Error includes board list when boards exist
 *   BE-8  Error indicates no boards when workspace is empty
 *   BE-9  list_cards error includes board list
 *   BE-10 create_card error includes board list
 *   BE-11 Board queries use BoardRepository (mock-based)
 *   BE-12 Board listing uses BoardRepository
 *   BE-13 Error scoped to workspace, not all boards
 *   BE-14 Board list ordered by created_at
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Database } from "bun:sqlite";
import { initDb, seedProjectAndTask, seedBoards, setupTestConfig } from "./helpers.ts";
import { BoardToolExecutor, type IBoardToolExecutor } from "../workflow/tools/board-tool-executor.ts";
import { WorkspaceRepository } from "../db/workspace-repository.ts";
import { BoardRepository, type IBoardRepository } from "../db/board-repository.ts";
import type { BoardToolContext } from "../workflow/tools/types.ts";

let db: Database;
let cfg: ReturnType<typeof setupTestConfig>;
let taskId: number;
let boardId: number;
let executor: BoardToolExecutor;

const noop = () => {};

function makeCtx(overrides?: Partial<BoardToolContext>): BoardToolContext {
  return {
    taskId,
    boardId,
    workspaceKey: "default",
    onTransition: noop,
    onHumanTurn: noop,
    onCancel: noop,
    onTaskUpdated: noop,
    ...overrides,
  };
}

beforeEach(() => {
  cfg = setupTestConfig();
  db = initDb();
  ({ taskId, boardId } = seedProjectAndTask(db, "/tmp/test-git"));
  executor = new BoardToolExecutor(db, new WorkspaceRepository(db), new BoardRepository(db));
});

afterEach(() => {
  cfg.cleanup();
});

describe("BE-1: constructor satisfies IBoardToolExecutor", () => {
  it("is assignable to IBoardToolExecutor interface", () => {
    const exec: IBoardToolExecutor = new BoardToolExecutor(db, new WorkspaceRepository(db), new BoardRepository(db));
    expect(typeof exec.execGetTask).toBe("function");
    expect(typeof exec.execCreateTask).toBe("function");
    expect(typeof exec.execMoveTask).toBe("function");
    expect(typeof exec.execMessageTask).toBe("function");
  });
});

describe("BE-2: execGetTask returns task data for known id", () => {
  it("returns a string containing the task title", async () => {
    const result = await executor.execGetTask({ task_id: taskId }, makeCtx());
    expect(result).toContain("Test task");
  });
});

describe("BE-3: execGetTask returns error string for unknown id", () => {
  it("returns an error string when task does not exist", async () => {
    const result = await executor.execGetTask({ task_id: 99999 }, makeCtx());
    expect(result).toMatch(/^Error:/);
  });
});

describe("BE-4: execCreateTask inserts into injected in-memory DB", () => {
  it("inserts a new task into the in-memory DB", async () => {
    const before = db.query<{ count: number }, []>("SELECT COUNT(*) as count FROM tasks").get()!.count;
    await executor.execCreateTask(
      { title: "New Task", project_key: "test-project", board_id: boardId },
      makeCtx(),
    );
    const after = db.query<{ count: number }, []>("SELECT COUNT(*) as count FROM tasks").get()!.count;
    expect(after).toBe(before + 1);
  });

  it("BE-4.2: places new task above existing tasks when backlog is non-empty", async () => {
    db.run("UPDATE tasks SET workflow_state = 'backlog', position = 500 WHERE id = ?", [taskId]);
    await executor.execCreateTask(
      { title: "On Top", project_key: "test-project", board_id: boardId },
      makeCtx(),
    );
    const positions = db
      .query<{ position: number }, [number]>(
        "SELECT position FROM tasks WHERE board_id = ? AND workflow_state = 'backlog' ORDER BY position ASC",
      )
      .all(boardId)
      .map((r) => r.position);
    expect(positions[0]).toBeLessThan(500);
  });

  it("BE-4.3: assigns position 500 when backlog is empty", async () => {
    db.run("DELETE FROM tasks WHERE board_id = ?", [boardId]);
    await executor.execCreateTask(
      { title: "Empty board task", project_key: "test-project", board_id: boardId },
      makeCtx(),
    );
    const row = db
      .query<{ position: number }, [number]>(
        "SELECT position FROM tasks WHERE board_id = ? ORDER BY id DESC LIMIT 1",
      )
      .get(boardId);
    expect(row!.position).toBe(500);
  });
});

describe("BE-5: execMoveTask updates workflow_state in injected DB", () => {
  it("updates workflow_state for the task", async () => {
    const result = await executor.execMoveTask(
      { task_id: taskId, workflow_state: "done" },
      makeCtx(),
    );
    expect(result).not.toMatch(/^Error:/);
    const row = db.query<{ workflow_state: string }, [number]>(
      "SELECT workflow_state FROM tasks WHERE id = ?",
    ).get(taskId);
    expect(row?.workflow_state).toBe("done");
  });
});

describe("BE-6: execMessageTask invokes onHumanTurn for idle task", () => {
  it("calls onHumanTurn when task is idle", async () => {
    const calls: Array<{ taskId: number; message: string }> = [];
    const ctx = makeCtx({
      onHumanTurn: (id, msg) => calls.push({ taskId: id, message: msg }),
    });
    await executor.execMessageTask({ task_id: taskId, message: "hello" }, ctx);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0]!.taskId).toBe(taskId);
  });
});

describe("BE-7: Error includes board list when boards exist", () => {
  it("error contains formatted board list", async () => {
    seedBoards(db, [
      { workspaceKey: "default", name: "Open Spec" },
      { workspaceKey: "default", name: "Design" },
    ]);
    const result = await executor.execGetBoardSummary({}, makeCtx({ boardId: undefined }));
    expect(result).toContain("Available boards:");
    expect(result).toContain("Open Spec");
    expect(result).toContain("Design");
  });
});

describe("BE-8: Error indicates no boards when workspace is empty", () => {
  it("error contains no boards available message", async () => {
    db.exec("PRAGMA foreign_keys = OFF;");
    db.run("DELETE FROM boards WHERE workspace_key = 'default'");
    db.exec("PRAGMA foreign_keys = ON;");
    const result = await executor.execGetBoardSummary({}, makeCtx({ boardId: undefined }));
    expect(result).toContain("No boards are currently available");
  });
});

describe("BE-9: list_cards error includes board list", () => {
  it("list_cards error contains board list", async () => {
    const result = await executor.execListTasks({}, makeCtx({ boardId: undefined }));
    expect(result).toContain("Available boards:");
  });
});

describe("BE-10: create_card error includes board list", () => {
  it("create_card error contains board list", async () => {
    const result = await executor.execCreateTask(
      { title: "X", project_key: "test-project" },
      makeCtx({ boardId: undefined }),
    );
    expect(result).toContain("Available boards:");
  });
});

describe("BE-11: Board queries use BoardRepository", () => {
  it("execGetBoardSummary calls boardRepo.exists()", async () => {
    const mockRepo: IBoardRepository = {
      listByWorkspace: vi.fn().mockReturnValue([]),
      getById: vi.fn().mockReturnValue(null),
      exists: vi.fn().mockReturnValue(true),
      getWorkspaceKey: vi.fn().mockReturnValue("default"),
    };
    const mockExecutor = new BoardToolExecutor(db, new WorkspaceRepository(db), mockRepo);
    await mockExecutor.execGetBoardSummary({ board_id: boardId }, makeCtx());
    expect(mockRepo.exists).toHaveBeenCalledWith(boardId);
  });
});

describe("BE-12: Board listing uses BoardRepository", () => {
  it("execListBoards delegates to boardRepo.listByWorkspace()", async () => {
    const mockRepo: IBoardRepository = {
      listByWorkspace: vi.fn().mockReturnValue([{ id: boardId, name: "test-board" }]),
      getById: vi.fn().mockReturnValue(null),
      exists: vi.fn().mockReturnValue(false),
      getWorkspaceKey: vi.fn().mockReturnValue(null),
    };
    const mockExecutor = new BoardToolExecutor(db, new WorkspaceRepository(db), mockRepo);
    await mockExecutor.execListBoards({}, makeCtx());
    expect(mockRepo.listByWorkspace).toHaveBeenCalledWith("default");
  });
});

describe("BE-13: Error scoped to workspace, not all boards", () => {
  it("error lists only boards from current workspace", async () => {
    seedBoards(db, [
      { workspaceKey: "ws1", name: "Board 1" },
      { workspaceKey: "ws2", name: "Board 2" },
    ]);
    const result = await executor.execGetBoardSummary({}, makeCtx({ workspaceKey: "ws1", boardId: undefined }));
    expect(result).toContain("Board 1");
    expect(result).not.toContain("Board 2");
  });
});

describe("BE-14: Board list ordered by created_at", () => {
  it("error message lists boards in ascending order", async () => {
    db.run("INSERT INTO boards (workspace_key, name, workflow_template_id, created_at) VALUES ('default', 'First', 'delivery', '2024-01-01')");
    db.run("INSERT INTO boards (workspace_key, name, workflow_template_id, created_at) VALUES ('default', 'Second', 'delivery', '2024-01-02')");
    const result = await executor.execGetBoardSummary({}, makeCtx({ boardId: undefined }));
    const firstIdx = result.indexOf("First");
    const secondIdx = result.indexOf("Second");
    expect(firstIdx).toBeLessThan(secondIdx);
  });
});
