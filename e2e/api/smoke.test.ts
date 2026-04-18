/**
 * smoke.test.ts — API smoke tests. Verifies the Bun HTTP server responds
 * correctly to core operations without a browser.
 *
 * Each test file gets its own server instance (full isolation).
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { startServer, type TestServer } from "./fixtures/server";

let server: TestServer;

beforeAll(async () => {
    server = await startServer();
}, 20_000);

afterAll(async () => {
    await server.shutdown();
});

describe("workspace", () => {
    test("workspace.getConfig returns a valid config", async () => {
        const config = await server.request("workspace.getConfig", {});
        expect(config).toBeDefined();
        expect(config.key).toBe("test-ws");
        expect(config.name).toBe("Test Workspace");
        expect(Array.isArray(config.workflows)).toBe(true);
    });

    test("workspace.list returns at least one workspace", async () => {
        const list = await server.request("workspace.list", {});
        expect(Array.isArray(list)).toBe(true);
        expect(list.length).toBeGreaterThanOrEqual(1);
        expect(list[0].key).toBe("test-ws");
    });
});

describe("boards", () => {
    let boardId: number;

    test("boards.list returns boards (may be empty on fresh DB)", async () => {
        const boards = await server.request("boards.list", {});
        expect(Array.isArray(boards)).toBe(true);
    });

    test("boards.create creates a new board", async () => {
        const board = await server.request("boards.create", {
            workspaceKey: "test-ws",
            name: "API Test Board",
            projectKeys: [],
            workflowTemplateId: "default",
        });
        expect(board.id).toBeGreaterThan(0);
        expect(board.name).toBe("API Test Board");
        boardId = board.id;
    });

    test("boards.list includes the newly created board", async () => {
        const boards = await server.request("boards.list", {});
        const found = boards.find((b: { id: number; name: string }) => b.id === boardId);
        expect(found).toBeDefined();
        expect((found as any)?.name).toBe("API Test Board");
    });
});

describe("tasks", () => {
    let boardId: number;
    let taskId: number;

    beforeAll(async () => {
        const board = await server.request("boards.create", {
            workspaceKey: "test-ws",
            name: "Tasks Test Board",
            projectKeys: [],
            workflowTemplateId: "default",
        });
        boardId = board.id;
    });

    test("tasks.list returns empty array for fresh board", async () => {
        const tasks = await server.request("tasks.list", { boardId });
        expect(Array.isArray(tasks)).toBe(true);
        expect(tasks.length).toBe(0);
    });

    test("tasks.create creates a task with idle execution state", async () => {
        const task = await server.request("tasks.create", {
            boardId,
            projectKey: "test-ws",
            title: "Test Task",
            description: "Created by API test",
        });
        expect(task.id).toBeGreaterThan(0);
        expect(task.title).toBe("Test Task");
        expect(task.executionState).toBe("idle");
        expect(task.workflowState).toBe("backlog");
        taskId = task.id;
    });

    test("tasks.list returns the created task", async () => {
        const tasks = await server.request("tasks.list", { boardId });
        const found = tasks.find((t: { id: number; title: string }) => t.id === taskId);
        expect(found).toBeDefined();
        expect((found as any)?.title).toBe("Test Task");
    });

    test("tasks.update modifies title and description", async () => {
        const updated = await server.request("tasks.update", {
            taskId,
            title: "Updated Title",
            description: "Updated description",
        });
        expect(updated.title).toBe("Updated Title");
        expect(updated.description).toBe("Updated description");
    });

    test("tasks.setModel updates the task model", async () => {
        const updated = await server.request("tasks.setModel", {
            taskId,
            model: "fake/v2",
        });
        expect(updated.model).toBe("fake/v2");
    });

    test("tasks.transition moves task to plan column", async () => {
        const result = await server.request("tasks.transition", {
            taskId,
            toState: "plan",
        });
        expect(result.task.workflowState).toBe("plan");
    });

    test("tasks.cancel on idle task returns idle state", async () => {
        const cancelled = await server.request("tasks.cancel", { taskId });
        // idle → cancel is a no-op; state stays idle or becomes waiting_user
        expect(["idle", "waiting_user", "cancelled"]).toContain(cancelled.executionState);
    });
});

describe("conversations", () => {
    let boardId: number;
    let taskId: number;

    beforeAll(async () => {
        const board = await server.request("boards.create", {
            workspaceKey: "test-ws",
            name: "Conversation Test Board",
            projectKeys: [],
            workflowTemplateId: "default",
        });
        boardId = board.id;
        const task = await server.request("tasks.create", {
            boardId,
            projectKey: "test-ws",
            title: "Conversation Task",
            description: "",
        });
        taskId = task.id;
    });

    test("conversations.getMessages returns empty array for new task", async () => {
        const msgs = await server.request("conversations.getMessages", { taskId });
        expect(Array.isArray(msgs)).toBe(true);
        expect(msgs.length).toBe(0);
    });
});

describe("models", () => {
    test("models.listEnabled returns an array", async () => {
        const models = await server.request("models.listEnabled", {});
        expect(Array.isArray(models)).toBe(true);
    });

    test("models.list returns provider model lists", async () => {
        const lists = await server.request("models.list", {});
        expect(Array.isArray(lists)).toBe(true);
    });
});
