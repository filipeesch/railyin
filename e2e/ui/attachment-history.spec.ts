/**
 * attachment-history.spec.ts — Tests for file attachment chip rendering in conversation history.
 *
 * Suite: AH — attachment chip rendering in history
 *
 * Attachment chips in history are embedded in message content via chip syntax
 * [#ref|label] and rendered by InlineChipText with .inline-chip-text__chip--file class.
 * Note: metadata.attachments stores binary data for the AI engine, not for UI display.
 */

import { test, expect } from "./fixtures";
import { openTaskDrawer } from "./fixtures";
import { makeUserMessage } from "./fixtures/mock-data";

test.describe("AH — attachment chip rendering in history", () => {
    test("AH-1: file chip syntax in message content renders a chip in the conversation bubble", async ({ page, api, task }) => {
        const msg = makeUserMessage(task.id, "Check out [#README.md|#README.md] for details");
        api.handle("conversations.getMessages", () => ({ messages: [msg], hasMore: false }));

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await expect(page.locator(".msg--user .inline-chip-text__chip--file")).toHaveCount(1);
        await expect(page.locator(".msg--user .inline-chip-text__chip--file")).toContainText("README.md");
    });

    test("AH-2: two file chip references in content render two chips", async ({ page, api, task }) => {
        const msg = makeUserMessage(task.id, "See [#src/app.ts|#app.ts] and [#README.md|#README.md]");
        api.handle("conversations.getMessages", () => ({ messages: [msg], hasMore: false }));

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await expect(page.locator(".msg--user .inline-chip-text__chip--file")).toHaveCount(2);
    });

    test("AH-3: message without chip syntax renders no file chips", async ({ page, api, task }) => {
        const msg = makeUserMessage(task.id, "Plain message with no chips");
        api.handle("conversations.getMessages", () => ({ messages: [msg], hasMore: false }));

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await expect(page.locator(".msg--user")).toBeVisible({ timeout: 3_000 });
        await expect(page.locator(".msg--user .inline-chip-text__chip--file")).toHaveCount(0);
    });
});
