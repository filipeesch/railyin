/**
 * index.ts — Extended Playwright test fixture.
 *
 * Exports a `test` with the following auto-use fixtures:
 *
 *   api   — ApiMock instance with baseline workspace/board/models pre-registered.
 *            Tests add task-specific handlers before calling page.goto('/').
 *   ws    — WsMock instance, installed and ready to push server events.
 *   task  — A pre-made Task object for the common single-task case.
 *
 * Usage:
 *   import { test, expect } from "../fixtures";
 *
 *   test("my test", async ({ page, api, ws, task }) => {
 *     api.handle("tasks.list", () => [task]);
 *     await page.goto("/");
 *     // ... Playwright assertions
 *   });
 */

import { test as base, expect } from "@playwright/test";
import { ApiMock } from "./mock-api";
import { WsMock } from "./mock-ws";
import { makeBoard, makeTask, makeWorkspace } from "./mock-data";
import type { Task } from "@shared/rpc-types";

type Fixtures = {
    api: ApiMock;
    ws: WsMock;
    task: Task;
};

export const test = base.extend<Fixtures>({
    // ── WsMock ─────────────────────────────────────────────────────────────────
    ws: [async ({ page }, use) => {
        const ws = new WsMock(page);
        await ws.install();
        await use(ws);
    }, { auto: true }],

    // ── ApiMock ─────────────────────────────────────────────────────────────────
    api: [async ({ page, task }, use) => {
        const api = new ApiMock(page);

        // Baseline responses every page needs on first load
        api
            .returns("workspace.getConfig", makeWorkspace())
            .returns("workspace.list", [{ key: "test-workspace", name: "Test Workspace" }])
            .returns("boards.list", [makeBoard()])
            .returns("models.listEnabled", [{ id: "fake/test", displayName: "Fake/Test", contextWindow: 8192 }])
            .returns("models.list", [])
            // Default single task — tests override this for multi-task scenarios
            .handle("tasks.list", () => [task])
            .returns("conversations.getMessages", [])
            .returns("conversations.getStreamEvents", [])
            .returns("conversations.contextUsage", { usedTokens: 0, maxTokens: 8192, fraction: 0 })
            .returns("tasks.contextUsage", { usedTokens: 0, maxTokens: 8192, fraction: 0 })
            .returns("todos.list", [])
            .returns("launch.getConfig", null)
            .returns("tasks.getChangedFiles", [])
            .returns("tasks.getGitStat", null)
            .returns("tasks.getPendingHunkSummary", [])
            .returns("projects.list", [])
            .returns("tasks.sessionMemory", { content: null })
            .returns("mcp.getStatus", [])
            // Autocomplete endpoints — tests override as needed
            .returns("engine.listCommands", [])
            .returns("workspace.listFiles", [])
            .returns("lsp.workspaceSymbol", [])
            // Chat sessions — tests override as needed
            .returns("chatSessions.list", [])
            .returns("chatSessions.create", { id: 900, workspaceKey: "test-workspace", title: "New Chat", status: "idle", conversationId: 900, enabledMcpTools: null, lastActivityAt: new Date().toISOString(), lastReadAt: null, archivedAt: null, createdAt: new Date().toISOString() })
            .returns("chatSessions.getMessages", [])
            .returns("chatSessions.rename", undefined)
            .returns("chatSessions.archive", undefined)
            .returns("chatSessions.markRead", undefined)
            .returns("chatSessions.cancel", undefined)
            .returns("chatSessions.sendMessage", { executionId: -1, message: null });

        await api.install();
        await use(api);
    }, { auto: true }],

    // ── Default task ──────────────────────────────────────────────────────────
    task: async ({ }, use) => {
        await use(makeTask({ id: 1 }));
    },
});

export { expect };
