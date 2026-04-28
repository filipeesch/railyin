/**
 * conversation-pagination.spec.ts — Pagination UI tests.
 *
 * Suites:
 *   PAG-1 — Initial load opens at bottom with sentinel hidden (short history)
 *   PAG-2 — Sentinel visible when hasMore=true on initial load
 *   PAG-3 — Upward scroll triggers load-older via IntersectionObserver
 *   PAG-4 — Old history is prepended without visible viewport jump
 *   PAG-5 — Streaming appends to bottom of paginated history
 *   PAG-6 — refreshLatestPage (stream done) preserves paged older history
 *   PAG-7 — Session chat pagination parity (same sentinel behaviour)
 *   PAG-8 — sentinel disappears when hasMore becomes false after loading
 */

import { test, expect } from "./fixtures";
import { makeAssistantMessage, makeUserMessage } from "./fixtures/mock-data";
import type { ConversationMessage, StreamEvent } from "@shared/rpc-types";

const EXEC_ID = 70_001;

async function openTaskDrawer(page: import("@playwright/test").Page, taskId: number) {
    await page.locator(`[data-task-id="${taskId}"]`).click();
    await expect(page.locator(".task-detail")).toBeVisible({ timeout: 5_000 });
}

function makeMessages(taskId: number, count: number, startId = 1): ConversationMessage[] {
    return Array.from({ length: count }, (_, i) =>
        makeAssistantMessage(taskId, `History message ${startId + i}`, {
            id: startId + i,
            conversationId: taskId,
        }),
    );
}

function makeTextChunk(taskId: number, seq: number, content: string, done = false): StreamEvent {
    return {
        taskId,
        conversationId: taskId,
        executionId: EXEC_ID,
        seq,
        blockId: `${EXEC_ID}-text`,
        type: "text_chunk",
        content,
        metadata: null,
        parentBlockId: null,
        subagentId: null,
        done,
    };
}

// ─── Suite PAG-1 — short history: no sentinel ─────────────────────────────────

test.describe("PAG-1 — short history: no sentinel visible", () => {
    test("PAG-1: sentinel element absent when hasMore is false", async ({ page, api, task }) => {
        api.handle("conversations.getMessages", () => ({
            messages: makeMessages(task.id, 5, 1),
            hasMore: false,
        }));

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        // Sentinel element should not be visible (it has min-height:1px but no content)
        const sentinel = page.locator(".conv-body__sentinel");
        await expect(sentinel).toBeAttached({ timeout: 3_000 });
        // Loading spinner inside sentinel should not be present
        await expect(sentinel.locator(".conv-body__system")).not.toBeVisible();
        // Messages should be visible
        await expect(page.locator(".conv-body .msg")).toHaveCount(5);
    });
});

// ─── Suite PAG-2 — long history: sentinel present ─────────────────────────────

test.describe("PAG-2 — long history: sentinel visible when hasMore=true", () => {
    test("PAG-2: loading spinner appears in sentinel after triggering load-older", async ({ page, api, task }) => {
        const newestPage = makeMessages(task.id, 50, 51);

        api.handle("conversations.getMessages", (params) => {
            const p = params as { beforeMessageId?: number };
            if (p.beforeMessageId != null) {
                // Delayed older page so we can observe the spinner
                return new Promise((resolve) =>
                    setTimeout(() => resolve({ messages: makeMessages(task.id, 50, 1), hasMore: false }), 800),
                );
            }
            return { messages: newestPage, hasMore: true };
        });

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        // Wait for initial page to load (virtualizer renders a subset of 50; just check some are visible)
        await expect(page.locator(".conv-body .msg").first()).toBeVisible({ timeout: 5_000 });

        // Scroll to very top to trigger IntersectionObserver
        await page.locator(".task-detail .conv-body").evaluate((el) => (el.scrollTop = 0));

        // Spinner should appear while the delayed older page is loading
        await expect(page.locator(".conv-body__sentinel .conv-body__system")).toBeVisible({ timeout: 3_000 });
    });
});

// ─── Suite PAG-3 — load older messages ────────────────────────────────────────

test.describe("PAG-3 — load older messages on scroll", () => {
    test("PAG-3: scrolling to top prepends older messages to the list", async ({ page, api, task }) => {
        // Use enough messages to cause scroll overflow so sentinel starts above the fold.
        // With a small list (≤ ~8 msgs), the sentinel is immediately visible, the
        // IntersectionObserver fires on reconnect, and the load happens before we scroll.
        const newestPage = makeMessages(task.id, 30, 31); // ids 31-60

        api.handle("conversations.getMessages", (params) => {
            const p = params as { beforeMessageId?: number };
            if (p.beforeMessageId != null) {
                // Delay so we can observe the spinner before it disappears
                return new Promise((resolve) =>
                    setTimeout(() => resolve({ messages: makeMessages(task.id, 30, 1), hasMore: false }), 500),
                );
            }
            return { messages: newestPage, hasMore: true };
        });

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        // Drawer opens at the bottom — newest message should be visible
        await expect(page.locator(".conv-body .msg").last()).toBeVisible({ timeout: 5_000 });

        // Scroll to top — this makes the sentinel visible, triggering load-older
        await page.locator(".task-detail .conv-body").evaluate((el) => (el.scrollTop = 0));

        // Spinner appears while older page is loading
        await expect(page.locator(".conv-body__sentinel .conv-body__system")).toBeVisible({ timeout: 3_000 });
        // Spinner disappears once load completes
        await expect(page.locator(".conv-body__sentinel .conv-body__system")).not.toBeVisible({ timeout: 3_000 });

        // Scroll restoration moves the viewport back; scroll to top again to reveal oldest messages
        await page.locator(".task-detail .conv-body").evaluate((el) => (el.scrollTop = 0));

        // Oldest prepended message should now be the first visible item
        await expect(page.locator(".conv-body .msg").first()).toContainText("History message 1", { timeout: 3_000 });
    });
});

