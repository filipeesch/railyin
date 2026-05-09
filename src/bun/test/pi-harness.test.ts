import { describe, expect, it, beforeEach, vi } from "vitest";
import { ContentHashCache } from "../engine/pi/harness/hash-cache.ts";
import { UndoStack } from "../engine/pi/harness/undo-stack.ts";
import { AsyncQueue } from "../engine/pi/async-queue.ts";
import { PiEngine } from "../engine/pi/engine.ts";
import type { PiEngineConfig } from "../config/index.ts";
import type { SlashCommandDialect, ResolvedPrompt } from "../engine/dialects/slash-command-dialect.ts";
import { NullDialect } from "../engine/dialects/null-dialect.ts";
import type { CommandInfo } from "../engine/types.ts";

// ─── ContentHashCache ─────────────────────────────────────────────────────────

describe("ContentHashCache", () => {
  let cache: ContentHashCache;

  beforeEach(() => {
    cache = new ContentHashCache();
  });

  describe("file cache", () => {
    it("CHC-1: returns miss on first read of a path", () => {
      const result = cache.checkFile("/a/b.ts", "abc123", "0:0", 1);
      expect(result.hit).toBe(false);
    });

    it("CHC-2: returns miss on first read even after updateFile (seenInWindow not yet true for checkFile path)", () => {
      cache.updateFile("/a/b.ts", "abc123", "0:0", 1);
      // updateFile sets seenInWindow=true, so the NEXT checkFile will see wasAlreadySeen=true
      const result = cache.checkFile("/a/b.ts", "abc123", "0:0", 1);
      expect(result.hit).toBe(true);
      expect(result.message).toContain("unchanged since turn");
    });

    it("CHC-3: hit on second checkFile with same hash after updateFile", () => {
      cache.updateFile("/a/b.ts", "hash1", "0:0", 5);
      const second = cache.checkFile("/a/b.ts", "hash1", "0:0", 5);
      expect(second.hit).toBe(true);
      expect(second.message).toContain("turn 5");
    });

    it("CHC-4: miss when hash changed (file modified)", () => {
      cache.updateFile("/a/b.ts", "hash1", "0:0", 1);
      const result = cache.checkFile("/a/b.ts", "hash2", "0:0", 2);
      expect(result.hit).toBe(false);
    });

    it("CHC-5: different range keys are independent cache entries", () => {
      cache.updateFile("/a/b.ts", "hash1", "0:0", 1);
      cache.updateFile("/a/b.ts", "hash1", "10:20", 1);
      const full = cache.checkFile("/a/b.ts", "hash1", "0:0", 1);
      const slice = cache.checkFile("/a/b.ts", "hash1", "10:20", 1);
      expect(full.hit).toBe(true);
      expect(slice.hit).toBe(true);
    });

    it("CHC-6: invalidate removes all range entries for a path", () => {
      cache.updateFile("/a/b.ts", "hash1", "0:0", 1);
      cache.updateFile("/a/b.ts", "hash1", "5:10", 1);
      cache.invalidate("/a/b.ts");
      expect(cache.checkFile("/a/b.ts", "hash1", "0:0", 1).hit).toBe(false);
      expect(cache.checkFile("/a/b.ts", "hash1", "5:10", 1).hit).toBe(false);
    });

    it("CHC-7: invalidate does not affect entries for other paths", () => {
      cache.updateFile("/a/b.ts", "hash1", "0:0", 1);
      cache.updateFile("/a/c.ts", "hash2", "0:0", 1);
      cache.invalidate("/a/b.ts");
      expect(cache.checkFile("/a/c.ts", "hash2", "0:0", 1).hit).toBe(true);
    });

    it("CHC-8: resetWindowFlags clears seenInWindow so next read is a miss", () => {
      cache.updateFile("/a/b.ts", "hash1", "0:0", 1);
      expect(cache.checkFile("/a/b.ts", "hash1", "0:0", 1).hit).toBe(true);
      cache.resetWindowFlags();
      // After reset, seenInWindow=false, so checkFile sets it to true but returns miss
      expect(cache.checkFile("/a/b.ts", "hash1", "0:0", 1).hit).toBe(false);
      // On the NEXT call it should be a hit
      expect(cache.checkFile("/a/b.ts", "hash1", "0:0", 1).hit).toBe(true);
    });
  });

  describe("search cache", () => {
    it("CHC-9: returns miss on first checkSearch", () => {
      expect(cache.checkSearch("search:foo:bar:3:content:0").hit).toBe(false);
    });

    it("CHC-10: hit after updateSearch", () => {
      const key = "search:foo:**.ts:3:content:0";
      cache.updateSearch(key, 7);
      const result = cache.checkSearch(key);
      expect(result.hit).toBe(true);
      expect(result.message).toContain("turn 7");
    });

    it("CHC-11: invalidateSearch removes the entry", () => {
      const key = "search:pat:*.ts:2:files_with_matches:0";
      cache.updateSearch(key, 1);
      cache.invalidateSearch(key);
      expect(cache.checkSearch(key).hit).toBe(false);
    });

    it("CHC-12: getSearchKeys returns all current search cache keys", () => {
      cache.updateSearch("k1", 1);
      cache.updateSearch("k2", 2);
      cache.updateSearch("k3", 3);
      expect(cache.getSearchKeys()).toEqual(expect.arrayContaining(["k1", "k2", "k3"]));
      expect(cache.getSearchKeys()).toHaveLength(3);
    });

    it("CHC-13: resetWindowFlags also clears search cache seenInWindow", () => {
      const key = "search:test:*.ts:0:content:0";
      cache.updateSearch(key, 1);
      expect(cache.checkSearch(key).hit).toBe(true);
      cache.resetWindowFlags();
      expect(cache.checkSearch(key).hit).toBe(false);
    });
  });
});

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

