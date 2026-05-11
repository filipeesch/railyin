import { describe, it, expect } from "vitest";
import { myersDiff, computeFileDiff } from "../utils/diff.ts";

// ─── myersDiff ────────────────────────────────────────────────────────────────

describe("myersDiff", () => {
  it("MD-1: identical content produces no hunks", () => {
    const lines = ["line1", "line2", "line3"];
    expect(myersDiff(lines, [...lines])).toHaveLength(0);
  });

  it("MD-2: single line added produces a hunk with one added line", () => {
    const before = ["a", "b"];
    const after = ["a", "inserted", "b"];
    const hunks = myersDiff(before, after);
    expect(hunks.length).toBeGreaterThan(0);
    const allLines = hunks.flatMap((h) => h.lines);
    const added = allLines.filter((l) => l.type === "added");
    expect(added).toHaveLength(1);
    expect(added[0].content).toBe("inserted");
  });

  it("MD-3: single line deleted produces a hunk with one removed line", () => {
    const before = ["a", "remove_me", "b"];
    const after = ["a", "b"];
    const hunks = myersDiff(before, after);
    expect(hunks.length).toBeGreaterThan(0);
    const allLines = hunks.flatMap((h) => h.lines);
    const removed = allLines.filter((l) => l.type === "removed");
    expect(removed).toHaveLength(1);
    expect(removed[0].content).toBe("remove_me");
  });

  it("MD-4: single line replacement produces hunk with both removed and added lines", () => {
    const before = ["before_line"];
    const after = ["after_line"];
    const hunks = myersDiff(before, after);
    expect(hunks.length).toBeGreaterThan(0);
    const allLines = hunks.flatMap((h) => h.lines);
    const removed = allLines.filter((l) => l.type === "removed");
    const added = allLines.filter((l) => l.type === "added");
    expect(removed[0]?.content).toBe("before_line");
    expect(added[0]?.content).toBe("after_line");
  });

  it("MD-5: two non-adjacent changes produce two separate hunks", () => {
    // Changes at index 0 and 8, with 7 unchanged lines between them —
    // context window is 3, so the gap (7) is wider than 2*context (6)
    const before = ["change1", "c1", "c2", "c3", "c4", "c5", "c6", "c7", "change2"];
    const after  = ["NEW1",    "c1", "c2", "c3", "c4", "c5", "c6", "c7", "NEW2"];
    const hunks = myersDiff(before, after);
    expect(hunks).toHaveLength(2);
  });
});

// ─── computeFileDiff ─────────────────────────────────────────────────────────

describe("computeFileDiff", () => {
  it("MD-5b: sets correct relPath and defaults to edit_file operation", () => {
    const diff = computeFileDiff("old\n", "new\n", "src/file.ts");
    expect(diff.path).toBe("src/file.ts");
    expect(diff.operation).toBe("edit_file");
  });

  it("MD-6: explicit operation overrides default", () => {
    const diff = computeFileDiff("", "new content\n", "src/new.ts", "write_file");
    expect(diff.operation).toBe("write_file");
  });

  it("MD-6b: empty before (new file) — removed is 0, added reflects after line count", () => {
    const after = "alpha\nbeta\ngamma\n";
    const diff = computeFileDiff("", after, "new.ts", "write_file");
    expect(diff.removed).toBe(0);
    expect(diff.added).toBeGreaterThan(0);
    const allAdded = diff.hunks.flatMap((h) => h.lines).filter((l) => l.type === "added");
    expect(allAdded.length).toBeGreaterThan(0);
  });
});
