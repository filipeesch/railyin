/**
 * chat-timeline-pipeline.test.ts — UI regression tests for the unified stream-event pipeline.
 *
 * Test runner: bun test  (bun:test)
 * Transport:   HTTP bridge to Electrobun debug server
 * Sync:        streamVersion watermark (no sleep-based waits in test bodies)
 *
 * Run: bun test src/ui-tests/chat-timeline-pipeline.test.ts --timeout 120000 -- --debug=9229
 * Requires the app to be running with: electrobun dev --test-mode
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
 *     S-2 (T-42): reasoning → tool → text — tool_call nested under reasoning block, reasoning replaces live chunks
 *     S-3 (T-43): multiple tool rounds — multiple tool pairs interleaved with text
 *     S-4 (T-44): cancel mid-reasoning — partial reasoning rendered, no ghost live blocks after cancel
 *     S-5 (T-45): subagent events — subagent blocks render with correct attribution
 *
 *   Suite N — streaming & nesting scenarios:
 *     T-46: reasoning chunks stream incrementally — content grows after each inject
 *     T-47: reasoning chunks batch — exactly 1 reasoning_chunk block, content concatenated
 *     T-48: reasoning bubble auto-opens during streaming, auto-closes after done
 *     T-49: nested tool_call under parent — child in parent's children[], NOT in roots[]
 *     T-50: reasoning_chunk with parentBlockId renders inside tool's children
 *     T-51: full orchestrator flow — roots=[reasoning, tool_call, assistant], nested reasoning inside tool
 *     T-52: persisted reasoning replaces live reasoning_chunk blocks
 *     T-53: text_chunk streams word-by-word — DOM content grows after each inject
 *     T-54: subagent text_chunk word-by-word inside tool — DOM grows in .tcg__children
 *     T-55: subagent reasoning_chunk word-by-word inside tool — DOM grows in .tcg__children .rb
 *
 *   Suite Q — sequential & interleaving order scenarios:
 *     T-56: same tool called twice — two separate collapsibles in DOM with distinct names
 *     T-57: fully interleaved — reasoning→tool→text→tool→text, first tool nested under reasoning, DOM order correct
 *     T-58: streaming granularity — tools injected one-at-a-time, each DOM-visible before next arrives
 *     T-59: sequence inside reasoning bubble — nested tool+text children under a tool_call parent
 */

import { describe, test, expect, beforeAll, beforeEach } from "bun:test";
import {
  sleep,
  waitFor,
  setupTestEnv,
  openTaskDrawer,
  closeTaskDrawer,
  webEval,
  injectEvents,
  resetStream,
  getStreamState,
  BRIDGE_BASE,
} from "./bridge";

let taskId: number;

// Use a synthetic executionId that won't collide with real executions in memory-db mode.
const EXEC_ID = 99_901;

beforeAll(async () => {
  const env = await setupTestEnv();
  taskId = env.taskId;
  await openTaskDrawer(taskId);
});

// ─── Suite T — stream-event pipeline ─────────────────────────────────────────

