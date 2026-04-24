/**
 * mcp-tools.spec.ts — UI tests for the MCP Tools panel in the chat drawer.
 *
 * Suites:
 *   V-1  to V-3  — Button visibility and severity
 *   V-4  to V-5  — Popover open / drawer-close regression
 *   V-6  to V-11 — Popover content (empty state, server list, status dots)
 *   V-12 to V-14 — Tool checkbox state and toggling
 *   V-15 to V-16 — Reload buttons
 *   V-17 to V-23 — File editor overlay (mcp.json editing)
 *
 * Backend is fully mocked. Monaco is controlled via window.monaco evaluate().
 */

import { test, expect } from "./fixtures";
import { makeTask, makeMcpStatus } from "./fixtures/mock-data";
import type { Task } from "@shared/rpc-types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function openTaskDrawer(page: import("@playwright/test").Page, taskId: number) {
    await page.locator(`[data-task-id="${taskId}"]`).click();
    await expect(page.locator(".task-detail")).toBeVisible();
}

async function openMcpPopover(page: import("@playwright/test").Page) {
    await page.locator(".task-detail__mcp-btn").click();
    await expect(page.locator(".mcp-tools-popover")).toBeVisible();
}

async function expandServer(page: import("@playwright/test").Page, serverName?: string) {
    if (serverName) {
        await expect(page.locator(".mcp-tools-popover__server-name", { hasText: serverName })).toBeVisible();
        await page.locator(".mcp-tools-popover__server-name", { hasText: serverName }).click();
    } else {
        const chevrons = page.locator(".mcp-tools-popover__chevron");
        await expect(chevrons.first()).toBeVisible();
        const count = await chevrons.count();
        for (let index = 0; index < count; index += 1) {
            await chevrons.nth(index).click();
        }
    }
}

async function waitForMonaco(page: import("@playwright/test").Page) {
    // window.monaco is never set when using bundled Monaco — use the editor instance
    // exposed by FileEditorOverlay.vue as window.__mcpJsonEditor instead.
    await page.waitForFunction(() => !!(window as any).__mcpJsonEditor, { timeout: 10000 });
}

// ─── Suite V-1 to V-3 — Button visibility and severity ───────────────────────

test.describe("V — MCP button visibility and severity", () => {
    test("V-1: MCP button is always visible even when no servers are configured", async ({ page, api, task }) => {
        api.returns("mcp.getStatus", []);
        api.handle("tasks.list", () => [task]);

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await expect(page.locator(".task-detail__mcp-btn")).toBeVisible();
    });

    test("V-2: Button severity stays secondary when no server errors", async ({ page, api, task }) => {
        api.returns("mcp.getStatus", [makeMcpStatus({ state: "running" })]);
        api.handle("tasks.list", () => [task]);

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        const btn = page.locator(".task-detail__mcp-btn");
        await expect(btn).toBeVisible();
        await expect(btn).not.toHaveClass(/p-button-danger/);
    });

    test("V-3: Button severity is danger when any server has error state", async ({ page, api, task }) => {
        api.returns("mcp.getStatus", [makeMcpStatus({ state: "error", error: "connection refused" })]);
        api.handle("tasks.list", () => [task]);

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        const btn = page.locator(".task-detail__mcp-btn");
        await expect(btn).toBeVisible();
        await expect(btn).toHaveClass(/p-button-danger/);
    });
});

// ─── Suite V-4 to V-5 — Popover open / drawer-close regression ───────────────

test.describe("V — MCP popover open and drawer regression", () => {
    test("V-4: Clicking MCP button opens the popover", async ({ page, api, task }) => {
        api.returns("mcp.getStatus", []);
        api.handle("tasks.list", () => [task]);

        await page.goto("/");
        await openTaskDrawer(page, task.id);
        await openMcpPopover(page);

        await expect(page.locator(".mcp-tools-popover")).toBeVisible();
    });

    test("V-5: Clicking inside popover does NOT close the drawer (regression)", async ({ page, api, task }) => {
        api.returns("mcp.getStatus", []);
        api.returns("mcp.getConfig", { path: "/home/.railyin/mcp.json", content: '{"servers":[]}' });
        api.handle("tasks.list", () => [task]);

        await page.goto("/");
        await openTaskDrawer(page, task.id);
        await openMcpPopover(page);

        // Click the "Edit mcp.json" button inside the teleported popover
        await page.locator(".mcp-tools-popover__footer button").click();

        // Drawer must still be visible — this was the regression
        await expect(page.locator(".task-detail")).toBeVisible();
    });
});

