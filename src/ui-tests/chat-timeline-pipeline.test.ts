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
 *     T-35: reasoning bubble closes (stops pulsing) after `done` event
 *     T-36: status message disappears after `done` event
 *     T-37: new execution (different executionId) resets state so second run is visible
 *     T-38: tool_call event clears live reasoning_chunk blocks (no stacked reasoning)
 *     T-39: autoscroll fires during text_chunk streaming — scroll reaches bottom
 *     T-40: autoscroll fires during reasoning_chunk streaming — reasoning bubble visible in viewport
 *
 *   Suite S — mixed scenario rendering (mirrors Layer 1 backend scenarios):
 *     S-1 (T-41): reasoning then text — reasoning streams live, both blocks render in correct order
 *     S-2 (T-42): reasoning → tool → text — tool_call between reasoning and text, reasoning before tool
 *     S-3 (T-43): multiple tool rounds — multiple tool pairs interleaved with text
 *     S-4 (T-44): cancel mid-reasoning — partial reasoning rendered, no ghost live blocks after cancel
 *     S-5 (T-45): subagent events — subagent blocks render with correct attribution
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

  test("T-35: reasoning bubble closes (stops pulsing) after done event", async () => {
    await queueStreamEvents([
      {
        taskId,
        executionId: EXEC_ID,
        seq: 0,
        blockId: `${EXEC_ID}-r1`,
        type: "reasoning_chunk",
        content: "Thinking deeply for T-35",
        done: false,
      },
    ]);

    const appeared = await waitFor(".rb__icon--pulse", 4_000);
    expect(appeared).toBe(true);

    // Send done — the entire live section should disappear
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
    await sleep(400);

    const stillPulsing = await webEval<boolean>(`
      return !!document.querySelector('.rb__icon--pulse');
    `);
    expect(stillPulsing).toBe(false);
  });

  test("T-36: status message disappears after done event", async () => {
    await queueStreamEvents([
      {
        taskId,
        executionId: EXEC_ID,
        seq: 0,
        blockId: `${EXEC_ID}-status`,
        type: "status_chunk",
        content: "Starting Copilot engines",
        done: false,
      },
    ]);
    await sleep(300);

    const state1 = await getStreamState(taskId);
    expect(state1?.statusMessage).toBe("Starting Copilot engines");

    const statusVisible = await webEval<boolean>(`
      var el = document.querySelector('.msg--status-ephemeral');
      return el ? el.textContent.includes('Starting Copilot engines') : false;
    `);
    expect(statusVisible).toBe(true);

    // Done should clear status message
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
    await sleep(400);

    const state2 = await getStreamState(taskId);
    expect(state2?.statusMessage).toBe("");

    const statusGone = await webEval<boolean>(`
      return !document.querySelector('.msg--status-ephemeral');
    `);
    expect(statusGone).toBe(true);
  });

  test("T-37: new execution (different executionId) resets stream state so second run is visible", async () => {
    // First execution: complete it so isDone = true
    await queueStreamEvents([
      {
        taskId,
        executionId: EXEC_ID,
        seq: 0,
        blockId: `${EXEC_ID}-t1`,
        type: "text_chunk",
        content: "First execution",
        done: false,
      },
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
    await sleep(400);

    const state1 = await getStreamState(taskId);
    expect(state1?.isDone).toBe(true);

    // Second execution with different executionId
    const EXEC_ID_2 = EXEC_ID + 1;
    await queueStreamEvents([
      {
        taskId,
        executionId: EXEC_ID_2,
        seq: 0,
        blockId: `${EXEC_ID_2}-status`,
        type: "status_chunk",
        content: "Starting Copilot engines",
        done: false,
      },
    ]);
    await sleep(300);

    // State should have been reset — isDone must be false
    const state2 = await getStreamState(taskId);
    expect(state2?.isDone).toBe(false);
    expect(state2?.statusMessage).toBe("Starting Copilot engines");

    // Status should be visible in the UI
    const statusVisible = await webEval<boolean>(`
      var el = document.querySelector('.msg--status-ephemeral');
      return el ? el.textContent.includes('Starting Copilot engines') : false;
    `);
    expect(statusVisible).toBe(true);

    // Second execution text should also render
    await queueStreamEvents([
      {
        taskId,
        executionId: EXEC_ID_2,
        seq: 1,
        blockId: `${EXEC_ID_2}-t1`,
        type: "text_chunk",
        content: "Second execution response",
        done: false,
      },
    ]);
    await sleep(300);

    const textVisible = await waitFor(".msg__bubble.streaming", 4_000);
    expect(textVisible).toBe(true);

    const text = await webEval<string>(`
      var el = document.querySelector('.msg__bubble.streaming');
      return el ? el.textContent.trim() : '';
    `);
    expect(text).toContain("Second execution response");

    // Cleanup: send done for second execution
    await queueStreamEvents([
      {
        taskId,
        executionId: EXEC_ID_2,
        seq: 99,
        blockId: `${EXEC_ID_2}-done`,
        type: "done",
        content: "",
        done: true,
      },
    ]);
    await sleep(300);
  });

  test("T-38: tool_call event clears live reasoning_chunk blocks (prevents stacked reasoning)", async () => {
    // Reasoning arrives real-time
    await queueStreamEvents([
      {
        taskId,
        executionId: EXEC_ID,
        seq: 0,
        blockId: `${EXEC_ID}-r1`,
        type: "reasoning_chunk",
        content: "Thinking about the tool to call...",
        done: false,
      },
    ]);
    await sleep(200);

    // Verify reasoning bubble is visible
    const rbVisible = await waitFor(".rb__icon--pulse", 4_000);
    expect(rbVisible).toBe(true);

    // tool_call persisted event fires (simulates the batcher sending it after the tool starts)
    await queueStreamEvents([
      {
        taskId,
        executionId: EXEC_ID,
        seq: 1,
        blockId: `${EXEC_ID}-tc1`,
        type: "tool_call",
        content: JSON.stringify({ type: "function", function: { name: "read_file", arguments: "{}" }, id: "tc1" }),
        done: false,
      },
    ]);
    await sleep(300);

    // reasoning_chunk live block should be cleared by the tool_call handler
    const state = await getStreamState(taskId);
    const reasoningBlocks = state!.blocks.filter((b) => b.type === "reasoning_chunk");
    expect(reasoningBlocks).toHaveLength(0);

    // Reasoning bubble should no longer be pulsing
    const stillPulsing = await webEval<boolean>(`
      return !!document.querySelector('.rb__icon--pulse');
    `);
    expect(stillPulsing).toBe(false);
  });

  test("T-39: autoscroll fires during text_chunk streaming — scroll reaches bottom", async () => {
    // Scroll to top first so we can verify autoscroll pulls us back
    await webEval(`
      var el = document.querySelector('.task-detail__conversation');
      if (el) { el.scrollTop = 0; }
    `);
    await sleep(100);

    // Send several text_chunk events to produce content
    const chunks = Array.from({ length: 20 }, (_, i) => ({
      taskId,
      executionId: EXEC_ID,
      seq: i,
      blockId: `${EXEC_ID}-text-autoscroll`,
      type: "text_chunk" as const,
      content: `Line ${i + 1}: Lorem ipsum dolor sit amet, consectetur adipiscing elit.\n`,
      done: false,
    }));
    await queueStreamEvents(chunks);
    await sleep(600);

    const atBottom = await webEval<boolean>(`
      var el = document.querySelector('.task-detail__conversation');
      if (!el) return false;
      return (el.scrollHeight - el.scrollTop - el.clientHeight) < 10;
    `);
    expect(atBottom).toBe(true);
  });

  test("T-40: autoscroll fires during reasoning_chunk streaming — reasoning bubble visible in viewport", async () => {
    // Scroll to top first
    await webEval(`
      var el = document.querySelector('.task-detail__conversation');
      if (el) { el.scrollTop = 0; }
    `);
    await sleep(100);

    // Send reasoning_chunk events to create a reasoning bubble
    await queueStreamEvents([
      {
        taskId,
        executionId: EXEC_ID,
        seq: 0,
        blockId: `${EXEC_ID}-rb-autoscroll`,
        type: "reasoning_chunk",
        content: "Thinking deeply about the problem...\nAnalyzing all edge cases...\nConsidering multiple approaches...",
        done: false,
      },
    ]);
    await sleep(600);

    // The reasoning bubble should be visible in the scroll container
    const rbVisible = await webEval<boolean>(`
      var container = document.querySelector('.task-detail__conversation');
      var rb = document.querySelector('.rb__icon--pulse');
      if (!container || !rb) return false;
      var containerRect = container.getBoundingClientRect();
      var rbRect = rb.getBoundingClientRect();
      return rbRect.bottom > containerRect.top && rbRect.top < containerRect.bottom;
    `);
    expect(rbVisible).toBe(true);

    // Cleanup
    await queueStreamEvents([{
      taskId,
      executionId: EXEC_ID,
      seq: 99,
      blockId: `${EXEC_ID}-rb-done`,
      type: "done",
      content: "",
      done: true,
    }]);
    await sleep(300);
  });
});

