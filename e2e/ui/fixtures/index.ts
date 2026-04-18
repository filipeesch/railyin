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
            .returns("tasks.contextUsage", { usedTokens: 0, maxTokens: 8192, fraction: 0 })
            .returns("todos.list", [])
            .returns("launch.getConfig", null)
            .returns("tasks.getChangedFiles", [])
            .returns("tasks.getGitStat", null)
            .returns("tasks.getPendingHunkSummary", [])
            .returns("projects.list", [])
            .returns("tasks.sessionMemory", { content: null });

        await api.install();
        await use(api);
    }, { auto: true }],

    // ── Default task ──────────────────────────────────────────────────────────
    task: async ({ }, use) => {
        await use(makeTask({ id: 1 }));
    },
});

export { expect };
