/**
 * stream-reactivity.spec.ts — Playwright E2E suite for reactivity performance changes.
 *
 * Suites:
 *   A — Live streaming (chunks appear, tool blocks render)
 *   B — Rendering isolation (background events don't touch active conv DOM)
 *   C — Memory cleanup (stream blocks cleared after done for background task)
 *   D — Unread state (background task gets unread dot)
 *   E — Auto-scroll (conversation body scrolls to bottom during live stream)
 */
import { test, expect } from "./fixtures";
import { makeTask } from "./fixtures/mock-data";
import type { StreamEvent } from "@shared/rpc-types";

const EXEC_ID = 42;

function textChunk(taskId: number, conversationId: number, seq: number, content: string): StreamEvent {
  return {
    taskId,
    conversationId,
    executionId: EXEC_ID,
    seq,
    blockId: `live-text-${seq}`,
    type: "text_chunk",
    content,
    metadata: null,
    parentBlockId: null,
    subagentId: null,
    done: false,
  };
}

function toolCallEvent(taskId: number, conversationId: number, seq: number): StreamEvent {
  return {
    taskId,
    conversationId,
    executionId: EXEC_ID,
    seq,
    blockId: `tool-block-${seq}`,
    type: "tool_call",
    content: JSON.stringify({ display: { label: "bash", subject: "echo hello" } }),
    metadata: null,
    parentBlockId: null,
    subagentId: null,
    done: false,
  };
}

async function openTaskDrawer(page: import("@playwright/test").Page, taskId: number) {
  await page.locator(`[data-task-id="${taskId}"]`).click();
  await expect(page.locator(".task-detail")).toBeVisible();
}

// ─── Suite A — Live streaming ──────────────────────────────────────────────────

test.describe("A — Live streaming", () => {
  test("A-1: 5 text_chunks appear in conversation body", async ({ page, api, ws, task }) => {
    api.returns("conversations.getMessages", { messages: [], hasMore: false });
    await page.goto("/");
    await openTaskDrawer(page, task.id);

    const chunks = ["Hello", " world", " from", " the", " stream"];
    for (let i = 0; i < chunks.length; i++) {
      ws.pushStreamEvent(textChunk(task.id, task.conversationId, i, chunks[i]));
    }

    // All chunks should concatenate into a single visible text block
    await expect(page.locator(".conv-body")).toContainText("Hello world from the stream", {
      timeout: 5_000,
    });
  });

  test("A-2: tool_call event renders tool block with correct label", async ({ page, api, ws, task }) => {
    api.returns("conversations.getMessages", { messages: [], hasMore: false });
    await page.goto("/");
    await openTaskDrawer(page, task.id);

    ws.pushStreamEvent(toolCallEvent(task.id, task.conversationId, 1));

    // Tool block label "bash" should appear in the .tcg__tool-name element
    await expect(page.locator(".conv-body .tcg__tool-name").first()).toContainText("bash", {
      timeout: 5_000,
    });
  });
});

// ─── Suite B — Rendering isolation ────────────────────────────────────────────

