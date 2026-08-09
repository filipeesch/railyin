/**
 * conversation-stream-state.spec.ts — Tests for stream state isolation between drawers.
 *
 * Suite: SS — stream state isolation
 * Verifies that streamed content is scoped to its task's conversation and
 * does not bleed across drawer switches.
 *
 * Migrated onto the agui fixture (Phase 6, plan 06-01): SS-1/SS-2 use the
 * threadId-switch pattern — per-thread registerHistory + streaming via
 * submitChatMessage + /run (S-1 pattern); SS-3 keeps the background-task
 * isolation intent with two per-thread registered histories. All assertions
 * target the new CopilotKit surface ([data-testid="copilot-chat-view"]).
 */

import { test, expect } from "./fixtures";
import { openTaskDrawer, openSessionDrawer, submitChatMessage } from "./fixtures";
import { makeTask, makeChatSession } from "./fixtures/mock-data";

test.describe("SS — stream state isolation", () => {
    test("SS-1: task A's streamed content not visible in task B's conversation body", async ({ page, api, agui }) => {
        const taskA = makeTask({ id: 10 });
        const taskB = makeTask({ id: 11 });

        api.handle("tasks.list", () => [taskA, taskB]);
        // Task A's thread replays a small alternating history (fixture-driven);
        // task B's thread is never registered — its connect answers an empty
        // body (RUNR-06), so the ONLY content in B's view could be A's.
        agui.registerHistory(String(taskA.conversationId), [
            { id: "u1", role: "user", content: "Round 1" },
            { id: "a1", role: "assistant", content: "Reply 1" },
        ]);

        await page.goto("/");
        await openTaskDrawer(page, taskA.id);

        const chat = page.locator('[data-testid="copilot-chat-view"]');
        await expect(chat).toBeVisible({ timeout: 10_000 });

        // Stream content scoped to task A's conversation via /run (S-1 pattern).
        await submitChatMessage(page, "Content for Task A only");
        await expect(chat).toContainText("Content for Task A only", { timeout: 10_000 });
        await expect(chat).toContainText("hello", { timeout: 10_000 }); // quick-script text

        // Close taskA
        await page.keyboard.press("Escape");
        await expect(page.locator(".task-detail")).not.toBeVisible({ timeout: 3_000 });

        // Open taskB — never-run thread: its chat must never show task A's
        // streamed content nor task A's registered history.
        await openTaskDrawer(page, taskB.id);
        const chatB = page.locator('[data-testid="copilot-chat-view"]');
        await expect(chatB).toBeVisible({ timeout: 10_000 });
        await expect(chatB).not.toContainText("Content for Task A only");
        await expect(chatB).not.toContainText("Round 1");
        await expect(chatB).not.toContainText("Reply 1");
    });

    test("SS-2: streaming content for task A persists after switching to session and back", async ({ page, api, agui }) => {
        const taskA = makeTask({ id: 12 });
        const session = makeChatSession({ id: 500 });

        api.handle("tasks.list", () => [taskA]);
        api.returns("chatSessions.list", [session]);
        api.returns("chatSessions.get", session);
        // Task A's prior content is fixture-driven: the connect replay carries
        // this registered history, so reopening re-renders it (CHAT-07).
        agui.registerHistory(String(taskA.conversationId), [
            { id: "u1", role: "user", content: "Persisted streaming content" },
            { id: "a1", role: "assistant", content: "Persisted reply" },
        ]);

        await page.goto("/");
        await openTaskDrawer(page, taskA.id);

        const chat = page.locator('[data-testid="copilot-chat-view"]');
        await expect(chat).toContainText("Persisted reply", { timeout: 10_000 });

        // Live stream into task A (fixture /run path).
        await submitChatMessage(page, "Persisted streaming content");
        await expect(chat).toContainText("Persisted streaming content", { timeout: 10_000 });
        await expect(chat).toContainText("hello", { timeout: 10_000 });

        // Switch to session drawer
        await page.keyboard.press("Escape");
        await expect(page.locator(".task-detail")).not.toBeVisible({ timeout: 3_000 });

        await openSessionDrawer(page, session.id);
        await expect(page.locator(".session-chat-view")).toBeVisible();

        // Return to taskA
        await page.keyboard.press("Escape");
        await expect(page.locator(".session-chat-view")).not.toBeVisible({ timeout: 3_000 });
        await openTaskDrawer(page, taskA.id);

        // taskA's prior content persists — replayed via /connect from the
        // registered history (fixture-driven, never legacy-ws-driven).
        await expect(chat).toContainText("Persisted streaming content", { timeout: 10_000 });
        await expect(chat).toContainText("Persisted reply", { timeout: 10_000 });
    });

    test("SS-3: a background task's thread content never appears in the active task's conversation", async ({ page, api, agui }) => {
        const taskA = makeTask({ id: 20 });
        const taskB = makeTask({ id: 21 });

        api.handle("tasks.list", () => [taskA, taskB]);
        // Distinct per-thread histories — the isolation proof: task A's chat
        // view must only ever render task A's registered history.
        agui.registerHistory(String(taskA.conversationId), [
            { id: "u1", role: "user", content: "Task A message" },
            { id: "a1", role: "assistant", content: "Task A reply" },
        ]);
        agui.registerHistory(String(taskB.conversationId), [
            { id: "u2", role: "user", content: "Background task content" },
            { id: "a2", role: "assistant", content: "Background reply" },
        ]);

        await page.goto("/");
        await openTaskDrawer(page, taskA.id);

        // Task A's view renders only its own registered history.
        const chatA = page.locator('[data-testid="copilot-chat-view"]');
        await expect(chatA).toContainText("Task A reply", { timeout: 10_000 });

        // Task B (background) content must not bleed into task A's view.
        await expect(chatA).not.toContainText("Background task content");
        await expect(chatA).not.toContainText("Background reply");
    });
});
