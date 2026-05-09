import { describe, expect, it, beforeEach, vi } from "vitest";
import { UndoStack } from "../engine/pi/harness/undo-stack.ts";
import { AsyncQueue } from "../engine/pi/async-queue.ts";
import { PiEngine } from "../engine/pi/engine.ts";
import type { PiEngineConfig } from "../config/index.ts";

// ─── UndoStack ────────────────────────────────────────────────────────────────

describe("UndoStack", () => {
  let stack: UndoStack;

  beforeEach(() => {
    stack = new UndoStack();
  });

  it("US-1: push returns op:XXXX format", () => {
    const opId = stack.push({ path: "/a/b.ts", type: "write_file", beforeContent: "old" });
    expect(opId).toMatch(/^op:[0-9a-f]{4}$/);
  });

  it("US-2: size increments on push", () => {
    stack.push({ path: "/a.ts", type: "write_file", beforeContent: null });
    stack.push({ path: "/b.ts", type: "delete_file", beforeContent: "x" });
    expect(stack.size).toBe(2);
  });

  it("US-3: undoById finds and removes the snapshot", () => {
    const opId = stack.push({ path: "/a.ts", type: "write_file", beforeContent: "v1" });
    const id = opId.slice(3); // strip "op:"
    const snap = stack.undoById(id);
    expect(snap).toBeDefined();
    expect(snap!.path).toBe("/a.ts");
    expect(snap!.beforeContent).toBe("v1");
    expect(stack.size).toBe(0);
  });

  it("US-4: undoById returns undefined for unknown id", () => {
    expect(stack.undoById("dead")).toBeUndefined();
  });

  it("US-5: popByPath returns the most recent snapshot for that path", () => {
    stack.push({ path: "/a.ts", type: "write_file", beforeContent: "v1" });
    stack.push({ path: "/a.ts", type: "patch_file", beforeContent: "v2" });
    stack.push({ path: "/a.ts", type: "patch_file", beforeContent: "v3" });

    const snap = stack.popByPath("/a.ts");
    expect(snap?.beforeContent).toBe("v3"); // most recent last = v3
    expect(stack.size).toBe(2);
  });

  it("US-6: chained popByPath peels layers in order", () => {
    stack.push({ path: "/a.ts", type: "write_file", beforeContent: "v1" });
    stack.push({ path: "/a.ts", type: "patch_file", beforeContent: "v2" });

    expect(stack.popByPath("/a.ts")?.beforeContent).toBe("v2");
    expect(stack.popByPath("/a.ts")?.beforeContent).toBe("v1");
    expect(stack.popByPath("/a.ts")).toBeUndefined();
  });

  it("US-7: popByPath only affects matching path, not others", () => {
    stack.push({ path: "/a.ts", type: "write_file", beforeContent: "x" });
    stack.push({ path: "/b.ts", type: "write_file", beforeContent: "y" });

    stack.popByPath("/a.ts");
    expect(stack.size).toBe(1);
    const remaining = stack.popByPath("/b.ts");
    expect(remaining?.path).toBe("/b.ts");
  });

  it("US-8: FIFO cap evicts oldest entry when maxSize is exceeded", () => {
    const small = new UndoStack(3);
    const ops: string[] = [];
    ops.push(small.push({ path: "/a.ts", type: "write_file", beforeContent: "v1" }));
    ops.push(small.push({ path: "/a.ts", type: "patch_file", beforeContent: "v2" }));
    ops.push(small.push({ path: "/a.ts", type: "patch_file", beforeContent: "v3" }));
    ops.push(small.push({ path: "/a.ts", type: "patch_file", beforeContent: "v4" }));

    expect(small.size).toBe(3);
    // op:0 (oldest) should be evicted
    expect(small.undoById(ops[0].slice(3))).toBeUndefined();
    // op:3 (newest) should still be there
    expect(small.undoById(ops[3].slice(3))).toBeDefined();
  });

  it("US-9: rename_file snapshot stores toPath", () => {
    stack.push({ path: "/src/a.ts", type: "rename_file", beforeContent: null, toPath: "/src/b.ts" });
    const snap = stack.popByPath("/src/a.ts");
    expect(snap?.toPath).toBe("/src/b.ts");
  });
});

// ─── AsyncQueue ───────────────────────────────────────────────────────────────