describe("Suite T — stream-event pipeline rendering", () => {
  beforeEach(async () => {
    await resetStream(taskId, EXEC_ID);
  });

  test("T-28: text_chunk renders live .streaming bubble", async () => {
    await injectEvents([
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

    const visible = await waitFor(".msg__bubble.streaming", 500);
    expect(visible).toBe(true);

    const text = await webEval<string>(`
      var el = document.querySelector('.msg__bubble.streaming');
      return el ? el.textContent.trim() : '';
    `);
    expect(text).toContain("Hello from T-28");
  });

  test("T-29: reasoning_chunk renders .rb with pulsing icon", async () => {
    await injectEvents([
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

    const visible = await waitFor(".rb", 500);
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
    await injectEvents([
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

    const appeared = await waitFor(".msg__bubble.streaming", 500);
    expect(appeared).toBe(true);

    // Send done event
    await injectEvents([
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

    // After done, live blocks should be purged — wait for DOM to reflect
    await sleep(100);

    const stillStreaming = await webEval<boolean>(`
      return !!document.querySelector('.msg__bubble.streaming');
    `);
    expect(stillStreaming).toBe(false);
  });

  test("T-31: multiple text_chunks merge into one live block (no duplicate content)", async () => {
    const words = ["word1", " word2", " word3"];
    for (let i = 0; i < words.length; i++) {
      await injectEvents([
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

    const state = await getStreamState(taskId);
    expect(state).not.toBeNull();

    // Should be exactly one text_chunk block
    const textChunkBlocks = state!.blocks.filter((b) => b.type === "text_chunk");
    expect(textChunkBlocks).toHaveLength(1);
    expect(textChunkBlocks[0].content).toBe("word1 word2 word3");
  });

  test("T-32: reasoning_chunk before text_chunk: both present in correct order", async () => {
    await injectEvents([
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
    await injectEvents([
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

    const state = await getStreamState(taskId);
    expect(state).not.toBeNull();

    const types = state!.blocks.map((b) => b.type);
    expect(types).toContain("reasoning_chunk");
    expect(types).toContain("text_chunk");

    // Reasoning must appear before text in the roots order
    const rIdx = state!.roots.findIndex((id) => {
      const b = state!.blocks.find((x) => x.blockId === id);
      return b?.type === "reasoning_chunk";
    });
    const tIdx = state!.roots.findIndex((id) => {
      const b = state!.blocks.find((x) => x.blockId === id);
      return b?.type === "text_chunk";
    });
    expect(rIdx).toBeLessThan(tIdx);
  });

  test("T-33: stream state survives drawer close and reopen", async () => {
    await injectEvents([
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

    await closeTaskDrawer();
    await sleep(200);

    // Stream state should still be in the store
    const stateClosed = await getStreamState(taskId);
    expect(stateClosed).not.toBeNull();
    const textBlock = stateClosed!.blocks.find((b) => b.type === "text_chunk");
    expect(textBlock?.content).toContain("Persistent content for T-33");

    // Reopen and verify the bubble is still visible
    await openTaskDrawer(taskId);
    await sleep(200);

    const visible = await waitFor(".msg__bubble.streaming", 500);
    expect(visible).toBe(true);

    const text = await webEval<string>(`
      var el = document.querySelector('.msg__bubble.streaming');
      return el ? el.textContent.trim() : '';
    `);
    expect(text).toContain("Persistent content for T-33");
  });

  test("T-34: status_chunk renders ephemeral status text (not a streaming bubble)", async () => {
    await injectEvents([
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

    const state = await getStreamState(taskId);
    expect(state?.statusMessage).toBe("Running tool…");

    // status_chunk does NOT create a text_chunk block
    const hasTextBlock = state!.blocks.some((b) => b.type === "text_chunk");
    expect(hasTextBlock).toBe(false);
  });

  test("T-35: reasoning bubble closes (stops pulsing) after done event", async () => {
    await injectEvents([
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

    const appeared = await waitFor(".rb__icon--pulse", 500);
    expect(appeared).toBe(true);

    // Send done — the entire live section should disappear
    await injectEvents([
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
    await sleep(100);

    const stillPulsing = await webEval<boolean>(`
      return !!document.querySelector('.rb__icon--pulse');
    `);
    expect(stillPulsing).toBe(false);
  });

  test("T-36: status message disappears after done event", async () => {
    await injectEvents([
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

    const state1 = await getStreamState(taskId);
    expect(state1?.statusMessage).toBe("Starting Copilot engines");

    const statusVisible = await webEval<boolean>(`
      var el = document.querySelector('.msg--status-ephemeral');
      return el ? el.textContent.includes('Starting Copilot engines') : false;
    `);
    expect(statusVisible).toBe(true);

    // Done should clear status message
    await injectEvents([
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
    await sleep(100);

    const state2 = await getStreamState(taskId);
    expect(state2?.statusMessage).toBe("");

    const statusGone = await webEval<boolean>(`
      return !document.querySelector('.msg--status-ephemeral');
    `);
    expect(statusGone).toBe(true);
  });

  test("T-37: new execution (different executionId) resets stream state so second run is visible", async () => {
    // First execution: complete it so isDone = true
    await injectEvents([
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

    const state1 = await getStreamState(taskId);
    expect(state1?.isDone).toBe(true);

    // Second execution with different executionId
    const EXEC_ID_2 = EXEC_ID + 1;
    await injectEvents([
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
    await injectEvents([
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

    const textVisible = await waitFor(".msg__bubble.streaming", 500);
    expect(textVisible).toBe(true);

    const text = await webEval<string>(`
      var el = document.querySelector('.msg__bubble.streaming');
      return el ? el.textContent.trim() : '';
    `);
    expect(text).toContain("Second execution response");

    // Cleanup: send done for second execution
    await injectEvents([
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
  });

  test("T-38: tool_call event clears live reasoning_chunk blocks (prevents stacked reasoning)", async () => {
    // Reasoning arrives real-time
    await injectEvents([
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

    // Verify reasoning bubble is visible
    const rbVisible = await waitFor(".rb__icon--pulse", 500);
    expect(rbVisible).toBe(true);

    // tool_call persisted event fires (simulates the batcher sending it after the tool starts)
    await injectEvents([
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
    await sleep(50);

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
    await injectEvents(chunks);
    await sleep(200);

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
    await sleep(50);

    // Send reasoning_chunk events to create a reasoning bubble
    await injectEvents([
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
    await sleep(200);

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
    await injectEvents([{
      taskId,
      executionId: EXEC_ID,
      seq: 99,
      blockId: `${EXEC_ID}-rb-done`,
      type: "done",
      content: "",
      done: true,
    }]);
  });
});

// ─── Suite S — Mixed scenario rendering ─────────────────────────────────────
// Mirrors Layer 1 backend scenarios but asserts DOM state.
// All use a distinct EXEC_ID (99_902) to avoid state bleed from Suite T.

const S_EXEC_ID = 99_902;

describe("Suite S — mixed scenario rendering", () => {
  beforeEach(async () => {
    await resetStream(taskId, S_EXEC_ID);
  });

  function evt(
    seq: number,
    type: string,
    content: string,
    blockId?: string,
    extra: Partial<{ subagentId: string; done: boolean; parentBlockId: string }> = {},
  ) {
    return {
      taskId,
      executionId: S_EXEC_ID,
      seq,
      blockId: blockId ?? `${S_EXEC_ID}-${seq}`,
      type,
      content,
      metadata: null,
      parentBlockId: extra.parentBlockId ?? null,
      done: extra.done ?? false,
    };
  }

  // T-41 ─ S-1: reasoning then text
  test("T-41 S-1: reasoning streams live then both reasoning and text blocks present in order", async () => {
    await openTaskDrawer(taskId);

    // Inject reasoning_chunk then text_chunk (simulates live stream before persisted arrives)
    await injectEvents([
      evt(0, "reasoning_chunk", "I am thinking..."),
      evt(1, "text_chunk", "Hello world."),
    ]);

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
    await injectEvents([evt(99, "done", "", `${S_EXEC_ID}-done`, { done: true })]);
    await closeTaskDrawer();
  });

  // T-42 ─ S-2: reasoning → tool → text (tool nested under reasoning)
  test("T-42 S-2: tool_call nests under reasoning block; live reasoning_chunk replaced", async () => {
    await openTaskDrawer(taskId);

    // Reasoning live
    await injectEvents([evt(0, "reasoning_chunk", "Planning to read file...")]);

    let state = await getStreamState(taskId);
    expect(state!.blocks.some((b) => b.type === "reasoning_chunk")).toBe(true);

    // Persisted reasoning + tool_call with parentBlockId (orchestrator now nests tool under reasoning)
    const toolCallContent = JSON.stringify({
      type: "function",
      function: { name: "read_file", arguments: '{"path":"/tmp/a.txt"}' },
      id: "tc1",
    });
    await injectEvents([
      evt(1, "reasoning", "Planning to read file...", `${S_EXEC_ID}-r1`),
      evt(2, "tool_call", toolCallContent, "tc1", { parentBlockId: `${S_EXEC_ID}-r1` }),
    ]);

    state = await getStreamState(taskId);
    const blockTypes = state!.blocks.map((b: { type: string }) => b.type);

    // reasoning_chunk live block should be gone (replaced by persisted reasoning)
    expect(blockTypes.filter((t: string) => t === "reasoning_chunk")).toHaveLength(0);

    // tool_call is NOT a root — it's a child of the reasoning block
    expect(state!.roots).not.toContain("tc1");
    const reasoningBlock = state!.blocks.find((b) => b.blockId === `${S_EXEC_ID}-r1`);
    expect(reasoningBlock).toBeDefined();
    expect(reasoningBlock!.children).toContain("tc1");

    // tool_result + text then done
    await injectEvents([
      evt(3, "tool_result", JSON.stringify({ success: true, result: "contents" }), "tc1"),
      evt(4, "text_chunk", "Done."),
      evt(99, "done", "", `${S_EXEC_ID}-done`, { done: true }),
    ]);

    // No ghost live blocks after done
    const finalState = await getStreamState(taskId);
    expect(finalState!.blocks.filter((b: { type: string }) => b.type === "reasoning_chunk")).toHaveLength(0);
    // text_chunk is preserved (marked done) — content survives cancel
    const textChunks = finalState!.blocks.filter((b: { type: string }) => b.type === "text_chunk");
    expect(textChunks.length).toBeGreaterThanOrEqual(1);
    expect(textChunks.every((b: { done: boolean }) => b.done)).toBe(true);

    await closeTaskDrawer();
  });

  // T-43 ─ S-3: multiple tool rounds
  test("T-43 S-3: multiple tool pairs render with text between them", async () => {
    await openTaskDrawer(taskId);

    const toolCall = (id: string, name: string) =>
      JSON.stringify({ type: "function", function: { name, arguments: "{}" }, id });
    const toolResult = (id: string) =>
      JSON.stringify({ success: true, result: `result from ${id}` });

    await injectEvents([
      evt(0, "text_chunk", "First. "),
      evt(1, "tool_call", toolCall("c1", "write_file"), "c1"),
      evt(2, "tool_result", toolResult("c1"), "c1"),
      evt(3, "text_chunk", "Second. "),
      evt(4, "tool_call", toolCall("c2", "read_file"), "c2"),
      evt(5, "tool_result", toolResult("c2"), "c2"),
      evt(6, "text_chunk", "Done."),
      evt(99, "done", "", `${S_EXEC_ID}-done`, { done: true }),
    ]);

    const state = await getStreamState(taskId);
    const toolCallBlocks = state!.blocks.filter((b: { type: string }) => b.type === "tool_call");

    expect(toolCallBlocks).toHaveLength(2);

    // Order: tool_call appears in sequence
    const rootTypes = state!.roots.map((id: string) => {
      const b = state!.blocks.find((x) => x.blockId === id);
      return b?.type;
    });
    const tcIndices = rootTypes.reduce((acc: number[], t: string | undefined, i: number) => {
      if (t === "tool_call") acc.push(i);
      return acc;
    }, []);
    expect(tcIndices).toHaveLength(2);
    expect(tcIndices[0]).toBeLessThan(tcIndices[1]);

    await closeTaskDrawer();
  });

  // T-44 ─ S-4: cancel mid-reasoning — no ghost blocks
  test("T-44 S-4: after done event all live blocks are cleared (cancel path)", async () => {
    await openTaskDrawer(taskId);

    // Simulate reasoning streaming then abrupt done (cancel path)
    await injectEvents([
      evt(0, "reasoning_chunk", "step 1"),
      evt(1, "reasoning_chunk", "step 2"),
    ]);

    let state = await getStreamState(taskId);
    expect(state!.blocks.some((b) => b.type === "reasoning_chunk")).toBe(true);

    // Cancel emits persisted reasoning then done
    await injectEvents([
      evt(2, "reasoning", "step 1step 2", `${S_EXEC_ID}-r1`),
      evt(99, "done", "", `${S_EXEC_ID}-done`, { done: true }),
    ]);
    await sleep(100);

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

    await injectEvents([
      // Parent: text before spawn
      evt(0, "text_chunk", "Spawning subagent..."),
      // Parent: tool_call that spawns subagent
      evt(1, "tool_call", JSON.stringify({ type: "function", function: { name: "spawn_agent", arguments: "{}" }, id: spawnId }), spawnId),
    ]);

    // Subagent events with parentBlockId pointing to the tool_call
    await injectEvents([
      {
        taskId,
        executionId: S_EXEC_ID,
        seq: 10,
        blockId: `${S_EXEC_ID}-sub-r`,
        type: "reasoning_chunk",
        content: "Subagent thinking...",
        metadata: null,
        parentBlockId: spawnId,
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
        parentBlockId: spawnId,
        done: false,
      },
    ]);

    // Subagent blocks present as children of the tool_call
    const state = await getStreamState(taskId);
    const toolCallBlock = state!.blocks.find((b) => b.type === "tool_call");
    expect(toolCallBlock).toBeDefined();
    expect(toolCallBlock!.children.length).toBeGreaterThan(0);

    // Children should include reasoning and text blocks
    const childBlocks = state!.blocks.filter((b) => b.parentBlockId === spawnId);
    expect(childBlocks.length).toBeGreaterThan(0);
    expect(childBlocks.some((b) => b.type === "reasoning_chunk")).toBe(true);
    expect(childBlocks.some((b) => b.type === "text_chunk")).toBe(true);

    // Cleanup
    await injectEvents([evt(99, "done", "", `${S_EXEC_ID}-done`, { done: true })]);
    await closeTaskDrawer();
  });
});

// ─── Suite N — New streaming & nesting scenarios ─────────────────────────────
// T-46 through T-52: covers reasoning streaming, nesting, and replacement bugs.

const N_EXEC_ID = 99_903;

describe("Suite N — streaming & nesting scenarios", () => {
  beforeEach(async () => {
    await resetStream(taskId, N_EXEC_ID);
    await openTaskDrawer(taskId);
  });

  function nEvt(
    seq: number,
    type: string,
    content: string,
    blockId?: string,
    extra: Partial<{ done: boolean; parentBlockId: string }> = {},
  ) {
    return {
      taskId,
      executionId: N_EXEC_ID,
      seq,
      blockId: blockId ?? `${N_EXEC_ID}-${seq}`,
      type,
      content,
      metadata: null,
      parentBlockId: extra.parentBlockId ?? null,
      done: extra.done ?? false,
    };
  }

  // T-46: Reasoning chunks stream incrementally
  test("T-46: reasoning chunks stream incrementally — content grows after each inject", async () => {
    await injectEvents([nEvt(0, "reasoning_chunk", "Alpha ")]);
    const rb1 = await waitFor(".rb", 500);
    expect(rb1).toBe(true);

    let content = await webEval<string>(`
      var el = document.querySelector('.rb__content');
      return el ? el.textContent.trim() : '';
    `);
    expect(content).toContain("Alpha");

    await injectEvents([nEvt(1, "reasoning_chunk", "Beta ")]);
    content = await webEval<string>(`
      var el = document.querySelector('.rb__content');
      return el ? el.textContent.trim() : '';
    `);
    expect(content).toContain("Beta");

    await injectEvents([nEvt(2, "reasoning_chunk", "Gamma")]);
    content = await webEval<string>(`
      var el = document.querySelector('.rb__content');
      return el ? el.textContent.trim() : '';
    `);
    expect(content).toContain("Gamma");

    // Should be streaming throughout
    const isStreaming = await webEval<boolean>(`
      return !!document.querySelector('.rb__content--streaming');
    `);
    expect(isStreaming).toBe(true);
  });

  // T-47: Reasoning chunks batch-accumulate into one block
  test("T-47: reasoning chunks batch — exactly 1 reasoning_chunk block, content concatenated", async () => {
    await injectEvents([
      nEvt(0, "reasoning_chunk", "Part-A "),
      nEvt(1, "reasoning_chunk", "Part-B "),
      nEvt(2, "reasoning_chunk", "Part-C"),
    ]);

    const state = await getStreamState(taskId);
    const rcBlocks = state!.blocks.filter((b) => b.type === "reasoning_chunk");
    expect(rcBlocks).toHaveLength(1);
    expect(rcBlocks[0].content).toBe("Part-A Part-B Part-C");
  });

  // T-48: Reasoning bubble auto-opens while streaming, auto-closes after done
  test("T-48: reasoning bubble auto-opens during streaming, auto-closes after done", async () => {
    await injectEvents([nEvt(0, "reasoning_chunk", "Streaming thought...")]);

    // Bubble should be open (body visible)
    const bodyVisible = await waitFor(".rb__body", 500);
    expect(bodyVisible).toBe(true);

    // Send persisted reasoning + done to close
    await injectEvents([
      nEvt(1, "reasoning", "Streaming thought...", `${N_EXEC_ID}-r1`),
      nEvt(99, "done", "", `${N_EXEC_ID}-done`, { done: true }),
    ]);
    await sleep(200);

    // Pulsing icon should be gone
    const stillPulsing = await webEval<boolean>(`
      return !!document.querySelector('.rb__icon--pulse');
    `);
    expect(stillPulsing).toBe(false);
  });

  // T-49: Nested tool call under parent tool
  test("T-49: nested tool_call under parent — child in parent's children[], NOT in roots[]", async () => {
    const parentTc = JSON.stringify({ type: "function", function: { name: "orchestrate", arguments: "{}" }, id: "parent-tc" });
    const childTc = JSON.stringify({ type: "function", function: { name: "read_file", arguments: "{}" }, id: "child-tc" });

    await injectEvents([
      nEvt(0, "tool_call", parentTc, "parent-tc"),
    ]);
    await injectEvents([
      nEvt(1, "tool_call", childTc, "child-tc", { parentBlockId: "parent-tc" }),
    ]);

    const state = await getStreamState(taskId);

    // child-tc should be in parent's children
    const parentBlock = state!.blocks.find((b) => b.blockId === "parent-tc");
    expect(parentBlock).toBeDefined();
    expect(parentBlock!.children).toContain("child-tc");

    // child-tc should NOT be in roots
    expect(state!.roots).not.toContain("child-tc");
  });

  // T-50: Reasoning chunk inside tool context
  test("T-50: reasoning_chunk with parentBlockId renders inside tool's children", async () => {
    const tcContent = JSON.stringify({ type: "function", function: { name: "analyze", arguments: "{}" }, id: "tool-50" });

    await injectEvents([
      nEvt(0, "tool_call", tcContent, "tool-50"),
    ]);
    await injectEvents([
      nEvt(1, "reasoning_chunk", "Thinking inside tool...", `${N_EXEC_ID}-sub-r`, { parentBlockId: "tool-50" }),
    ]);

    const state = await getStreamState(taskId);

    // Reasoning should be a child of the tool_call
    const toolBlock = state!.blocks.find((b) => b.blockId === "tool-50");
    expect(toolBlock).toBeDefined();
    expect(toolBlock!.children.length).toBeGreaterThan(0);

    // Live reasoning_chunk gets a store-generated blockId — find it by type + parentBlockId
    const childReasoningBlock = state!.blocks.find(
      (b) => b.type === "reasoning_chunk" && b.parentBlockId === "tool-50",
    );
    expect(childReasoningBlock).toBeDefined();
    expect(childReasoningBlock!.content).toContain("Thinking inside tool...");

    // Should NOT be in roots
    expect(state!.roots).not.toContain(childReasoningBlock!.blockId);

    // DOM: expand tool call, then reasoning bubble should be nested inside
    await webEval(`
      var header = document.querySelector('.tcg__header');
      if (header) header.click();
    `);
    await sleep(100);
    const nestedRb = await webEval<boolean>(`
      return !!document.querySelector('.tcg__children .rb');
    `);
    expect(nestedRb).toBe(true);
  });

  // T-51: Full orchestrator nesting flow
  test("T-51: full orchestrator flow — roots=[reasoning, tool_call, assistant], nested reasoning inside tool", async () => {
    const tcContent = JSON.stringify({ type: "function", function: { name: "execute", arguments: "{}" }, id: "orch-tc" });

    // Phase 1: reasoning streams live
    await injectEvents([
      nEvt(0, "reasoning_chunk", "Planning execution..."),
    ]);

    // Phase 2: persisted reasoning + tool_call
    await injectEvents([
      nEvt(1, "reasoning", "Planning execution...", `${N_EXEC_ID}-r1`),
      nEvt(2, "tool_call", tcContent, "orch-tc"),
    ]);

    // Phase 3: nested reasoning inside tool
    await injectEvents([
      nEvt(3, "reasoning_chunk", "Subagent reasoning...", `${N_EXEC_ID}-sub-r`, { parentBlockId: "orch-tc" }),
    ]);

    // Phase 4: nested persisted reasoning + tool_result + assistant
    await injectEvents([
      nEvt(4, "reasoning", "Subagent reasoning...", `${N_EXEC_ID}-sub-r-final`, { parentBlockId: "orch-tc" }),
      nEvt(5, "tool_result", JSON.stringify({ success: true, result: "done" }), "orch-tc"),
      nEvt(6, "assistant", "Here is the result.", `${N_EXEC_ID}-assistant`),
      nEvt(99, "done", "", `${N_EXEC_ID}-done`, { done: true }),
    ]);

    const state = await getStreamState(taskId);

    // Roots should include reasoning, tool_call, assistant (not nested reasoning)
    const rootTypes = state!.roots.map((id: string) => {
      const b = state!.blocks.find((x) => x.blockId === id);
      return b?.type;
    });
    expect(rootTypes).toContain("reasoning");
    expect(rootTypes).toContain("tool_call");
    expect(rootTypes).toContain("assistant");

    // Tool should have nested reasoning child
    const toolBlock = state!.blocks.find((b) => b.blockId === "orch-tc");
    expect(toolBlock!.children.length).toBeGreaterThan(0);

    // No live blocks after done
    const liveBlocks = state!.blocks.filter((b) => b.type === "reasoning_chunk" || b.type === "text_chunk");
    expect(liveBlocks).toHaveLength(0);
  });

  // T-52: Persisted reasoning replaces live chunks
  test("T-52: persisted reasoning replaces live reasoning_chunk blocks", async () => {
    // Build up live reasoning
    await injectEvents([
      nEvt(0, "reasoning_chunk", "a"),
      nEvt(1, "reasoning_chunk", "b"),
      nEvt(2, "reasoning_chunk", "c"),
    ]);

    let state = await getStreamState(taskId);
    expect(state!.blocks.filter((b) => b.type === "reasoning_chunk")).toHaveLength(1);
    expect(state!.blocks.find((b) => b.type === "reasoning_chunk")!.content).toBe("abc");

    // Persisted reasoning replaces live chunks
    await injectEvents([
      nEvt(3, "reasoning", "abc", `${N_EXEC_ID}-r1`),
    ]);

    state = await getStreamState(taskId);
    // 0 reasoning_chunk blocks, 1 reasoning block
    expect(state!.blocks.filter((b) => b.type === "reasoning_chunk")).toHaveLength(0);
    const reasoningBlocks = state!.blocks.filter((b) => b.type === "reasoning");
    expect(reasoningBlocks).toHaveLength(1);
    expect(reasoningBlocks[0].content).toBe("abc");
  });

  // T-53: text_chunk streams word-by-word with DOM assertion after each
  test("T-53: text_chunk streams word-by-word — DOM content grows after each inject", async () => {
    const words = ["Hello ", "beautiful ", "world"];

    await injectEvents([nEvt(0, "text_chunk", words[0])]);
    const appeared = await waitFor(".msg__bubble.streaming", 500);
    expect(appeared).toBe(true);

    let text = await webEval<string>(`
      var el = document.querySelector('.msg__bubble.streaming');
      return el ? el.textContent.trim() : '';
    `);
    expect(text).toContain("Hello");

    await injectEvents([nEvt(1, "text_chunk", words[1])]);
    text = await webEval<string>(`
      var el = document.querySelector('.msg__bubble.streaming');
      return el ? el.textContent.trim() : '';
    `);
    expect(text).toContain("beautiful");

    await injectEvents([nEvt(2, "text_chunk", words[2])]);
    text = await webEval<string>(`
      var el = document.querySelector('.msg__bubble.streaming');
      return el ? el.textContent.trim() : '';
    `);
    expect(text).toContain("world");
    // All three words should be present (merged)
    expect(text).toContain("Hello");
    expect(text).toContain("beautiful");
  });

  // T-54: subagent text_chunk streams word-by-word inside tool children
  test("T-54: subagent text_chunk word-by-word inside tool — DOM grows in .tcg__children", async () => {
    const tcContent = JSON.stringify({ type: "function", function: { name: "sub_task", arguments: "{}" }, id: "tool-54" });

    await injectEvents([nEvt(0, "tool_call", tcContent, "tool-54")]);

    // Expand the tool call so children are visible
    await webEval(`
      var header = document.querySelector('.tcg__header');
      if (header) header.click();
    `);
    await sleep(100);

    const words = ["Sub ", "agent ", "output"];
    await injectEvents([nEvt(1, "text_chunk", words[0], `${N_EXEC_ID}-sub-t`, { parentBlockId: "tool-54" })]);

    // Child text should appear inside tool children
    let text = await webEval<string>(`
      var el = document.querySelector('.tcg__children .msg__bubble.streaming');
      return el ? el.textContent.trim() : '';
    `);
    expect(text).toContain("Sub");

    await injectEvents([nEvt(2, "text_chunk", words[1], `${N_EXEC_ID}-sub-t`, { parentBlockId: "tool-54" })]);
    text = await webEval<string>(`
      var el = document.querySelector('.tcg__children .msg__bubble.streaming');
      return el ? el.textContent.trim() : '';
    `);
    expect(text).toContain("agent");

    await injectEvents([nEvt(3, "text_chunk", words[2], `${N_EXEC_ID}-sub-t`, { parentBlockId: "tool-54" })]);
    text = await webEval<string>(`
      var el = document.querySelector('.tcg__children .msg__bubble.streaming');
      return el ? el.textContent.trim() : '';
    `);
    expect(text).toContain("output");
    expect(text).toContain("Sub");
  });

  // T-55: subagent reasoning_chunk streams word-by-word inside tool children
  test("T-55: subagent reasoning_chunk word-by-word inside tool — DOM grows in .tcg__children .rb", async () => {
    const tcContent = JSON.stringify({ type: "function", function: { name: "analyze", arguments: "{}" }, id: "tool-55" });

    await injectEvents([nEvt(0, "tool_call", tcContent, "tool-55")]);

    // Expand the tool call
    await webEval(`
      var header = document.querySelector('.tcg__header');
      if (header) header.click();
    `);
    await sleep(100);

    const words = ["Think ", "deeply ", "now"];
    await injectEvents([nEvt(1, "reasoning_chunk", words[0], `${N_EXEC_ID}-sub-r`, { parentBlockId: "tool-55" })]);

    let content = await webEval<string>(`
      var el = document.querySelector('.tcg__children .rb__content');
      return el ? el.textContent.trim() : '';
    `);
    expect(content).toContain("Think");

    await injectEvents([nEvt(2, "reasoning_chunk", words[1], `${N_EXEC_ID}-sub-r`, { parentBlockId: "tool-55" })]);
    content = await webEval<string>(`
      var el = document.querySelector('.tcg__children .rb__content');
      return el ? el.textContent.trim() : '';
    `);
    expect(content).toContain("deeply");

    await injectEvents([nEvt(3, "reasoning_chunk", words[2], `${N_EXEC_ID}-sub-r`, { parentBlockId: "tool-55" })]);
    content = await webEval<string>(`
      var el = document.querySelector('.tcg__children .rb__content');
      return el ? el.textContent.trim() : '';
    `);
    expect(content).toContain("now");
    expect(content).toContain("Think");
  });
});

// ─── Suite Q — sequential & interleaving order scenarios ─────────────────────
// T-56 through T-59: covers same-tool-twice, fully mixed sequences, streaming
// granularity, and nested sequences inside a reasoning bubble.

const Q_EXEC_ID = 99_904;

describe("Suite Q — sequential & interleaving order scenarios", () => {
  beforeEach(async () => {
    await resetStream(taskId, Q_EXEC_ID);
    await openTaskDrawer(taskId);
  });

  function qEvt(
    seq: number,
    type: string,
    content: string,
    blockId?: string,
    extra: Partial<{ done: boolean; parentBlockId: string }> = {},
  ) {
    return {
      taskId,
      executionId: Q_EXEC_ID,
      seq,
      blockId: blockId ?? `${Q_EXEC_ID}-${seq}`,
      type,
      content,
      metadata: null,
      parentBlockId: extra.parentBlockId ?? null,
      done: extra.done ?? false,
    };
  }

  function toolCallContent(id: string, name: string, args = "{}") {
    return JSON.stringify({ type: "function", function: { name, arguments: args }, id });
  }
  function toolResultContent(id: string, result = "ok") {
    return JSON.stringify({ success: true, result });
  }

  // T-56: same tool name called twice → two separate .tcg collapsibles
  test("T-56: same tool called twice — two separate collapsibles in DOM", async () => {
    await injectEvents([
      qEvt(0, "tool_call", toolCallContent("tc-a", "read_file", '{"path":"/a.txt"}'), "tc-a"),
      qEvt(1, "tool_result", toolResultContent("tc-a", "content of a"), "tc-a"),
      qEvt(2, "tool_call", toolCallContent("tc-b", "read_file", '{"path":"/b.txt"}'), "tc-b"),
      qEvt(3, "tool_result", toolResultContent("tc-b", "content of b"), "tc-b"),
      qEvt(99, "done", "", `${Q_EXEC_ID}-done`, { done: true }),
    ]);

    // Two .tcg elements rendered
    const count = await webEval<number>(`
      return document.querySelectorAll('.tcg').length;
    `);
    expect(count).toBe(2);

    // Both show "read_file"
    const names = await webEval<string[]>(`
      return Array.from(document.querySelectorAll('.tcg__tool-name')).map(el => el.textContent.trim());
    `);
    expect(names).toHaveLength(2);
    expect(names[0]).toBe("read_file");
    expect(names[1]).toBe("read_file");

    // Primary args differ
    const args = await webEval<string[]>(`
      return Array.from(document.querySelectorAll('.tcg__primary-arg')).map(el => el.textContent.trim());
    `);
    expect(args[0]).toContain("a.txt");
    expect(args[1]).toContain("b.txt");

    // Store roots order: tc-a before tc-b
    const state = await getStreamState(taskId);
    const tcBlocks = state!.blocks.filter((b: { type: string }) => b.type === "tool_call");
    expect(tcBlocks).toHaveLength(2);
    const idxA = state!.roots.indexOf("tc-a");
    const idxB = state!.roots.indexOf("tc-b");
    expect(idxA).toBeGreaterThanOrEqual(0);
    expect(idxB).toBeGreaterThanOrEqual(0);
    expect(idxA).toBeLessThan(idxB);
  });

  // T-57: fully interleaved — reasoning → tool → text → tool → text
  test("T-57: fully interleaved sequence — DOM order matches event order", async () => {
    await injectEvents([
      // reasoning live → persisted
      qEvt(0, "reasoning_chunk", "Planning..."),
      qEvt(1, "reasoning", "Planning...", `${Q_EXEC_ID}-r1`),
      // first tool round (nested under reasoning — orchestrator sets parentBlockId)
      qEvt(2, "tool_call", toolCallContent("tc1", "write_file"), "tc1", { parentBlockId: `${Q_EXEC_ID}-r1` }),
      qEvt(3, "tool_result", toolResultContent("tc1"), "tc1"),
      // text between tools (clears reasoning context in orchestrator)
      qEvt(4, "text_chunk", "Between tools."),
      qEvt(5, "assistant", "Between tools.", `${Q_EXEC_ID}-a1`),
      // second tool round (no reasoning context — stays at root)
      qEvt(6, "tool_call", toolCallContent("tc2", "run_bash"), "tc2"),
      qEvt(7, "tool_result", toolResultContent("tc2"), "tc2"),
      // final text
      qEvt(8, "text_chunk", "All done."),
      qEvt(9, "assistant", "All done.", `${Q_EXEC_ID}-a2`),
      qEvt(99, "done", "", `${Q_EXEC_ID}-done`, { done: true }),
    ]);

    const state = await getStreamState(taskId);

    // Expected root order: reasoning, assistant, tool_call, assistant
    // (first tool_call is nested under reasoning)
    const rootBlocks = state!.roots.map((id: string) =>
      state!.blocks.find((b: { blockId: string }) => b.blockId === id),
    );
    const rootTypes = rootBlocks.map((b: { type: string } | undefined) => b?.type);

    expect(rootTypes[0]).toBe("reasoning");
    expect(rootTypes[1]).toBe("assistant");
    expect(rootTypes[2]).toBe("tool_call");
    expect(rootTypes[3]).toBe("assistant");

    // First tool_call is a child of the reasoning block
    const reasoningBlock = state!.blocks.find((b) => b.blockId === `${Q_EXEC_ID}-r1`);
    expect(reasoningBlock).toBeDefined();
    expect(reasoningBlock!.children).toContain("tc1");

    // DOM: .rb before first .tcg (first tcg is inside .rb__children)
    const rbBeforeFirst = await webEval<boolean>(`
      var rb = document.querySelector('.rb');
      var tcg = document.querySelector('.tcg');
      if (!rb || !tcg) return false;
      return !!(rb.compareDocumentPosition(tcg) & Node.DOCUMENT_POSITION_FOLLOWING);
    `);
    expect(rbBeforeFirst).toBe(true);

    // Two .tcg in DOM total (one nested in reasoning, one at root)
    const tcgCount = await webEval<number>(`
      return document.querySelectorAll('.tcg').length;
    `);
    expect(tcgCount).toBe(2);

    // First .tcg is inside reasoning bubble
    const nestedTcg = await webEval<boolean>(`
      return !!document.querySelector('.rb__children .tcg');
    `);
    expect(nestedTcg).toBe(true);
  });

  // T-58: streaming granularity — inject one tool at a time, each appears before next
  test("T-58: streaming granularity — each tool visible in DOM before next arrives", async () => {
    // First tool arrives alone
    await injectEvents([
      qEvt(0, "tool_call", toolCallContent("tc1", "step_one"), "tc1"),
    ]);

    // First tool is in DOM before second arrives
    const firstVisible = await webEval<boolean>(`
      var els = document.querySelectorAll('.tcg__tool-name');
      return Array.from(els).some(el => el.textContent.trim() === 'step_one');
    `);
    expect(firstVisible).toBe(true);

    // Second tool arrives
    await injectEvents([
      qEvt(1, "tool_result", toolResultContent("tc1"), "tc1"),
      qEvt(2, "tool_call", toolCallContent("tc2", "step_two"), "tc2"),
    ]);

    const bothVisible = await webEval<boolean>(`
      var els = Array.from(document.querySelectorAll('.tcg__tool-name')).map(el => el.textContent.trim());
      return els.includes('step_one') && els.includes('step_two');
    `);
    expect(bothVisible).toBe(true);

    // Third tool arrives
    await injectEvents([
      qEvt(3, "tool_result", toolResultContent("tc2"), "tc2"),
      qEvt(4, "tool_call", toolCallContent("tc3", "step_three"), "tc3"),
      qEvt(5, "tool_result", toolResultContent("tc3"), "tc3"),
      qEvt(99, "done", "", `${Q_EXEC_ID}-done`, { done: true }),
    ]);

    const allThreeVisible = await webEval<boolean>(`
      var els = Array.from(document.querySelectorAll('.tcg__tool-name')).map(el => el.textContent.trim());
      return els.includes('step_one') && els.includes('step_two') && els.includes('step_three');
    `);
    expect(allThreeVisible).toBe(true);

    // Store roots has all three in order
    const state = await getStreamState(taskId);
    const tcIds = state!.roots.filter((id: string) =>
      state!.blocks.find((b: { blockId: string; type: string }) => b.blockId === id && b.type === "tool_call"),
    );
    expect(tcIds).toEqual(["tc1", "tc2", "tc3"]);
  });

  // T-59: sequence inside reasoning bubble — tool + text as children of a parent tool_call
  test("T-59: sequence inside tool — reasoning then tool then text as nested children", async () => {
    const parentId = "parent-tool-59";

    // Parent tool spawns a subagent
    await injectEvents([
      qEvt(0, "tool_call", toolCallContent(parentId, "spawn_agent"), parentId),
    ]);

    // Expand parent
    await webEval(`
      var header = document.querySelector('.tcg__header');
      if (header) header.click();
    `);
    await sleep(100);

    // Subagent inside parent: reasoning → tool → text (all with parentBlockId=parentId)
    const childTcId = "child-tc-59";
    await injectEvents([
      qEvt(1, "reasoning_chunk", "Sub-thinking...", `${Q_EXEC_ID}-sub-rc`, { parentBlockId: parentId }),
      qEvt(2, "reasoning", "Sub-thinking...", `${Q_EXEC_ID}-sub-r`, { parentBlockId: parentId }),
      qEvt(3, "tool_call", toolCallContent(childTcId, "write_file", '{"path":"/x.txt"}'), childTcId, { parentBlockId: parentId }),
      qEvt(4, "tool_result", toolResultContent(childTcId, "written"), childTcId, { parentBlockId: parentId }),
      qEvt(5, "text_chunk", "Sub done.", `${Q_EXEC_ID}-sub-tc`, { parentBlockId: parentId }),
      qEvt(6, "assistant", "Sub done.", `${Q_EXEC_ID}-sub-a`, { parentBlockId: parentId }),
      qEvt(7, "tool_result", toolResultContent(parentId, "agent complete"), parentId),
      qEvt(99, "done", "", `${Q_EXEC_ID}-done`, { done: true }),
    ]);

    const state = await getStreamState(taskId);

    // Parent tool_call in roots
    expect(state!.roots).toContain(parentId);

    // Children of parent: [sub-reasoning, child-tool-call, sub-assistant]
    const parentBlock = state!.blocks.find((b: { blockId: string }) => b.blockId === parentId);
    expect(parentBlock).toBeDefined();
    const childIds = parentBlock!.children;
    const childTypes = childIds.map((id: string) =>
      state!.blocks.find((b: { blockId: string }) => b.blockId === id)?.type,
    );

    expect(childTypes).toContain("reasoning");
    expect(childTypes).toContain("tool_call");
    expect(childTypes).toContain("assistant");

    // Order inside children: reasoning before child tool_call
    const rIdx = childTypes.indexOf("reasoning");
    const tcIdx = childTypes.indexOf("tool_call");
    const aIdx = childTypes.indexOf("assistant");
    expect(rIdx).toBeLessThan(tcIdx);
    expect(tcIdx).toBeLessThan(aIdx);

    // DOM: inside .tcg__children we should see a .rb and a nested .tcg
    const rbInChildren = await webEval<boolean>(`
      return !!document.querySelector('.tcg__children .rb');
    `);
    expect(rbInChildren).toBe(true);

    const nestedTcg = await webEval<boolean>(`
      return !!document.querySelector('.tcg__children .tcg');
    `);
    expect(nestedTcg).toBe(true);
  });
});