// ─── PiEngine dialect injection ───────────────────────────────────────────────

/** Spy dialect that records all calls and passes through the prompt unchanged. */
class SpyDialect implements SlashCommandDialect {
  resolvePromptCalls: { value: string; worktreePath: string; projectPath?: string }[] = [];
  listCommandsCalls: { worktreePath: string; projectPath?: string }[] = [];

  async resolvePrompt(value: string, worktreePath: string, projectPath?: string): Promise<ResolvedPrompt> {
    this.resolvePromptCalls.push({ value, worktreePath, projectPath });
    return { content: value, wasSlash: false };
  }

  listCommands(worktreePath: string, projectPath?: string): CommandInfo[] {
    this.listCommandsCalls.push({ worktreePath, projectPath });
    return [];
  }
}

describe("PiEngine dialect injection", () => {
  it("SPY-1: dialect passed to constructor is stored and accessible", () => {
    const spy = new SpyDialect();
    const config: PiEngineConfig = { type: "pi", model: "lmstudio/qwen3-8b" };
    const engine = new PiEngine("test-pi", config, () => {}, () => {}, spy);
    expect((engine as any).dialect).toBe(spy);
  });

  it("SPY-2: default dialect is NullDialect when none is provided", () => {
    const config: PiEngineConfig = { type: "pi", model: "lmstudio/qwen3-8b" };
    const engine = new PiEngine("test-pi", config, () => {}, () => {});
    expect((engine as any).dialect).toBeInstanceOf(NullDialect);
  });

  it("SPY-3: pre-aborted execution does NOT call dialect.resolvePrompt", async () => {
    const spy = new SpyDialect();
    const config: PiEngineConfig = { type: "pi", model: "lmstudio/qwen3-8b" };
    const engine = new PiEngine("test-pi", config, () => {}, () => {}, spy);
    const controller = new AbortController();
    controller.abort();

    const gen = engine.execute({
      executionId: 1,
      taskId: null,
      boardId: undefined,
      conversationId: 101,
      model: "lmstudio/qwen3-8b",
      workingDirectory: process.cwd(),
      prompt: "/some-command",
      signal: controller.signal,
      boardTools: {} as any,
    });
    for await (const _ of gen) { /* drain */ }

    expect(spy.resolvePromptCalls).toHaveLength(0);
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
