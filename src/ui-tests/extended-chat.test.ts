/**
 * extended-chat.test.ts — Edge-case and advanced chat UI tests.
 *
 * Test runner: bun test  (bun:test)
 * Transport:   HTTP bridge to Electrobun debug server (port from /tmp/railyn-debug.port)
 *
 * Run: bun test src/ui-tests/extended-chat.test.ts --timeout 120000
 * Requires the app to be running with: bun run dev:test  (--debug=0 --memory-db)
 *
 * Scenarios covered:
 *   Suite P — Execution cancellation:
 *    12. Cancel button is hidden when task is idle, visible when running
 *    13. Cancelling mid-stream → execution_state becomes 'waiting_user'
 *    14. After cancel, a new message can be sent (task fully recovers)
 *    15. Compact button is disabled while an execution is running
 *
 *   Suite Q — Model switching:
 *    16. Model selector shows the task's current model (fake/test)
 *    17. After setTaskModel(), the Pinia store reflects the new model ID
 *    18. Drawer model selector label updates to new model after switch
 *    19. A second chat round after model switch completes successfully
 *
 *   Suite R — Context compaction:
 *    20. Compact button is visible and enabled when task is idle
 *    21. Manual compact → '.msg--compaction' divider appears in conversation
 *    22. 'Show summary' details element is present inside the compaction marker
 *    23. Context gauge appears in the model row after an execution completes
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
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
  getActiveTaskExecutionState,
  waitForExecutionState,
  cancelExecution,
  setTaskModel,
  getActiveTaskModel,
  compactTask,
  getCompactionSummaryCount,
  getModelSelectorLabel,
  isCompactButtonEnabled,
  isCompactButtonDisabled,
  isContextGaugeVisible,
} from "./bridge";

// ─── Shared test state ────────────────────────────────────────────────────────

let taskId: number;

beforeAll(async () => {
  const env = await setupTestEnv();
  taskId = env.taskId;
});

// ─── Suite P — Execution cancellation ─────────────────────────────────────────

describe("Suite P — Execution cancellation", () => {
  beforeAll(async () => {
    await openTaskDrawer(taskId);
  });

  afterAll(async () => {
    // Ensure no streaming is left hanging before next suite
    await waitForStreamingDone(20_000);
  });

  test("P-12: cancel button hidden when idle, visible when running", async () => {
    // Idle: stop-circle button must NOT be present
    const idleVisible = await webEval<number>(
      `return document.querySelectorAll('.task-detail__input .pi-stop-circle').length`,
    );
    expect(idleVisible).toBe(0);

    // Start a stream
    await sendChatMessage("Hello from P-12", taskId);

    // Poll until running
    let running = false;
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const count = await webEval<number>(
        `return document.querySelectorAll('.task-detail__input .pi-stop-circle').length`,
      );
      if (count > 0) { running = true; break; }
      await sleep(200);
    }
    expect(running).toBe(true);

    // Let it finish
    await waitForStreamingDone(30_000);

    // Completed: stop-circle must be gone again
    const doneVisible = await webEval<number>(
      `return document.querySelectorAll('.task-detail__input .pi-stop-circle').length`,
    );
    expect(doneVisible).toBe(0);
  });

  test("P-13: cancelling mid-stream → executionState becomes 'waiting_user'", async () => {
    // Start a stream
    await sendChatMessage("Hello from P-13, please run a long job", taskId);

    // Wait until running
    const wasRunning = await waitForExecutionState("running", 10_000);
    expect(wasRunning).toBe(true);

    // Cancel via HTTP endpoint (not webEval — that would deadlock)
    await cancelExecution(taskId);

    // After cancellation the engine sets execution_state → 'waiting_user'
    const wasCancelled = await waitForExecutionState("waiting_user", 15_000);
    expect(wasCancelled).toBe(true);
  });

  test("P-14: can send a new message after cancel (task fully recovers)", async () => {
    // We're in 'waiting_user' from P-13 — sending should work
    const usersBefore = await getMessageCount("user");
    await sendChatMessage("Recovery message from P-14", taskId);
    await waitForStreamingDone(30_000);
    const usersAfter = await getMessageCount("user");
    expect(usersAfter).toBeGreaterThan(usersBefore);

    // And the execution completed normally
    const state = await getActiveTaskExecutionState();
    expect(["waiting_user", "completed"]).toContain(state);
  });

  test("P-15: compact button is disabled while execution is running", async () => {
    // Start another stream
    await sendChatMessage("Long job for P-15", taskId);

    const wasRunning = await waitForExecutionState("running", 10_000);
    expect(wasRunning).toBe(true);

    // Compact button must be disabled during execution
    const disabled = await isCompactButtonDisabled();
    expect(disabled).toBe(true);

    await waitForStreamingDone(30_000);
  });
});

// ─── Suite Q — Model switching ────────────────────────────────────────────────

describe("Suite Q — Model switching", () => {
  beforeAll(async () => {
    // Re-open drawer (may have been left open from Suite P)
    await waitForStreamingDone(5_000);
    await openTaskDrawer(taskId);
  });

  test("Q-16: model selector shows the task's current model (fake/test)", async () => {
    // The model stored in Pinia should be 'fake/test' (set by /setup-test-env)
    const model = await getActiveTaskModel();
    expect(model).toBe("fake/test");
  });

  test("Q-17: after setTaskModel(), Pinia activeTask.model reflects the new value", async () => {
    await setTaskModel(taskId, "fake/v2");
    const model = await getActiveTaskModel();
    expect(model).toBe("fake/v2");
  });

  test("Q-18: drawer model selector label updates to new model after switch", async () => {
    // PrimeVue Select shows the option value as the label; for fake/v2 it should
    // show "fake/v2" (option-label="id", option-value="id", so label = value).
    const label = await getModelSelectorLabel();
    expect(label).toBe("fake/v2");
  });

  test("Q-19: a message sent after model switch completes successfully", async () => {
    // fake/v2 still resolves to the FakeAI provider — all model IDs with prefix
    // 'fake' map to the FakeAIProvider (provider id = 'fake').
    const usersBefore = await getMessageCount("user");
    await sendChatMessage("Message on fake/v2 model from Q-19", taskId);
    await waitForStreamingDone(30_000);

    // User message was appended
    const usersAfter = await getMessageCount("user");
    expect(usersAfter).toBeGreaterThan(usersBefore);

    // At least one assistant reply arrived
    const assistants = await getMessageCount("assistant");
    expect(assistants).toBeGreaterThanOrEqual(1);

    // Restore model to fake/test for subsequent suites
    await setTaskModel(taskId, "fake/test");
  });
});

// ─── Suite R — Context compaction ────────────────────────────────────────────

describe("Suite R — Context compaction", () => {
  beforeAll(async () => {
    await waitForStreamingDone(5_000);
    await openTaskDrawer(taskId);
  });

  test("R-20: compact button is visible and enabled when task is idle", async () => {
    const enabled = await isCompactButtonEnabled();
    expect(enabled).toBe(true);
  });

  test("R-21: manual compact → .msg--compaction divider appears in conversation", async () => {
    const before = await getCompactionSummaryCount();

    // Trigger compaction — the bun side runs compactConversation and pushes the
    // new compaction_summary message via IPC to the Vue store.
    await compactTask(taskId);

    // Wait for the divider to render
    const appeared = await waitFor(".msg--compaction", 15_000);
    expect(appeared).toBe(true);

    const after = await getCompactionSummaryCount();
    expect(after).toBe(before + 1);
  });

  test("R-22: 'Show summary' details element is present inside the compaction marker", async () => {
    const hasDetails = await webEval<boolean>(
      `return !!document.querySelector('.msg--compaction .msg--compaction__details')`,
    );
    expect(hasDetails).toBe(true);

    // The <details> summary text should say "Show summary"
    const summaryText = await webEval<string>(
      `var el = document.querySelector('.msg--compaction__details > summary'); return el ? el.textContent.trim() : ''`,
    );
    expect(summaryText).toBe("Show summary");
  });

  test("R-23: context gauge appears after an execution completes", async () => {
    // Send a message so the engine calls fetchContextUsage after the stream.
    await sendChatMessage("Trigger context gauge for R-23", taskId);
    await waitForStreamingDone(30_000);

    // Give Vue a render tick to populate the gauge
    await sleep(500);

    const visible = await isContextGaugeVisible();
    expect(visible).toBe(true);
  });
});