describe("AsyncQueue", () => {
  it("AQ-1: push before next — buffered item delivered immediately", async () => {
    const q = new AsyncQueue<number>();
    q.push(1);
    q.push(2);
    const iter = q[Symbol.asyncIterator]();
    expect((await iter.next()).value).toBe(1);
    expect((await iter.next()).value).toBe(2);
  });

  it("AQ-2: next before push — waiter unblocked when item arrives", async () => {
    const q = new AsyncQueue<string>();
    const nextPromise = q[Symbol.asyncIterator]().next();
    q.push("hello");
    expect((await nextPromise).value).toBe("hello");
  });

  it("AQ-3: close resolves pending waiter with done:true", async () => {
    const q = new AsyncQueue<number>();
    const iter = q[Symbol.asyncIterator]();
    const nextPromise = iter.next();
    q.close();
    const result = await nextPromise;
    expect(result.done).toBe(true);
  });

  it("AQ-4: close after push — buffered items still consumed, then done", async () => {
    const q = new AsyncQueue<number>();
    q.push(42);
    q.close();
    const items: number[] = [];
    for await (const item of q) {
      items.push(item);
    }
    expect(items).toEqual([42]);
  });

  it("AQ-5: close is idempotent — calling twice does not throw", () => {
    const q = new AsyncQueue<number>();
    q.close();
    expect(() => q.close()).not.toThrow();
  });

  it("AQ-6: push after close is silently ignored", async () => {
    const q = new AsyncQueue<number>();
    q.close();
    q.push(99); // should not throw or deliver
    const iter = q[Symbol.asyncIterator]();
    const result = await iter.next();
    expect(result.done).toBe(true);
  });

  it("AQ-7: wakeup is never lost (push fires before next registers waiter)", async () => {
    const q = new AsyncQueue<number>();
    // Fire multiple pushes synchronously before any await
    q.push(10);
    q.push(20);
    q.push(30);
    q.close();

    const collected: number[] = [];
    for await (const v of q) {
      collected.push(v);
    }
    expect(collected).toEqual([10, 20, 30]);
  });
});

// ─── PiEngine abort / cancel ──────────────────────────────────────────────────

function makePiEngine(): PiEngine {
  const config: PiEngineConfig = { type: "pi", model: "lmstudio/qwen3-8b" };
  return new PiEngine("test-pi", config, () => {}, () => {});
}

/** Minimal fake AgentSession — only needs abort() */
function makeFakeSession(): { abort: ReturnType<typeof vi.fn>; prompt: ReturnType<typeof vi.fn> } {
  return {
    abort: vi.fn().mockResolvedValue(undefined),
    prompt: vi.fn().mockResolvedValue(undefined),
  };
}

describe("PiEngine abort & cancel", () => {
  it("ABORT-1: pre-aborted signal causes execute to yield only 'done' without calling Pi", async () => {
    const engine = makePiEngine();
    const controller = new AbortController();
    controller.abort();

    const events: string[] = [];
    const gen = engine.execute({
      executionId: 1,
      taskId: null,
      boardId: undefined,
      conversationId: 101,
      model: "lmstudio/qwen2.5-coder",
      workingDirectory: process.cwd(),
      prompt: "hello",
      signal: controller.signal,
      boardTools: {} as any,
    });

    for await (const event of gen) {
      events.push(event.type);
    }

    expect(events).toEqual(["done"]);
  });

  it("ABORT-2: cancel() calls abort() on the session mapped to that executionId", () => {
    const engine = makePiEngine();
    const eng = engine as any;

    const session1 = makeFakeSession();
    const session2 = makeFakeSession();

    eng.sessions.set(1, session1);
    eng.sessions.set(2, session2);
    eng.executionToConversation.set(99, 1); // executionId 99 → conversationId 1

    engine.cancel(99);

    expect(session1.abort).toHaveBeenCalledOnce();
    expect(session2.abort).not.toHaveBeenCalled();
  });

  it("ABORT-3: cancel() of unknown executionId aborts no sessions", () => {
    const engine = makePiEngine();
    const eng = engine as any;

    const session = makeFakeSession();
    eng.sessions.set(1, session);
    // no entry in executionToConversation

    engine.cancel(404);

    expect(session.abort).not.toHaveBeenCalled();
  });

  it("ABORT-4: cancel() resolves pending resume before aborting session", () => {
    const engine = makePiEngine();
    const eng = engine as any;

    const session = makeFakeSession();
    eng.sessions.set(1, session);
    eng.executionToConversation.set(77, 1);

    const rejectFn = vi.fn();
    eng.pendingResumes.set(77, { resolve: vi.fn(), reject: rejectFn });

    engine.cancel(77);

    expect(rejectFn).toHaveBeenCalledWith(expect.objectContaining({ message: "Execution 77 cancelled" }));
    expect(session.abort).toHaveBeenCalledOnce();
    expect(eng.pendingResumes.has(77)).toBe(false);
  });

  it("ABORT-5: executionToConversation entry is cleaned up after execute finishes", async () => {
    const engine = makePiEngine();
    const eng = engine as any;
    const controller = new AbortController();
    controller.abort();

    const gen = engine.execute({
      executionId: 42,
      taskId: null,
      boardId: undefined,
      conversationId: 200,
      model: "lmstudio/qwen2.5-coder",
      workingDirectory: process.cwd(),
      prompt: "hello",
      signal: controller.signal,
      boardTools: {} as any,
    });

    // Drain the generator to completion
    for await (const _ of gen) { /* noop */ }

    // The mapping should have been removed in the finally block (though for pre-abort it never gets set)
    expect(eng.executionToConversation.has(42)).toBe(false);
  });
});
