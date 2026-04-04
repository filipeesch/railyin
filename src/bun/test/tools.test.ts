import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { executeTool, resolveToolsForColumn, TOOL_GROUPS, myersDiff } from "../workflow/tools.ts";
import type { FileDiffPayload } from "../../shared/rpc-types.ts";

/** Cast helper: write tools return { content, diff } on success, a string on error. */
const asWrite = (r: unknown) => r as { content: string; diff: FileDiffPayload };

// ─── Fixture setup ────────────────────────────────────────────────────────────

let worktreeDir: string;

beforeEach(() => {
  worktreeDir = mkdtempSync(join(tmpdir(), "railyn-tools-"));
  writeFileSync(join(worktreeDir, "hello.ts"), 'export const x = 1;\n');
  writeFileSync(join(worktreeDir, "README.md"), '# Test project\n');
  mkdirSync(join(worktreeDir, "src"));
  writeFileSync(join(worktreeDir, "src", "index.ts"), 'console.log("hi");\n');
});

afterEach(() => {
  rmSync(worktreeDir, { recursive: true, force: true });
});

const ctx = () => ({ worktreePath: worktreeDir });

// ─── myersDiff ────────────────────────────────────────────────────────────────

describe("myersDiff", () => {
  it("returns empty array for identical input", () => {
    const hunks = myersDiff(["a", "b", "c"], ["a", "b", "c"]);
    expect(hunks).toEqual([]);
  });

  it("returns all-added hunk when before is empty", () => {
    const hunks = myersDiff([], ["a", "b"]);
    expect(hunks.length).toBe(1);
    expect(hunks[0].lines.every(l => l.type === "added")).toBe(true);
    expect(hunks[0].lines.map(l => l.content)).toEqual(["a", "b"]);
  });

  it("returns all-removed hunk when after is empty", () => {
    const hunks = myersDiff(["a", "b"], []);
    expect(hunks.length).toBe(1);
    expect(hunks[0].lines.every(l => l.type === "removed")).toBe(true);
    expect(hunks[0].lines.map(l => l.content)).toEqual(["a", "b"]);
  });

  it("produces correct removed/added/context lines for a single-line change", () => {
    const hunks = myersDiff(["line1", "line2", "line3"], ["line1", "changed", "line3"]);
    expect(hunks.length).toBe(1);
    const lines = hunks[0].lines;
    expect(lines.find(l => l.type === "removed")?.content).toBe("line2");
    expect(lines.find(l => l.type === "added")?.content).toBe("changed");
    expect(lines.find(l => l.type === "context" && l.content === "line1")).toBeDefined();
    expect(lines.find(l => l.type === "context" && l.content === "line3")).toBeDefined();
  });

  it("caps trailing context at 3 lines per hunk boundary", () => {
    // change at index 3 (d→X); "h" is the 4th line after the change → must be excluded
    const before = ["a", "b", "c", "d", "e", "f", "g", "h"];
    const after  = ["a", "b", "c", "X", "e", "f", "g", "h"];
    const hunks = myersDiff(before, after);
    expect(hunks.length).toBe(1);
    const contents = hunks[0].lines.map(l => l.content);
    expect(contents).not.toContain("h");
  });

  it("produces two hunks for distant changes", () => {
    // Changes at positions 0 and 11 — more than 6 lines apart → separate hunks
    const before = ["A","b","c","d","e","f","g","h","i","j","k","L"];
    const after  = ["X","b","c","d","e","f","g","h","i","j","k","Z"];
    const hunks = myersDiff(before, after);
    expect(hunks.length).toBe(2);
  });

  it("assigns correct old_line and new_line numbers", () => {
    const hunks = myersDiff(["a", "b", "c"], ["a", "X", "c"]);
    const removed = hunks[0].lines.find(l => l.type === "removed")!;
    const added   = hunks[0].lines.find(l => l.type === "added")!;
    expect(removed.old_line).toBe(2);
    expect(removed.new_line).toBeUndefined();
    expect(added.new_line).toBe(2);
    expect(added.old_line).toBeUndefined();
  });
});

// ─── read_file ────────────────────────────────────────────────────────────────

