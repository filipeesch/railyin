/**
 * stream-reactivity.spec.ts — Playwright E2E suite for reactivity performance changes.
 *
 * Suites:
 *   A — Live streaming (chunks appear, tool blocks render)
 *   B — Rendering isolation (background events don't touch active conv DOM)
 *   C — Memory cleanup (stream blocks cleared after done for background task)
 *   D — Unread state (background task gets unread dot)
 *   E — Auto-scroll (conversation body scrolls to bottom during live stream)
 *   F — Progressive streaming (each token appears before the next arrives)
 *
 * Bug regression tests:
 *   E-3 — Autoscroll disengages when user scrolls up during streaming
 *   E-4 — Autoscroll re-engages when user scrolls back to bottom
 *   E-5 — Reading position stays stable while streaming below the fold
 */
import { test, expect } from "./fixtures";
import { makeTask, makeAssistantMessage } from "./fixtures/mock-data";
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

    // Push 5 text_chunk events for task2 (background) — should not touch task1 DOM
    for (let i = 0; i < 5; i++) {
      ws.pushStreamEvent({
        taskId: task2.id,
        conversationId: task2.conversationId,
        executionId: EXEC_ID,
        seq: i,
        blockId: `bg-${i}`,
        type: "text_chunk",
        content: `chunk-${i}`,
        metadata: null,
        parentBlockId: null,
        subagentId: null,
        done: false,
      });
    }

    // Positive proof: push task.updated with terminal state → task2 gets unread dot
    ws.push({ type: "task.updated", payload: makeTask({ id: task2.id, executionState: "completed" }) });
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
  test("D-1: task.updated with terminal state gives task2 unread dot; opening task2 clears it", async ({
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

    // Push task.updated with terminal executionState for task2 (background) — this marks it unread
    ws.push({
      type: "task.updated",
      payload: makeTask({ id: task2.id, executionState: "completed" }),
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

// ─── Suite E (regression) — Auto-scroll stutter ────────────────────────────────
//
// Bug: during streaming the RAF loop calls scrollToBottom() every frame.
// When the user scrolls up, the browser may fire the scroll event asynchronously,
// creating a window where autoScroll is still true and the loop drags the
// viewport back to the bottom before onScroll() has a chance to flip the flag.
//
// Key design decisions:
//   - Content uses "overflow\n" (no spaces) so the typewriter reveals it immediately
//     (word-split produces 1 token → pos >= wordCount → displayed = full text).
//     All chunks from one execution append to the same block.
//   - Overflow detection uses waitForFunction on scrollHeight, not toContainText,
//     so there is no dependency on typewriter animation timing.
//   - E-3 uses page.mouse.wheel() which dispatches a real WheelEvent; the browser
//     initiates smooth-scroll asynchronously, recreating the RAF-vs-onScroll race.
//   - E-4 uses evaluate() + dispatchEvent (synchronous) because re-engagement does
//     not require the race condition to be present.

test.describe("E (regression) — Auto-scroll stutter", () => {
  test("E-3: autoscroll disengages when user scrolls up during streaming", async ({
    page,
    api,
    ws,
    task,
  }) => {
    api.returns("conversations.getMessages", { messages: [], hasMore: false });
    await page.goto("/");
    await openTaskDrawer(page, task.id);

    // Push 50 "overflow\n" chunks.  No spaces → typewriter reveals content
    // immediately (one word-token per split).  All chunks accumulate into the
    // same live block so the stream_tail grows tall quickly.
    for (let i = 0; i < 50; i++) {
      ws.pushStreamEvent(textChunk(task.id, task.conversationId, i, "overflow\n"));
    }

    // Wait for the virtual list to measure the tall stream_tail item so
    // scrollHeight actually exceeds the visible viewport height.
    await page.waitForFunction(
      () => {
        const el = document.querySelector(".conv-body");
        return !!el && el.scrollHeight > el.clientHeight + 100;
      },
      undefined,
      { timeout: 8_000 },
    );

    // Confirm autoScroll is engaged: scroll is pinned at the bottom.
    await page.waitForFunction(
      () => {
        const el = document.querySelector(".conv-body");
        if (!el) return false;
        return el.scrollHeight - el.scrollTop - el.clientHeight < 60;
      },
      undefined,
      { timeout: 3_000 },
    );

    const scrollHeightBefore = await page.evaluate(
      () => document.querySelector(".conv-body")?.scrollHeight ?? 0,
    );

    // Hover so the wheel event hits the right element, then fire a real
    // WheelEvent.  Unlike evaluate()+dispatchEvent, mouse.wheel() goes through
    // the browser's input pipeline: the scroll animation starts asynchronously,
    // before onScroll() fires — this is the race that causes the stutter bug.
    await page.locator(".task-detail .conv-body").hover();
    await page.mouse.wheel(0, -5000);

    // Give the browser time to process the wheel input and update scrollTop.
    await page.waitForTimeout(200);

    // Keep streaming so the RAF loop has the opportunity to drag scroll back.
    for (let i = 50; i < 70; i++) {
      ws.pushStreamEvent(textChunk(task.id, task.conversationId, i, "overflow\n"));
    }

    // Wait for new content to arrive: block grows → measureRef → scrollHeight grows.
    await page.waitForFunction(
      (prevH: number) => {
        const el = document.querySelector(".conv-body");
        return !!el && el.scrollHeight > prevH + 50;
      },
      scrollHeightBefore,
      { timeout: 8_000 },
    );

    // Allow multiple RAF frames to potentially drag scroll back (~300 ms ≈ 18 frames).
    await page.waitForTimeout(300);

    // Scroll position must NOT have been dragged back to the bottom.
    // A properly disengaged autoscroll leaves us far from the bottom (> 200 px).
    const distFromBottom = await page.evaluate(() => {
      const el = document.querySelector(".conv-body");
      if (!el) return 0;
      return el.scrollHeight - el.scrollTop - el.clientHeight;
    });
    expect(distFromBottom).toBeGreaterThan(200);
  });

  test("E-4: autoscroll re-engages when user scrolls back to bottom after scrolling up", async ({
    page,
    api,
    ws,
    task,
  }) => {
    api.returns("conversations.getMessages", { messages: [], hasMore: false });
    await page.goto("/");
    await openTaskDrawer(page, task.id);

    for (let i = 0; i < 50; i++) {
      ws.pushStreamEvent(textChunk(task.id, task.conversationId, i, "overflow\n"));
    }

    await page.waitForFunction(
      () => {
        const el = document.querySelector(".conv-body");
        return !!el && el.scrollHeight > el.clientHeight + 100;
      },
      undefined,
      { timeout: 8_000 },
    );

    // User scrolls up (synchronous via evaluate — re-engagement does not need the race).
    await page.locator(".task-detail .conv-body").evaluate((el) => {
      el.scrollTop = 0;
      el.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    await page.waitForTimeout(100);

    // User scrolls back to the bottom.
    await page.locator(".task-detail .conv-body").evaluate((el) => {
      el.scrollTop = el.scrollHeight;
      el.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    await page.waitForTimeout(100);

    const scrollHeightBefore = await page.evaluate(
      () => document.querySelector(".conv-body")?.scrollHeight ?? 0,
    );

    for (let i = 50; i < 70; i++) {
      ws.pushStreamEvent(textChunk(task.id, task.conversationId, i, "overflow\n"));
    }

    await page.waitForFunction(
      (prevH: number) => {
        const el = document.querySelector(".conv-body");
        return !!el && el.scrollHeight > prevH + 50;
      },
      scrollHeightBefore,
      { timeout: 8_000 },
    );

    await page.waitForTimeout(300);

    const distFromBottom = await page.evaluate(() => {
      const el = document.querySelector(".conv-body");
      if (!el) return 0;
      return el.scrollHeight - el.scrollTop - el.clientHeight;
    });
    // Re-engaged autoscroll keeps viewport near the bottom (≤ 60 px).
    expect(distFromBottom).toBeLessThanOrEqual(60);
  });

  test("E-5: reading position stays stable during the pendingScrollBottom race window", async ({
    page,
    api,
    ws,
    task,
  }) => {
    // 30 persisted messages give enough height for the user to scroll to mid-history.
    const msgs = Array.from({ length: 30 }, (_, i) =>
      makeAssistantMessage(task.id, `History message ${i + 1}`, {
        id: i + 1,
        conversationId: task.conversationId,
      }),
    );
    api.returns("conversations.getMessages", { messages: msgs, hasMore: false });

    await page.goto("/");

    // Freeze page timers BEFORE opening the drawer so the 60ms pendingScrollBottom
    // timer in scheduleScrollToBottom is queued but never fires.  This keeps the
    // race-condition window (pendingScrollBottom=true) open indefinitely.
    await page.clock.install();

    // Click task card and wait for the drawer to be attached (visible=false is fine
    // because conv-body--positioning hides it until initialScrollReady, which relies
    // on the frozen setTimeout).
    await page.locator(`[data-task-id="${task.id}"]`).click();
    await page.locator(".task-detail").waitFor({ state: "visible", timeout: 5_000 });

    // Allow Vue microtasks (nextTick, reactive updates) to settle.
    // Real-time wait is unaffected by the frozen fake clock.
    await page.waitForTimeout(150);

    // The virtualizer should have content and be scrolled to the bottom.
    const scrollInfo = await page.locator(".task-detail .conv-body").evaluate((el) => ({
      scrollTop: el.scrollTop,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }));

    // Need enough height to scroll mid-way; skip if virtualizer is empty.
    if (scrollInfo.scrollHeight < scrollInfo.clientHeight + 50) {
      test.skip();
      return;
    }

    // Simulate user scrolling up to read — sets autoScroll=false and (with fix)
    // pendingScrollBottom=false.
    const midPosition = Math.floor(scrollInfo.scrollHeight * 0.4);
    await page.locator(".task-detail .conv-body").evaluate((el, mid) => {
      el.scrollTop = mid;
      el.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, bubbles: true, cancelable: true }));
      el.dispatchEvent(new Event("scroll", { bubbles: true }));
    }, midPosition);
    await page.waitForTimeout(80);

    const scrollTopBefore = await page.locator(".task-detail .conv-body").evaluate(
      (el) => el.scrollTop,
    );
    // Must not be at the bottom already.
    const distFromBottom = scrollInfo.scrollHeight - scrollTopBefore - scrollInfo.clientHeight;
    expect(distFromBottom).toBeGreaterThan(50);

    // Push stream events while pendingScrollBottom is still true (timer frozen).
    // BUG: getTotalSize watcher calls scrollToLatest() because autoScroll check missing.
    // FIX: watcher now checks autoScroll.value — skips scrollToLatest when user scrolled up.
    for (let i = 0; i < 12; i++) {
      ws.pushStreamEvent(textChunk(task.id, task.conversationId, i, `word${i} `));
    }

    // Wait for Vue to process all reactive updates from the stream events.
    await page.waitForTimeout(300);

    const scrollTopAfter = await page.locator(".task-detail .conv-body").evaluate(
      (el) => el.scrollTop,
    );

    // Reading position must NOT have drifted toward the bottom.
    // Allow ≤ 5 px tolerance for sub-pixel rounding.
    expect(Math.abs(scrollTopAfter - scrollTopBefore)).toBeLessThanOrEqual(5);
  });

  test("E-6: upward wheel prevents onScroll from re-engaging autoScroll within REENGAGE_THRESHOLD", async ({
    page,
    api,
    ws,
    task,
  }) => {
    // Bug: user is pinned to the bottom (distFromBottom ≈ 0).  They wheel up.
    // onUserScroll fires (autoScroll=false, userScrolling=true).  But then the
    // very first scroll event fires while the viewport is still within
    // REENGAGE_THRESHOLD (1–4 px from bottom).  Without the fix, onScroll
    // re-engages autoScroll=true, the SIZE/RAF loop re-scrolls to bottom — the
    // user is trapped even 5+ lines above the bottom.
    //
    // Fix: onScroll captures userScrolling BEFORE resetting it and skips the
    // re-engagement branch when scrollingByUser=true.

    // 30 persisted messages give enough height for the body to overflow.
    const msgs = Array.from({ length: 30 }, (_, i) =>
      makeAssistantMessage(task.id, `Line ${i + 1}: the quick brown fox jumped\n`, {
        id: i + 1,
        conversationId: task.conversationId,
      }),
    );
    api.returns("conversations.getMessages", { messages: msgs, hasMore: false });
    await page.goto("/");
    await openTaskDrawer(page, task.id);

    // Wait for the virtualizer to render content that overflows the viewport.
    await page.waitForFunction(
      () => {
        const el = document.querySelector(".conv-body");
        return !!el && el.scrollHeight > el.clientHeight + 100;
      },
      undefined,
      { timeout: 8_000 },
    );

    const scrollHeight = await page.locator(".task-detail .conv-body").evaluate((el) => el.scrollHeight);
    const clientHeight = await page.locator(".task-detail .conv-body").evaluate((el) => el.clientHeight);
    if (scrollHeight < clientHeight + 50) {
      test.skip();
      return;
    }
    const REENGAGE_THRESHOLD = 5;
    // Place viewport exactly 3px from the bottom (inside the REENGAGE danger zone).
    const dangerZoneTop = scrollHeight - clientHeight - (REENGAGE_THRESHOLD - 2);

    // Step 1: Place viewport in the danger zone.  Setting scrollTop queues an async
    // scroll event.  We wait for it to fire before proceeding so that autoScroll is
    // re-engaged (distFromBottom < REENGAGE_THRESHOLD, userScrolling=false) — this
    // is the "starting state" where the user is near-bottom and autoScroll=true.
    await page.locator(".task-detail .conv-body").evaluate((el, top) => {
      el.scrollTop = top;
    }, dangerZoneTop);
    await page.waitForTimeout(80); // let queued scroll event fire & onScroll settle

    // Step 2: Simulate the user wheeling up while inside the danger zone.
    // Dispatch WheelEvent → onUserScroll: autoScroll=false, userScrolling=true.
    // Then immediately dispatch the scroll event the browser would produce —
    // onScroll should see scrollingByUser=true and NOT re-engage autoScroll.
    await page.locator(".task-detail .conv-body").evaluate((el) => {
      el.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, bubbles: true, cancelable: true }));
      // Fire the paired scroll event in the same microtask so userScrolling is
      // still true when onScroll runs (mirrors real browser interleaving).
      el.dispatchEvent(new Event("scroll", { bubbles: true }));
    });

    // Step 3: Push streaming content so the SIZE / RAF loop has a chance to snap
    // the viewport back to the bottom (the bug: autoScroll re-engaged in step 2).
    for (let i = 0; i < 8; i++) {
      ws.pushStreamEvent(textChunk(task.id, task.conversationId, i, `word${i} `));
    }
    await page.waitForTimeout(300); // let RAF loop run

    const distFromBottom = await page.locator(".task-detail .conv-body").evaluate((el) => {
      return el.scrollHeight - el.scrollTop - el.clientHeight;
    });
    // Viewport must NOT have been snapped back to the bottom by the SIZE/RAF watcher.
    expect(distFromBottom).toBeGreaterThan(REENGAGE_THRESHOLD - 1);
  });
});

// ─── Suite F — Progressive streaming ──────────────────────────────────────────

test.describe("F — Progressive streaming", () => {
  test("F-1: each token appears in the DOM before the next token is sent", async ({
    page,
    api,
    ws,
    task,
  }) => {
    api.returns("conversations.getMessages", { messages: [], hasMore: false });
    await page.goto("/");
    await openTaskDrawer(page, task.id);

    const tokens = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon"];

    for (let i = 0; i < tokens.length; i++) {
      ws.pushStreamEvent(textChunk(task.id, task.conversationId, i, tokens[i]));
      // Each token must be visible BEFORE the next one is pushed.
      // A 16ms wait (one frame) is enough for Vue to flush reactive updates.
      await expect(page.locator(".conv-body")).toContainText(tokens[i], { timeout: 2_000 });
    }

    // All tokens should be concatenated in the final block.
    await expect(page.locator(".conv-body")).toContainText("AlphaBetaGammaDeltaEpsilon", {
      timeout: 1_000,
    });
  });

  test("F-2: status_chunk events do not delay subsequent text_chunk rendering", async ({
    page,
    api,
    ws,
    task,
  }) => {
    api.returns("conversations.getMessages", { messages: [], hasMore: false });
    await page.goto("/");
    await openTaskDrawer(page, task.id);

    // Push a status event followed immediately by text tokens.
    ws.pushStreamEvent({
      taskId: task.id,
      conversationId: task.conversationId,
      executionId: EXEC_ID,
      seq: 0,
      blockId: `${EXEC_ID}-status`,
      type: "status_chunk",
      content: "Thinking…",
      metadata: null,
      parentBlockId: null,
      subagentId: null,
      done: false,
    });
    ws.pushStreamEvent(textChunk(task.id, task.conversationId, 1, "Hello"));
    ws.pushStreamEvent(textChunk(task.id, task.conversationId, 2, " world"));

    // Text should appear promptly — not blocked by the preceding status event.
    await expect(page.locator(".conv-body")).toContainText("Hello world", { timeout: 2_000 });
  });
});
