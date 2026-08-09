/**
 * chat-copilotkit.spec.ts — the Phase 5 chat suite: the task-drawer Chat tab
 * now renders the CopilotKit surface (RailyinChat.vue) instead of the legacy
 * ConversationBody/ConversationInput stack. All AG-UI traffic flows through
 * the `agui` fixture (MockAgui) against /api/copilotkit/*; every other RPC is
 * mocked by the api fixture baseline.
 *
 * Suites:
 *   S — streaming (CHAT-01), history-on-reopen (CHAT-07), empty state
 *       (RUNR-06), error state (RUN_ERROR)
 *
 * Wire contract (verified in mock-agui.ts): POST /agent/:agentId/run streams
 * the quick event sequence (RUN_STARTED → TEXT_MESSAGE_START/CONTENT/END
 * "hello" → RUN_FINISHED); POST /agent/:agentId/connect replays history for
 * registered threads (MESSAGES_SNAPSHOT) and an empty SSE body for never-run
 * threads; the threadId arrives in the request BODY (parseConnectRequest).
 */

import { test, expect } from "./fixtures";
import { openTaskDrawer } from "./fixtures";
import { makeTask } from "./fixtures/mock-data";
import type { Page } from "@playwright/test";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** The CopilotChatInput textarea inside our #input slot wrapper. */
function chatTextarea(page: Page) {
    return page.locator('[data-testid="chat-input"] textarea');
}

/** Track POSTs to /agent/default/connect (the CHAT-07 replay requests).
 *  The threadId arrives in the request BODY (parseConnectRequest mirrors the
 *  real runtime) — extract and record it. */
function collectConnectRequests(page: Page): string[] {
    const requests: string[] = [];
    page.on("request", (req) => {
        if (req.method() === "POST" && /\/agent\/default\/connect$/.test(new URL(req.url()).pathname)) {
            try {
                const body = JSON.parse(req.postData() ?? "{}") as { threadId?: unknown };
                if (typeof body.threadId === "string") requests.push(body.threadId);
            } catch {
                // Malformed body — ignore; the fixture route mirrors the 400.
            }
        }
    });
    return requests;
}

async function submitChatMessage(page: Page, text: string): Promise<void> {
    const input = chatTextarea(page);
    await input.click();
    await input.pressSequentially(text);
    await page.keyboard.press("Enter");
}

// ─── Suite S — streaming & history (CHAT-01, CHAT-07) ─────────────────────────

test.describe("S — CopilotKit streaming & history", () => {
    test("S-1: submitted message streams the assistant text via /run (CHAT-01)", async ({ page, api }) => {
        // Never-run thread (NOT registered with MockAgui): connect answers an
        // empty SSE body, so the ONLY source of the assistant "hello" text is
        // the /run stream — the streaming proof is unambiguous.
        const t = makeTask({ id: 101, conversationId: 101, title: "Streaming Task" });
        api.handle("tasks.list", () => [t]);

        await page.goto("/");
        await openTaskDrawer(page, t.id);

        const chat = page.locator('[data-testid="copilot-chat-view"]');
        await expect(chat).toBeVisible({ timeout: 10_000 });
        await expect(chatTextarea(page)).toBeEnabled();

        await submitChatMessage(page, "stream this please");

        // The user message renders (RUN_STARTED carries the run input) and the
        // assistant response streams token-by-token from buildQuickRunEvents.
        await expect(chat).toContainText("stream this please", { timeout: 10_000 });
        await expect(chat).toContainText("hello", { timeout: 10_000 });
    });

    test("S-2: reopening the drawer replays full history via /connect (CHAT-07)", async ({ page, api, agui }) => {
        const t = makeTask({ id: 102, conversationId: 102, title: "History Task" });
        api.handle("tasks.list", () => [t]);
        agui.registerThread(String(t.conversationId));

        const connectRequests = collectConnectRequests(page);
        await page.goto("/");
        await openTaskDrawer(page, t.id);

        const chat = page.locator('[data-testid="copilot-chat-view"]');
        // Connect replay renders the MESSAGES_SNAPSHOT assistant message.
        await expect(chat).toContainText("hello", { timeout: 10_000 });

        // Close the drawer (unmounts TaskChatView → new mount on reopen) and
        // reopen — the prior assistant text must render again via the replay.
        await page.keyboard.press("Escape");
        await expect(page.locator(".task-detail")).not.toBeVisible({ timeout: 3_000 });

        await openTaskDrawer(page, t.id);
        await expect(chat).toContainText("hello", { timeout: 10_000 });

        // The second open triggered a fresh POST /agent/default/connect for
        // the task's threadId (the CHAT-07 replay chain).
        expect(connectRequests.length).toBeGreaterThanOrEqual(2);
        expect(connectRequests).toContain(String(t.conversationId));
    });
});
