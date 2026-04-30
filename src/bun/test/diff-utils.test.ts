import { describe, it, expect } from "vitest";
import type { Database } from "bun:sqlite";
import { computeHunkHash, parseGitDiffHunks, extractHunkPatch } from "../git/diff-utils.ts";

const SAMPLE_DIFF = `--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,3 +1,4 @@
 const x = 1;
+const y = 2;
 const z = 3;
 const w = 4;
@@ -10,2 +11,2 @@
-const old = true;
+const new2 = false;`;

// ─── DU-1: computeHunkHash is deterministic ───────────────────────────────────

describe("computeHunkHash — DU-1: is deterministic", () => {
  it("returns the same hash for identical inputs called twice", () => {
    const hash1 = computeHunkHash("src/foo.ts", ["line 1", "line 2"], ["line 1", "line 3"]);
    const hash2 = computeHunkHash("src/foo.ts", ["line 1", "line 2"], ["line 1", "line 3"]);
    expect(hash1).toBe(hash2);
  });
});

// ─── DU-2: computeHunkHash changes when filePath changes ─────────────────────

describe("computeHunkHash — DU-2: changes when filePath changes", () => {
  it("returns a different hash when only the filePath differs", () => {
    const hash1 = computeHunkHash("src/foo.ts", ["a"], ["b"]);
    const hash2 = computeHunkHash("src/bar.ts", ["a"], ["b"]);
    expect(hash1).not.toBe(hash2);
  });
});

// ─── DU-3: computeHunkHash changes when lines change ─────────────────────────

describe("computeHunkHash — DU-3: changes when lines change", () => {
  it("returns a different hash when originalLines differ", () => {
    const hash1 = computeHunkHash("src/foo.ts", ["old line"], ["new line"]);
    const hash2 = computeHunkHash("src/foo.ts", ["changed line"], ["new line"]);
    expect(hash1).not.toBe(hash2);
  });

  it("returns a different hash when modifiedLines differ", () => {
    const hash1 = computeHunkHash("src/foo.ts", ["old line"], ["new line"]);
    const hash2 = computeHunkHash("src/foo.ts", ["old line"], ["different line"]);
    expect(hash1).not.toBe(hash2);
  });
});

// ─── DU-4: parseGitDiffHunks returns empty array for empty diff ───────────────

describe("parseGitDiffHunks — DU-4: returns empty array for empty diff", () => {
  it("returns [] for an empty string", () => {
    expect(parseGitDiffHunks("", "src/foo.ts")).toEqual([]);
  });

  it("returns [] for a diff with no @@ headers", () => {
    expect(parseGitDiffHunks("--- a/src/foo.ts\n+++ b/src/foo.ts\n", "src/foo.ts")).toEqual([]);
  });
});

// ─── DU-5: parseGitDiffHunks parses single hunk header ───────────────────────

describe("parseGitDiffHunks — DU-5: parses single hunk header", () => {
  it("returns one ParsedHunk for a diff with a single @@ header", () => {
    const diff = `@@ -1,3 +1,4 @@\n const x = 1;\n+const y = 2;\n const z = 3;`;
    const hunks = parseGitDiffHunks(diff, "src/foo.ts");
    expect(hunks).toHaveLength(1);
    expect(hunks[0].hunkIndex).toBe(0);
  });
});

// ─── DU-6: parseGitDiffHunks parses multiple hunks ───────────────────────────

describe("parseGitDiffHunks — DU-6: parses multiple hunks", () => {
  it("returns two ParsedHunks for the sample diff", () => {
    const hunks = parseGitDiffHunks(SAMPLE_DIFF, "src/foo.ts");
    expect(hunks).toHaveLength(2);
    expect(hunks[0].hunkIndex).toBe(0);
    expect(hunks[1].hunkIndex).toBe(1);
  });
});

// ─── DU-7: parseGitDiffHunks sets correct originalStart/modifiedStart ─────────

describe("parseGitDiffHunks — DU-7: sets correct originalStart/modifiedStart from @@ header", () => {
  it("extracts the correct line numbers from each @@ header", () => {
    const hunks = parseGitDiffHunks(SAMPLE_DIFF, "src/foo.ts");
    expect(hunks[0].originalStart).toBe(1);
    expect(hunks[0].modifiedStart).toBe(1);
    expect(hunks[1].originalStart).toBe(10);
    expect(hunks[1].modifiedStart).toBe(11);
  });
});

// ─── DU-8: extractHunkPatch returns the hunk's lines from the raw diff ────────

describe("extractHunkPatch — DU-8: returns the hunk's lines from the raw diff", () => {
  it("extracts the first hunk patch with file header and hunk lines", () => {
    const patch = extractHunkPatch(SAMPLE_DIFF, 0, "src/foo.ts");
    expect(patch).toContain("--- a/src/foo.ts");
    expect(patch).toContain("+++ b/src/foo.ts");
    expect(patch).toContain("@@ -1,3 +1,4 @@");
    expect(patch).toContain("+const y = 2;");
  });

  it("extracts the second hunk patch and does not include the first hunk's lines", () => {
    const patch = extractHunkPatch(SAMPLE_DIFF, 1, "src/foo.ts");
    expect(patch).toContain("@@ -10,2 +11,2 @@");
    expect(patch).toContain("-const old = true;");
    expect(patch).toContain("+const new2 = false;");
    expect(patch).not.toContain("+const y = 2;");
  });
});

// ─── DU-9: extractHunkPatch throws for out-of-range hunkIndex ────────────────

describe("extractHunkPatch — DU-9: throws for out-of-range hunkIndex", () => {
  it("throws an error when hunkIndex exceeds the number of hunks", () => {
    expect(() => extractHunkPatch(SAMPLE_DIFF, 99, "src/foo.ts")).toThrow();
  });
});