// ─── Suite S — Mixed scenario rendering ─────────────────────────────────────
// Mirrors Layer 1 backend scenarios but asserts DOM state.
// All use a distinct EXEC_ID (99_902) to avoid state bleed from Suite T.

const S_EXEC_ID = 99_902;

describe("Suite S — mixed scenario rendering", () => {
  beforeEach(async () => {
    await clearStreamState(taskId, S_EXEC_ID);
    await sleep(100);
    await webEval(`
      window.__pinia?.state?.value?.task &&
        (window.__pinia.state.value.task.streamStates?.delete(${taskId}));
    `);
    await sleep(100);
  });

  function evt(
    seq: number,
    type: string,
    content: string,
    blockId?: string,
    extra: Partial<{ subagentId: string; done: boolean }> = {},
  ) {
    return {
      taskId,
      executionId: S_EXEC_ID,
      seq,
      blockId: blockId ?? `${S_EXEC_ID}-${seq}`,
      type,
      content,
      metadata: null,
      subagentId: extra.subagentId ?? null,
      done: extra.done ?? false,
    };
  }

  // T-41 ─ S-1: reasoning then text
  test("T-41 S-1: reasoning streams live then both reasoning and text blocks present in order", async () => {
    await openTaskDrawer(taskId);

    // Inject reasoning_chunk then text_chunk (simulates live stream before persisted arrives)
    await queueStreamEvents([
      evt(0, "reasoning_chunk", "I am thinking..."),
      evt(1, "text_chunk", "Hello world."),
    ]);
    await sleep(300);

    // Both live blocks visible
    const state = await getStreamState(taskId);
    expect(state!.blocks.some((b) => b.type === "reasoning_chunk")).toBe(true);
    expect(state!.blocks.some((b) => b.type === "text_chunk")).toBe(true);

    // Reasoning block appears before text block in blockOrder
    const blockTypes = state!.blocks.map((b: { type: string }) => b.type);
    const rIdx = blockTypes.indexOf("reasoning_chunk");
    const tIdx = blockTypes.indexOf("text_chunk");
    expect(rIdx).toBeLessThan(tIdx);

    // Cleanup
    await queueStreamEvents([evt(99, "done", "", `${S_EXEC_ID}-done`, { done: true })]);
    await sleep(300);
    await closeTaskDrawer();
  });

  // T-42 ─ S-2: reasoning → tool → text
  test("T-42 S-2: tool_call clears live reasoning; reasoning block appears before tool_call", async () => {
    await openTaskDrawer(taskId);

    // Reasoning live
    await queueStreamEvents([evt(0, "reasoning_chunk", "Planning to read file...")]);
    await sleep(200);

    let state = await getStreamState(taskId);
    expect(state!.blocks.some((b) => b.type === "reasoning_chunk")).toBe(true);

    // tool_call persisted (should flush reasoning)
    const toolCallContent = JSON.stringify({
      type: "function",
      function: { name: "read_file", arguments: '{"path":"/tmp/a.txt"}' },
      id: "tc1",
    });
    await queueStreamEvents([
      evt(1, "reasoning", "Planning to read file...", `${S_EXEC_ID}-r1`),
      evt(2, "tool_call", toolCallContent, "tc1"),
    ]);
    await sleep(300);

    state = await getStreamState(taskId);
    const blockTypes = state!.blocks.map((b: { type: string }) => b.type);

    // reasoning_chunk live block should be gone (replaced by persisted reasoning)
    expect(blockTypes.filter((t: string) => t === "reasoning_chunk")).toHaveLength(0);

    // reasoning block before tool_call in order
    const rIdx = blockTypes.indexOf("reasoning");
    const tcIdx = blockTypes.indexOf("tool_call");
    if (rIdx !== -1 && tcIdx !== -1) {
      expect(rIdx).toBeLessThan(tcIdx);
    }

    // tool_result + text then done
    await queueStreamEvents([
      evt(3, "tool_result", JSON.stringify({ success: true, result: "contents" }), "tc1"),
      evt(4, "text_chunk", "Done."),
      evt(99, "done", "", `${S_EXEC_ID}-done`, { done: true }),
    ]);
    await sleep(300);

    // No ghost live blocks after done
    const finalState = await getStreamState(taskId);
    expect(finalState!.blocks.filter((b: { type: string }) => b.type === "reasoning_chunk")).toHaveLength(0);
    expect(finalState!.blocks.filter((b: { type: string }) => b.type === "text_chunk")).toHaveLength(0);

    await closeTaskDrawer();
  });

  // T-43 ─ S-3: multiple tool rounds
  test("T-43 S-3: multiple tool pairs render with text between them", async () => {
    await openTaskDrawer(taskId);

    const toolCall = (id: string, name: string) =>
      JSON.stringify({ type: "function", function: { name, arguments: "{}" }, id });
    const toolResult = (id: string) =>
      JSON.stringify({ success: true, result: `result from ${id}` });

    await queueStreamEvents([
      evt(0, "text_chunk", "First. "),
      evt(1, "tool_call", toolCall("c1", "write_file"), "c1"),
      evt(2, "tool_result", toolResult("c1"), "c1"),
      evt(3, "text_chunk", "Second. "),
      evt(4, "tool_call", toolCall("c2", "read_file"), "c2"),
      evt(5, "tool_result", toolResult("c2"), "c2"),
      evt(6, "text_chunk", "Done."),
      evt(99, "done", "", `${S_EXEC_ID}-done`, { done: true }),
    ]);
    await sleep(500);

    const state = await getStreamState(taskId);
    const toolCallBlocks = state!.blocks.filter((b: { type: string }) => b.type === "tool_call");
    const toolResultBlocks = state!.blocks.filter((b: { type: string }) => b.type === "tool_result");

    expect(toolCallBlocks).toHaveLength(2);
    expect(toolResultBlocks).toHaveLength(2);

    // Each tool_call immediately precedes its tool_result in blockOrder
    const blockTypes = state!.blocks.map((b: { type: string }) => b.type);
    const tc1 = blockTypes.indexOf("tool_call");
    const tr1 = blockTypes.indexOf("tool_result");
    expect(tr1).toBe(tc1 + 1);

    await closeTaskDrawer();
  });

  // T-44 ─ S-4: cancel mid-reasoning — no ghost blocks
  test("T-44 S-4: after done event all live blocks are cleared (cancel path)", async () => {
    await openTaskDrawer(taskId);

    // Simulate reasoning streaming then abrupt done (cancel path)
    await queueStreamEvents([
      evt(0, "reasoning_chunk", "step 1"),
      evt(1, "reasoning_chunk", "step 2"),
    ]);
    await sleep(200);

    let state = await getStreamState(taskId);
    expect(state!.blocks.some((b) => b.type === "reasoning_chunk")).toBe(true);

    // Cancel emits persisted reasoning then done
    await queueStreamEvents([
      evt(2, "reasoning", "step 1step 2", `${S_EXEC_ID}-r1`),
      evt(99, "done", "", `${S_EXEC_ID}-done`, { done: true }),
    ]);
    await sleep(300);

    state = await getStreamState(taskId);
    // All live blocks cleared after done
    expect(state!.blocks.filter((b: { type: string }) => b.type === "reasoning_chunk")).toHaveLength(0);
    expect(state!.blocks.filter((b: { type: string }) => b.type === "text_chunk")).toHaveLength(0);

    // The pulsing reasoning icon should be gone
    const stillPulsing = await webEval<boolean>(`
      return !!document.querySelector('.rb__icon--pulse');
    `);
    expect(stillPulsing).toBe(false);

    await closeTaskDrawer();
  });

  // T-45 ─ S-5: subagent events
  test("T-45 S-5: subagent events render separately from parent stream", async () => {
    await openTaskDrawer(taskId);

    const spawnId = "spawn-001";

    await queueStreamEvents([
      // Parent: text before spawn
      evt(0, "text_chunk", "Spawning subagent..."),
      // Parent: tool_call that spawns subagent
      evt(1, "tool_call", JSON.stringify({ type: "function", function: { name: "spawn_agent", arguments: "{}" }, id: spawnId }), spawnId),
    ]);
    await sleep(200);

    // Subagent events tagged with subagentId
    await queueStreamEvents([
      {
        taskId,
        executionId: S_EXEC_ID,
        seq: 10,
        blockId: `${S_EXEC_ID}-sub-r`,
        type: "reasoning_chunk",
        content: "Subagent thinking...",
        metadata: null,
        subagentId: `${spawnId}-0`,
        done: false,
      },
      {
        taskId,
        executionId: S_EXEC_ID,
        seq: 11,
        blockId: `${S_EXEC_ID}-sub-t`,
        type: "text_chunk",
        content: "Subagent output.",
        metadata: null,
        subagentId: `${spawnId}-0`,
        done: false,
      },
    ]);
    await sleep(300);

    // Subagent blocks present in state
    const state = await getStreamState(taskId);
    const subagentBlocks = state!.blocks.filter((b: { subagentId?: string }) => b.subagentId === `${spawnId}-0`);
    expect(subagentBlocks.length).toBeGreaterThan(0);

    // Parent tool_call block present
    expect(state!.blocks.some((b: { type: string }) => b.type === "tool_call")).toBe(true);

    // Cleanup
    await queueStreamEvents([evt(99, "done", "", `${S_EXEC_ID}-done`, { done: true })]);
    await sleep(300);
    await closeTaskDrawer();
  });
});
