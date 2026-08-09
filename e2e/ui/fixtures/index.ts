/**
 * index.ts — Extended Playwright test fixture.
 *
 * Exports a `test` with the following auto-use fixtures:
 *
 *   api   — ApiMock instance with baseline workspace/board/models pre-registered.
 *            Tests add task-specific handlers before calling page.goto('/').
 *   ws    — WsMock instance, installed and ready to push server events.
 *   agui  — MockAgui instance intercepting /api/copilotkit/* (the CopilotRuntime
 *            AG-UI prefix) for the CopilotChat surface; ApiMock's
 *            route.fallback() hands /api/copilotkit/* to it (install order
 *            independent). Legacy specs never call /api/copilotkit/* so they
 *            are unaffected.
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
import { MockAgui } from "./mock-agui";
import { makeBoard, makeTask, makeWorkspace, makeChatSession } from "./mock-data";
import type { Task, ChatSession } from "@shared/rpc-types";

type Fixtures = {
    api: ApiMock;
    ws: WsMock;
    agui: MockAgui;
    task: Task;
    session: ChatSession;
};

export const test = base.extend<Fixtures>({
    // ── WsMock ─────────────────────────────────────────────────────────────────
    ws: [async ({ page }, use) => {
        const ws = new WsMock(page);
        await ws.install();
        await use(ws);
    }, { auto: true }],

    // ── MockAgui (CopilotRuntime AG-UI SSE) ────────────────────────────────────
    // Safe before/after api.install() — ApiMock's route.fallback() defers
    // /api/copilotkit/* to this fixture's route (mock-api.ts:95-98).
    agui: [async ({ page }, use) => {
        const agui = new MockAgui(page);
        await agui.install();
        await use(agui);
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
            .returns("conversations.getMessages", { messages: [], hasMore: false })
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
            .returns("lsp.detectLanguages", [])
            // Chat sessions — tests override as needed
            .returns("chatSessions.list", [])
            .returns("chatSessions.create", { id: 900, workspaceKey: "test-workspace", title: "New Chat", status: "idle", conversationId: 900, model: null, enabledMcpTools: null, samplingPresetOverride: null, lastActivityAt: new Date().toISOString(), lastReadAt: null, archivedAt: null, createdAt: new Date().toISOString() })
            .handle("chatSessions.get", ({ sessionId }) => ({
                id: sessionId,
                conversationId: sessionId,
                title: `Session ${sessionId}`,
                workspaceKey: "test-workspace",
                status: "idle",
                enabledMcpTools: null,
                lastActivityAt: new Date().toISOString(),
                lastReadAt: null,
                archivedAt: null,
                createdAt: new Date().toISOString(),
                model: null,
                samplingPresetOverride: null,
            }))
            .returns("chatSessions.getMessages", { messages: [], hasMore: false })
            .returns("chatSessions.rename", undefined)
            .returns("chatSessions.archive", undefined)
            .returns("chatSessions.markRead", undefined)
            .returns("chatSessions.cancel", undefined)
            .returns("chatSessions.sendMessage", { executionId: -1, message: null })
            // Workspace management endpoints
            .returns("workspace.update", {})
            .returns("workspace.create", { key: "new-workspace", name: "New Workspace" })
            .returns("workspace.resolveGitRoot", { gitRoot: "" })
            .returns("workspace.openFolderDialog", { path: null })
            .returns("projects.register", { key: "new-project", workspaceKey: "test-workspace", name: "New Project", projectPath: { absolute: "/tmp/new", relative: "new" }, gitRootPath: { absolute: "/tmp/new", relative: "new" }, defaultBranch: "main" })
            .returns("projects.update", { key: "test-project", workspaceKey: "test-workspace", name: "Test Project", projectPath: { absolute: "/home/user/projects/test", relative: "test" }, gitRootPath: { absolute: "/home/user/projects/test", relative: "test" }, defaultBranch: "main" })
            .returns("projects.delete", undefined)
            // Task deletion — tests override as needed
            .returns("tasks.delete", {})
            // Decision records — tests override as needed
            .returns("decisions.list", [])
            .returns("decisions.getRevisions", [])
            // Notes — tests override as needed
            .returns("notes.list", [])
            // Workflow setup — tests override as needed
            .returns("workflow.list", []);

        await api.install();
        await use(api);
    }, { auto: true }],

    // ── Default task ──────────────────────────────────────────────────────────
    task: async ({ }, use) => {
        await use(makeTask({ id: 1 }));
    },

    // ── Default session ───────────────────────────────────────────────────────
    session: async ({ }, use) => {
        await use(makeChatSession({ id: 500 }));
    },
});

export { expect };
// sendMessage / typeInSessionEditor were removed with the dead CodeMirror
// surface (IN-01 — see helpers.ts).
export { openTaskDrawer, openSidebar, openSessionDrawer, openSessionNotesTab, chatTextarea, submitChatMessage, collectConnectRequests } from "./helpers";
