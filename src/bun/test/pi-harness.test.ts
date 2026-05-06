import { describe, expect, it, beforeEach } from "vitest";
import { ContentHashCache } from "../engine/pi/harness/hash-cache.ts";
import { UndoStack } from "../engine/pi/harness/undo-stack.ts";

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
