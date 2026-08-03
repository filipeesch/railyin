/**
 * workspace-repository.test.ts — Unit tests for WorkspaceRepository
 *
 * Suites:
 *   WR-1  getBoardWorkspaceKey returns stored key
 *   WR-2  getBoardWorkspaceKey falls back to default for unknown board
 *   WR-3  getTaskWorkspaceKey returns key via board join
 *   WR-4  getTaskWorkspaceKey falls back to default for unknown task
 *   WR-5  interface contract is satisfied at compile time
 */
import { describe, it, expect, beforeEach } from "vitest";
import type { Db } from "../db/db.ts";
import { initDb, seedProjectAndTask } from "./helpers.ts";
import { WorkspaceRepository, type IWorkspaceRepository } from "../db/workspace-repository.ts";
import { getDefaultWorkspaceKey } from "../workspace-context.ts";

let db: Db;
let wsRepo: WorkspaceRepository;

beforeEach(async () => {
  db = await initDb();
  wsRepo = new WorkspaceRepository(db);
});

describe("WR-1: getBoardWorkspaceKey returns stored key", () => {
  it("returns the workspace_key for a known board", async () => {
    const { boardId } = await seedProjectAndTask(db, "");
    await db.exec("UPDATE boards SET workspace_key = 'myworkspace' WHERE id = $1", [boardId]);
    expect(await wsRepo.getBoardWorkspaceKey(boardId)).toBe("myworkspace");
  });
});

describe("WR-2: getBoardWorkspaceKey falls back to default for unknown board", () => {
  it("returns getDefaultWorkspaceKey() for a non-existent board id", async () => {
    expect(await wsRepo.getBoardWorkspaceKey(99999)).toBe(getDefaultWorkspaceKey());
  });
});

describe("WR-3: getTaskWorkspaceKey returns key via board join", () => {
  it("returns the workspace_key from the task's board", async () => {
    const { taskId, boardId } = await seedProjectAndTask(db, "");
    await db.exec("UPDATE boards SET workspace_key = 'ws2' WHERE id = $1", [boardId]);
    expect(await wsRepo.getTaskWorkspaceKey(taskId)).toBe("ws2");
  });
});

describe("WR-4: getTaskWorkspaceKey falls back to default for unknown task", () => {
  it("returns getDefaultWorkspaceKey() for a non-existent task id", async () => {
    expect(await wsRepo.getTaskWorkspaceKey(99999)).toBe(getDefaultWorkspaceKey());
  });
});

describe("WR-5: interface contract is satisfied", () => {
  it("WorkspaceRepository satisfies IWorkspaceRepository", () => {
    // TypeScript compile-time check: assignable to the interface
    const r: IWorkspaceRepository = new WorkspaceRepository(db);
    expect(typeof r.getBoardWorkspaceKey).toBe("function");
    expect(typeof r.getTaskWorkspaceKey).toBe("function");
  });
});
