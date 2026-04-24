/**
 * autocomplete.spec.ts — E2E tests for chat editor autocomplete.
 *
 * Suite AC — autocomplete UX:
 *   AC-1  `/` opens slash command picker
 *   AC-2  Slash command filtered by query text
 *   AC-3  Selecting a slash command inserts it as plain text
 *   AC-4  `#` opens file picker
 *   AC-5  `#` file result renders as chip after selection
 *   AC-6  `@` opens MCP tool picker
 *   AC-7  Selecting an MCP tool inserts a chip
 *   AC-8  Chip renders inline as a token (not raw syntax)
 *   AC-9  Send with a # chip emits an attachment
 *   AC-10 Shift+Enter inserts newline instead of sending
 *   AC-11 Enter submits the message
 *   AC-12 Escape dismisses the autocomplete dropdown
 *   AC-13 Backspace removes an entire chip atomically
 *   AC-14 Symbol chip (from LSP) emits a file attachment on send
 *   AC-15 LSP unavailable does not crash the file picker
 *   AC-16 Empty slash command list shows no dropdown
 *   AC-17 Symbol chip renders as visual token in editor
 *   AC-18 No MCP servers → @ sigil shows no dropdown
 *   AC-19 @ dropdown filters by tool name as user types
 *   AC-20 Chip cannot be partially edited (is atomic)
 *   AC-21 Editor grows taller as content is added
 */

import { test, expect } from "./fixtures";
import { makeUserMessage } from "./fixtures/mock-data";

type CommandInfo = { name: string; description?: string; argumentHint?: string };

const EXEC_ID = 2001;

async function openTaskDrawer(page: import("@playwright/test").Page, taskId: number) {
    await page.locator(`[data-task-id="${taskId}"]`).click();
    await expect(page.locator(".task-detail")).toBeVisible();
}

async function focusEditor(page: import("@playwright/test").Page) {
    await page.locator(".task-detail__input .cm-content").click();
}

// ─── Suite AC — Autocomplete UX ──────────────────────────────────────────────