describe("executeTool / read_file", () => {
  it("reads an existing file", async () => {
    const result = await executeTool("read_file", JSON.stringify({ path: "hello.ts" }), ctx());
    expect(result).toContain("export const x = 1");
  });

  it("returns error for missing file", async () => {
    const result = await executeTool("read_file", JSON.stringify({ path: "nope.ts" }), ctx());
    expect(result).toMatch(/Error.*not found/i);
  });

  it("blocks path traversal", async () => {
    const result = await executeTool("read_file", JSON.stringify({ path: "../../etc/passwd" }), ctx());
    expect(result).toMatch(/path traversal/i);
  });

  it("returns error for directory", async () => {
    const result = await executeTool("read_file", JSON.stringify({ path: "src" }), ctx());
    expect(result).toMatch(/not a file/i);
  });

  it("returns error for invalid JSON args", async () => {
    const result = await executeTool("read_file", "not-json", ctx());
    expect(result).toMatch(/could not parse/i);
  });
});

// ─── list_dir ─────────────────────────────────────────────────────────────────

describe("executeTool / list_dir", () => {
  it("lists root directory", async () => {
    const result = await executeTool("list_dir", JSON.stringify({ path: "." }), ctx());
    expect(result).toContain("hello.ts");
    expect(result).toContain("README.md");
    expect(result).toContain("src/");
  });

  it("lists subdirectory", async () => {
    const result = await executeTool("list_dir", JSON.stringify({ path: "src" }), ctx());
    expect(result).toContain("src/index.ts");
  });

  it("returns error for missing directory", async () => {
    const result = await executeTool("list_dir", JSON.stringify({ path: "nowhere" }), ctx());
    expect(result).toMatch(/Error.*not found/i);
  });

  it("blocks path traversal", async () => {
    const result = await executeTool("list_dir", JSON.stringify({ path: "../../../" }), ctx());
    expect(result).toMatch(/path traversal/i);
  });

  it("returns error when path is a file not a dir", async () => {
    const result = await executeTool("list_dir", JSON.stringify({ path: "hello.ts" }), ctx());
    expect(result).toMatch(/not a directory/i);
  });
});

// ─── run_command ──────────────────────────────────────────────────────────────

describe("executeTool / run_command", () => {
  it("runs a safe read-only command", async () => {
    const result = await executeTool("run_command", JSON.stringify({ command: "echo hello" }), ctx());
    expect(result).toBe("hello");
  });

  it("blocks rm command", async () => {
    const result = await executeTool("run_command", JSON.stringify({ command: "rm -rf ." }), ctx());
    expect(result).toMatch(/blocked/i);
  });

  it("blocks git push", async () => {
    const result = await executeTool("run_command", JSON.stringify({ command: "git push origin main" }), ctx());
    expect(result).toMatch(/blocked/i);
  });

  it("blocks curl", async () => {
    const result = await executeTool("run_command", JSON.stringify({ command: "curl https://evil.com" }), ctx());
    expect(result).toMatch(/blocked/i);
  });

  it("captures stderr", async () => {
    const result = await executeTool("run_command", JSON.stringify({ command: "ls /nonexistent_path_xyz" }), ctx());
    // Either an error message or stderr output — both are acceptable
    expect(result.length).toBeGreaterThan(0);
  });

  it("returns (no output) for silent commands", async () => {
    const result = await executeTool("run_command", JSON.stringify({ command: "true" }), ctx());
    expect(result).toBe("(no output)");
  });
});

// ─── unknown tool ─────────────────────────────────────────────────────────────

describe("executeTool / unknown", () => {
  it("returns error for unknown tool name", async () => {
    const result = await executeTool("delete_everything", JSON.stringify({}), ctx());
    expect(result).toMatch(/unknown tool/i);
  });
});

// ─── write_file ───────────────────────────────────────────────────────────────