// ─── Suite V-6 to V-11 — Popover content ─────────────────────────────────────

test.describe("V — MCP popover content", () => {
    test("V-6: Empty state shows 'No MCP servers configured' when servers=[]", async ({ page, api, task }) => {
        api.returns("mcp.getStatus", []);
        api.handle("tasks.list", () => [task]);

        await page.goto("/");
        await openTaskDrawer(page, task.id);
        await openMcpPopover(page);

        await expect(page.locator(".mcp-tools-popover__empty")).toContainText("No MCP servers configured");
    });

    test("V-7: Edit button is visible in empty state", async ({ page, api, task }) => {
        api.returns("mcp.getStatus", []);
        api.handle("tasks.list", () => [task]);

        await page.goto("/");
        await openTaskDrawer(page, task.id);
        await openMcpPopover(page);

        await expect(page.locator(".mcp-tools-popover__footer button:has-text('Edit mcp.json')")).toBeVisible();
    });

    test("V-8: Running server renders name, tool count, and green dot", async ({ page, api, task }) => {
        api.returns("mcp.getStatus", [makeMcpStatus({ name: "my-server", state: "running" })]);
        api.handle("tasks.list", () => [task]);

        await page.goto("/");
        await openTaskDrawer(page, task.id);
        await openMcpPopover(page);

        await expect(page.locator(".mcp-tools-popover__server-name")).toHaveText("my-server");
        // Tool rows visible after expanding (2 tools from makeMcpStatus default)
        await expandServer(page, "my-server");
        await expect(page.locator(".mcp-tools-popover__tool")).toHaveCount(2);
        await expect(page.locator(".mcp-tools-popover__server-dot--running")).toBeVisible();
    });

    test("V-9: Error server shows red dot and error message", async ({ page, api, task }) => {
        api.returns("mcp.getStatus", [
            makeMcpStatus({ state: "error", error: "connection refused", tools: [] }),
        ]);
        api.handle("tasks.list", () => [task]);

        await page.goto("/");
        await openTaskDrawer(page, task.id);
        await openMcpPopover(page);

        await expect(page.locator(".mcp-tools-popover__server-dot--error")).toBeVisible();
        await expect(page.locator(".mcp-tools-popover__server-error")).toContainText("connection refused");
    });

    test("V-10: Starting server shows starting dot", async ({ page, api, task }) => {
        api.returns("mcp.getStatus", [makeMcpStatus({ state: "starting", tools: [] })]);
        api.handle("tasks.list", () => [task]);

        await page.goto("/");
        await openTaskDrawer(page, task.id);
        await openMcpPopover(page);

        await expect(page.locator(".mcp-tools-popover__server-dot--starting")).toBeVisible();
    });

    test("V-11: Only running servers show tool checkboxes", async ({ page, api, task }) => {
        api.returns("mcp.getStatus", [
            makeMcpStatus({ name: "ok-server", state: "running" }),
            makeMcpStatus({ name: "bad-server", state: "error", tools: [] }),
        ]);
        api.handle("tasks.list", () => [task]);

        await page.goto("/");
        await openTaskDrawer(page, task.id);
        await openMcpPopover(page);

        // Expand ok-server to verify only one .mcp-tools-popover__tools section appears
        await expandServer(page, "ok-server");
        // Only one .mcp-tools-popover__tools section (the running server's)
        await expect(page.locator(".mcp-tools-popover__tools")).toHaveCount(1);
    });
});

// ─── Suite V-12 to V-14 — Tool checkbox state and toggling ───────────────────

