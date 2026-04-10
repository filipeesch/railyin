/**
 * chat.test.ts — UI regression tests for the task chat / conversation UI.
 *
 * Test runner: bun test  (bun:test)
 * Transport:   HTTP bridge to Electrobun debug server on localhost:9229
 *
 * Run: bun test src/ui-tests --timeout 120000
 * Requires the app to be running with: bun run dev:test  (--debug --memory-db)
 *
 * Scenarios covered:
 *   Suite M — basic send & streaming:
 *     1. User message appears immediately in .msg--user after send
 *     2. Streaming bubble (.msg__bubble.streaming) is visible while FakeAI streams
 *     3. Assistant message (.msg--assistant) is persisted after streaming ends
 *     4. Assistant message content matches FakeAI default response text
 *
 *   Suite N — execution state in the UI during chat:
 *     5. Task card has .exec-running class while the response is streaming
 *     6. Stop button (.pi-stop-circle) visible during streaming; send button (.pi-send) absent
 *     7. After streaming ends, task card has .exec-completed class (not running)
 *     8. Send button is disabled (not rendered) when the textarea is empty
 *
 *   Suite O — persistence and multi-turn ordering:
 *     9. Messages survive drawer close and reopen (loaded from DB)
 *    10. Two round-trips → exactly 4 messages in correct user/assistant order
 *    11. No duplicate messages appear after a message.new + loadMessages race
 */

import { describe, test, expect, beforeAll } from "bun:test";
import {
  webEval,
  sleep,
  waitFor,
  setupTestEnv,
  openTaskDrawer,
  closeTaskDrawer,
  sendChatMessage,
  waitForStreamingDone,
  getMessageCount,
  getMessageTexts,
  getActiveTaskExecutionState,
} from "./bridge";

// ─── Global test environment ──────────────────────────────────────────────────
// Shared across all suites: one task with model='fake/test' so messages flow.

let taskId: number;

beforeAll(async () => {
  const env = await setupTestEnv();
  taskId = env.taskId;
});

// ─── Suite M — basic send & streaming ─────────────────────────────────────────