describe("executeTool / write_file", () => {
  it("creates a new file and returns is_new FileDiffPayload with added hunks", async () => {
    const r = asWrite(await executeTool("write_file", JSON.stringify({ path: "new.ts", content: "const a = 1;" }), ctx()));
    expect(r.content).toMatch(/OK/);
    expect(r.content).toMatch(/\+\d+ lines?/);
    expect(readFileSync(join(worktreeDir, "new.ts"), "utf-8")).toBe("const a = 1;");
    expect(r.diff.operation).toBe("write_file");
    expect(r.diff.is_new).toBe(true);
    expect(r.diff.added).toBeGreaterThan(0);
    expect(r.diff.removed).toBe(0);
    expect(r.diff.hunks).toBeDefined();
    expect(r.diff.hunks![0].lines.every(l => l.type === "added")).toBe(true);
  });

  it("overwrites an existing file and returns Myers diff hunks", async () => {
    // hello.ts fixture: 'export const x = 1;\n'
    const r = asWrite(await executeTool("write_file", JSON.stringify({ path: "hello.ts", content: "const b = 2;" }), ctx()));
    expect(r.content).toMatch(/OK/);
    expect(r.content).toMatch(/\+\d+ -\d+/);
    expect(readFileSync(join(worktreeDir, "hello.ts"), "utf-8")).toBe("const b = 2;");
    expect(r.diff.operation).toBe("write_file");
    expect(r.diff.is_new).toBeFalsy();
    expect(r.diff.hunks).toBeDefined();
    const allLines = r.diff.hunks!.flatMap(h => h.lines);
    expect(allLines.some(l => l.type === "removed")).toBe(true);
    expect(allLines.some(l => l.type === "added")).toBe(true);
  });

  it("creates parent directories if missing", async () => {
    const r = asWrite(await executeTool("write_file", JSON.stringify({ path: "deep/nested/file.ts", content: "x" }), ctx()));
    expect(r.content).toMatch(/OK/);
    expect(existsSync(join(worktreeDir, "deep", "nested", "file.ts"))).toBe(true);
  });

  it("blocks path traversal", async () => {
    const result = await executeTool("write_file", JSON.stringify({ path: "../../evil.ts", content: "x" }), ctx()) as string;
    expect(result).toMatch(/path traversal/i);
  });
});

// ─── delete_file ──────────────────────────────────────────────────────────────

describe("executeTool / delete_file", () => {
  it("deletes file and returns FileDiffPayload with removed hunks", async () => {
    // README.md fixture: '# Test project\n' → 1 line
    const r = asWrite(await executeTool("delete_file", JSON.stringify({ path: "README.md" }), ctx()));
    expect(r.content).toMatch(/OK: deleted/i);
    expect(r.content).toMatch(/\d+ lines?/);
    expect(existsSync(join(worktreeDir, "README.md"))).toBe(false);
    expect(r.diff.operation).toBe("delete_file");
    expect(r.diff.removed).toBeGreaterThan(0);
    expect(r.diff.added).toBe(0);
    expect(r.diff.hunks).toBeDefined();
    expect(r.diff.hunks!.length).toBeGreaterThan(0);
    expect(r.diff.hunks![0].lines.every(l => l.type === "removed")).toBe(true);
  });

  it("returns error string for non-existent file", async () => {
    const result = await executeTool("delete_file", JSON.stringify({ path: "ghost.ts" }), ctx()) as string;
    expect(result).toMatch(/Error.*not found/i);
  });

  it("blocks path traversal", async () => {
    const result = await executeTool("delete_file", JSON.stringify({ path: "../../important" }), ctx()) as string;
    expect(result).toMatch(/path traversal/i);
  });
});

// ─── rename_file ──────────────────────────────────────────────────────────────

describe("executeTool / rename_file", () => {
  it("renames file and returns FileDiffPayload with to_path", async () => {
    const r = asWrite(await executeTool("rename_file", JSON.stringify({ from_path: "README.md", to_path: "NOTES.md" }), ctx()));
    expect(r.content).toMatch(/OK/);
    expect(existsSync(join(worktreeDir, "NOTES.md"))).toBe(true);
    expect(existsSync(join(worktreeDir, "README.md"))).toBe(false);
    expect(r.diff.operation).toBe("rename_file");
    expect(r.diff.path).toBe("README.md");
    expect(r.diff.to_path).toBe("NOTES.md");
    expect(r.diff.added).toBe(0);
    expect(r.diff.removed).toBe(0);
    expect(r.diff.hunks).toBeUndefined();
  });

  it("returns error string when source does not exist", async () => {
    const result = await executeTool("rename_file", JSON.stringify({ from_path: "ghost.ts", to_path: "newname.ts" }), ctx()) as string;
    expect(result).toMatch(/Error.*not found/i);
  });

  it("blocks path traversal in to_path", async () => {
    const result = await executeTool("rename_file", JSON.stringify({ from_path: "hello.ts", to_path: "../../evil.ts" }), ctx()) as string;
    expect(result).toMatch(/path traversal/i);
  });
});