test.describe("V — MCP tool checkboxes", () => {
    test("V-12: enabledMcpTools=null means all tools are checked", async ({ page, api, task }) => {
        const t = makeTask({ id: 1, enabledMcpTools: null });
        api.returns("mcp.getStatus", [makeMcpStatus()]);
        api.handle("tasks.list", () => [t]);

        await page.goto("/");
        await openTaskDrawer(page, t.id);
        await openMcpPopover(page);
        await expandServer(page);

        const checkboxes = page.locator(".mcp-tools-popover__tool .p-checkbox");
        await expect(checkboxes).toHaveCount(2);
        await expect(checkboxes.nth(0)).toHaveClass(/p-checkbox-checked/);
        await expect(checkboxes.nth(1)).toHaveClass(/p-checkbox-checked/);
    });

    test("V-13: enabledMcpTools=[toolA] means only toolA is checked", async ({ page, api, task }) => {
        const t = makeTask({ id: 1, enabledMcpTools: ["test-server:toolA"] });
        api.returns("mcp.getStatus", [makeMcpStatus()]);
        api.handle("tasks.list", () => [t]);

        await page.goto("/");
        await openTaskDrawer(page, t.id);
        await openMcpPopover(page);
        await expandServer(page);

        const checkboxes = page.locator(".mcp-tools-popover__tool .p-checkbox");
        await expect(checkboxes).toHaveCount(2);
        await expect(checkboxes.nth(0)).toHaveClass(/p-checkbox-checked/); // toolA
        await expect(checkboxes.nth(1)).not.toHaveClass(/p-checkbox-checked/); // toolB
    });

    test("V-14: Toggling a checkbox calls mcp.setTaskTools with updated list", async ({ page, api, task }) => {
        const t = makeTask({ id: 1, enabledMcpTools: null });
        const updatedTask = makeTask({ id: 1, enabledMcpTools: ["test-server:toolB"] });

        api.returns("mcp.getStatus", [makeMcpStatus()]);
        api.handle("tasks.list", () => [t]);
        const calls = api.capture("mcp.setTaskTools", updatedTask);

        await page.goto("/");
        await openTaskDrawer(page, t.id);
        await openMcpPopover(page);
        await expandServer(page);

        // Uncheck toolA (first checkbox) — click the PrimeVue wrapper, not the hidden input
        const checkboxes = page.locator(".mcp-tools-popover__tool .p-checkbox");
        await expect(checkboxes).toHaveCount(2);
        await checkboxes.nth(0).click();

        expect(calls).toHaveLength(1);
        expect(calls[0]).toMatchObject({ taskId: 1, enabledTools: ["test-server:toolB"] });
    });
});

// ─── Suite V-15 to V-16 — Reload buttons ─────────────────────────────────────

test.describe("V — MCP reload buttons", () => {
    test("V-15: Reload all button calls mcp.reload without serverName", async ({ page, api, task }) => {
        api.returns("mcp.getStatus", [makeMcpStatus()]);
        api.handle("tasks.list", () => [task]);
        const calls = api.capture("mcp.reload", []);

        await page.goto("/");
        await openTaskDrawer(page, task.id);
        await openMcpPopover(page);

        // First button in header is "Reload all"
        await page.locator(".mcp-tools-popover__header button").first().click();

        expect(calls).toHaveLength(1);
        expect(calls[0]).not.toHaveProperty("serverName");
    });

    test("V-16: Per-server reload button calls mcp.reload with serverName", async ({ page, api, task }) => {
        api.returns("mcp.getStatus", [makeMcpStatus({ name: "test-server" })]);
        api.handle("tasks.list", () => [task]);
        const calls = api.capture("mcp.reload", [makeMcpStatus({ name: "test-server" })]);

        await page.goto("/");
        await openTaskDrawer(page, task.id);
        await openMcpPopover(page);

        await page.locator(".mcp-tools-popover__server-reload").click();

        expect(calls).toHaveLength(1);
        expect(calls[0]).toMatchObject({ serverName: "test-server" });
    });
});

// ─── Suite V-17 to V-23 — File editor overlay ────────────────────────────────

