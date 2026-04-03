import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { executeTool } from "../workflow/tools.ts";

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

// ─── read_file ────────────────────────────────────────────────────────────────

describe("executeTool / read_file", () => {
  it("reads an existing file", () => {
    const result = executeTool("read_file", JSON.stringify({ path: "hello.ts" }), ctx());
    expect(result).toContain("export const x = 1");
  });

  it("returns error for missing file", () => {
    const result = executeTool("read_file", JSON.stringify({ path: "nope.ts" }), ctx());
    expect(result).toMatch(/Error.*not found/i);
  });

  it("blocks path traversal", () => {
    const result = executeTool("read_file", JSON.stringify({ path: "../../etc/passwd" }), ctx());
    expect(result).toMatch(/path traversal/i);
  });

  it("returns error for directory", () => {
    const result = executeTool("read_file", JSON.stringify({ path: "src" }), ctx());
    expect(result).toMatch(/not a file/i);
  });

  it("returns error for invalid JSON args", () => {
    const result = executeTool("read_file", "not-json", ctx());
    expect(result).toMatch(/could not parse/i);
  });
});

// ─── list_dir ─────────────────────────────────────────────────────────────────

describe("executeTool / list_dir", () => {
  it("lists root directory", () => {
    const result = executeTool("list_dir", JSON.stringify({ path: "." }), ctx());
    expect(result).toContain("hello.ts");
    expect(result).toContain("README.md");
    expect(result).toContain("src/");
  });

  it("lists subdirectory", () => {
    const result = executeTool("list_dir", JSON.stringify({ path: "src" }), ctx());
    expect(result).toContain("src/index.ts");
  });

  it("returns error for missing directory", () => {
    const result = executeTool("list_dir", JSON.stringify({ path: "nowhere" }), ctx());
    expect(result).toMatch(/Error.*not found/i);
  });

  it("blocks path traversal", () => {
    const result = executeTool("list_dir", JSON.stringify({ path: "../../../" }), ctx());
    expect(result).toMatch(/path traversal/i);
  });

  it("returns error when path is a file not a dir", () => {
    const result = executeTool("list_dir", JSON.stringify({ path: "hello.ts" }), ctx());
    expect(result).toMatch(/not a directory/i);
  });
});

// ─── run_command ──────────────────────────────────────────────────────────────

describe("executeTool / run_command", () => {
  it("runs a safe read-only command", () => {
    const result = executeTool("run_command", JSON.stringify({ command: "echo hello" }), ctx());
    expect(result).toBe("hello");
  });

  it("blocks rm command", () => {
    const result = executeTool("run_command", JSON.stringify({ command: "rm -rf ." }), ctx());
    expect(result).toMatch(/blocked/i);
  });

  it("blocks git push", () => {
    const result = executeTool("run_command", JSON.stringify({ command: "git push origin main" }), ctx());
    expect(result).toMatch(/blocked/i);
  });

  it("blocks curl", () => {
    const result = executeTool("run_command", JSON.stringify({ command: "curl https://evil.com" }), ctx());
    expect(result).toMatch(/blocked/i);
  });

  it("captures stderr", () => {
    const result = executeTool("run_command", JSON.stringify({ command: "ls /nonexistent_path_xyz" }), ctx());
    // Either an error message or stderr output — both are acceptable
    expect(result.length).toBeGreaterThan(0);
  });

  it("returns (no output) for silent commands", () => {
    const result = executeTool("run_command", JSON.stringify({ command: "true" }), ctx());
    expect(result).toBe("(no output)");
  });
});

// ─── unknown tool ─────────────────────────────────────────────────────────────

describe("executeTool / unknown", () => {
  it("returns error for unknown tool name", () => {
    const result = executeTool("delete_everything", JSON.stringify({}), ctx());
    expect(result).toMatch(/unknown tool/i);
  });
});