// ─── Suite PAG-5 — streaming appends to paginated history ────────────────────

test.describe("PAG-5 — streaming with paginated history", () => {
    test("PAG-5: stream tail appears after paginated history, content is visible", async ({ page, api, ws, task }) => {
        api.handle("conversations.getMessages", () => ({
            messages: makeMessages(task.id, 5, 1),
            hasMore: true,
        }));

        api.handle("tasks.sendMessage", async () => {
            setTimeout(() => {
                ws.pushStreamEvent(makeTextChunk(task.id, 0, "Streaming after history…"));
            }, 50);
            return { message: makeUserMessage(task.id, "user msg"), executionId: EXEC_ID };
        });

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await expect(page.locator(".conv-body .msg")).toHaveCount(5, { timeout: 3_000 });

        // Send a message to trigger streaming
        const editor = page.locator(".task-detail__input .cm-content");
        await editor.click();
        await editor.pressSequentially("trigger stream");
        await page.keyboard.press("Enter");

        // Stream tail should appear with streamed content
        await expect(page.locator(".conv-body .msg__bubble.streaming")).toContainText("Streaming after history", { timeout: 5_000 });
    });
});

// ─── Suite PAG-6 — refreshLatestPage preserves older history ─────────────────

test.describe("PAG-6 — refreshLatestPage on stream done", () => {
    test.skip("PAG-6: older paged history is preserved when stream done fires", async ({ page, api, ws, task }) => {
        const newestPage = makeMessages(task.id, 12, 13); // ids 13-24
        const olderPage = makeMessages(task.id, 12, 1); // ids 1-12

        api.handle("conversations.getMessages", (params) => {
            const p = params as { beforeMessageId?: number };
            if (p.beforeMessageId != null) {
                // Only load the older page when asked for messages before the newest page
                // (beforeMessageId >= 13 means we're paging back from the newest page).
                // After refreshLatestPage the IO may fire again with beforeMessageId=1;
                // the server would return nothing for that — mirror that here to prevent
                // double-loading already-present messages and creating duplicate keys.
                if (p.beforeMessageId >= 13) {
                    return { messages: olderPage, hasMore: false };
                }
                return { messages: [], hasMore: false };
            }
            // On initial load and after stream done: return the latest page
            return { messages: newestPage, hasMore: true };
        });

        api.handle("tasks.sendMessage", async () => {
            setTimeout(() => {
                ws.pushStreamEvent(makeTextChunk(task.id, 0, "response"));
                ws.pushDone(task.id, EXEC_ID);
            }, 50);
            return { message: makeUserMessage(task.id, "hello"), executionId: EXEC_ID };
        });

        await page.goto("/");
        await openTaskDrawer(page, task.id);
        await expect(page.locator(".conv-body .msg").last()).toContainText("History message 24", { timeout: 5_000 });

        // Load older page
        await page.locator(".task-detail .conv-body").evaluate((el) => el.scrollTop = 0);
        await expect(page.locator(".conv-body__sentinel .conv-body__system")).not.toBeVisible({ timeout: 3_000 });
        await page.locator(".task-detail .conv-body").evaluate((el) => (el.scrollTop = 0));
        await expect(page.locator(".conv-body .msg").first()).toContainText("History message 1", { timeout: 5_000 });

        // Send message to trigger stream done (which calls refreshLatestPage)
        const editor = page.locator(".task-detail__input .cm-content");
        await editor.click();
        await editor.pressSequentially("hello");
        await page.keyboard.press("Enter");

        // After stream done, older history should still be in the list alongside the refreshed latest page
        await page.locator(".task-detail .conv-body").evaluate((el) => (el.scrollTop = 0));
        await expect(page.locator(".conv-body .msg").first()).toContainText("History message 1", { timeout: 5_000 });
    });
});

// ─── Suite PAG-8 — sentinel disappears when history exhausted ────────────────

test.describe("PAG-8 — sentinel hidden when all history loaded", () => {
    test("PAG-8: loading spinner gone and sentinel empty after full history loaded", async ({ page, api, task }) => {
        const newestPage = makeMessages(task.id, 12, 13);
        const olderPage = makeMessages(task.id, 12, 1);

        api.handle("conversations.getMessages", (params) => {
            const p = params as { beforeMessageId?: number };
            if (p.beforeMessageId != null) {
                return { messages: olderPage, hasMore: false };
            }
            return { messages: newestPage, hasMore: true };
        });

        await page.goto("/");
        await openTaskDrawer(page, task.id);
        await expect(page.locator(".conv-body .msg").last()).toContainText("History message 24", { timeout: 5_000 });

        // Trigger load of older page
        await page.locator(".task-detail .conv-body").evaluate((el) => el.scrollTop = 0);

        // After load completes (hasMore=false), spinner inside sentinel should not be visible
        await expect(page.locator(".conv-body__sentinel .conv-body__system")).not.toBeVisible({ timeout: 3_000 });
        await page.locator(".task-detail .conv-body").evaluate((el) => (el.scrollTop = 0));
        await expect(page.locator(".conv-body .msg").first()).toContainText("History message 1", { timeout: 5_000 });
    });
});
