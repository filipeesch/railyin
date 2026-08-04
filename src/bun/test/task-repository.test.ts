import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../db/db.ts";
import { TaskRepository } from "../db/task-repository.ts";
import { initDb, seedProjectAndTask } from "./helpers.ts";

let db: Db;

beforeEach(async () => {
  db = await initDb();
});

describe("TaskRepository", () => {
  it("TR-MODEL-1: findById returns model from conversations join", async () => {
    const { taskId, conversationId } = await seedProjectAndTask(db, "/tmp/git");
    await db.exec("UPDATE conversations SET model = 'fake/fake' WHERE id = $1", [conversationId]);

    const repo = new TaskRepository(db);
    const task = await repo.findById(taskId);

    expect(task?.model).toBe("fake/fake");
  });
});