test.describe("V — MCP file editor overlay", () => {
    async function openMcpEditor(
        page: import("@playwright/test").Page,
        api: import("./fixtures/mock-api").ApiMock,
        task: Task,
        content = '{"servers":[]}',
    ) {
        api.returns("mcp.getConfig", { path: "/home/.railyin/mcp.json", content });
        api.handle("tasks.list", () => [task]);

        await page.goto("/");
        await openTaskDrawer(page, task.id);
        await openMcpPopover(page);
        await page.locator(".mcp-tools-popover__footer button:has-text('Edit mcp.json')").click();
        await expect(page.locator(".file-editor-overlay")).toBeVisible();
    }

    test("V-17: Clicking 'Edit mcp.json' opens the FileEditorOverlay", async ({ page, api, task }) => {
        api.returns("mcp.getStatus", []);
        await openMcpEditor(page, api, task);
        await expect(page.locator(".file-editor-overlay")).toBeVisible();
    });

    test("V-18: Editor opens with content returned by mcp.getConfig", async ({ page, api, task }) => {
        api.returns("mcp.getStatus", []);
        const expectedContent = '{"servers":[],"_marker":true}';
        await openMcpEditor(page, api, task, expectedContent);
        await waitForMonaco(page);

        const value = await page.evaluate(() =>
            (window as any).__mcpJsonEditor?.getValue(),
        );
        expect(JSON.parse(value)["_marker"]).toBe(true);
    });

    test("V-19: No config file returns template with empty servers array", async ({ page, api, task }) => {
        api.returns("mcp.getStatus", []);
        // Backend always returns template when file missing — mock returns same
        await openMcpEditor(page, api, task, '{"servers":[]}');
        await waitForMonaco(page);

        const value = await page.evaluate(() =>
            (window as any).__mcpJsonEditor?.getValue(),
        );
        expect(JSON.parse(value)).toEqual({ servers: [] });
    });

    test("V-20: Valid JSON shows 'Valid JSON' and Save button is enabled", async ({ page, api, task }) => {
        api.returns("mcp.getStatus", []);
        await openMcpEditor(page, api, task, '{"servers":[]}');
        await waitForMonaco(page);

        await expect(page.locator(".file-editor-overlay__validation-valid")).toBeVisible();
        await expect(page.locator(".file-editor-overlay__validation-valid")).toContainText("Valid JSON");
        await expect(
            page.locator(".file-editor-overlay__actions button").last(),
        ).not.toBeDisabled();
    });

    test("V-21: Invalid JSON shows validation error and disables Save button", async ({ page, api, task }) => {
        api.returns("mcp.getStatus", []);
        await openMcpEditor(page, api, task, '{"servers":[]}');
        await waitForMonaco(page);

        // Inject invalid content via editor instance
        await page.evaluate(() => {
            (window as any).__mcpJsonEditor?.setValue("{invalid json {{");
        });

        await expect(page.locator(".file-editor-overlay__validation-error")).toBeVisible();
        await expect(
            page.locator(".file-editor-overlay__actions button").last(),
        ).toBeDisabled();
    });

    test("V-22: Clicking Save calls mcp.saveConfig with current editor content", async ({ page, api, task }) => {
        api.returns("mcp.getStatus", []);
        await openMcpEditor(page, api, task, '{"servers":[]}');
        const saveCalls = api.capture("mcp.saveConfig", undefined as unknown as void);
        await waitForMonaco(page);

        // Inject new valid content via editor instance
        await page.evaluate(() => {
            (window as any).__mcpJsonEditor?.setValue('{"servers":[],"_saved":true}');
        });

        // Wait for the save RPC to be intercepted before asserting
        // (emit → async parent handler → fetch is not awaited by click())
        const saveResponse = page.waitForResponse(r => r.url().includes("/api/mcp.saveConfig"));
        await page.locator(".file-editor-overlay__actions button:has-text('Save')").click();
        await saveResponse;

        expect(saveCalls).toHaveLength(1);
        expect(JSON.parse((saveCalls[0] as any).content)["_saved"]).toBe(true);
    });

    test("V-23: Cancel closes overlay without calling mcp.saveConfig", async ({ page, api, task }) => {
        api.returns("mcp.getStatus", []);
        await openMcpEditor(page, api, task, '{"servers":[]}');
        const saveCalls = api.capture("mcp.saveConfig", undefined as unknown as void);

        await page.locator(".file-editor-overlay__actions button:has-text('Cancel')").click();

        await expect(page.locator(".file-editor-overlay")).not.toBeVisible();
        expect(saveCalls).toHaveLength(0);
    });
});

