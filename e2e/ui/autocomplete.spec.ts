/**
 * autocomplete.spec.ts — E2E tests for chat input autocomplete.
 *
 * Migrated onto the CopilotChatInput surface (Phase 6, plan 06-06): slash
 * commands flow through the CopilotKit toolsMenu (engine.listCommands →
 * toToolsMenu → [data-testid="copilot-slash-menu"] — the canonical C-3
 * pattern), and the editor-behavior tests assert the
 * [data-testid="chat-input"] textarea instead of the legacy CodeMirror
 * surface.
 *
 * Each test uses a UNIQUE taskId: the command registry is cached per task
 * (useCommandsCache — module-level, 30-min TTL), so shared ids would serve
 * stale commands across tests in a Playwright worker.
 *
 * Suite AC — autocomplete UX (migrated):
 *   AC-1  `/` opens the slash command menu
 *   AC-2  Slash command list filters by query text
 *   AC-3  Selecting a slash command inserts it as plain text
 *   AC-10 Shift+Enter inserts newline instead of sending
 *   AC-11 Enter submits the message
 *   AC-12 Escape dismisses the slash menu
 *   AC-16 Empty slash command list shows no menu
 *   AC-21 Editor grows taller as content is added
 *   AC-22 Selecting a slash command inserts the full command atomically
 *   AC-25 `/` opens the menu in an editor with prior conversation content
 *   AC-29 Clicking a menu option with the mouse does not close the drawer
 *   AC-30 Commands are served from cache on second menu open (SWR)
 *
 * Retired in-file (AC-4..9, 13..15, 17..20, 23, 24, 26..28, 31..34 —
 * CodeMirror chips/#/@/LSP + attachments; chips removed with ChatEditor,
 * attachments out of scope CONT-01): see the retire block at the bottom.
 */

import { test, expect } from "./fixtures";
import { openTaskDrawer, chatTextarea, submitChatMessage } from "./fixtures";
import { makeTask } from "./fixtures/mock-data";

type CommandInfo = { name: string; description?: string; argumentHint?: string };

// ─── Suite AC — Autocomplete UX ──────────────────────────────────────────────

