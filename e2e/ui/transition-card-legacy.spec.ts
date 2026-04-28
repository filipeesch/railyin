/**
 * transition-card-legacy.spec.ts — Tests for legacy prompt row coexistence with transition cards.
 *
 * Suite: LC — legacy prompt row coexistence
 * Legacy messages (type: "user", role: "prompt") predate the transition_event type.
 * These tests verify both render correctly together without errors.
 */

import { test, expect } from "./fixtures";
import { openTaskDrawer } from "./fixtures";
import { makeUserMessage, makeTransitionMessage } from "./fixtures/mock-data";

test.describe("LC — legacy prompt row coexistence", () => {
    test("LC-1: user message with role 'prompt' renders .msg--prompt in conversation history", async ({ page, api, task }) => {
        const legacyMsg = makeUserMessage(task.id, "Original prompt text", { role: "prompt" });
        api.handle("conversations.getMessages", () => ({ messages: [legacyMsg], hasMore: false }));

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await expect(page.locator(".msg--prompt")).toBeVisible({ timeout: 3_000 });
        await expect(page.locator(".msg--prompt")).toContainText("Original prompt text");
        // Should NOT be rendered as a regular user bubble
        await expect(page.locator(".msg--user")).toHaveCount(0);
    });

    test("LC-2: timeline with both legacy prompt row and transition_event renders both without error", async ({ page, api, task }) => {
        const consoleErrors: string[] = [];
        page.on("console", msg => {
            if (msg.type() === "error") consoleErrors.push(msg.text());
        });

        const legacyMsg = makeUserMessage(task.id, "Legacy instruction", { role: "prompt" });
        const transitionMsg = makeTransitionMessage(task.id, {
            from: "Backlog",
            to: "Plan",
            instructionDetail: null,
        });
        api.handle("conversations.getMessages", () => ({
            messages: [legacyMsg, transitionMsg],
            hasMore: false,
        }));

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await expect(page.locator(".msg--prompt")).toBeVisible({ timeout: 3_000 });
        await expect(page.locator(".transition-card")).toBeVisible({ timeout: 3_000 });

        await expect(page.locator(".msg--prompt")).toHaveCount(1);
        await expect(page.locator(".transition-card")).toHaveCount(1);

        // No JS console errors (excluding benign favicon 404s)
        expect(consoleErrors.filter(e => !e.includes("favicon"))).toHaveLength(0);
    });
});