// ─── Suite V-24 to V-26 — Tree behavior ──────────────────────────────────────

test.describe("V — MCP tree behavior", () => {
    test("V-24: Server checkbox checks all children", async ({ page, api, task }) => {
        const t = makeTask({ id: 1, enabledMcpTools: [] });
        const allChecked = makeTask({ id: 1, enabledMcpTools: null });
        api.returns("mcp.getStatus", [makeMcpStatus({ name: "test-server" })]);
        api.handle("tasks.list", () => [t]);
        const calls = api.capture("mcp.setTaskTools", allChecked);

        await page.goto("/");
        await openTaskDrawer(page, t.id);
        await openMcpPopover(page);

        // Check server-level checkbox → should enable all tools
        await page.locator(".mcp-tools-popover__server-row .p-checkbox").first().click();

        expect(calls).toHaveLength(1);
        expect(calls[0]).toMatchObject({ taskId: 1, enabledTools: null });
    });

    test("V-25: Server checkbox unchecks all children", async ({ page, api, task }) => {
        const t = makeTask({ id: 1, enabledMcpTools: null });
        const noneChecked = makeTask({ id: 1, enabledMcpTools: [] });
        api.returns("mcp.getStatus", [makeMcpStatus({ name: "test-server" })]);
        api.handle("tasks.list", () => [t]);
        const calls = api.capture("mcp.setTaskTools", noneChecked);

        await page.goto("/");
        await openTaskDrawer(page, t.id);
        await openMcpPopover(page);

        // Uncheck server-level checkbox → should disable all tools
        await page.locator(".mcp-tools-popover__server-row .p-checkbox").first().click();

        expect(calls).toHaveLength(1);
        expect(calls[0]).toMatchObject({ taskId: 1, enabledTools: [] });
    });

    test("V-26: Closing popover collapses all tree nodes", async ({ page, api, task }) => {
        api.returns("mcp.getStatus", [makeMcpStatus({ name: "test-server" })]);
        api.handle("tasks.list", () => [task]);

        await page.goto("/");
        await openTaskDrawer(page, task.id);
        await openMcpPopover(page);

        // Expand the server
        await expandServer(page, "test-server");
        await expect(page.locator(".mcp-tools-popover__tools")).toBeVisible();

        // Close the popover by clicking outside it (on the drawer header)
        await page.locator(".task-detail").click({ position: { x: 10, y: 10 } });
        await expect(page.locator(".mcp-tools-popover")).not.toBeVisible();

        // Reopen — tree should be collapsed
        await openMcpPopover(page);
        await expect(page.locator(".mcp-tools-popover__tools")).not.toBeVisible();
    });

    test("V-27: Popover stays within viewport after expanding a server", async ({ page, api, task }) => {
        // Use a small viewport to reproduce the overflow at the bottom
        await page.setViewportSize({ width: 1280, height: 500 });

        // Use many tools so content is tall when expanded
        const manyTools = Array.from({ length: 10 }, (_, i) => ({
            name: `tool${i}`,
            serverName: "test-server",
            qualifiedName: `mcp__test-server__tool${i}`,
            description: `Tool ${i}`,
            inputSchema: { type: "object" as const, properties: {} },
        }));
        api.returns("mcp.getStatus", [makeMcpStatus({ name: "test-server", tools: manyTools })]);
        api.handle("tasks.list", () => [task]);

        await page.goto("/");
        await openTaskDrawer(page, task.id);
        await openMcpPopover(page);
        await expandServer(page, "test-server");

        // Give the popover time to reposition
        await page.waitForTimeout(100);

        const popoverBox = await page.locator(".p-popover").boundingBox();
        const viewport = page.viewportSize()!;

        expect(popoverBox!.y + popoverBox!.height).toBeLessThanOrEqual(viewport.height + 1); // +1 for sub-pixel rounding
    });
});