test.describe("AC — autocomplete", () => {
    test("AC-1: typing / opens the slash command menu", async ({ page, api }) => {
        const t = makeTask({ id: 4001, conversationId: 4001, title: "AC-1 Task" });
        api.handle("tasks.list", () => [t]);
        api.handle("engine.listCommands", () => [
            { name: "opsx-propose", description: "Propose a change" },
            { name: "opsx-apply", description: "Apply a change" },
        ]);

        await page.goto("/");
        await openTaskDrawer(page, t.id);
        await expect(chatTextarea(page)).toBeEnabled({ timeout: 10_000 });

        const input = chatTextarea(page);
        await input.click();
        await input.pressSequentially("/");

        const slashMenu = page.locator('[data-testid="copilot-slash-menu"]');
        await expect(slashMenu).toBeVisible({ timeout: 5_000 });
        await expect(slashMenu).toContainText("opsx-propose");
        await expect(slashMenu).toContainText("opsx-apply");
    });

    test("AC-2: slash command list filters as user types", async ({ page, api }) => {
        const t = makeTask({ id: 4002, conversationId: 4002, title: "AC-2 Task" });
        api.handle("tasks.list", () => [t]);
        api.handle("engine.listCommands", () => [
            { name: "opsx-propose" },
            { name: "opsx-apply" },
            { name: "unrelated-cmd" },
        ]);

        await page.goto("/");
        await openTaskDrawer(page, t.id);
        await expect(chatTextarea(page)).toBeEnabled({ timeout: 10_000 });

        const input = chatTextarea(page);
        await input.click();
        await input.pressSequentially("/propose");

        const slashMenu = page.locator('[data-testid="copilot-slash-menu"]');
        await expect(slashMenu).toBeVisible({ timeout: 5_000 });
        await expect(slashMenu).toContainText("opsx-propose");
        await expect(slashMenu).not.toContainText("unrelated-cmd");
    });

    test("AC-3: selecting a slash command inserts it as plain text", async ({ page, api }) => {
        const t = makeTask({ id: 4003, conversationId: 4003, title: "AC-3 Task" });
        api.handle("tasks.list", () => [t]);
        api.handle("engine.listCommands", () => [{ name: "opsx-apply", description: "Apply a change" }]);

        await page.goto("/");
        await openTaskDrawer(page, t.id);
        await expect(chatTextarea(page)).toBeEnabled({ timeout: 10_000 });

        const input = chatTextarea(page);
        await input.click();
        await input.pressSequentially("/opsx");

        const slashMenu = page.locator('[data-testid="copilot-slash-menu"]');
        await expect(slashMenu).toBeVisible({ timeout: 5_000 });
        await slashMenu.locator('[role="option"]', { hasText: "/opsx-apply" }).click();

        // The command inserts as plain text — no chip widget, no bracket markup.
        await expect(input).toHaveValue("/opsx-apply");
    });

    test("AC-10: Shift+Enter inserts newline instead of sending", async ({ page, api, agui }) => {
        const t = makeTask({ id: 4010, conversationId: 4010, title: "AC-10 Task" });
        api.handle("tasks.list", () => [t]);

        await page.goto("/");
        await openTaskDrawer(page, t.id);
        await expect(chatTextarea(page)).toBeEnabled({ timeout: 10_000 });

        const input = chatTextarea(page);
        await input.click();
        await input.pressSequentially("hello");
        await page.keyboard.press("Shift+Enter");

        // Newline lands in the textarea and nothing is submitted.
        await expect(input).toHaveValue(/hello\n/);
        expect(agui.runInputs).toHaveLength(0);
    });

    test("AC-11: Enter submits the message", async ({ page, api, agui }) => {
        const t = makeTask({ id: 4011, conversationId: 4011, title: "AC-11 Task" });
        api.handle("tasks.list", () => [t]);

        await page.goto("/");
        await openTaskDrawer(page, t.id);
        await expect(chatTextarea(page)).toBeEnabled({ timeout: 10_000 });

        const input = chatTextarea(page);
        await input.click();
        await input.pressSequentially("hello world");
        await page.keyboard.press("Enter");

        // Enter submits — the /run round-trip fires and the user turn renders.
        await expect.poll(() => agui.runInputs.length).toBe(1);
        const chat = page.locator('[data-testid="copilot-chat-view"]');
        await expect(chat).toContainText("hello world", { timeout: 10_000 });
    });

    test("AC-12: Escape dismisses the slash menu", async ({ page, api }) => {
        const t = makeTask({ id: 4012, conversationId: 4012, title: "AC-12 Task" });
        api.handle("tasks.list", () => [t]);
        api.handle("engine.listCommands", () => [{ name: "opsx-apply", description: "Apply" }]);

        await page.goto("/");
        await openTaskDrawer(page, t.id);
        await expect(chatTextarea(page)).toBeEnabled({ timeout: 10_000 });

        const input = chatTextarea(page);
        await input.click();
        await input.pressSequentially("/");

        const slashMenu = page.locator('[data-testid="copilot-slash-menu"]');
        await expect(slashMenu).toBeVisible({ timeout: 5_000 });
        await page.keyboard.press("Escape");

        await expect(slashMenu).not.toBeVisible();
    });

    test("AC-16: empty slash command list shows no menu", async ({ page, api }) => {
        const t = makeTask({ id: 4016, conversationId: 4016, title: "AC-16 Task" });
        api.handle("tasks.list", () => [t]);
        // No commands available — the menu affordance stays hidden entirely.
        api.returns("engine.listCommands", []);

        await page.goto("/");
        await openTaskDrawer(page, t.id);
        await expect(chatTextarea(page)).toBeEnabled({ timeout: 10_000 });

        const input = chatTextarea(page);
        await input.click();
        await input.pressSequentially("/");

        await expect(page.locator('[data-testid="copilot-slash-menu"]')).not.toBeVisible({ timeout: 2_000 });
    });

    test("AC-21: editor grows taller as content is added", async ({ page, api }) => {
        const t = makeTask({ id: 4021, conversationId: 4021, title: "AC-21 Task" });
        api.handle("tasks.list", () => [t]);

        await page.goto("/");
        await openTaskDrawer(page, t.id);
        await expect(chatTextarea(page)).toBeEnabled({ timeout: 10_000 });

        const input = chatTextarea(page);
        await input.click();
        const initialBox = await input.boundingBox();
        expect(initialBox).not.toBeNull();
        const initialHeight = initialBox!.height;

        // Type many lines to force the textarea to grow (auto-expand: the
        // input sets height = scrollHeight and flips to the expanded layout).
        for (let i = 0; i < 8; i++) {
            await input.pressSequentially(`Line ${i} of content that wraps`);
            await page.keyboard.press("Shift+Enter");
        }

        const grownBox = await input.boundingBox();
        expect(grownBox).not.toBeNull();
        expect(grownBox!.height).toBeGreaterThan(initialHeight);
    });

    test("AC-22: selecting a slash command inserts the full command atomically", async ({ page, api }) => {
        const t = makeTask({ id: 4022, conversationId: 4022, title: "AC-22 Task" });
        api.handle("tasks.list", () => [t]);
        api.handle("engine.listCommands", () => [{ name: "opsx-apply", description: "Apply a change" }]);

        await page.goto("/");
        await openTaskDrawer(page, t.id);
        await expect(chatTextarea(page)).toBeEnabled({ timeout: 10_000 });

        const input = chatTextarea(page);
        await input.click();
        await input.pressSequentially("/opsx");

        const slashMenu = page.locator('[data-testid="copilot-slash-menu"]');
        await expect(slashMenu).toBeVisible({ timeout: 5_000 });
        await slashMenu.locator('[role="option"]', { hasText: "/opsx-apply" }).click();

        // The WHOLE command text lands in the input — atomic insertion (no
        // partial "/opsx" residue, no bracket markup).
        await expect(input).toHaveValue("/opsx-apply");
    });

    test("AC-25: typing / after a prior exchange opens the slash menu", async ({ page, api }) => {
        const t = makeTask({ id: 4025, conversationId: 4025, title: "AC-25 Task" });
        api.handle("tasks.list", () => [t]);
        api.handle("engine.listCommands", () => [{ name: "deploy", description: "Deploy" }]);

        await page.goto("/");
        await openTaskDrawer(page, t.id);
        await expect(chatTextarea(page)).toBeEnabled({ timeout: 10_000 });

        // Complete an exchange first — the slash trigger must work in an
        // editor with prior conversation content (the legacy chip-then-slash
        // regression; chips are removed, the trigger intent survives).
        await submitChatMessage(page, "first message");
        const chat = page.locator('[data-testid="copilot-chat-view"]');
        await expect(chat).toContainText("hello", { timeout: 10_000 });

        const input = chatTextarea(page);
        await input.click();
        await input.pressSequentially("/");

        const slashMenu = page.locator('[data-testid="copilot-slash-menu"]');
        await expect(slashMenu).toBeVisible({ timeout: 5_000 });
        await expect(slashMenu).toContainText("deploy");
    });

    test("AC-29: clicking a menu option with the mouse does not close the task drawer", async ({ page, api }) => {
        const t = makeTask({ id: 4029, conversationId: 4029, title: "AC-29 Task" });
        api.handle("tasks.list", () => [t]);
        api.handle("engine.listCommands", () => [{ name: "deploy", description: "Deploy" }]);

        await page.goto("/");
        await openTaskDrawer(page, t.id);
        await expect(chatTextarea(page)).toBeEnabled({ timeout: 10_000 });

        const input = chatTextarea(page);
        await input.click();
        await input.pressSequentially("/dep");

        const slashMenu = page.locator('[data-testid="copilot-slash-menu"]');
        await expect(slashMenu).toBeVisible({ timeout: 5_000 });

        // Click the option with the mouse (mousedown is preventDefault'ed —
        // the textarea keeps focus and the drawer stays open).
        await slashMenu.locator('[role="option"]', { hasText: "/deploy" }).click();

        // The drawer must still be visible after the click.
        await expect(page.locator(".task-detail")).toBeVisible();
        await expect(input).toHaveValue("/deploy");
    });

    test("AC-30: commands are served from cache on second menu open (SWR)", async ({ page, api }) => {
        const t = makeTask({ id: 4030, conversationId: 4030, title: "AC-30 Task" });
        api.handle("tasks.list", () => [t]);
        const commands: CommandInfo[] = [{ name: "opsx-apply", description: "Apply" }];
        const calls = api.capture("engine.listCommands", commands);

        await page.goto("/");
        await openTaskDrawer(page, t.id);
        await expect(chatTextarea(page)).toBeEnabled({ timeout: 10_000 });

        const input = chatTextarea(page);
        await input.click();

        // First / — the registry was primed at drawer open (cold miss).
        await input.pressSequentially("/");
        const slashMenu = page.locator('[data-testid="copilot-slash-menu"]');
        await expect(slashMenu).toBeVisible({ timeout: 5_000 });
        await expect(slashMenu).toContainText("opsx-apply");

        // Backspace closes the menu; the second / reopens it from the cache —
        // no new API call within the TTL.
        await page.keyboard.press("Backspace");
        await expect(slashMenu).not.toBeVisible({ timeout: 3_000 });
        await input.pressSequentially("/");
        await expect(slashMenu).toBeVisible({ timeout: 5_000 });
        await expect(slashMenu).toContainText("opsx-apply");

        // Only one API call total — the second open was served from cache.
        expect(calls).toHaveLength(1);
    });
});

