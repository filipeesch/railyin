/**
 * stream-tree-scenarios.test.ts — Integration tests for the stream block tree.
 *
 * Each test injects events via ScriptedEngine, waits for the execution to
 * finish, then:
 *   1. Reads persisted events from DB via `runtime.getDbStreamEvents()`
 *   2. Passes them to `buildStreamTree()` to get the block hierarchy
 *   3. Asserts on `tree.roots[]` order and `block.children[]` for nesting
 *
 * Scenarios:
 *   S-14  Simple text → single assistant root, no children
 *   S-15  Reasoning + text → two ordered roots [r, t], no children
 *   S-16  Text → tool → text → three roots [t1, c1, t2], tool has no children
 *   S-17  Cancel mid-text → flushed assistant in tree
 *   S-18  Reasoning inside tool (Copilot-style) → tool block has reasoning child
 *   S-19  Nested tools → outer tool has inner tool as child
 *
 * BlockId naming (from batcher):
 *   Text / assistant   → `{executionId}-t{n}`  (n starts at 1)
 *   Reasoning          → `{executionId}-r{n}`  (n starts at 1)
 *   Tool call / result → callId (e.g., "c1", "c2")
 */

import { describe, it, expect, afterEach } from "vitest";
import { createBackendRpcRuntime, type BackendRpcRuntime } from "./support/backend-rpc-runtime.ts";
import {
    ScriptedEngine,
    scriptToken,
    scriptReasoning,
    scriptToolStart,
    scriptToolResult,
    scriptDone,
    scriptWaitForAbort,
    scriptCheckpoint,
} from "./support/scripted-engine.ts";
import { buildStreamTree } from "../../shared/stream-tree.ts";

// ---------------------------------------------------------------------------
// Suite setup
// ---------------------------------------------------------------------------

let runtime: BackendRpcRuntime;

afterEach(() => {
    runtime?.cleanup();
});

function makeRuntime(engine: ScriptedEngine): BackendRpcRuntime {
    return createBackendRpcRuntime({ createEngine: () => engine });
}

// ---------------------------------------------------------------------------
// S-14: Simple text → done
//
// Stream:  token("Hello world") → done
// DB:      [assistant blockId="{execId}-t1"]
// Tree:    roots=["{execId}-t1"], no children
// ---------------------------------------------------------------------------