// ─── search_text ──────────────────────────────────────────────────────────────

describe("executeTool / search_text", () => {
  it("finds lines matching a pattern", async () => {
    const result = await executeTool("search_text", JSON.stringify({ pattern: "export const" }), ctx());
    expect(result).toContain("hello.ts");
    expect(result).toContain("export const");
  });

  it("returns no-match indicator when pattern not found", async () => {
    const result = await executeTool("search_text", JSON.stringify({ pattern: "xyzzy_not_here" }), ctx());
    expect(result).toMatch(/no matches/i);
  });

  it("restricts to glob when provided", async () => {
    const result = await executeTool("search_text", JSON.stringify({ pattern: "log", glob: "*.md" }), ctx());
    // README.md does not contain "log", src/index.ts does — glob restricts to *.md only
    expect(result).toMatch(/no matches/i);
  });
});

// ─── find_files ───────────────────────────────────────────────────────────────

describe("executeTool / find_files", () => {
  it("finds files matching a glob", async () => {
    const result = await executeTool("find_files", JSON.stringify({ glob: "**/*.ts" }), ctx());
    expect(result).toContain("hello.ts");
    expect(result).toContain("src/index.ts");
  });

  it("returns no-files indicator when glob matches nothing", async () => {
    const result = await executeTool("find_files", JSON.stringify({ glob: "**/*.java" }), ctx());
    expect(result).toMatch(/no files/i);
  });
});

// ─── run_command block-list extensions ───────────────────────────────────────

describe("executeTool / run_command — write redirection block-list", () => {
  it("blocks > redirection", async () => {
    const result = await executeTool("run_command", JSON.stringify({ command: "echo x > /tmp/out.txt" }), ctx());
    expect(result).toMatch(/blocked/i);
  });

  it("blocks >> append redirection", async () => {
    const result = await executeTool("run_command", JSON.stringify({ command: "echo x >> /tmp/out.txt" }), ctx());
    expect(result).toMatch(/blocked/i);
  });

  it("blocks tee", async () => {
    const result = await executeTool("run_command", JSON.stringify({ command: "echo x | tee /tmp/out.txt" }), ctx());
    expect(result).toMatch(/blocked/i);
  });
});

// ─── resolveToolsForColumn — group expansion ──────────────────────────────────

describe("resolveToolsForColumn", () => {
  it("expands a group name to its tools", () => {
    const result = resolveToolsForColumn(["write"]);
    const names = result.map((t) => t.name);
    expect(names).toContain("write_file");
    expect(names).toContain("patch_file");
    expect(names).toContain("delete_file");
    expect(names).toContain("rename_file");
  });

  it("handles individual tool names alongside group names", () => {
    const result = resolveToolsForColumn(["read", "ask_me"]);
    const names = result.map((t) => t.name);
    expect(names).toContain("read_file");
    expect(names).toContain("list_dir");
    expect(names).toContain("ask_me");
  });

  it("deduplicates when a tool appears via group and by name", () => {
    const result = resolveToolsForColumn(["read", "read_file"]);
    const names = result.map((t) => t.name);
    const readFileCount = names.filter((n) => n === "read_file").length;
    expect(readFileCount).toBe(1);
  });

  it("expands all known groups without unknown-tool warnings", () => {
    // Every group name should resolve to at least one known tool definition
    for (const [groupName] of TOOL_GROUPS) {
      const result = resolveToolsForColumn([groupName]);
      expect(result.length).toBeGreaterThan(0);
    }
  });

  it("uses defaults when columnTools is undefined", () => {
    const result = resolveToolsForColumn(undefined);
    const names = result.map((t) => t.name);
    expect(names).toContain("read_file");
    expect(names).toContain("list_dir");
    expect(names).toContain("run_command");
  });

  it("expands web group to fetch_url and search_internet", () => {
    const result = resolveToolsForColumn(["web"]);
    const names = result.map((t) => t.name);
    expect(names).toContain("fetch_url");
    expect(names).toContain("search_internet");
  });
});

// ─── read_file partial reads ──────────────────────────────────────────────────

