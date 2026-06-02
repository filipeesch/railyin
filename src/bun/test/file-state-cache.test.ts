import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DefaultFileStateCache } from "../engine/claude/file-state-cache.ts";

describe("DefaultFileStateCache", () => {
  let dir: string;
  let cache: DefaultFileStateCache;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "railyn-cache-"));
    cache = new DefaultFileStateCache();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("FC-1: existing file captured before write → get returns content", () => {
    const filePath = "existing.txt";
    const content = "line1\nline2\nline3\n";
    writeFileSync(join(dir, filePath), content);

    cache.capture("call-1", dir, filePath);
    expect(cache.get("call-1")).toBe(content);
  });

  it("FC-2: non-existent file → get returns null", () => {
    cache.capture("call-new", dir, "does-not-exist.txt");
    expect(cache.get("call-new")).toBeNull();
  });

  it("FC-3: read failure → null (non-fatal degradation)", () => {
    // Capture a path that exists but is a directory — readFileSync will fail
    cache.capture("call-bad", dir, ".");
    expect(cache.get("call-bad")).toBeNull();
  });

  it("FC-3b: delete removes entry → get returns undefined", () => {
    const filePath = "del.txt";
    writeFileSync(join(dir, filePath), "content");
    cache.capture("call-del", dir, filePath);
    expect(cache.get("call-del")).toBe("content");

    cache.delete("call-del");
    expect(cache.get("call-del")).toBeUndefined();
  });

  it("FC-4: clear removes all entries", () => {
    writeFileSync(join(dir, "a.txt"), "a");
    writeFileSync(join(dir, "b.txt"), "b");

    cache.capture("call-a", dir, "a.txt");
    cache.capture("call-b", dir, "b.txt");

    expect(cache.get("call-a")).toBe("a");
    expect(cache.get("call-b")).toBe("b");

    cache.clear();

    expect(cache.get("call-a")).toBeUndefined();
    expect(cache.get("call-b")).toBeUndefined();
  });

  it("FC-5: two different callIds are isolated", () => {
    writeFileSync(join(dir, "x.txt"), "first");
    writeFileSync(join(dir, "y.txt"), "second");

    cache.capture("call-x", dir, "x.txt");
    cache.capture("call-y", dir, "y.txt");

    expect(cache.get("call-x")).toBe("first");
    expect(cache.get("call-y")).toBe("second");

    // Modifying one doesn't affect the other
    cache.delete("call-x");
    expect(cache.get("call-x")).toBeUndefined();
    expect(cache.get("call-y")).toBe("second");
  });

  it("FC-6: get on never-captured callId → undefined", () => {
    expect(cache.get("never-captured")).toBeUndefined();
  });
});