describe("S-14 [stream-tree]: simple text produces single root assistant block", () => {
    it("tree has one root with type=assistant and no children", async () => {
        const engine = new ScriptedEngine();
        engine.queueTurn([
            scriptToken("Hello world"),
            scriptDone(),
        ]);

        runtime = makeRuntime(engine);
        const { taskId } = await runtime.createTask();
        const { executionId } = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "go" });
        await runtime.recorder.waitForStreamDone(executionId);

        const db = runtime.getDbStreamEvents(executionId);
        const tree = buildStreamTree(db);

        const expectedBlockId = `${executionId}-t1`;

        expect(tree.roots).toEqual([expectedBlockId]);

        const block = tree.blocks.get(expectedBlockId);
        expect(block).toBeDefined();
        expect(block!.type).toBe("assistant");
        expect(block!.parentBlockId).toBeNull();
        expect(block!.children).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// S-15: Reasoning + text → ordered roots
//
// Stream:  reasoning("thinking") → token("Answer") → done
// DB:      [reasoning blockId="{execId}-r1", assistant blockId="{execId}-t1"]
// Tree:    roots=["{execId}-r1", "{execId}-t1"]  (reasoning BEFORE assistant)
// ---------------------------------------------------------------------------

describe("S-15 [stream-tree]: reasoning + text produces two ordered roots", () => {
    it("tree roots are [r1, t1] in arrival order; both have no children", async () => {
        const engine = new ScriptedEngine();
        engine.queueTurn([
            scriptReasoning("thinking"),
            scriptToken("Answer"),
            scriptDone(),
        ]);

        runtime = makeRuntime(engine);
        const { taskId } = await runtime.createTask();
        const { executionId } = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "go" });
        await runtime.recorder.waitForStreamDone(executionId);

        const db = runtime.getDbStreamEvents(executionId);
        const tree = buildStreamTree(db);

        const r1 = `${executionId}-r1`;
        const t1 = `${executionId}-t1`;

        // Both roots present in order
        expect(tree.roots).toEqual([r1, t1]);

        // Reasoning block
        const rBlock = tree.blocks.get(r1);
        expect(rBlock).toBeDefined();
        expect(rBlock!.type).toBe("reasoning");
        expect(rBlock!.parentBlockId).toBeNull();
        expect(rBlock!.children).toEqual([]);

        // Assistant block
        const tBlock = tree.blocks.get(t1);
        expect(tBlock).toBeDefined();
        expect(tBlock!.type).toBe("assistant");
        expect(tBlock!.parentBlockId).toBeNull();
        expect(tBlock!.children).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// S-16: Text → tool → text → correct sibling ordering
//
// Stream:  token("Before") → tool_start("c1") → tool_result("c1") →
//          token("After") → done
// DB:      [assistant t1, tool_call c1, tool_result c1, assistant t2]
// Tree:    roots=[t1, "c1", t2]  c1.children=[]
//
// Key assertion: pre-tool assistant block appears BEFORE tool in roots, not after.
// ---------------------------------------------------------------------------

describe("S-16 [stream-tree]: text → tool → text produces three ordered roots", () => {
    it("roots are [t1, c1, t2] in order; c1 has no children", async () => {
        const engine = new ScriptedEngine();
        engine.queueTurn([
            scriptToken("Before the tool"),
            scriptToolStart("c1", "read_file", { path: "/tmp/a.txt" }),
            scriptToolResult("c1", "read_file", "file contents"),
            scriptToken("After the tool"),
            scriptDone(),
        ]);

        runtime = makeRuntime(engine);
        const { taskId } = await runtime.createTask();
        const { executionId } = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "go" });
        await runtime.recorder.waitForStreamDone(executionId);

        const db = runtime.getDbStreamEvents(executionId);
        const tree = buildStreamTree(db);

        const t1 = `${executionId}-t1`;
        const t2 = `${executionId}-t2`;

        // The pre-tool text block must appear before the tool call
        const rootsWithoutUser = tree.roots.filter((r) => !r.includes("user"));
        expect(rootsWithoutUser).toEqual([t1, "c1", t2]);

        // Tool block: present, no children, no parent
        const c1 = tree.blocks.get("c1");
        expect(c1).toBeDefined();
        expect(c1!.parentBlockId).toBeNull();
        expect(c1!.children).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// S-17: Cancel mid-stream — flushed text appears in tree
//
// Stream:  token("Hello ") → token("world") → [cancel] → (flush) → done
// DB:      [assistant t1] (flushed on cancel)
// Tree:    roots=[t1]
// ---------------------------------------------------------------------------

describe("S-17 [stream-tree]: cancel mid-text flushes assistant block into tree", () => {
    it("after cancel: tree has one assistant root with accumulated text", async () => {
        const engine = new ScriptedEngine();
        engine.queueTurn([
            scriptToken("Hello "),
            scriptToken("world"),
            scriptWaitForAbort(),
        ]);

        runtime = makeRuntime(engine);
        const { taskId } = await runtime.createTask();
        const { executionId } = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "go" });

        // Wait for IPC text_chunks to confirm streaming started
        await runtime.recorder.waitForStreamDone(executionId, 200).catch(() => {});

        // Cancel the execution
        await runtime.handlers["tasks.cancel"]({ taskId });
        await runtime.recorder.waitForStreamDone(executionId, 5_000);

        const db = runtime.getDbStreamEvents(executionId);
        const tree = buildStreamTree(db);

        const t1 = `${executionId}-t1`;

        expect(tree.roots).toContain(t1);

        const block = tree.blocks.get(t1);
        expect(block).toBeDefined();
        expect(block!.type).toBe("assistant");
        expect(block!.content).toContain("Hello");
        expect(block!.content).toContain("world");
        expect(block!.children).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// S-18: Reasoning inside tool call (Copilot-style)
//
// Stream:  reasoning("pre") → tool_start("c1") → reasoning("in-tool") →
//          tool_result("c1") → token("Done") → done
//
// parentBlockId propagation (reasoningBlockId + callStack):
//   reasoning "pre"     → parentBlockId=null  (callStack=[])
//   --- tool_start flushes reasoning as "pre-r1" with deterministic blockId ---
//   tool_call "c1"      → parentBlockId="pre-r1" (reasoningBlockId set)
//   reasoning "in-tool" → parentBlockId="c1"  (callStack=["c1"])
//   tool_result "c1"    → parentBlockId="pre-r1" (reasoningBlockId still set)
//   assistant           → parentBlockId=null  (reasoningBlockId cleared by token)
//
// DB:   [reasoning pre-r1 pBid=null, tool_call c1 pBid=pre-r1,
//        reasoning r2 pBid="c1", tool_result c1, assistant t1]
// Tree: roots=[pre-r1, t1]
//       pre-r1.children=["c1"]
//       c1.children=["r2"]
// ---------------------------------------------------------------------------

describe("S-18 [stream-tree]: reasoning inside tool call hangs off tool block as child", () => {
    it("roots=[pre-r1, t1]; pre-r1.children=[c1]; c1.children=[r2]", async () => {
        const engine = new ScriptedEngine();
        engine.queueTurn([
            scriptReasoning("pre-tool thinking"),
            scriptToolStart("c1", "search_web", { query: "foo" }),
            scriptReasoning("in-tool thinking"),
            scriptToolResult("c1", "search_web", "results"),
            scriptToken("Done"),
            scriptDone(),
        ]);

        runtime = makeRuntime(engine);
        const { taskId } = await runtime.createTask();
        const { executionId } = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "go" });
        await runtime.recorder.waitForStreamDone(executionId);

        const db = runtime.getDbStreamEvents(executionId);
        const tree = buildStreamTree(db);

        const preR1 = `${executionId}-pre-r1`;
        const r2 = `${executionId}-r2`;
        const t1 = `${executionId}-t1`;

        // Root order: pre-tool reasoning bubble (with tool nested inside) → post-tool assistant
        expect(tree.roots).toEqual([preR1, t1]);

        // Pre-tool reasoning: root-level, tool nested as child
        const preR1Block = tree.blocks.get(preR1);
        expect(preR1Block).toBeDefined();
        expect(preR1Block!.type).toBe("reasoning");
        expect(preR1Block!.parentBlockId).toBeNull();
        expect(preR1Block!.children).toEqual(["c1"]);

        // Tool call block: child of pre-tool reasoning, has in-tool reasoning as child
        const c1Block = tree.blocks.get("c1");
        expect(c1Block).toBeDefined();
        expect(c1Block!.parentBlockId).toBe(preR1);
        expect(c1Block!.children).toEqual([r2]);

        // In-tool reasoning: child of c1
        const r2Block = tree.blocks.get(r2);
        expect(r2Block).toBeDefined();
        expect(r2Block!.type).toBe("reasoning");
        expect(r2Block!.parentBlockId).toBe("c1");
        expect(r2Block!.children).toEqual([]);

        // Post-tool assistant: root-level
        const t1Block = tree.blocks.get(t1);
        expect(t1Block).toBeDefined();
        expect(t1Block!.type).toBe("assistant");
        expect(t1Block!.parentBlockId).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// S-19: Nested tool calls
//
// Stream:  tool_start("c1") → tool_start("c2", parentCallId="c1") →
//          tool_result("c2") → tool_result("c1") → token("Done") → done
//
// parentBlockId propagation (via explicit parentCallId):
//   tool_call "c1"      → parentBlockId=null   (no parentCallId)
//   tool_call "c2"      → parentBlockId="c1"   (parentCallId="c1" explicitly set)
//   tool_result "c2"    → parentBlockId=null
//   tool_result "c1"    → parentBlockId=null
//   assistant           → parentBlockId=null
//
// DB:   [tool_call c1 pBid=null, tool_call c2 pBid="c1",
//        tool_result c2, tool_result c1, assistant t1]
// Tree: roots=["c1", t1]
//       c1.children=["c2"]
//       c2.children=[]
// ---------------------------------------------------------------------------

describe("S-19 [stream-tree]: nested tool calls produce parent–child hierarchy", () => {
    it("roots=[c1, t1]; c1.children=[c2]; c2.children=[]", async () => {
        const engine = new ScriptedEngine();
        engine.queueTurn([
            scriptToolStart("c1", "outer_tool", {}),
            scriptToolStart("c2", "inner_tool", {}, { parentCallId: "c1" }),
            scriptToolResult("c2", "inner_tool", "inner result"),
            scriptToolResult("c1", "outer_tool", "outer result"),
            scriptToken("Done"),
            scriptDone(),
        ]);

        runtime = makeRuntime(engine);
        const { taskId } = await runtime.createTask();
        const { executionId } = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "go" });
        await runtime.recorder.waitForStreamDone(executionId);

        const db = runtime.getDbStreamEvents(executionId);
        const tree = buildStreamTree(db);

        const t1 = `${executionId}-t1`;

        // Root order: outer tool → post-tool assistant
        expect(tree.roots).toEqual(["c1", t1]);

        // Outer tool block: root-level, has inner tool as child
        const c1Block = tree.blocks.get("c1");
        expect(c1Block).toBeDefined();
        expect(c1Block!.parentBlockId).toBeNull();
        expect(c1Block!.children).toEqual(["c2"]);

        // Inner tool block: child of c1
        const c2Block = tree.blocks.get("c2");
        expect(c2Block).toBeDefined();
        expect(c2Block!.parentBlockId).toBe("c1");
        expect(c2Block!.children).toEqual([]);

        // Post-tool assistant: root-level
        const t1Block = tree.blocks.get(t1);
        expect(t1Block).toBeDefined();
        expect(t1Block!.type).toBe("assistant");
        expect(t1Block!.parentBlockId).toBeNull();
    });
});