// ─── Retired tests (in-file rationale, plan 06-06 / T-06-24) ──────────────────
//
// The CodeMirror chip editor is removed (ChatEditor deleted with the Phase 5
// swap; chips were its widget API) and attachments are out of scope (CONT-01).
// Every retired test's subject → fate:
//
// AC-4, AC-5 — `#` file picker + chip insert: file chips removed with
//        ChatEditor (attachments out of scope CONT-01).
// AC-6, AC-7 — `@` MCP tool picker + chip insert: tool chips removed with
//        ChatEditor; MCP tool calls in chat render via the canonical T-1
//        default card.
// AC-8 — chips render as inline tokens: no chip widgets in CopilotChatInput.
// AC-9 — send with # chip emits an attachment: attachment plumbing removed
//        (CONT-01); plain-text send covered by AC-11.
// AC-13 — Backspace removes an entire chip atomically: no chips (see AC-4).
// AC-14 — LSP symbol chip emits a file attachment: LSP symbol picker removed
//        with ChatEditor (lsp.workspaceSymbol has no live consumer);
//        attachments out of scope CONT-01.
// AC-15 — LSP unavailable does not crash the file picker: the `#` picker
//        itself is removed (see AC-4).
// AC-17 — symbol chip renders as a visual token: no chip widgets (see AC-8).
// AC-18 — no MCP servers → `@` shows no dropdown: MCP picker removed (see
//        AC-6).
// AC-19 — `@` dropdown filters by tool name: MCP picker removed (see AC-6).
// AC-20 — chip is atomic — clicking inside it does not split it: no chips
//        (see AC-4).
// AC-23 — slash command chip is atomic — backspace removes the whole chip:
//        no chips; the slash-text atomic insert is covered by AC-22.
// AC-24 — `@` tools load when MCP server is running: MCP picker removed (see
//        AC-6).
// AC-26, AC-27 — `#`/`@` immediately after a chip opens the picker:
//        chip-trigger sequences removed with ChatEditor.
// AC-28 — multiple chips in sequence render correctly: no chips (see AC-4).
// AC-31 — slash chip serialization ([/opsx|/opsx] markup + engineContent):
//        chip markup removed; the plain slash-text insert is covered by
//        AC-3/AC-22.
// AC-32 — file chip serialization + attachment delivery: removed (see AC-9).
// AC-33 — MCP chip serialization (@fs:read_file): removed (see AC-6).
// AC-34 — adjacent slash + MCP chips serialize to separated engine text:
//        removed (see AC-6).
