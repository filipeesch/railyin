import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { executeTool, resolveToolsForColumn, TOOL_GROUPS, myersDiff, extractCommandBinaries } from "../workflow/tools.ts";
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
const ctxWithCache = () => ({ worktreePath: worktreeDir, mtimeCache: new Map<string, number>() });

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

// ─── run_command ──────────────────────────────────────────────────────────────

describe("executeTool / run_command", () => {
  it("runs a safe read-only command", async () => {
    const result = await executeTool("run_command", JSON.stringify({ command: "echo hello" }), ctx());
    expect(result).toBe("hello");
  });

  it("runs rm without approval gate when no taskCallbacks provided", async () => {
    // With no taskCallbacks, the approval gate is bypassed entirely — the command runs
    const result = await executeTool("run_command", JSON.stringify({ command: "echo ran" }), ctx());
    expect(result).toBe("ran");
  });

  it("skips approval gate when shellAutoApprove is true", async () => {
    const result = await executeTool(
      "run_command",
      JSON.stringify({ command: "echo approved" }),
      { ...ctx(), shellAutoApprove: true, approvedCommands: [] },
    );
    expect(result).toBe("approved");
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

// ─── edit_file ────────────────────────────────────────────────────────────────

describe("executeTool / edit_file", () => {
  it("creates file when old_string is empty and file does not exist", async () => {
    const r = asWrite(await executeTool("edit_file", JSON.stringify({ path: "created.ts", old_string: "", new_string: "const x = 1;\n" }), ctx()));
    expect(r.content).toMatch(/created successfully/i);
    expect(existsSync(join(worktreeDir, "created.ts"))).toBe(true);
    expect(readFileSync(join(worktreeDir, "created.ts"), "utf-8")).toBe("const x = 1;\n");
    expect(r.diff.operation).toBe("edit_file");
  });

  it("replaces a unique occurrence of old_string", async () => {
    const r = asWrite(await executeTool("edit_file", JSON.stringify({ path: "hello.ts", old_string: "x = 1", new_string: "x = 42" }), ctx()));
    expect(r.content).toMatch(/updated successfully/i);
    expect(readFileSync(join(worktreeDir, "hello.ts"), "utf-8")).toContain("x = 42");
    expect(readFileSync(join(worktreeDir, "hello.ts"), "utf-8")).not.toContain("x = 1");
    expect(r.diff.operation).toBe("edit_file");
  });

  it("returns error when old_string is not found", async () => {
    const result = await executeTool("edit_file", JSON.stringify({ path: "hello.ts", old_string: "not_in_file", new_string: "x" }), ctx()) as string;
    expect(result).toMatch(/not found/i);
  });

  it("returns error when old_string appears multiple times without replace_all", async () => {
    writeFileSync(join(worktreeDir, "dup.ts"), "dup\ndup\n");
    const result = await executeTool("edit_file", JSON.stringify({ path: "dup.ts", old_string: "dup", new_string: "x" }), ctx()) as string;
    expect(result).toMatch(/2 times|multiple/i);
  });

  it("replaces all occurrences when replace_all=true", async () => {
    writeFileSync(join(worktreeDir, "dup.ts"), "dup\ndup\n");
    const r = asWrite(await executeTool("edit_file", JSON.stringify({ path: "dup.ts", old_string: "dup", new_string: "rep", replace_all: "true" }), ctx()));
    expect(r.content).toMatch(/updated successfully/i);
    expect(readFileSync(join(worktreeDir, "dup.ts"), "utf-8")).toBe("rep\nrep\n");
  });

  it("returns error when old_string is empty but file exists", async () => {
    const result = await executeTool("edit_file", JSON.stringify({ path: "hello.ts", old_string: "", new_string: "x" }), ctx()) as string;
    expect(result).toMatch(/already exists|write_file/i);
  });

  it("returns error for non-existent file with non-empty old_string", async () => {
    const result = await executeTool("edit_file", JSON.stringify({ path: "ghost.ts", old_string: "x", new_string: "y" }), ctx()) as string;
    expect(result).toMatch(/not found/i);
  });

  it("blocks path traversal", async () => {
    const result = await executeTool("edit_file", JSON.stringify({ path: "../../evil.ts", old_string: "", new_string: "x" }), ctx()) as string;
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

describe("executeTool / run_command — approval gate", () => {
  it("runs command when no taskCallbacks provided (no gate)", async () => {
    const result = await executeTool("run_command", JSON.stringify({ command: "echo x" }), ctx());
    expect(result).toBe("x");
  });

  it("calls requestShellApproval for unapproved binaries", async () => {
    let capturedBinaries: string[] = [];
    const result = await executeTool("run_command", JSON.stringify({ command: "curl https://example.com" }), {
      ...ctx(),
      shellAutoApprove: false,
      approvedCommands: [],
      taskId: 999,
      taskCallbacks: {
        handleTransition: () => {},
        handleHumanTurn: () => {},
        cancelExecution: () => {},
        appendApprovedCommands: () => {},
        requestShellApproval: async (_tid, _cmd, binaries) => {
          capturedBinaries = binaries;
          return "deny";
        },
      },
    });
    expect(capturedBinaries).toContain("curl");
    expect(result).toMatch(/denied/i);
  });

  it("skips gate when shellAutoApprove is true", async () => {
    let gateCalled = false;
    const result = await executeTool("run_command", JSON.stringify({ command: "echo approved" }), {
      ...ctx(),
      shellAutoApprove: true,
      approvedCommands: [],
      taskId: 999,
      taskCallbacks: {
        handleTransition: () => {},
        handleHumanTurn: () => {},
        cancelExecution: () => {},
        appendApprovedCommands: () => {},
        requestShellApproval: async () => { gateCalled = true; return "deny"; },
      },
    });
    expect(gateCalled).toBe(false);
    expect(result).toBe("approved");
  });

  it("skips gate when binary is already approved", async () => {
    let gateCalled = false;
    const result = await executeTool("run_command", JSON.stringify({ command: "echo test" }), {
      ...ctx(),
      shellAutoApprove: false,
      approvedCommands: ["echo"],
      taskId: 999,
      taskCallbacks: {
        handleTransition: () => {},
        handleHumanTurn: () => {},
        cancelExecution: () => {},
        appendApprovedCommands: () => {},
        requestShellApproval: async () => { gateCalled = true; return "deny"; },
      },
    });
    expect(gateCalled).toBe(false);
    expect(result).toBe("test");
  });
});

// ─── extractCommandBinaries ───────────────────────────────────────────────────

describe("extractCommandBinaries", () => {
  it("extracts single binary", () => {
    expect(extractCommandBinaries("git status")).toEqual(["git"]);
  });

  it("extracts binaries from compound command with &&", () => {
    expect(extractCommandBinaries("cd src && bun test && git diff")).toEqual(["cd", "bun", "git"]);
  });

  it("deduplicates repeated binaries", () => {
    expect(extractCommandBinaries("git add . && git commit -m 'msg'")).toEqual(["git"]);
  });

  it("handles pipe operator", () => {
    expect(extractCommandBinaries("ls -la | grep ts")).toEqual(["ls", "grep"]);
  });

  it("handles || operator", () => {
    expect(extractCommandBinaries("mkdir dist || true")).toEqual(["mkdir", "true"]);
  });

  it("handles semicolon separator", () => {
    expect(extractCommandBinaries("echo a; echo b")).toEqual(["echo"]);
  });
});

// ─── resolveToolsForColumn — group expansion ──────────────────────────────────

describe("resolveToolsForColumn", () => {
  it("expands a group name to its tools", () => {
    const result = resolveToolsForColumn(["write"]);
    const names = result.map((t) => t.name);
    expect(names).toContain("write_file");
    expect(names).toContain("edit_file");
    expect(names).not.toContain("patch_file");
    expect(names).not.toContain("delete_file");
    expect(names).not.toContain("rename_file");
  });

  it("handles individual tool names alongside group names", () => {
    const result = resolveToolsForColumn(["read", "ask_me"]);
    const names = result.map((t) => t.name);
    expect(names).toContain("read_file");
    expect(names).not.toContain("list_dir");
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
    expect(names).toContain("run_command");
    expect(names).not.toContain("list_dir");
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

// ─── read_file line numbers and metadata header (Group 12) ───────────────────

describe("executeTool / read_file — line numbers and header", () => {
  it("includes metadata header with file path, total lines, and range", async () => {
    const result = await executeTool("read_file", JSON.stringify({ path: "hello.ts" }), ctx());
    expect(result).toMatch(/\[file: hello\.ts, lines: \d+, showing: \d+-\d+\]/);
  });

  it("prefixes each line with padded line number and arrow", async () => {
    const result = await executeTool("read_file", JSON.stringify({ path: "hello.ts" }), ctx());
    // First line must be formatted as "     1→content"
    const lines = result.split("\n");
    const firstContentLine = lines[1]; // lines[0] is the header
    expect(firstContentLine).toMatch(/^\s+1→/);
  });

  it("partial read header shows correct range", async () => {
    writeFileSync(join(worktreeDir, "five.txt"), "a\nb\nc\nd\ne\n");
    const result = await executeTool("read_file", JSON.stringify({ path: "five.txt", start_line: 2, end_line: 3 }), ctx());
    expect(result).toMatch(/showing: 2-3/);
    expect(result).toContain("b");
    expect(result).toContain("c");
    expect(result).not.toContain("a\n"); // "a" only appears as part of "da" or not at all
  });

  it("warns for empty file", async () => {
    writeFileSync(join(worktreeDir, "empty.ts"), "");
    const result = await executeTool("read_file", JSON.stringify({ path: "empty.ts" }), ctx());
    expect(result).toMatch(/empty/i);
  });

  it("warns when start_line exceeds file length", async () => {
    writeFileSync(join(worktreeDir, "short.ts"), "one line\n");
    const result = await executeTool("read_file", JSON.stringify({ path: "short.ts", start_line: 99 }), ctx());
    expect(result).toMatch(/exceeds|start_line/i);
  });
});

// ─── read_file mtime dedup (Group 12) ────────────────────────────────────────

describe("executeTool / read_file — mtime dedup", () => {
  it("returns stub on second full read of unchanged file when mtimeCache provided", async () => {
    const c = ctxWithCache();
    const first = await executeTool("read_file", JSON.stringify({ path: "hello.ts" }), c);
    expect(first).toContain("export const x = 1");
    const second = await executeTool("read_file", JSON.stringify({ path: "hello.ts" }), c);
    expect(second).toMatch(/unchanged since last read/i);
  });

  it("returns fresh content after file changes between reads", async () => {
    const c = ctxWithCache();
    await executeTool("read_file", JSON.stringify({ path: "hello.ts" }), c);
    writeFileSync(join(worktreeDir, "hello.ts"), "const updated = true;\n");
    const result = await executeTool("read_file", JSON.stringify({ path: "hello.ts" }), c);
    expect(result).toContain("updated");
  });

  it("partial reads always bypass dedup", async () => {
    const c = ctxWithCache();
    await executeTool("read_file", JSON.stringify({ path: "hello.ts" }), c);
    const partial = await executeTool("read_file", JSON.stringify({ path: "hello.ts", start_line: 1, end_line: 1 }), c);
    // Must return actual content, not the stub
    expect(partial).not.toMatch(/unchanged since last read/i);
    expect(partial).toContain("export const x = 1");
  });
});

// ─── edit_file read-before-write enforcement (Group 12) ──────────────────────

describe("executeTool / edit_file — read-before-write", () => {
  it("rejects edit when file has not been read when mtimeCache is provided", async () => {
    const c = ctxWithCache();
    const result = await executeTool("edit_file", JSON.stringify({ path: "hello.ts", old_string: "x = 1", new_string: "x = 99" }), c) as string;
    expect(result).toMatch(/must read|before editing/i);
  });

  it("allows edit after reading the file", async () => {
    const c = ctxWithCache();
    await executeTool("read_file", JSON.stringify({ path: "hello.ts" }), c);
    const r = asWrite(await executeTool("edit_file", JSON.stringify({ path: "hello.ts", old_string: "x = 1", new_string: "x = 99" }), c));
    expect(r.content).toMatch(/updated successfully/i);
  });

  it("rejects edit when file is modified after reading", async () => {
    const c = ctxWithCache();
    await executeTool("read_file", JSON.stringify({ path: "hello.ts" }), c);
    // Simulate external modification by forcing a different mtime in cache
    const abs = join(worktreeDir, "hello.ts");
    c.mtimeCache!.set(abs, 0); // stale mtime
    const result = await executeTool("edit_file", JSON.stringify({ path: "hello.ts", old_string: "x = 1", new_string: "x = 99" }), c) as string;
    expect(result).toMatch(/modified since|read it again/i);
  });

  it("skips read-before-write enforcement when no mtimeCache in ctx", async () => {
    // Without mtimeCache, edits are always allowed (backward compat)
    const r = asWrite(await executeTool("edit_file", JSON.stringify({ path: "hello.ts", old_string: "x = 1", new_string: "x = 99" }), ctx()));
    expect(r.content).toMatch(/updated successfully/i);
  });
});
