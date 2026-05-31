import { describe, it, expect } from "vitest";
import { myersDiff, computeFileDiff, splitLines } from "../utils/diff.ts";

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
    const allAdded = diff.hunks!.flatMap((h) => h.lines).filter((l) => l.type === "added");
    expect(allAdded.length).toBeGreaterThan(0);
  });
});

// ─── splitLines ────────────────────────────────────────────────────────────────

describe("splitLines", () => {
  it("SL-1: empty string produces 0 lines", () => {
    expect(splitLines("")).toBe(0);
  });

  it("SL-2: single newline produces 1 line", () => {
    expect(splitLines("\n")).toBe(1);
  });

  it("SL-3: newline-terminated string does not over-count", () => {
    expect(splitLines("a\nb\nc\n")).toBe(3);
  });

  it("SL-4: non-terminated string counts all lines", () => {
    expect(splitLines("line1\nline2")).toBe(2);
  });

  it("SL-5: empty line before trailing newline counts", () => {
    expect(splitLines("a\nb\n\n")).toBe(3);
  });
});

// ─── computeFileDiff — accurate counts ────────────────────────────────────────

describe("computeFileDiff — accurate counts", () => {
  it("SL-6: single-line change in large file produces accurate counts", () => {
    // Build a 150-line file, change one line
    const before = Array.from({ length: 150 }, (_, i) => `line ${i + 1}`).join("\n") + "\n";
    const after = before.replace("line 50", "LINE 50");
    const diff = computeFileDiff(before, after, "test.ts", "patch_file");
    expect(diff.added).toBe(1);
    expect(diff.removed).toBe(1);
  });

  it("SL-7: no changes produces zero added and zero removed", () => {
    const content = "line1\nline2\nline3\n";
    const diff = computeFileDiff(content, content, "unchanged.ts", "edit_file");
    expect(diff.added).toBe(0);
    expect(diff.removed).toBe(0);
    expect(diff.hunks).toHaveLength(0);
  });

  it("SL-8: new file (empty before) reports correct added count", () => {
    const after = "alpha\nbeta\ngamma\n";
    const diff = computeFileDiff("", after, "new.ts", "write_file", { isNew: true });
    expect(diff.added).toBe(3);
    expect(diff.removed).toBe(0);
    expect(diff.is_new).toBe(true);
  });

  it("SL-9: delete scenario reports correct removed count", () => {
    const before = "old content\n";
    const diff = computeFileDiff(before, "", "deleted.ts", "delete_file");
    expect(diff.added).toBe(0);
    expect(diff.removed).toBe(1);
  });

  it("SL-10: multi-hunk diff sums counts across all hunks", () => {
    // Two non-adjacent changes → two hunks
    const before = ["change1", "c1", "c2", "c3", "c4", "c5", "c6", "c7", "change2"].join("\n") + "\n";
    const after = ["NEW1", "c1", "c2", "c3", "c4", "c5", "c6", "c7", "NEW2"].join("\n") + "\n";
    const diff = computeFileDiff(before, after, "multi.ts", "edit_file");
    expect(diff.added).toBe(2);
    expect(diff.removed).toBe(2);
    expect(diff.hunks).toHaveLength(2);
  });

  it("SL-11: added/removed match hunk line type counts exactly", () => {
    // Multi-hunk diff with independent substitutions — verify derived counts == exact line-type tallies
    const before = ["a", "b", "c", "d", "e", "f", "g", "h"].join("\n") + "\n";
    const after = ["A", "b", "c", "X", "e", "Y", "g", "h"].join("\n") + "\n";
    const diff = computeFileDiff(before, after, "test.ts", "edit_file");
    const exactAdded = (diff.hunks ?? []).flatMap((h) => h.lines).filter((l: { type: string }) => l.type === "added").length;
    const exactRemoved = (diff.hunks ?? []).flatMap((h) => h.lines).filter((l: { type: string }) => l.type === "removed").length;
    expect(diff.added).toBe(exactAdded);
    expect(diff.removed).toBe(exactRemoved);
  });
});