describe("executeTool / read_file partial reads", () => {
  beforeEach(() => {
    writeFileSync(join(worktreeDir, "lines.txt"), "line1\nline2\nline3\nline4\nline5\n");
  });

  it("reads the full file when no range specified", async () => {
    const result = await executeTool("read_file", JSON.stringify({ path: "lines.txt" }), ctx());
    expect(result).toContain("line1");
    expect(result).toContain("line5");
  });

  it("reads a specific line range", async () => {
    const result = await executeTool("read_file", JSON.stringify({ path: "lines.txt", start_line: 2, end_line: 4 }), ctx());
    expect(result).toContain("line2");
    expect(result).toContain("line3");
    expect(result).toContain("line4");
    expect(result).not.toContain("line1");
    expect(result).not.toContain("line5");
  });

  it("reads from start_line to end of file when end_line omitted", async () => {
    const result = await executeTool("read_file", JSON.stringify({ path: "lines.txt", start_line: 3 }), ctx());
    expect(result).toContain("line3");
    expect(result).toContain("line5");
    expect(result).not.toContain("line1");
  });
});

// ─── patch_file ───────────────────────────────────────────────────────────────

describe("executeTool / patch_file", () => {
  beforeEach(() => {
    writeFileSync(join(worktreeDir, "target.ts"), "const a = 1;\nconst b = 2;\n");
  });

  it("prepends content (position=start) and returns added-only diff", async () => {
    const r = asWrite(await executeTool("patch_file", JSON.stringify({
      path: "target.ts", content: "// header\n", position: "start",
    }), ctx()));
    expect(r.content).toMatch(/OK/);
    expect(r.content).toMatch(/\+\d+/);
    expect(readFileSync(join(worktreeDir, "target.ts"), "utf-8")).toMatch(/^\/\/ header/);
    expect(r.diff.operation).toBe("patch_file");
    expect(r.diff.added).toBeGreaterThan(0);
    expect(r.diff.removed).toBe(0);
  });

  it("appends content (position=end) and returns added-only diff", async () => {
    const r = asWrite(await executeTool("patch_file", JSON.stringify({
      path: "target.ts", content: "// footer\n", position: "end",
    }), ctx()));
    expect(r.content).toMatch(/OK/);
    expect(r.content).toMatch(/\+\d+/);
    expect(readFileSync(join(worktreeDir, "target.ts"), "utf-8")).toMatch(/\/\/ footer\n$/);
    expect(r.diff.added).toBeGreaterThan(0);
    expect(r.diff.removed).toBe(0);
  });

  it("inserts before anchor (position=before) and includes line number in LLM string", async () => {
    const r = asWrite(await executeTool("patch_file", JSON.stringify({
      path: "target.ts", content: "// inserted\n", position: "before", anchor: "const b = 2;",
    }), ctx()));
    expect(r.content).toMatch(/OK/);
    expect(r.content).toMatch(/at line \d+/i);
    const content = readFileSync(join(worktreeDir, "target.ts"), "utf-8");
    expect(content).toContain("// inserted\nconst b = 2;");
    expect(r.diff.added).toBeGreaterThan(0);
    expect(r.diff.removed).toBe(0);
  });

  it("inserts after anchor (position=after) and includes line number in LLM string", async () => {
    const r = asWrite(await executeTool("patch_file", JSON.stringify({
      path: "target.ts", content: "\n// after", position: "after", anchor: "const a = 1;",
    }), ctx()));
    expect(r.content).toMatch(/OK/);
    expect(r.content).toMatch(/at line \d+/i);
    const content = readFileSync(join(worktreeDir, "target.ts"), "utf-8");
    expect(content).toContain("const a = 1;\n// after");
    expect(r.diff.added).toBeGreaterThan(0);
    expect(r.diff.removed).toBe(0);
  });

  it("replaces anchor (position=replace) and returns removed+added diff with hunks", async () => {
    const r = asWrite(await executeTool("patch_file", JSON.stringify({
      path: "target.ts", content: "const a = 42;", position: "replace", anchor: "const a = 1;",
    }), ctx()));
    expect(r.content).toMatch(/OK/);
    expect(r.content).toMatch(/\+\d+ -\d+/);
    expect(r.content).toMatch(/at line \d+/i);
    const content = readFileSync(join(worktreeDir, "target.ts"), "utf-8");
    expect(content).toContain("const a = 42;");
    expect(content).not.toContain("const a = 1;");
    expect(r.diff.removed).toBeGreaterThan(0);
    expect(r.diff.added).toBeGreaterThan(0);
    expect(r.diff.hunks).toBeDefined();
    const allLines = r.diff.hunks!.flatMap(h => h.lines);
    expect(allLines.some(l => l.type === "removed" && l.content === "const a = 1;")).toBe(true);
    expect(allLines.some(l => l.type === "added" && l.content === "const a = 42;")).toBe(true);
  });

  it("deletes content via position=replace with content='' (deleted line shows as removed)", async () => {
    const r = asWrite(await executeTool("patch_file", JSON.stringify({
      path: "target.ts", content: "", position: "replace", anchor: "const a = 1;\n",
    }), ctx()));
    expect(r.content).toMatch(/OK/);
    const fileContent = readFileSync(join(worktreeDir, "target.ts"), "utf-8");
    expect(fileContent).not.toContain("const a = 1;");
    expect(r.diff.removed).toBe(1);
    expect(r.diff.added).toBe(0);
    // LLM message must NOT claim lines were added
    expect(r.content).not.toMatch(/\+[1-9]/);
    const allLines = r.diff.hunks!.flatMap(h => h.lines);
    expect(allLines.some(l => l.type === "removed")).toBe(true);
    expect(allLines.some(l => l.type === "added")).toBe(false);
  });

  it("deletes a multi-line block via position=replace with content=''", async () => {
    writeFileSync(join(worktreeDir, "block.ts"), "// header\nline1\nline2\n// footer\n");
    const r = asWrite(await executeTool("patch_file", JSON.stringify({
      path: "block.ts", content: "", position: "replace", anchor: "line1\nline2\n",
    }), ctx()));
    expect(r.content).toMatch(/OK/);
    const fileContent = readFileSync(join(worktreeDir, "block.ts"), "utf-8");
    expect(fileContent).not.toContain("line1");
    expect(fileContent).not.toContain("line2");
    expect(fileContent).toContain("// header");
    expect(fileContent).toContain("// footer");
    expect(r.diff.removed).toBe(2);
    expect(r.diff.added).toBe(0);
  });

  it("replaces multi-line anchor with new content and counts correctly", async () => {
    writeFileSync(join(worktreeDir, "multi.ts"), "start\nold line 1\nold line 2\nend\n");
    const r = asWrite(await executeTool("patch_file", JSON.stringify({
      path: "multi.ts", content: "new line\n", position: "replace", anchor: "old line 1\nold line 2\n",
    }), ctx()));
    expect(r.content).toMatch(/OK/);
    const fileContent = readFileSync(join(worktreeDir, "multi.ts"), "utf-8");
    expect(fileContent).toContain("new line");
    expect(fileContent).not.toContain("old line 1");
    expect(r.diff.removed).toBe(2);
    expect(r.diff.added).toBe(1);
    // Confirmation string counts must match diff counts exactly
    expect(r.content).toContain("+1");
    expect(r.content).toContain("-2");
  });

  it("exact count: start prepend of 2 lines reports added=2 in both diff and message", async () => {
    const r = asWrite(await executeTool("patch_file", JSON.stringify({
      path: "target.ts", content: "line1\nline2\n", position: "start",
    }), ctx()));
    expect(r.diff.added).toBe(2);
    expect(r.diff.removed).toBe(0);
    expect(r.content).toContain("+2");
  });

  it("empty content before anchor returns no-op error", async () => {
    const result = await executeTool("patch_file", JSON.stringify({
      path: "target.ts", content: "", position: "before", anchor: "const b = 2;",
    }), ctx()) as string;
    expect(result).toMatch(/would not modify the file/i);
  });

  it("returns error when file does not exist", async () => {
    const result = await executeTool("patch_file", JSON.stringify({
      path: "nonexistent.ts", content: "x", position: "end",
    }), ctx()) as string;
    expect(result).toMatch(/file not found|not found/i);
  });

  it("rejects ambiguous anchor", async () => {
    writeFileSync(join(worktreeDir, "dup.ts"), "dup\ndup\n");
    const result = await executeTool("patch_file", JSON.stringify({
      path: "dup.ts", content: "x", position: "replace", anchor: "dup",
    }), ctx()) as string;
    expect(result).toMatch(/appears.*times|ambiguous/i);
  });

  it("empty content insertion (position=after) returns no-op error", async () => {
    const result = await executeTool("patch_file", JSON.stringify({
      path: "target.ts", content: "", position: "after", anchor: "const a = 1;",
    }), ctx()) as string;
    expect(result).toMatch(/would not modify the file/i);
  });

  it("single blank-line insertion reports 1 added", async () => {
    const r = asWrite(await executeTool("patch_file", JSON.stringify({
      path: "target.ts", content: "\n", position: "after", anchor: "const a = 1;",
    }), ctx()));
    expect(r.content).toMatch(/OK/);
    expect(r.diff.added).toBe(1);
    expect(r.diff.removed).toBe(0);
  });

  it("rejects anchor not found", async () => {
    const result = await executeTool("patch_file", JSON.stringify({
      path: "target.ts", content: "x", position: "replace", anchor: "notexist",
    }), ctx()) as string;
    expect(result).toMatch(/anchor not found/i);
  });

  it("rejects missing anchor param for anchor-based positions", async () => {
    const result = await executeTool("patch_file", JSON.stringify({
      path: "target.ts", content: "x", position: "before",
    }), ctx()) as string;
    expect(result).toMatch(/anchor is required/i);
  });

  it("blocks path traversal", async () => {
    const result = await executeTool("patch_file", JSON.stringify({
      path: "../../evil.ts", content: "x", position: "end",
    }), ctx()) as string;
    expect(result).toMatch(/path traversal/i);
  });
});

