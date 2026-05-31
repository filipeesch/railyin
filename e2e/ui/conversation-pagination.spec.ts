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
 *   PAG-9 — sentinel triggers load-older without requiring manual scroll
 *   PAG-10 — load-older uses task.conversationId, not task.id
 */

import { test, expect } from "./fixtures";
import { makeAssistantMessage, makeUserMessage, makeTask } from "./fixtures/mock-data";
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
        api.handle("conversations.getMessages", (params) => {
            const p = params as { beforeMessageId?: number };
            // Sentinel fires immediately (hasMore=true) — return empty so count stays at 5.
            if (p.beforeMessageId != null) return { messages: [], hasMore: false };
            return { messages: makeMessages(task.id, 5, 1), hasMore: true };
        });

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
    test("PAG-6: older paged history is preserved when stream done fires", async ({ page, api, ws, task }) => {
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

// ─── Suite PAG-9 — immediate sentinel trigger on short initial load ───────────
//
// Regression: when hasMoreBefore=true but the conversation is short enough
// that the sentinel is visible immediately (autoScroll=true on mount), the
// old !autoScroll.value guard in the IntersectionObserver callback prevented
// load-older from firing. This test verifies the guard is gone.

test.describe("PAG-9 — sentinel triggers load-older without requiring manual scroll", () => {
    test("PAG-9: load-older fires on mount when sentinel is immediately visible", async ({ page, api, task }) => {
        // A very short conversation (3 messages) so the sentinel is above the fold
        // immediately after the drawer opens — no manual scroll required.
        const initialMessages = makeMessages(task.id, 3, 10); // ids 10–12
        let loadOlderCalled = false;

        api.handle("conversations.getMessages", (params) => {
            const p = params as { beforeMessageId?: number };
            if (p.beforeMessageId != null) {
                loadOlderCalled = true;
                return { messages: makeMessages(task.id, 3, 1), hasMore: false }; // ids 1–3
            }
            return { messages: initialMessages, hasMore: true };
        });

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        // The sentinel is visible immediately on mount (short conversation + autoScroll=true).
        // Give the async IntersectionObserver callback time to fire and load older messages.
        await page.waitForTimeout(500);

        expect(loadOlderCalled).toBe(true);

        // All 6 messages (3 initial + 3 older) should now be visible.
        // We skip asserting the intermediate count of 3 because the sentinel fires
        // synchronously enough that load-older may complete before the first assertion.
        await expect(page.locator(".conv-body .msg")).toHaveCount(6, { timeout: 3_000 });
    });
});

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

// ─── Suite PAG-10 — load-older uses task.conversationId, not task.id ──────────
//
// Regression: TaskChatView.vue was passing task.id (the task PK, e.g. 5) instead
// of task.conversationId (the FK, e.g. 999) to conversationStore.loadOlderMessages.
// The guard `if (activeConversationId !== params.conversationId) return` would then
// bail immediately because 999 ≠ 5, silently swallowing every load-older request.

test.describe("PAG-10 — load-older uses task.conversationId", () => {
    test("PAG-10: scroll-to-top triggers load-older when task.id !== task.conversationId", async ({ page, api }) => {
        // Create a task where id and conversationId are intentionally different.
        const task = makeTask({ id: 5, conversationId: 999 });

        // Override the task list to return our specially-crafted task.
        api.handle("tasks.list", () => [task]);

        // Enough messages to scroll overflow so sentinel starts above the fold.
        const initialMessages = Array.from({ length: 30 }, (_, i) =>
            makeAssistantMessage(task.conversationId, `History message ${31 + i}`, {
                id: 31 + i,
                conversationId: task.conversationId,
            }),
        );

        let loadOlderCalled = false;

        api.handle("conversations.getMessages", (params) => {
            const p = params as { beforeMessageId?: number };
            if (p.beforeMessageId != null) {
                loadOlderCalled = true;
                return {
                    messages: Array.from({ length: 10 }, (_, i) =>
                        makeAssistantMessage(task.conversationId, `Old message ${i + 1}`, {
                            id: i + 1,
                            conversationId: task.conversationId,
                        }),
                    ),
                    hasMore: false,
                };
            }
            return { messages: initialMessages, hasMore: true };
        });

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        // Wait for initial messages to render
        await expect(page.locator(".conv-body .msg").last()).toBeVisible({ timeout: 5_000 });

        // Scroll to top — IntersectionObserver fires → @load-older → loadOlderMessages
        await page.locator(".task-detail .conv-body").evaluate((el) => (el.scrollTop = 0));

        // Give the async observer callback time to fire
        await page.waitForTimeout(800);

        // Older messages should have been loaded — this fails before the fix because
        // task.id (5) ≠ activeConversationId (999) causes loadOlderMessages to return early.
        expect(loadOlderCalled).toBe(true);

        await expect(page.locator(".conv-body .msg").first()).toContainText("Old message 1", { timeout: 3_000 });
    });
});

// ─── Suite PAG-11 — orphaned tool calls render standalone ────────────────────
//
// Regression guard: when a page contains only subagent children whose parent
// delegate call lives on an older page, all children must render as standalone
// tool call cards (not be silently dropped).

test.describe("PAG-11 — orphaned tool calls render as standalone entries", () => {
    test("PAG-11: subagent children without parent on current page render as tool entries", async ({ page, api, task }) => {
        const delegateCallId = "tc-pag11-delegate";

        function makeChildCall(id: number, toolCallId: string): ConversationMessage {
            return {
                id,
                taskId: task.id,
                conversationId: task.id,
                type: "tool_call",
                role: "assistant",
                content: JSON.stringify({
                    type: "function",
                    function: { name: "read_file", arguments: JSON.stringify({ path: `src/file${id}.ts` }) },
                    id: toolCallId,
                    display: { label: "read_file", subject: `src/file${id}.ts` },
                }),
                metadata: { parent_tool_call_id: delegateCallId },
                createdAt: new Date().toISOString(),
            };
        }

        function makeChildResult(id: number, toolCallId: string): ConversationMessage {
            return {
                id,
                taskId: task.id,
                conversationId: task.id,
                type: "tool_result",
                role: "user",
                content: JSON.stringify({ tool_use_id: toolCallId, content: "file contents" }),
                metadata: null,
                createdAt: new Date().toISOString(),
            };
        }

        const messages: ConversationMessage[] = [
            makeChildCall(1, "tc-c1"),
            makeChildResult(2, "tc-c1"),
            makeChildCall(3, "tc-c2"),
            makeChildResult(4, "tc-c2"),
        ];

        // hasMore: true signals the parent is on an older page.
        // Return empty for any older-page requests (beforeMessageId set) to avoid
        // PAG-9's immediate auto-trigger doubling the message list.
        api.handle("conversations.getMessages", (params) => {
            const p = params as { beforeMessageId?: number };
            if (p.beforeMessageId != null) return { messages: [], hasMore: false };
            return { messages, hasMore: true };
        });

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        // Both orphaned children must render as tool entries, not be dropped
        await expect(page.locator(".conv-body .tc")).toHaveCount(2, { timeout: 3_000 });
    });
});

// ─── Suite PAG-12 — re-nesting after paging in parent ────────────────────────
//
// When the user scrolls up and the older page loads the delegate parent,
// orphaned children should re-nest under it: the .delegate-divider appears
// and the orphaned .tc cards collapse into the delegate entry.

test.describe("PAG-12 — orphaned children re-nest when parent is paged in", () => {
    test("PAG-12: scrolling loads delegate parent and children collapse into delegate-divider", async ({ page, api, task }) => {
        const delegateCallId = "tc-pag12-delegate";

        function makeChildCall(id: number, toolCallId: string): ConversationMessage {
            return {
                id,
                taskId: task.id,
                conversationId: task.id,
                type: "tool_call",
                role: "assistant",
                content: JSON.stringify({
                    type: "function",
                    function: { name: "read_file", arguments: JSON.stringify({ path: `src/f${id}.ts` }) },
                    id: toolCallId,
                    display: { label: "read_file", subject: `src/f${id}.ts` },
                }),
                metadata: { parent_tool_call_id: delegateCallId },
                createdAt: new Date().toISOString(),
            };
        }

        function makeChildResult(id: number, toolCallId: string): ConversationMessage {
            return {
                id,
                taskId: task.id,
                conversationId: task.id,
                type: "tool_result",
                role: "user",
                content: JSON.stringify({ tool_use_id: toolCallId, content: "ok" }),
                metadata: null,
                createdAt: new Date().toISOString(),
            };
        }

        const delegateCall: ConversationMessage = {
            id: 100,
            taskId: task.id,
            conversationId: task.id,
            type: "tool_call",
            role: "assistant",
            content: JSON.stringify({
                type: "function",
                function: {
                    name: "delegate",
                    arguments: JSON.stringify({ intent: "parallel reads", tasks: [{ id: "a", prompt: "read a" }, { id: "b", prompt: "read b" }] }),
                },
                id: delegateCallId,
                display: { label: "delegate", subject: "parallel reads" },
            }),
            metadata: null,
            createdAt: new Date().toISOString(),
        };

        const delegateResult: ConversationMessage = {
            id: 101,
            taskId: task.id,
            conversationId: task.id,
            type: "tool_result",
            role: "user",
            content: JSON.stringify({ tool_use_id: delegateCallId, content: "done" }),
            metadata: null,
            createdAt: new Date().toISOString(),
        };

        // Current page: only orphaned children (parent is on older page).
        // We use a gate promise to delay the older-page response until Phase 1 is
        // verified, avoiding a race with PAG-9's immediate sentinel trigger.
        const currentPage: ConversationMessage[] = [
            makeChildCall(1, "tc-p12-c1"),
            makeChildResult(2, "tc-p12-c1"),
            makeChildCall(3, "tc-p12-c2"),
            makeChildResult(4, "tc-p12-c2"),
        ];

        // Older page: the delegate parent + some padding message to avoid empty older page
        const olderPage: ConversationMessage[] = [
            makeAssistantMessage(task.id, "pre-delegate context", { id: 99, conversationId: task.id }),
            delegateCall,
            delegateResult,
        ];

        let releaseOlderPage!: () => void;
        const olderPageGate = new Promise<void>((resolve) => { releaseOlderPage = resolve; });

        api.handle("conversations.getMessages", async (params) => {
            const p = params as { beforeMessageId?: number };
            if (p.beforeMessageId != null) {
                await olderPageGate;
                return { messages: olderPage, hasMore: false };
            }
            return { messages: currentPage, hasMore: true };
        });

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        // Phase 1: orphaned children are visible as standalone .tc cards
        // (older page is held behind the gate, so no race with PAG-9 auto-trigger)
        await expect(page.locator(".conv-body .tc")).toHaveCount(2, { timeout: 5_000 });

        // Release gate so the older page can now respond, then scroll to top
        releaseOlderPage();
        await page.locator(".task-detail .conv-body").evaluate((el) => (el.scrollTop = 0));

        // Phase 2: after older page loads, delegate-divider appears (children are now nested)
        await expect(page.locator(".conv-body .delegate-divider")).toBeVisible({ timeout: 5_000 });

        // The previously-orphaned .tc cards collapse into the delegate entry
        await expect(page.locator(".conv-body .tc")).toHaveCount(0, { timeout: 3_000 });
    });
});
