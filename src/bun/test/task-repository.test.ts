import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "bun:sqlite";
import { TaskRepository } from "../db/task-repository.ts";
import { initDb, seedProjectAndTask } from "./helpers.ts";

let db: Database;

beforeEach(() => {
  db = initDb();
});

describe("TaskRepository", () => {
  it("TR-MODEL-1: findById returns model from conversations join", () => {
    const { taskId, conversationId } = seedProjectAndTask(db, "/tmp/git");
    db.run("UPDATE conversations SET model = 'fake/fake' WHERE id = ?", [conversationId]);

    const repo = new TaskRepository(db);
    const task = repo.findById(taskId);

    expect(task?.model).toBe("fake/fake");
  });
});