// ─── search_text context_lines ────────────────────────────────────────────────

describe("executeTool / search_text context_lines", () => {
  beforeEach(() => {
    writeFileSync(join(worktreeDir, "ctx.txt"), "before\ntarget\nafter\n");
  });

  it("returns only matching line when context_lines omitted", async () => {
    const result = await executeTool("search_text", JSON.stringify({ pattern: "target" }), ctx());
    expect(result).toContain("target");
    // should not include surrounding lines (grep -rn with no -C)
    expect(result.split("\n").filter(l => l.includes("before")).length).toBe(0);
  });

  it("returns surrounding lines when context_lines is set", async () => {
    const result = await executeTool("search_text", JSON.stringify({ pattern: "target", context_lines: 1 }), ctx());
    expect(result).toContain("target");
    expect(result).toContain("before");
    expect(result).toContain("after");
  });
});

// ─── fetch_url ────────────────────────────────────────────────────────────────

describe("executeTool / fetch_url", () => {
  it("rejects localhost URL (SSRF)", async () => {
    const result = await executeTool("fetch_url", JSON.stringify({ url: "http://127.0.0.1/secret" }), ctx());
    expect(result).toMatch(/SSRF|private|loopback/i);
  });

  it("rejects private IP URL (SSRF)", async () => {
    const result = await executeTool("fetch_url", JSON.stringify({ url: "http://192.168.1.1/" }), ctx());
    expect(result).toMatch(/SSRF|private|loopback/i);
  });

  it("returns error for invalid URL", async () => {
    const result = await executeTool("fetch_url", JSON.stringify({ url: "not-a-url" }), ctx());
    expect(result).toMatch(/error/i);
  });
});

// ─── search_internet ──────────────────────────────────────────────────────────

describe("executeTool / search_internet", () => {
  it("returns config error when search not configured", async () => {
    const result = await executeTool("search_internet", JSON.stringify({ query: "test" }), ctx());
    expect(result).toMatch(/not configured|workspace\.yaml/i);
  });

  it("returns config error when api_key is empty", async () => {
    const ctxWithSearch = { ...ctx(), searchConfig: { engine: "tavily", api_key: "" } };
    const result = await executeTool("search_internet", JSON.stringify({ query: "test" }), ctxWithSearch);
    expect(result).toMatch(/not configured/i);
  });

  it("returns error for unsupported engine", async () => {
    const ctxWithSearch = { ...ctx(), searchConfig: { engine: "bing", api_key: "key123" } };
    const result = await executeTool("search_internet", JSON.stringify({ query: "test" }), ctxWithSearch);
    expect(result).toMatch(/unsupported.*engine/i);
  });
});