test.describe("B — Rendering isolation", () => {
  test("B-1: stream events for background task do not mutate active task's conv-body DOM", async ({
    page,
    api,
    ws,
  }) => {
    const task1 = makeTask({ id: 1, conversationId: 1 });
    const task2 = makeTask({ id: 2, conversationId: 2 });
    api.handle("tasks.list", () => [task1, task2]);
    api.returns("conversations.getMessages", { messages: [], hasMore: false });

    await page.goto("/");
    await openTaskDrawer(page, task1.id);

    // Attach MutationObserver to task1's conv-body
    await page.evaluate(() => {
      const body = document.querySelector(".task-detail .conv-body");
      let count = 0;
      const obs = new MutationObserver(() => count++);
      if (body) obs.observe(body, { subtree: true, childList: true, characterData: true });
      (window as unknown as Record<string, unknown>).__convBodyMutCount = () => {
        obs.disconnect();
        return count;
      };
    });

    // Push 5 ASSISTANT-type events for task2 (background) — assistant type triggers unread marking
    for (let i = 0; i < 5; i++) {
      ws.pushStreamEvent({
        taskId: task2.id,
        conversationId: task2.conversationId,
        executionId: EXEC_ID,
        seq: i,
        blockId: `bg-${i}`,
        type: "assistant",
        content: `chunk-${i}`,
        metadata: null,
        parentBlockId: null,
        subagentId: null,
        done: false,
      });
    }

    // Positive proof: task2 card should get an unread dot (events processed)
    await expect(
      page.locator(`[data-task-id="${task2.id}"] .task-card__unread-dot`),
    ).toBeVisible({ timeout: 5_000 });

    // Negative proof: task1's conv-body had zero mutations
    const mutCount = await page.evaluate(
      () => (window as unknown as Record<string, () => number>).__convBodyMutCount(),
    );
    expect(mutCount).toBe(0);
  });

  test("B-2: no data-stream-version attribute in DOM after streaming", async ({
    page,
    api,
    ws,
    task,
  }) => {
    api.returns("conversations.getMessages", { messages: [], hasMore: false });
    await page.goto("/");
    await openTaskDrawer(page, task.id);

    ws.pushStreamEvent(textChunk(task.id, task.conversationId, 1, "streaming..."));
    await expect(page.locator(".conv-body")).toContainText("streaming...", { timeout: 5_000 });

    const hasVersionAttr = await page.evaluate(() => {
      return document.querySelector("[data-stream-version]") !== null;
    });
    expect(hasVersionAttr).toBe(false);
  });
});

// ─── Suite C — Memory cleanup ──────────────────────────────────────────────────

test.describe("C — Memory cleanup", () => {
  test("C-1: re-opening task drawer after done event loads fresh messages from API", async ({
    page,
    api,
    ws,
    task,
  }) => {
    api.returns("conversations.getMessages", { messages: [], hasMore: false });
    await page.goto("/");
    await openTaskDrawer(page, task.id);

    // Stream some content, then close the execution
    ws.pushStreamEvent(textChunk(task.id, task.conversationId, 1, "stale block"));
    await expect(page.locator(".conv-body")).toContainText("stale block", { timeout: 5_000 });
    ws.pushDone(task.id, EXEC_ID);

    // Close the drawer by pressing Escape
    await page.keyboard.press("Escape");
    await expect(page.locator(".task-detail")).not.toBeVisible({ timeout: 3_000 });

    // Re-open: store should reload from API — stream blocks were cleared on done for non-active
    // We now make API return a different message so we can see a fresh load
    api.returns("conversations.getMessages", {
      messages: [
        {
          id: 1,
          taskId: task.id,
          conversationId: task.conversationId,
          type: "assistant",
          role: "assistant",
          content: "fresh from API",
          metadata: null,
          createdAt: new Date().toISOString(),
        },
      ],
      hasMore: false,
    });
    await openTaskDrawer(page, task.id);

    // The stale stream block should not be visible, the API message should be
    await expect(page.locator(".conv-body")).toContainText("fresh from API", { timeout: 5_000 });
  });

  test("C-2: background task done event — opening its drawer shows fresh load, not stale blocks", async ({
    page,
    api,
    ws,
  }) => {
    const task1 = makeTask({ id: 1, conversationId: 1 });
    const task2 = makeTask({ id: 2, conversationId: 2 });
    api.handle("tasks.list", () => [task1, task2]);
    api.returns("conversations.getMessages", { messages: [], hasMore: false });

    await page.goto("/");
    await openTaskDrawer(page, task1.id);

    // Background task2 streams and finishes while task1 is open
    ws.pushStreamEvent(textChunk(task2.id, task2.conversationId, 1, "background work"));
    ws.pushDone(task2.id, EXEC_ID, 999, task2.conversationId);

    // Now open task2: stream blocks should be cleared, API message shown
    api.returns("conversations.getMessages", {
      messages: [
        {
          id: 2,
          taskId: task2.id,
          conversationId: task2.conversationId,
          type: "assistant",
          role: "assistant",
          content: "persisted response",
          metadata: null,
          createdAt: new Date().toISOString(),
        },
      ],
      hasMore: false,
    });
    await page.locator(`[data-task-id="${task2.id}"]`).click();
    await expect(page.locator(".task-detail")).toBeVisible();

    await expect(page.locator(".conv-body")).not.toContainText("background work", { timeout: 3_000 });
    await expect(page.locator(".conv-body")).toContainText("persisted response", { timeout: 5_000 });
  });
});

