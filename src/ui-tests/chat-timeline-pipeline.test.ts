/**
 * chat-timeline-pipeline.test.ts — UI regression tests for the unified stream-event pipeline.
 *
 * Test runner: bun test  (bun:test)
 * Transport:   HTTP bridge to Electrobun debug server on localhost:9229
 *
 * Run: bun test src/ui-tests/chat-timeline-pipeline.test.ts --timeout 120000
 * Requires the app to be running with: bun run dev:test  (--debug --memory-db)
 *
 * Scenarios covered:
 *   Suite T — stream-event pipeline rendering:
 *     T-28: text_chunk events render a live `.streaming` bubble in the drawer
 *     T-29: reasoning_chunk events render a `.rb` (ReasoningBubble) with `.rb__icon--pulse`
 *     T-30: `done` event clears live blocks — `.streaming` and `.rb__icon--pulse` disappear
 *     T-31: multiple text_chunks merge into one block (no duplicate rendering)
 *     T-32: reasoning_chunk followed by text_chunk: both blocks present in correct order
 *     T-33: stream state survives drawer close and reopen
 *     T-34: status_chunk renders ephemeral status text
 */

import { describe, test, expect, beforeAll, beforeEach } from "bun:test";
import {
  sleep,
  waitFor,
  setupTestEnv,
  openTaskDrawer,
  closeTaskDrawer,
  webEval,
  queueStreamEvents,
  getStreamState,
  clearStreamState,
  BRIDGE_BASE,
} from "./bridge";

let taskId: number;

// Use a synthetic executionId that won't collide with real executions in memory-db mode.
const EXEC_ID = 99_901;

/** Reset the task's stream state before each test. */
async function resetStreamState(): Promise<void> {
  await clearStreamState(taskId, EXEC_ID);
  await sleep(100);
  // Clear the stream state completely via Pinia
  await webEval(`
    var pinia = document.querySelector('#app').__vue_app__.config.globalProperties['$pinia'];
    pinia._s.get('task').streamStates.delete(${taskId});
    pinia._s.get('task').streamStates = new Map(pinia._s.get('task').streamStates);
    return 'ok';
  `);
  await sleep(100);
}

beforeAll(async () => {
  const env = await setupTestEnv();
  taskId = env.taskId;
  await openTaskDrawer(taskId);
});

// ─── Suite T — stream-event pipeline ─────────────────────────────────────────