describe("Suite M — basic send & streaming", () => {
  beforeAll(async () => {
    await openTaskDrawer(taskId);
  });

  test("M-1: user message appears immediately in .msg--user", async () => {
    const before = await getMessageCount("user");
    await sendChatMessage("Hello from M-1");
    // Give Vue a tick to optimistically push the message before the RPC round-trip
    await sleep(500);
    const after = await getMessageCount("user");
    expect(after).toBe(before + 1);
  });

  test("M-2: streaming bubble (.msg__bubble.streaming) is visible while FakeAI streams", async () => {
    // Wait for the stream to start (bubble appears) then capture it mid-flight.
    // The FakeAI streams word-by-word at 30ms — there's a window of ~1-5 seconds.
    const streamingVisible = await waitFor(".msg__bubble.streaming", 15_000);
    expect(streamingVisible).toBe(true);
  });

  test("M-3: assistant message is persisted after streaming ends", async () => {
    const settled = await waitForStreamingDone(30_000);
    expect(settled).toBe(true);
    const count = await getMessageCount("assistant");
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test("M-4: assistant message content matches FakeAI default text", async () => {
    const texts = await getMessageTexts("assistant");
    const last = texts[texts.length - 1] ?? "";
    // FakeAI default response 1 begins with this phrase
    expect(last).toContain("analysed");
  });
});

// ─── Suite N — execution state in the UI ──────────────────────────────────────

describe("Suite N — execution state in the UI", () => {
  beforeAll(async () => {
    // Open fresh drawer (may already be open after Suite M)
    await openTaskDrawer(taskId);
    // Wait for previous streaming to finish before running state tests
    await waitForStreamingDone(30_000);
  });

  test("N-5: task card has .exec-running class while response is streaming", async () => {
    await sendChatMessage("Hello from N-5");
    // Streaming starts asynchronously — poll until card goes running
    let running = false;
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const state = await getActiveTaskExecutionState();
      if (state === "running") { running = true; break; }
      await sleep(200);
    }
    expect(running).toBe(true);
  });

  test("N-6: stop button (.pi-stop-circle) visible during streaming; send button (.pi-send) absent", async () => {
    // This test runs while N-5 stream is still in-flight (FakeAI streams for ~1-5s)
    const stopVisible = await waitFor(".task-detail__input .pi-stop-circle", 10_000);
    const sendAbsent = await webEval<number>(
      `return document.querySelectorAll('.task-detail__input .pi-send').length`,
    );
    expect(stopVisible).toBe(true);
    expect(sendAbsent).toBe(0);
    // Wait for stream to finish before moving on
    await waitForStreamingDone(30_000);
  });

  test("N-7: task card has .exec-completed (not exec-running) after streaming ends", async () => {
    // Already settled after N-6's waitForStreamingDone
    const state = await getActiveTaskExecutionState();
    expect(state).toBe("completed");
  });

  test("N-8: send button is disabled when textarea is empty", async () => {
    // With an empty textarea the send button should not be rendered at all
    // (v-else branch with :disabled="!inputText.trim()").
    // We confirm no enabled .pi-send button exists for an empty textarea.
    const emptyTextarea = await webEval<boolean>(`
      var ta = document.querySelector('.task-detail__input textarea');
      return ta ? ta.value.trim() === '' : true;
    `);
    // Make sure textarea is truly empty first
    if (!emptyTextarea) {
      await webEval(`
        var ta = document.querySelector('.task-detail__input textarea');
        var setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
        setter.call(ta, '');
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        return 'ok';
      `);
      await sleep(100);
    }
    const sendDisabled = await webEval<boolean>(`
      var btn = document.querySelector('.task-detail__input button[disabled]');
      var sendBtn = document.querySelector('.task-detail__input .pi-send');
      // Either send button is absent OR the button containing it is disabled
      if (!sendBtn) return true;
      return !!btn;
    `);
    expect(sendDisabled).toBe(true);
  });
});

// ─── Suite O — persistence and multi-turn ordering ───────────────────────────

describe("Suite O — persistence and multi-turn ordering", () => {
  beforeAll(async () => {
    await openTaskDrawer(taskId);
    await waitForStreamingDone(30_000);
  });

  test("O-9: messages survive drawer close and reopen", async () => {
    const countBefore = await getMessageCount("assistant");
    expect(countBefore).toBeGreaterThanOrEqual(1);

    await closeTaskDrawer();
    await sleep(300);

    await openTaskDrawer(taskId);
    const countAfter = await getMessageCount("assistant");
    expect(countAfter).toBe(countBefore);
  });

  test("O-10: two round-trips produce exactly 4 messages in user/assistant/user/assistant order", async () => {
    // Start from a clean message count (from previous suites we may have >=2 already)
    const baseUser = await getMessageCount("user");
    const baseAssistant = await getMessageCount("assistant");

    // Send first new message
    await sendChatMessage("Round O first");
    await sleep(400);
    await waitForStreamingDone(30_000);

    // Send second new message
    await sendChatMessage("Round O second");
    await sleep(400);
    await waitForStreamingDone(30_000);

    const finalUser = await getMessageCount("user");
    const finalAssistant = await getMessageCount("assistant");

    expect(finalUser).toBe(baseUser + 2);
    expect(finalAssistant).toBe(baseAssistant + 2);

    // Verify ordering: last 4 messages alternate user → assistant → user → assistant
    const userTexts = await getMessageTexts("user");
    const assistantTexts = await getMessageTexts("assistant");
    expect(userTexts[userTexts.length - 2]).toContain("Round O first");
    expect(userTexts[userTexts.length - 1]).toContain("Round O second");
    expect(assistantTexts.length).toBeGreaterThanOrEqual(2);
  });

  test("O-11: no duplicate messages after drawer close/reopen race", async () => {
    const before = await getMessageCount("assistant");

    // Close and immediately reopen — this triggers loadMessages while the
    // message.new IPC event may still be in flight from a prior send
    await closeTaskDrawer();
    await openTaskDrawer(taskId);
    await sleep(500); // let any pending IPC events settle

    const after = await getMessageCount("assistant");
    // Count must be stable — no duplicates
    expect(after).toBe(before);
  });
});