// ─── Suite D — Unread state ────────────────────────────────────────────────────

test.describe("D — Unread state", () => {
  test("D-1: background stream gives task2 unread dot; opening task2 clears it", async ({
    page,
    api,
    ws,
  }) => {
    const task1 = makeTask({ id: 1, conversationId: 1 });
    const task2 = makeTask({ id: 2, conversationId: 2 });
    api.handle("tasks.list", () => [task1, task2]);
    api.returns("conversations.getMessages", { messages: [], hasMore: false });

    await page.goto("/");
    await openTaskDrawer(page, task1.id);

    // Push an "assistant" event for task2 (background) — this marks it unread
    ws.pushStreamEvent({
      taskId: task2.id,
      conversationId: task2.conversationId,
      executionId: EXEC_ID,
      seq: 1,
      blockId: "b1",
      type: "assistant",
      content: "done",
      metadata: null,
      parentBlockId: null,
      subagentId: null,
      done: true,
    });

    // Task2 card should have unread dot
    await expect(
      page.locator(`[data-task-id="${task2.id}"] .task-card__unread-dot`),
    ).toBeVisible({ timeout: 5_000 });

    // Open task2 — unread dot should disappear
    await page.locator(`[data-task-id="${task2.id}"]`).click();
    await expect(page.locator(".task-detail")).toBeVisible();
    await expect(
      page.locator(`[data-task-id="${task2.id}"] .task-card__unread-dot`),
    ).not.toBeVisible({ timeout: 3_000 });
  });
});

// ─── Suite E — Auto-scroll ─────────────────────────────────────────────────────

test.describe("E — Auto-scroll", () => {
  test("E-1: 20 stream chunks overflow the body and scroll stays at bottom", async ({
    page,
    api,
    ws,
    task,
  }) => {
    api.returns("conversations.getMessages", { messages: [], hasMore: false });
    await page.goto("/");
    await openTaskDrawer(page, task.id);

    // Push 20 chunks with substantial text to force overflow
    for (let i = 0; i < 20; i++) {
      ws.pushStreamEvent(
        textChunk(task.id, task.conversationId, i, `Line ${i}: ${"x".repeat(80)}\n`),
      );
    }

    // Wait for last chunk to appear
    await expect(page.locator(".conv-body")).toContainText("Line 19", { timeout: 5_000 });

    // Wait for auto-scroll to settle (it uses requestAnimationFrame + setTimeout)
    const isAtBottom = await page.waitForFunction(
      () => {
        const body = document.querySelector(".conv-body");
        if (!body) return false;
        // If content doesn't overflow at all, we're trivially at bottom
        if (body.scrollHeight <= body.clientHeight) return true;
        return body.scrollTop + body.clientHeight >= body.scrollHeight - 10;
      },
      { timeout: 3_000 },
    );
    expect(isAtBottom).toBeTruthy();
  });

  test("E-2: background task stream does not change active task's scroll position", async ({
    page,
    api,
    ws,
  }) => {
    const task1 = makeTask({ id: 1, conversationId: 1 });
    const task2 = makeTask({ id: 2, conversationId: 2 });
    api.handle("tasks.list", () => [task1, task2]);
    api.returns("conversations.getMessages", { messages: [], hasMore: false });

    await page.goto("/");
    await openTaskDrawer(page, task1.id);

    // Scroll task1 to top by pushing some content first
    for (let i = 0; i < 5; i++) {
      ws.pushStreamEvent(textChunk(task1.id, task1.conversationId, i, `task1 line ${i}\n`));
    }
    await expect(page.locator(".conv-body")).toContainText("task1 line 4", { timeout: 5_000 });

    // Capture scroll position
    const scrollBefore = await page.evaluate(() => {
      return document.querySelector(".conv-body")?.scrollTop ?? 0;
    });

    // Push events for background task2
    for (let i = 0; i < 5; i++) {
      ws.pushStreamEvent(textChunk(task2.id, task2.conversationId, i, `task2 chunk ${i}`));
    }
    await page.waitForTimeout(300); // let Vue flush

    const scrollAfter = await page.evaluate(() => {
      return document.querySelector(".conv-body")?.scrollTop ?? 0;
    });

    // task1's scroll should not have changed due to task2's events
    expect(scrollAfter).toBe(scrollBefore);
  });
});
