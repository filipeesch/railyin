import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { initDb, setupTestConfig, seedProjectAndTask } from "./helpers.ts";
import { todoHandlers } from "../handlers/todos.ts";
import { TodoRepository } from "../db/todos.ts";
import type { Database } from "bun:sqlite";

let db: Database;
let taskId: number;
let cleanupConfig: () => void;

beforeEach(() => {
  db = initDb();
  const cfg = setupTestConfig();
  cleanupConfig = cfg.cleanup;
  const seed = seedProjectAndTask(db, cfg.configDir);
  taskId = seed.taskId;
});

afterEach(() => {
  cleanupConfig();
});

describe("todoHandlers — TH-1: todos.create inserts a row and returns it", () => {
  it("returns the created todo with correct fields", async () => {
    const handlers = todoHandlers(db);
    const result = await handlers["todos.create"]({ taskId, number: 10, title: "First", description: "Do the first thing" });
    expect(result.id).toBeGreaterThan(0);
    expect(result.title).toBe("First");
    expect(result.number).toBe(10);
    expect(result.status).toBe("pending");
  });
});

describe("todoHandlers — TH-2: todos.create uses the injected db (not singleton)", () => {
  it("the inserted row is visible when querying the injected db directly", async () => {
    const handlers = todoHandlers(db);
    await handlers["todos.create"]({ taskId, number: 1, title: "Injected DB", description: "check injection" });

    const rows = db
      .query<{ id: number; title: string }, [number]>(
        "SELECT id, title FROM task_todos WHERE task_id = ?",
      )
      .all(taskId);

    expect(rows.length).toBe(1);
    expect(rows[0].title).toBe("Injected DB");
  });
});

describe("todoHandlers — TH-3: todos.list returns empty array when no todos exist", () => {
  it("returns an empty array for a task with no todos", async () => {
    const handlers = todoHandlers(db);
    const result = await handlers["todos.list"]({ taskId });
    expect(result).toEqual([]);
  });
});

describe("todoHandlers — TH-4: todos.list returns created todos ordered by number", () => {
  it("returns todos in ascending number order", async () => {
    const handlers = todoHandlers(db);
    await handlers["todos.create"]({ taskId, number: 30, title: "Third", description: "" });
    await handlers["todos.create"]({ taskId, number: 10, title: "First", description: "" });
    await handlers["todos.create"]({ taskId, number: 20, title: "Second", description: "" });

    const result = await handlers["todos.list"]({ taskId });
    expect(result.map((t) => t.number)).toEqual([10, 20, 30]);
    expect(result.map((t) => t.title)).toEqual(["First", "Second", "Third"]);
  });
});

describe("todoHandlers — TH-5: todos.get returns the todo by id", () => {
  it("returns the full todo item when queried by id", async () => {
    const handlers = todoHandlers(db);
    const created = await handlers["todos.create"]({ taskId, number: 5, title: "Get me", description: "details here" });
    const result = await handlers["todos.get"]({ taskId, todoId: created.id });

    expect(result).not.toBeNull();
    expect("deleted" in (result as object)).toBe(false);
    const todo = result as Awaited<ReturnType<TodoRepository["getTodo"]>> & { title?: string };
    expect((todo as { title: string }).title).toBe("Get me");
  });
});

describe("todoHandlers — TH-6: todos.get returns null for missing id", () => {
  it("returns null when the todo does not exist", async () => {
    const handlers = todoHandlers(db);
    const result = await handlers["todos.get"]({ taskId, todoId: 99999 });
    expect(result).toBeNull();
  });
});

describe("todoHandlers — TH-7: todos.edit updates title and description when status is pending", () => {
  it("persists the updated title and description", async () => {
    const handlers = todoHandlers(db);
    const created = await handlers["todos.create"]({ taskId, number: 1, title: "Original", description: "old desc" });
    const updated = await handlers["todos.edit"]({ taskId, todoId: created.id, title: "Updated", description: "new desc" });

    expect(updated).not.toBeNull();
    expect("error" in (updated as object)).toBe(false);
    const item = updated as { title: string };
    expect(item.title).toBe("Updated");
  });
});

describe("todoHandlers — TH-8: todos.edit returns error when status is not pending", () => {
  it("returns an error object when the todo status is in-progress", async () => {
    const handlers = todoHandlers(db);
    const created = await handlers["todos.create"]({ taskId, number: 1, title: "In flight", description: "" });

    // Move to in-progress directly via DB so edit guard triggers
    db.run("UPDATE task_todos SET status = 'in-progress' WHERE id = ?", [created.id]);

    const result = await handlers["todos.edit"]({ taskId, todoId: created.id, title: "Rejected" });
    expect(result).toMatchObject({ error: expect.any(String) });
  });
});

describe("todoHandlers — TH-9: todos.delete soft-deletes the todo", () => {
  it("marks the todo as deleted and returns the deleted item", async () => {
    const handlers = todoHandlers(db);
    const created = await handlers["todos.create"]({ taskId, number: 1, title: "Delete me", description: "" });
    const result = await handlers["todos.delete"]({ taskId, todoId: created.id });

    expect(result).not.toBeNull();
    expect((result as { status: string }).status).toBe("deleted");

    // Row still exists in DB (soft delete)
    const row = db
      .query<{ status: string }, [number]>("SELECT status FROM task_todos WHERE id = ?")
      .get(created.id);
    expect(row?.status).toBe("deleted");
  });
});

describe("todoHandlers — TH-10: todos.list with includeDeleted=false does not return deleted todos", () => {
  it("excludes deleted todos from the default list", async () => {
    const handlers = todoHandlers(db);
    const kept = await handlers["todos.create"]({ taskId, number: 1, title: "Keep me", description: "" });
    const gone = await handlers["todos.create"]({ taskId, number: 2, title: "Gone", description: "" });
    await handlers["todos.delete"]({ taskId, todoId: gone.id });

    const result = await handlers["todos.list"]({ taskId, includeDeleted: false });
    expect(result.map((t) => t.id)).toContain(kept.id);
    expect(result.map((t) => t.id)).not.toContain(gone.id);
  });
});