test.describe("AC — autocomplete", () => {
    test("AC-1: typing / opens the slash command dropdown", async ({ page, api, task }) => {
        const commands: CommandInfo[] = [
            { name: "opsx-propose", description: "Propose a change" },
            { name: "opsx-apply", description: "Apply a change" },
        ];
        api.returns("engine.listCommands", commands);

        await page.goto("/");
        await openTaskDrawer(page, task.id);
        await focusEditor(page);
        await page.keyboard.type("/");

        await expect(page.locator(".cm-tooltip-autocomplete")).toBeVisible({ timeout: 3_000 });
        await expect(page.locator(".cm-tooltip-autocomplete")).toContainText("opsx-propose");
        await expect(page.locator(".cm-tooltip-autocomplete")).toContainText("opsx-apply");
    });

    test("AC-2: slash command list filters as user types", async ({ page, api, task }) => {
        const commands: CommandInfo[] = [
            { name: "opsx-propose" },
            { name: "opsx-apply" },
            { name: "unrelated-cmd" },
        ];
        api.returns("engine.listCommands", commands);

        await page.goto("/");
        await openTaskDrawer(page, task.id);
        await focusEditor(page);
        await page.keyboard.type("/propose");

        const dropdown = page.locator(".cm-tooltip-autocomplete");
        await expect(dropdown).toBeVisible({ timeout: 3_000 });
        await expect(dropdown).toContainText("opsx-propose");
        await expect(dropdown).not.toContainText("unrelated-cmd");
    });

    test("AC-3: selecting a slash command inserts it as an atomic chip", async ({ page, api, task }) => {
        api.returns("engine.listCommands", [{ name: "opsx-apply" }]);

        await page.goto("/");
        await openTaskDrawer(page, task.id);
        await focusEditor(page);
        await page.keyboard.type("/opsx");

        const dropdown = page.locator(".cm-tooltip-autocomplete");
        await expect(dropdown).toBeVisible({ timeout: 3_000 });
        await expect(dropdown.locator("[aria-selected]")).toBeVisible({ timeout: 1_000 });
        await page.keyboard.press("Enter"); // select first completion

        // Slash command must render as a chip widget with the command label
        const chip = page.locator(".task-detail__input .chat-editor__chip");
        await expect(chip).toBeVisible({ timeout: 2_000 });
        await expect(chip).toContainText("opsx-apply");

        // Raw bracket syntax must not be visible in the DOM text
        const text = await page.locator(".task-detail__input .cm-content").textContent();
        expect(text).not.toContain("[");
    });

    test("AC-4: typing # opens file picker", async ({ page, api, task }) => {
        api.returns("workspace.listFiles", [
            { name: "app.ts", path: "src/app.ts" },
            { name: "utils.ts", path: "src/utils.ts" },
        ]);
        api.returns("lsp.workspaceSymbol", []);

        await page.goto("/");
        await openTaskDrawer(page, task.id);
        await focusEditor(page);
        await page.keyboard.type("#");

        await expect(page.locator(".cm-tooltip-autocomplete")).toBeVisible({ timeout: 3_000 });
        await expect(page.locator(".cm-tooltip-autocomplete")).toContainText("app.ts");
        await expect(page.locator(".cm-tooltip-autocomplete")).toContainText("utils.ts");
    });

    test("AC-5: selecting a file inserts it as a chip token", async ({ page, api, task }) => {
        api.returns("workspace.listFiles", [{ name: "app.ts", path: "src/app.ts" }]);
        api.returns("lsp.workspaceSymbol", []);

        await page.goto("/");
        await openTaskDrawer(page, task.id);
        await focusEditor(page);
        await page.keyboard.type("#app");

        await expect(page.locator(".cm-tooltip-autocomplete")).toBeVisible({ timeout: 3_000 });
        await expect(page.locator(".cm-tooltip-autocomplete [aria-selected]")).toBeVisible({ timeout: 1_000 });
        await page.keyboard.press("Enter");

        // The chip should render as a decorated token (not raw bracket syntax)
        await expect(page.locator(".task-detail__input .chat-editor__chip")).toBeVisible({ timeout: 2_000 });
        await expect(page.locator(".task-detail__input .chat-editor__chip")).toContainText("app.ts");
    });

    test("AC-6: typing @ opens MCP tool picker", async ({ page, api, task }) => {
        api.returns("mcp.getStatus", [
            {
                name: "filesystem",
                state: "running",
                tools: [
                    { name: "read_file", description: "Read a file" },
                    { name: "write_file", description: "Write a file" },
                ],
            },
        ]);

        await page.goto("/");
        await openTaskDrawer(page, task.id);
        await focusEditor(page);
        await page.keyboard.type("@");

        await expect(page.locator(".cm-tooltip-autocomplete")).toBeVisible({ timeout: 3_000 });
        await expect(page.locator(".cm-tooltip-autocomplete")).toContainText("read_file");
        await expect(page.locator(".cm-tooltip-autocomplete")).toContainText("write_file");
    });

    test("AC-7: selecting an @ tool inserts a chip", async ({ page, api, task }) => {
        api.returns("mcp.getStatus", [
            {
                name: "fs",
                state: "running",
                tools: [{ name: "read_file" }],
            },
        ]);

        await page.goto("/");
        await openTaskDrawer(page, task.id);
        await focusEditor(page);
        await page.keyboard.type("@read");

        await expect(page.locator(".cm-tooltip-autocomplete")).toBeVisible({ timeout: 3_000 });
        await expect(page.locator(".cm-tooltip-autocomplete [aria-selected]")).toBeVisible({ timeout: 1_000 });
        await page.keyboard.press("Enter");

        await expect(page.locator(".task-detail__input .chat-editor__chip")).toBeVisible({ timeout: 2_000 });
        await expect(page.locator(".task-detail__input .chat-editor__chip")).toContainText("read_file");
    });

    test("AC-8: chips render as inline tokens (not raw [#...] syntax)", async ({ page, api, task }) => {
        api.returns("workspace.listFiles", [{ name: "config.ts", path: "src/config.ts" }]);
        api.returns("lsp.workspaceSymbol", []);

        await page.goto("/");
        await openTaskDrawer(page, task.id);
        await focusEditor(page);
        await page.keyboard.type("#config");

        await expect(page.locator(".cm-tooltip-autocomplete")).toBeVisible({ timeout: 3_000 });
        await expect(page.locator(".cm-tooltip-autocomplete [aria-selected]")).toBeVisible({ timeout: 1_000 });
        await page.keyboard.press("Enter");

        // Raw chip syntax should not be visible in the DOM text
        const editorText = await page.locator(".task-detail__input .cm-content").textContent();
        expect(editorText).not.toContain("[#src/config.ts|config.ts]");
        // But a chip widget should be rendered
        await expect(page.locator(".chat-editor__chip")).toBeVisible();
    });

    test("AC-9: send with # chip emits file attachment", async ({ page, api, task }) => {
        api.returns("workspace.listFiles", [{ name: "service.ts", path: "src/service.ts" }]);
        api.returns("lsp.workspaceSymbol", []);

        let capturedAttachments: unknown[] | undefined;
        api.handle("tasks.sendMessage", (params: { attachments?: unknown[] }) => {
            capturedAttachments = params.attachments;
            return {
                message: makeUserMessage(task.id, "check service.ts"),
                executionId: EXEC_ID,
            };
        });

        await page.goto("/");
        await openTaskDrawer(page, task.id);
        await focusEditor(page);
        await page.keyboard.type("#service");

        await expect(page.locator(".cm-tooltip-autocomplete")).toBeVisible({ timeout: 3_000 });
        await expect(page.locator(".cm-tooltip-autocomplete [aria-selected]")).toBeVisible({ timeout: 1_000 });
        await page.keyboard.press("Enter"); // select file

        // Now send (click send button)
        const sendResponsePromise = page.waitForResponse("**/api/tasks.sendMessage");
        await page.locator(".task-detail__input button:has(.pi-send)").click();
        await sendResponsePromise;

        // Verify an attachment was included
        expect(capturedAttachments).toBeDefined();
        expect(capturedAttachments!.length).toBeGreaterThan(0);
        const att = capturedAttachments![0] as { data: string; label: string };
        expect(att.data).toBe("@file:src/service.ts");
        expect(att.label).toBe("service.ts");
    });

    test("AC-10: Shift+Enter inserts newline instead of sending", async ({ page, api, task }) => {
        let sendCalled = false;
        api.handle("tasks.sendMessage", () => {
            sendCalled = true;
            return { message: makeUserMessage(task.id, "hello"), executionId: EXEC_ID };
        });

        await page.goto("/");
        await openTaskDrawer(page, task.id);
        await focusEditor(page);
        await page.keyboard.type("hello");
        await page.keyboard.press("Shift+Enter");

        // Should not have sent
        expect(sendCalled).toBe(false);

        // Editor should have two lines
        const lines = await page.locator(".task-detail__input .cm-line").count();
        expect(lines).toBeGreaterThanOrEqual(2);
    });

    test("AC-11: Enter submits the message", async ({ page, api, task }) => {
        let capturedParams: { taskId: number; content: string } | undefined;
        api.handle("tasks.sendMessage", (params: { taskId: number; content: string }) => {
            capturedParams = params;
            return { message: makeUserMessage(task.id, "hello world"), executionId: EXEC_ID };
        });

        await page.goto("/");
        await openTaskDrawer(page, task.id);
        await focusEditor(page);
        await page.keyboard.type("hello world");

        // Set up response waiter before the action that triggers it
        const responsePromise = page.waitForResponse("**/api/tasks.sendMessage");
        await page.keyboard.press("Enter");
        await responsePromise; // wait for the API call to complete

        expect(capturedParams).toBeDefined();
        expect(capturedParams!.content).toContain("hello world");
    });

    test("AC-12: Escape dismisses the autocomplete dropdown", async ({ page, api, task }) => {
        api.returns("engine.listCommands", [{ name: "opsx-apply", description: "Apply" }]);

        await page.goto("/");
        await openTaskDrawer(page, task.id);
        await focusEditor(page);
        await page.keyboard.type("/");

        await expect(page.locator(".cm-tooltip-autocomplete")).toBeVisible({ timeout: 3_000 });
        await page.keyboard.press("Escape");

        await expect(page.locator(".cm-tooltip-autocomplete")).not.toBeVisible();
    });

    test("AC-13: Backspace removes an entire chip atomically", async ({ page, api, task }) => {
        api.returns("workspace.listFiles", [{ name: "app.ts", path: "src/app.ts" }]);
        api.returns("lsp.workspaceSymbol", []);

        await page.goto("/");
        await openTaskDrawer(page, task.id);
        await focusEditor(page);
        await page.keyboard.type("#app");

        await expect(page.locator(".cm-tooltip-autocomplete")).toBeVisible({ timeout: 3_000 });
        await expect(page.locator(".cm-tooltip-autocomplete [aria-selected]")).toBeVisible({ timeout: 1_000 });
        await page.keyboard.press("Enter"); // insert chip

        await expect(page.locator(".task-detail__input .chat-editor__chip")).toBeVisible({ timeout: 2_000 });

        // Single Backspace should atomically remove the whole chip
        await page.keyboard.press("Backspace");

        await expect(page.locator(".task-detail__input .chat-editor__chip")).not.toBeVisible({ timeout: 2_000 });
        // No chip raw syntax in the DOM either
        const text = await page.locator(".task-detail__input .cm-content").textContent();
        expect(text).not.toContain("[#src/app.ts");
    });

    test("AC-14: symbol chip (from LSP) emits a file attachment on send", async ({ page, api, task }) => {
        api.returns("workspace.listFiles", []);
        api.returns("lsp.workspaceSymbol", [
            { name: "MyClass", location: { uri: "file:///src/service.ts" } },
        ]);

        let capturedAttachments: unknown[] | undefined;
        api.handle("tasks.sendMessage", (params: { attachments?: unknown[] }) => {
            capturedAttachments = params.attachments;
            return { message: makeUserMessage(task.id, "check MyClass"), executionId: EXEC_ID };
        });

        await page.goto("/");
        await openTaskDrawer(page, task.id);
        await focusEditor(page);
        await page.keyboard.type("#MyC"); // >=2 chars after # triggers LSP

        await expect(page.locator(".cm-tooltip-autocomplete")).toBeVisible({ timeout: 3_000 });
        await expect(page.locator(".cm-tooltip-autocomplete [aria-selected]")).toBeVisible({ timeout: 1_000 });
        await page.keyboard.press("Enter"); // select first (MyClass)

        await expect(page.locator(".task-detail__input .chat-editor__chip")).toBeVisible({ timeout: 2_000 });

        const sendResponsePromise = page.waitForResponse("**/api/tasks.sendMessage");
        await page.locator(".task-detail__input button:has(.pi-send)").click();
        await sendResponsePromise;

        expect(capturedAttachments).toBeDefined();
        expect(capturedAttachments!.length).toBeGreaterThan(0);
        const att = capturedAttachments![0] as { data: string; label: string };
        expect(att.data).toContain("@file:");
        expect(att.data).toContain("src/service.ts");
        expect(att.label).toBe("MyClass");
    });

    test("AC-15: LSP unavailable does not crash the file picker", async ({ page, api, task }) => {
        api.returns("workspace.listFiles", [{ name: "app.ts", path: "src/app.ts" }]);
        // Simulate an LSP error — mock throws → 500 → api() rejects → allSettled catches it
        api.handle("lsp.workspaceSymbol", () => { throw new Error("LSP unavailable"); });

        await page.goto("/");
        await openTaskDrawer(page, task.id);
        await focusEditor(page);
        await page.keyboard.type("#ap"); // 2 chars to trigger LSP path

        // File picker should still open with file results despite LSP failure
        await expect(page.locator(".cm-tooltip-autocomplete")).toBeVisible({ timeout: 3_000 });
        await expect(page.locator(".cm-tooltip-autocomplete")).toContainText("app.ts");
    });

    test("AC-16: empty slash command list shows no dropdown", async ({ page, api, task }) => {
        // No commands available
        api.returns("engine.listCommands", []);

        await page.goto("/");
        await openTaskDrawer(page, task.id);
        await focusEditor(page);
        await page.keyboard.type("/");

        // Dropdown should not appear
        await expect(page.locator(".cm-tooltip-autocomplete")).not.toBeVisible({ timeout: 1_000 });
    });

    test("AC-17: symbol chip renders as a visual token in the editor", async ({ page, api, task }) => {
        api.returns("workspace.listFiles", []);
        api.returns("lsp.workspaceSymbol", [
            { name: "UserService", location: { uri: "file:///src/service.ts" } },
        ]);

        await page.goto("/");
        await openTaskDrawer(page, task.id);
        await focusEditor(page);
        await page.keyboard.type("#UserS"); // >=2 chars triggers LSP

        await expect(page.locator(".cm-tooltip-autocomplete [aria-selected]")).toBeVisible({ timeout: 3_000 });
        await page.keyboard.press("Enter");

        // A chip widget should be visible with the symbol label
        const chip = page.locator(".task-detail__input .chat-editor__chip");
        await expect(chip).toBeVisible({ timeout: 2_000 });
        await expect(chip).toContainText("UserService");
    });

    test("AC-18: no MCP servers connected → @ shows no dropdown", async ({ page, api, task }) => {
        // Server is not running — no tools should appear
        api.returns("mcp.getStatus", [{ name: "server1", state: "error", tools: [] }]);

        await page.goto("/");
        await openTaskDrawer(page, task.id);
        await focusEditor(page);
        await page.keyboard.type("@");

        await expect(page.locator(".cm-tooltip-autocomplete")).not.toBeVisible({ timeout: 1_000 });
    });

    test("AC-19: @ dropdown filters by tool name as user types", async ({ page, api, task }) => {
        api.returns("mcp.getStatus", [
            {
                name: "filesystem",
                state: "running",
                tools: [
                    { name: "read_file", description: "Read a file" },
                    { name: "write_file", description: "Write a file" },
                    { name: "list_dir", description: "List directory" },
                ],
            },
        ]);

        await page.goto("/");
        await openTaskDrawer(page, task.id);
        await focusEditor(page);

        // Type @write — should only show write_file
        await page.keyboard.type("@write");
        await expect(page.locator(".cm-tooltip-autocomplete")).toBeVisible({ timeout: 3_000 });
        await expect(page.locator(".cm-tooltip-autocomplete")).toContainText("write_file");
        await expect(page.locator(".cm-tooltip-autocomplete")).not.toContainText("read_file");
        await expect(page.locator(".cm-tooltip-autocomplete")).not.toContainText("list_dir");
    });

    test("AC-20: chip is atomic — clicking inside it does not split it", async ({ page, api, task }) => {
        api.returns("workspace.listFiles", [{ name: "config.ts", path: "src/config.ts" }]);
        api.returns("lsp.workspaceSymbol", []);

        await page.goto("/");
        await openTaskDrawer(page, task.id);
        await focusEditor(page);
        await page.keyboard.type("#conf");

        await expect(page.locator(".cm-tooltip-autocomplete [aria-selected]")).toBeVisible({ timeout: 3_000 });
        await page.keyboard.press("Enter"); // insert chip

        const chip = page.locator(".task-detail__input .chat-editor__chip");
        await expect(chip).toBeVisible({ timeout: 2_000 });

        // Click in the middle of the chip
        const box = await chip.boundingBox();
        if (box) {
            await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        }

        // The chip widget should still be present (not split into raw text)
        await expect(chip).toBeVisible();
        const editorText = await page.locator(".task-detail__input .cm-content").textContent();
        expect(editorText).not.toContain("[#");
    });

    test("AC-21: editor height grows as content is added", async ({ page, api, task }) => {
        await page.goto("/");
        await openTaskDrawer(page, task.id);
        await focusEditor(page);

        const editor = page.locator(".task-detail__input .cm-content");
        const initialBox = await editor.boundingBox();
        expect(initialBox).not.toBeNull();
        const initialHeight = initialBox!.height;

        // Type many lines to force the editor to grow
        for (let i = 0; i < 8; i++) {
            await page.keyboard.type(`Line ${i} of content that wraps`);
            await page.keyboard.press("Shift+Enter");
        }

        const grownBox = await editor.boundingBox();
        expect(grownBox).not.toBeNull();
        expect(grownBox!.height).toBeGreaterThan(initialHeight);
    });

    // ── Regression tests for bugs found in manual testing ──────────────────

    test("AC-22: selecting a slash command inserts it as an atomic chip token", async ({ page, api, task }) => {
        api.returns("engine.listCommands", [{ name: "opsx-apply", description: "Apply a change" }]);

        await page.goto("/");
        await openTaskDrawer(page, task.id);
        await focusEditor(page);
        await page.keyboard.type("/opsx");

        await expect(page.locator(".cm-tooltip-autocomplete [aria-selected]")).toBeVisible({ timeout: 3_000 });
        await page.keyboard.press("Enter");

        // Slash command must render as a chip widget, not raw text
        const chip = page.locator(".task-detail__input .chat-editor__chip");
        await expect(chip).toBeVisible({ timeout: 2_000 });
        await expect(chip).toContainText("opsx-apply");

        // Raw bracket syntax must not appear in the DOM text
        const text = await page.locator(".task-detail__input .cm-content").textContent();
        expect(text).not.toContain("[");
    });

    test("AC-23: slash command chip is atomic — backspace removes the whole chip", async ({ page, api, task }) => {
        api.returns("engine.listCommands", [{ name: "deploy", description: "Deploy" }]);

        await page.goto("/");
        await openTaskDrawer(page, task.id);
        await focusEditor(page);
        await page.keyboard.type("/dep");

        await expect(page.locator(".cm-tooltip-autocomplete [aria-selected]")).toBeVisible({ timeout: 3_000 });
        await page.keyboard.press("Enter"); // insert chip

        const chip = page.locator(".task-detail__input .chat-editor__chip");
        await expect(chip).toBeVisible({ timeout: 2_000 });

        // One Backspace should remove the entire chip (atomic), not just the last char
        await page.keyboard.press("Backspace");
        await expect(chip).not.toBeVisible({ timeout: 1_000 });

        // Raw bracket syntax must not remain in the editor document
        const text = await page.locator(".task-detail__input .cm-content").textContent();
        expect(text).not.toContain("[/");
    });

    test("AC-24: @ tools load when MCP server state is 'running'", async ({ page, api, task }) => {
        // Uses real McpServerStatus shape: state (not status), value "running" (not "connected")
        api.returns("mcp.getStatus", [
            {
                name: "filesystem",
                state: "running",
                tools: [{ name: "read_file", description: "Read a file", inputSchema: { type: "object", properties: {} } }],
            },
        ]);

        await page.goto("/");
        await openTaskDrawer(page, task.id);
        await focusEditor(page);
        await page.keyboard.type("@");

        // The dropdown must appear with the tool from the running server
        await expect(page.locator(".cm-tooltip-autocomplete")).toBeVisible({ timeout: 3_000 });
        await expect(page.locator(".cm-tooltip-autocomplete")).toContainText("read_file");
    });

    // ── Trigger-after-chip regression tests ────────────────────────────────────

    test("AC-25: typing / immediately after a chip (no space) opens slash dropdown", async ({ page, api, task }) => {
        api.returns("workspace.listFiles", [{ name: "app.ts", path: "src/app.ts" }]);
        api.returns("lsp.workspaceSymbol", []);
        api.returns("engine.listCommands", [{ name: "deploy", description: "Deploy" }]);

        await page.goto("/");
        await openTaskDrawer(page, task.id);
        await focusEditor(page);

        // Insert a file chip
        await page.keyboard.type("#app");
        await expect(page.locator(".cm-tooltip-autocomplete [aria-selected]")).toBeVisible({ timeout: 3_000 });
        await page.keyboard.press("Enter");
        await expect(page.locator(".task-detail__input .chat-editor__chip")).toBeVisible({ timeout: 2_000 });

        // Type / immediately after chip (no space) — dropdown must open
        await page.keyboard.type("/");
        await expect(page.locator(".cm-tooltip-autocomplete")).toBeVisible({ timeout: 3_000 });
        await expect(page.locator(".cm-tooltip-autocomplete")).toContainText("deploy");
    });

    test("AC-26: typing # immediately after a chip (no space) opens file picker", async ({ page, api, task }) => {
        api.returns("workspace.listFiles", [
            { name: "app.ts", path: "src/app.ts" },
            { name: "utils.ts", path: "src/utils.ts" },
        ]);
        api.returns("lsp.workspaceSymbol", []);

        await page.goto("/");
        await openTaskDrawer(page, task.id);
        await focusEditor(page);

        // Insert first file chip
        await page.keyboard.type("#app");
        await expect(page.locator(".cm-tooltip-autocomplete [aria-selected]")).toBeVisible({ timeout: 3_000 });
        await page.keyboard.press("Enter");
        await expect(page.locator(".task-detail__input .chat-editor__chip")).toBeVisible({ timeout: 2_000 });

        // Type # immediately after chip — second picker must open
        await page.keyboard.type("#utils");
        await expect(page.locator(".cm-tooltip-autocomplete")).toBeVisible({ timeout: 3_000 });
        await expect(page.locator(".cm-tooltip-autocomplete")).toContainText("utils.ts");
    });

    test("AC-27: typing @ immediately after a chip (no space) opens tool picker", async ({ page, api, task }) => {
        api.returns("workspace.listFiles", [{ name: "app.ts", path: "src/app.ts" }]);
        api.returns("lsp.workspaceSymbol", []);
        api.returns("mcp.getStatus", [{
            name: "fs", state: "running",
            tools: [{ name: "read_file", description: "Read a file" }],
        }]);

        await page.goto("/");
        await openTaskDrawer(page, task.id);
        await focusEditor(page);

        // Insert a file chip
        await page.keyboard.type("#app");
        await expect(page.locator(".cm-tooltip-autocomplete [aria-selected]")).toBeVisible({ timeout: 3_000 });
        await page.keyboard.press("Enter");
        await expect(page.locator(".task-detail__input .chat-editor__chip")).toBeVisible({ timeout: 2_000 });

        // Type @ immediately after chip — tool picker must open
        await page.keyboard.type("@");
        await expect(page.locator(".cm-tooltip-autocomplete")).toBeVisible({ timeout: 3_000 });
        await expect(page.locator(".cm-tooltip-autocomplete")).toContainText("read_file");
    });

    test("AC-28: multiple chips in sequence separated by spaces all render correctly", async ({ page, api, task }) => {
        api.returns("workspace.listFiles", [
            { name: "app.ts", path: "src/app.ts" },
            { name: "utils.ts", path: "src/utils.ts" },
        ]);
        api.returns("lsp.workspaceSymbol", []);

        await page.goto("/");
        await openTaskDrawer(page, task.id);
        await focusEditor(page);

        // Insert first chip
        await page.keyboard.type("#app");
        await expect(page.locator(".cm-tooltip-autocomplete [aria-selected]")).toBeVisible({ timeout: 3_000 });
        await page.keyboard.press("Enter");

        // Space between chips
        await page.keyboard.type(" ");

        // Insert second chip
        await page.keyboard.type("#utils");
        await expect(page.locator(".cm-tooltip-autocomplete [aria-selected]")).toBeVisible({ timeout: 3_000 });
        await page.keyboard.press("Enter");

        // Both chips must render as tokens
        const chips = page.locator(".task-detail__input .chat-editor__chip");
        await expect(chips).toHaveCount(2, { timeout: 2_000 });
        await expect(chips.nth(0)).toContainText("app.ts");
        await expect(chips.nth(1)).toContainText("utils.ts");
    });

    test("AC-29: clicking a completion item with the mouse does not close the task drawer", async ({ page, api, task }) => {
        api.returns("engine.listCommands", [{ name: "deploy", description: "Deploy" }]);

        await page.goto("/");
        await openTaskDrawer(page, task.id);
        await focusEditor(page);

        await page.keyboard.type("/dep");
        const dropdown = page.locator(".cm-tooltip-autocomplete");
        await expect(dropdown).toBeVisible({ timeout: 3_000 });

        // Click the item with the mouse instead of pressing Enter
        await dropdown.locator("[role='option'], li").first().click();

        // The drawer must still be visible after the click
        await expect(page.locator(".p-drawer")).toBeVisible({ timeout: 1_000 });
    });

    test("AC-30: commands are served from cache on second dropdown open (SWR)", async ({ page, api, task }) => {
        const commands: CommandInfo[] = [{ name: "opsx-apply", description: "Apply" }];
        const calls = api.capture("engine.listCommands", commands);

        await page.goto("/");
        await openTaskDrawer(page, task.id);
        await focusEditor(page);

        // First / — triggers API fetch (cold miss)
        await page.keyboard.type("/");
        await expect(page.locator(".cm-tooltip-autocomplete")).toBeVisible({ timeout: 3_000 });
        await expect(page.locator(".cm-tooltip-autocomplete")).toContainText("opsx-apply");
        await page.keyboard.press("Backspace");
        await expect(page.locator(".cm-tooltip-autocomplete")).not.toBeVisible({ timeout: 3_000 });

        // Second / — cache hit, no new API call within TTL
        await page.keyboard.type("/");
        await expect(page.locator(".cm-tooltip-autocomplete")).toBeVisible({ timeout: 3_000 });
        await expect(page.locator(".cm-tooltip-autocomplete")).toContainText("opsx-apply");

        // Only one API call total — second open was served from cache
        expect(calls).toHaveLength(1);
    });
});