describe("Suite T — stream-event pipeline rendering", () => {
  beforeEach(async () => {
    await resetStreamState();
    await sleep(200);
  });

  test("T-28: text_chunk renders live .streaming bubble", async () => {
    await queueStreamEvents([
      {
        taskId,
        executionId: EXEC_ID,
        seq: 0,
        blockId: `${EXEC_ID}-t1`,
        type: "text_chunk",
        content: "Hello from T-28",
        done: false,
      },
    ]);

    const visible = await waitFor(".msg__bubble.streaming", 4_000);
    expect(visible).toBe(true);

    const text = await webEval<string>(`
      var el = document.querySelector('.msg__bubble.streaming');
      return el ? el.textContent.trim() : '';
    `);
    expect(text).toContain("Hello from T-28");
  });

  test("T-29: reasoning_chunk renders .rb with pulsing icon", async () => {
    await queueStreamEvents([
      {
        taskId,
        executionId: EXEC_ID,
        seq: 0,
        blockId: `${EXEC_ID}-r1`,
        type: "reasoning_chunk",
        content: "Thinking about T-29",
        done: false,
      },
    ]);

    const visible = await waitFor(".rb", 4_000);
    expect(visible).toBe(true);

    const isPulsing = await webEval<boolean>(`
      return !!document.querySelector('.rb__icon--pulse');
    `);
    expect(isPulsing).toBe(true);

    const content = await webEval<string>(`
      var el = document.querySelector('.rb__content');
      return el ? el.textContent.trim() : '';
    `);
    expect(content).toContain("Thinking about T-29");
  });

  test("T-30: done event clears live streaming bubble", async () => {
    // Push a text chunk first
    await queueStreamEvents([
      {
        taskId,
        executionId: EXEC_ID,
        seq: 0,
        blockId: `${EXEC_ID}-t1`,
        type: "text_chunk",
        content: "Live text for T-30",
        done: false,
      },
    ]);

    const appeared = await waitFor(".msg__bubble.streaming", 4_000);
    expect(appeared).toBe(true);

    // Send done event
    await queueStreamEvents([
      {
        taskId,
        executionId: EXEC_ID,
        seq: 99,
        blockId: `${EXEC_ID}-done`,
        type: "done",
        content: "",
        done: true,
      },
    ]);

    await sleep(300);

    const stillStreaming = await webEval<boolean>(`
      return !!document.querySelector('.msg__bubble.streaming');
    `);
    expect(stillStreaming).toBe(false);
  });

  test("T-31: multiple text_chunks merge into one live block (no duplicate content)", async () => {
    const words = ["word1", " word2", " word3"];
    for (let i = 0; i < words.length; i++) {
      await queueStreamEvents([
        {
          taskId,
          executionId: EXEC_ID,
          seq: i,
          blockId: `${EXEC_ID}-t1`,
          type: "text_chunk",
          content: words[i],
          done: false,
        },
      ]);
    }

    await sleep(300);

    const state = await getStreamState(taskId);
    expect(state).not.toBeNull();

    // Should be exactly one text_chunk block
    const textChunkBlocks = state!.blocks.filter((b) => b.type === "text_chunk");
    expect(textChunkBlocks).toHaveLength(1);
    expect(textChunkBlocks[0].content).toBe("word1 word2 word3");
  });

  test("T-32: reasoning_chunk before text_chunk: both present in correct order", async () => {
    await queueStreamEvents([
      {
        taskId,
        executionId: EXEC_ID,
        seq: 0,
        blockId: `${EXEC_ID}-r1`,
        type: "reasoning_chunk",
        content: "Reasoning for T-32",
        done: false,
      },
    ]);
    await sleep(50);
    await queueStreamEvents([
      {
        taskId,
        executionId: EXEC_ID,
        seq: 1,
        blockId: `${EXEC_ID}-t1`,
        type: "text_chunk",
        content: "Response for T-32",
        done: false,
      },
    ]);

    await sleep(300);

    const state = await getStreamState(taskId);
    expect(state).not.toBeNull();

    const types = state!.blocks.map((b) => b.type);
    expect(types).toContain("reasoning_chunk");
    expect(types).toContain("text_chunk");

    // Reasoning must appear before text in the block order
    const rIdx = state!.blockOrder.findIndex((id) => {
      const b = state!.blocks.find((x) => x.blockId === id);
      return b?.type === "reasoning_chunk";
    });
    const tIdx = state!.blockOrder.findIndex((id) => {
      const b = state!.blocks.find((x) => x.blockId === id);
      return b?.type === "text_chunk";
    });
    expect(rIdx).toBeLessThan(tIdx);
  });

  test("T-33: stream state survives drawer close and reopen", async () => {
    await queueStreamEvents([
      {
        taskId,
        executionId: EXEC_ID,
        seq: 0,
        blockId: `${EXEC_ID}-t1`,
        type: "text_chunk",
        content: "Persistent content for T-33",
        done: false,
      },
    ]);
    await sleep(200);

    await closeTaskDrawer();
    await sleep(300);

    // Stream state should still be in the store
    const stateClosed = await getStreamState(taskId);
    expect(stateClosed).not.toBeNull();
    const textBlock = stateClosed!.blocks.find((b) => b.type === "text_chunk");
    expect(textBlock?.content).toContain("Persistent content for T-33");

    // Reopen and verify the bubble is still visible
    await openTaskDrawer(taskId);
    await sleep(400);

    const visible = await waitFor(".msg__bubble.streaming", 4_000);
    expect(visible).toBe(true);

    const text = await webEval<string>(`
      var el = document.querySelector('.msg__bubble.streaming');
      return el ? el.textContent.trim() : '';
    `);
    expect(text).toContain("Persistent content for T-33");
  });

  test("T-34: status_chunk renders ephemeral status text (not a streaming bubble)", async () => {
    await queueStreamEvents([
      {
        taskId,
        executionId: EXEC_ID,
        seq: 0,
        blockId: `${EXEC_ID}-status`,
        type: "status_chunk",
        content: "Running tool…",
        done: false,
      },
    ]);

    await sleep(300);

    const state = await getStreamState(taskId);
    expect(state?.statusMessage).toBe("Running tool…");

    // status_chunk does NOT create a text_chunk block
    const hasTextBlock = state!.blocks.some((b) => b.type === "text_chunk");
    expect(hasTextBlock).toBe(false);
  });
});
