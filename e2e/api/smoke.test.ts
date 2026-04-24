/**
 * smoke.test.ts — API smoke tests. Verifies the Bun HTTP server responds
 * correctly to core operations without a browser.
 *
 * Each test file gets its own server instance (full isolation).
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { startServer, type TestServer } from "./fixtures/server";

let server: TestServer;

async function waitFor<T>(
    load: () => Promise<T>,
    predicate: (value: T) => boolean,
    timeoutMs = 10_000,
    intervalMs = 50,
): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    let lastValue = await load();
    while (!predicate(lastValue)) {
        if (Date.now() >= deadline) {
            throw new Error(`Timed out waiting for expected state: ${JSON.stringify(lastValue)}`);
        }
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
        lastValue = await load();
    }
    return lastValue;
}

async function getTask(boardId: number, taskId: number) {
    const tasks = await server.request("tasks.list", { boardId });
    const task = tasks.find((entry) => entry.id === taskId);
    if (!task) throw new Error(`Task ${taskId} not found on board ${boardId}`);
    return task;
}

async function getSession(sessionId: number, includeArchived = false) {
    const sessions = await server.request("chatSessions.list", { includeArchived });
    const session = sessions.find((entry) => entry.id === sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    return session;
}

beforeAll(async () => {
    server = await startServer();
}, 20_000);

afterAll(async () => {
    if (server) {
        await server.shutdown();
    }
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
    let conversationId: number;

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
        conversationId = task.conversationId;
    });

    test("conversations.getMessages supports taskId alias and conversationId reads for task chats", async () => {
        const initialByTask = await server.request("conversations.getMessages", { taskId });
        const initialByConversation = await server.request("conversations.getMessages", { conversationId });
        expect(initialByTask.length).toBeGreaterThanOrEqual(1);
        expect(initialByTask.map((message) => message.id)).toEqual(initialByConversation.map((message) => message.id));
        expect(initialByTask.every((message) => message.conversationId === conversationId)).toBe(true);

        await server.request("tasks.setModel", {
            taskId,
            model: "copilot/mock-model",
        });
        const sent = await server.request("tasks.sendMessage", {
            taskId,
            content: "Hello from the task conversation",
        });
        expect(sent.message.role).toBe("user");
        expect(sent.executionId).toBeGreaterThan(0);

        const canonical = await waitFor(
            () => server.request("conversations.getMessages", { conversationId }),
            (messages) => messages.some((message) => message.type === "assistant"),
        );
        const aliased = await server.request("conversations.getMessages", { taskId });
        expect(aliased.map((message) => message.id)).toEqual(canonical.map((message) => message.id));
        expect(canonical.some((message) => message.role === "user" && message.content === "Hello from the task conversation")).toBe(true);
        expect(canonical.every((message) => message.conversationId === conversationId)).toBe(true);

        const task = await waitFor(
            () => getTask(boardId, taskId),
            (entry) => entry.executionState !== "running",
        );
        expect(["waiting_user", "completed"]).toContain(task.executionState);
    });

    test("tasks.sendMessage with slash chip engineContent delivers raw command to engine", async () => {
        await server.request("tasks.setModel", { taskId, model: "copilot/mock-model" });
        const baseline = await server.request("conversations.getMessages", { conversationId });
        const baselineAssistantCount = baseline.filter((m) => m.type === "assistant").length;

        const sent = await server.request("tasks.sendMessage", {
            taskId,
            content: "[/opsx:propose|/opsx:propose] my feature",
            engineContent: "/opsx:propose my feature",
        });
        expect(sent.message.role).toBe("user");

        await waitFor(
            () => getTask(boardId, taskId),
            (t) => t.executionState !== "running",
        );
        const messages = await server.request("conversations.getMessages", { conversationId });
        const userMsg = [...messages].reverse().find((m) => m.role === "user" && m.type === "user");
        expect(userMsg?.content).toContain("[/opsx:propose|/opsx:propose]");
        const assistantMessages = messages.filter((m) => m.type === "assistant");
        expect(assistantMessages.length).toBe(baselineAssistantCount + 1);
        const lastAssistant = assistantMessages[assistantMessages.length - 1];
        expect(lastAssistant?.content).toBe("Mock response: /opsx:propose my feature");
    });

    test("tasks.sendMessage with slash chip content (no engineContent) falls back to extractChips", async () => {
        await server.request("tasks.setModel", { taskId, model: "copilot/mock-model" });
        const baseline = await server.request("conversations.getMessages", { conversationId });
        const baselineAssistantCount = baseline.filter((m) => m.type === "assistant").length;

        const sent = await server.request("tasks.sendMessage", {
            taskId,
            content: "[/opsx:propose|/opsx:propose] my feature",
        });
        expect(sent.message.role).toBe("user");

        await waitFor(
            () => getTask(boardId, taskId),
            (t) => t.executionState !== "running",
        );
        const messages = await server.request("conversations.getMessages", { conversationId });
        const assistantMessages = messages.filter((m) => m.type === "assistant");
        expect(assistantMessages.length).toBe(baselineAssistantCount + 1);
        const lastAssistant = assistantMessages[assistantMessages.length - 1];
        expect(lastAssistant?.content).toBe("Mock response: /opsx:propose my feature");
    });
});

describe("chatSessions", () => {
    test("chatSessions lifecycle covers standalone chat and conversationId reads", async () => {
        const initial = await server.request("chatSessions.list", {});
        expect(initial).toEqual([]);

        const created = await server.request("chatSessions.create", {
            workspaceKey: "test-ws",
            title: "Standalone Session",
        });
        expect(created.id).toBeGreaterThan(0);
        expect(created.title).toBe("Standalone Session");
        expect(created.status).toBe("idle");
        expect(created.conversationId).toBeGreaterThan(0);

        const listed = await server.request("chatSessions.list", {});
        expect(listed.some((session) => session.id === created.id)).toBe(true);

        await server.request("chatSessions.rename", {
            sessionId: created.id,
            title: "Renamed Session",
        });
        const renamed = await getSession(created.id);
        expect(renamed.title).toBe("Renamed Session");

        const sent = await server.request("chatSessions.sendMessage", {
            sessionId: created.id,
            content: "Hello from the standalone session",
            model: "copilot/mock-model",
        });
        expect(sent.messageId).toBeGreaterThan(0);
        expect(sent.executionId).toBeGreaterThan(0);

        const canonical = await waitFor(
            () => server.request("conversations.getMessages", { conversationId: created.conversationId }),
            (messages) => messages.some((message) => message.type === "assistant"),
        );
        const sessionMessages = await server.request("chatSessions.getMessages", { sessionId: created.id });
        expect(sessionMessages.map((message) => message.id)).toEqual(canonical.map((message) => message.id));
        expect(canonical.some((message) => message.role === "user" && message.content === "Hello from the standalone session")).toBe(true);
        expect(canonical.some((message) => message.type === "assistant" && message.content.length > 0)).toBe(true);
        expect(canonical.every((message) => message.conversationId === created.conversationId)).toBe(true);

        const idleSession = await waitFor(
            () => getSession(created.id),
            (session) => session.status === "idle",
        );
        expect(idleSession.status).toBe("idle");

        await server.request("chatSessions.markRead", { sessionId: created.id });
        const readSession = await waitFor(
            () => getSession(created.id),
            (session) => session.lastReadAt !== null,
        );
        expect(readSession.lastReadAt).not.toBeNull();

        await server.request("chatSessions.archive", { sessionId: created.id });
        const activeSessions = await server.request("chatSessions.list", {});
        expect(activeSessions.some((session) => session.id === created.id)).toBe(false);

        const archived = await waitFor(
            () => getSession(created.id, true),
            (session) => session.status === "archived",
        );
        expect(archived.archivedAt).not.toBeNull();
    });

    test("chatSessions.sendMessage with slash chip engineContent delivers raw command to engine", async () => {
        const session = await server.request("chatSessions.create", {
            workspaceKey: "test-ws",
            title: "Slash Command Test Session",
        });

        const sent = await server.request("chatSessions.sendMessage", {
            sessionId: session.id,
            content: "[/opsx:propose|/opsx:propose] my feature",
            engineContent: "/opsx:propose my feature",
            model: "copilot/mock-model",
        });
        expect(sent.executionId).toBeGreaterThan(0);

        const messages = await waitFor(
            () => server.request("conversations.getMessages", { conversationId: session.conversationId }),
            (msgs) => msgs.some((m) => m.type === "assistant"),
        );
        const assistant = messages.find((m) => m.type === "assistant");
        expect(assistant?.content).toBe("Mock response: /opsx:propose my feature");
    });

    test("chatSessions.sendMessage with slash chip content (no engineContent) falls back to extractChips", async () => {
        const session = await server.request("chatSessions.create", {
            workspaceKey: "test-ws",
            title: "Slash Fallback Test Session",
        });

        const sent = await server.request("chatSessions.sendMessage", {
            sessionId: session.id,
            content: "[/opsx:propose|/opsx:propose] my feature",
            model: "copilot/mock-model",
        });
        expect(sent.executionId).toBeGreaterThan(0);

        const messages = await waitFor(
            () => server.request("conversations.getMessages", { conversationId: session.conversationId }),
            (msgs) => msgs.some((m) => m.type === "assistant"),
        );
        const assistant = messages.find((m) => m.type === "assistant");
        expect(assistant?.content).toBe("Mock response: /opsx:propose my feature");
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
