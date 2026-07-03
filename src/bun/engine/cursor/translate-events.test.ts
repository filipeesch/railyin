/**
 * Unit tests for src/bun/engine/cursor/translate-events.ts
 *
 * Covers:
 *   - buildCursorToolDisplay: lowercase tool name matching
 *   - extractStructuredResult: shell stdout/stderr, edit/write diffString
 *   - translateCursorMessage: end-to-end SDK → EngineEvent shapes
 */

import { describe, expect, it } from "vitest";
import {
  buildCursorToolDisplay,
  extractStructuredResult,
  translateCursorMessage,
  normalizeCursorToolResult,
  unwrapCursorToolName,
} from "./translate-events.ts";
import type { CursorSDKMessage } from "./translate-events.ts";

/* ─── buildCursorToolDisplay — lowercase matching ─────────────────── */

describe("buildCursorToolDisplay", () => {
  it("read: extracts file path subject", () => {
    const d = buildCursorToolDisplay("read", { path: "/repo/src/foo.ts" }, "/repo");
    expect(d).toEqual({ label: "read", subject: "src/foo.ts", contentType: "file" });
  });

  it("read with file_path: accepts alternate arg name", () => {
    const d = buildCursorToolDisplay("read", { file_path: "/repo/src/bar.ts" }, "/repo");
    expect(d.subject).toBe("src/bar.ts");
  });

  it("shell: extracts command subject with terminal content type (canonical: run)", () => {
    const d = buildCursorToolDisplay("shell", { command: "ls -la" }, "/repo");
    expect(d).toEqual({ label: "run", subject: "ls -la", contentType: "terminal" });
  });

  it("shell with cmd: accepts alternate arg name", () => {
    const d = buildCursorToolDisplay("shell", { cmd: "echo hi" }, "/repo");
    expect(d.subject).toBe("echo hi");
  });

  it("edit: extracts file path subject", () => {
    const d = buildCursorToolDisplay("edit", { path: "/repo/src/baz.ts" }, "/repo");
    expect(d).toEqual({ label: "edit", subject: "src/baz.ts", contentType: "file" });
  });

  it("multiedit: maps to edit display (case-insensitive)", () => {
    const d = buildCursorToolDisplay("MultEdit", { path: "/repo/src/baz.ts" }, "/repo");
    expect(d.label).toBe("edit");
    expect(d.subject).toBe("src/baz.ts");
  });

  it("write: extracts file path subject", () => {
    const d = buildCursorToolDisplay("write", { path: "/repo/src/new.ts" }, "/repo");
    expect(d).toEqual({ label: "write", subject: "src/new.ts", contentType: "file" });
  });

  it("delete: extracts file path subject", () => {
    const d = buildCursorToolDisplay("delete", { path: "/repo/src/old.ts" }, "/repo");
    expect(d).toEqual({ label: "delete", subject: "src/old.ts", contentType: "file" });
  });

  it("glob: extracts pattern subject (canonical: find)", () => {
    const d = buildCursorToolDisplay("glob", { pattern: "src/**/*.ts" }, "/repo");
    expect(d).toEqual({ label: "find", subject: "src/**/*.ts" });
  });

  it("grep: extracts pattern from query field (canonical: search)", () => {
    const d = buildCursorToolDisplay("grep", { query: "TODO" }, "/repo");
    expect(d.label).toBe("search");
    expect(d.subject).toBe("TODO");
  });

  it("grep: extracts pattern from pattern field", () => {
    const d = buildCursorToolDisplay("grep", { pattern: "TODO" }, "/repo");
    expect(d.subject).toBe("TODO");
  });

  it("unknown tool: falls back to humanized label", () => {
    const d = buildCursorToolDisplay("unknown_tool", {}, "/repo");
    expect(d).toEqual({ label: "unknown tool" });
  });

  it("railyin_shell: maps to run display", () => {
    const d = buildCursorToolDisplay("railyin_shell", { command: "ls" }, "/repo");
    expect(d).toEqual({ label: "run", subject: "ls", contentType: "terminal" });
  });

  it("railyin_read: maps to read display", () => {
    const d = buildCursorToolDisplay("railyin_read", { path: "/repo/f.ts" }, "/repo");
    expect(d).toEqual({ label: "read", subject: "f.ts", contentType: "file" });
  });

  it("mcp envelope: unwraps before display lookup", () => {
    const { name, args } = unwrapCursorToolName("mcp", { toolName: "read", args: { path: "/repo/f.ts" } });
    const d = buildCursorToolDisplay(name, args, "/repo");
    expect(d.label).toBe("read");
    expect(d.subject).toBe("f.ts");
  });
});

/* ─── extractStructuredResult — structured data extraction ───────── */

describe("extractStructuredResult", () => {
  it("shell: extracts stdout into detailedResult", () => {
    const r = extractStructuredResult({
      status: "success",
      value: { exitCode: 0, signal: "", stdout: "hello world" },
    });
    expect(r.detailedResult).toBe("hello world");
  });

  it("shell: appends stderr to detailedResult", () => {
    const r = extractStructuredResult({
      status: "success",
      value: { exitCode: 1, signal: "", stdout: "out", stderr: "err" },
    });
    expect(r.detailedResult).toBe("out\nerr");
  });

  it("edit: parses diffString into writtenFiles with hunks", () => {
    const r = extractStructuredResult({
      status: "success",
      value: {
        linesAdded: 2,
        linesRemoved: 1,
        diffString: "--- a/src/foo.ts\n+++ b/src/foo.ts\n@@ -1,3 +1,4 @@\n-old\n+new\n+added\n",
      },
    });
    expect(r.writtenFiles).toHaveLength(1);
    expect(r.writtenFiles![0].path).toBe("src/foo.ts");
    expect(r.writtenFiles![0].operation).toBe("edit_file");
    expect(r.writtenFiles![0].hunks).toBeDefined();
    expect(r.writtenFiles![0].added).toBe(2);
    expect(r.writtenFiles![0].removed).toBe(1);
  });

  it("write: parses diffString into writtenFiles", () => {
    const r = extractStructuredResult({
      status: "success",
      value: {
        linesAdded: 5,
        linesRemoved: 0,
        diffString: "--- /dev/null\n+++ b/src/new.ts\n@@ -0,0 +1,5 @@\n+line1\n+line2\n",
      },
    });
    expect(r.writtenFiles![0].operation).toBe("edit_file");
  });

  it("delete: handles empty result gracefully", () => {
    const r = extractStructuredResult({
      status: "success",
      value: {},
    });
    expect(r.detailedResult).toBe("(file deleted)");
  });

  it("read: passes through content as detailedResult", () => {
    const r = extractStructuredResult({
      status: "success",
      value: { content: "file content" },
    });
    expect(r.detailedResult).toBe("file content");
  });

  it("unknown: falls back to JSON stringify", () => {
    const r = extractStructuredResult({
      status: "error",
      value: { message: "something broke" },
    });
    expect(r.detailedResult).toContain("something broke");
  });
});

/* ─── translateCursorMessage — end-to-end event shapes ───────────── */

describe("translateCursorMessage", () => {
  it("tool_call running → tool_start WITH display", () => {
    const events = translateCursorMessage({
      type: "tool_call",
      call_id: "tc-1",
      name: "shell",
      status: "running",
      args: { command: "ls -la", timeout: 30000 },
    } as CursorSDKMessage);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "tool_start",
      name: "shell",
      callId: "tc-1",
      display: { label: "run", subject: "ls -la", contentType: "terminal" },
    });
  });

  it("tool_call completed shell → tool_result WITH detailedResult", () => {
    const events = translateCursorMessage({
      type: "tool_call",
      call_id: "tc-1",
      name: "shell",
      status: "completed",
      args: { command: "ls -la" },
      result: { status: "success", value: { exitCode: 0, signal: "", stdout: "file1\nfile2\n", stderr: "" } },
    } as CursorSDKMessage);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "tool_result",
      name: "shell",
      callId: "tc-1",
      detailedResult: "file1\nfile2\n",
    });
  });

  it("tool_call completed edit → tool_result WITH writtenFiles", () => {
    const events = translateCursorMessage({
      type: "tool_call",
      call_id: "tc-2",
      name: "edit",
      status: "completed",
      args: { path: "/repo/src/foo.ts" },
      result: {
        status: "success",
        value: { linesAdded: 1, linesRemoved: 1, diffString: "--- a/src/foo.ts\n+++ b/src/foo.ts\n@@ -1 +1 @@\n-old\n+new\n" },
      },
    } as CursorSDKMessage);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "tool_result",
      name: "edit",
      callId: "tc-2",
      writtenFiles: expect.arrayContaining([
        expect.objectContaining({ operation: "edit_file", path: "src/foo.ts" }),
      ]),
    });
  });

  it("tool_call completed delete → tool_result with empty result handled", () => {
    const events = translateCursorMessage({
      type: "tool_call",
      call_id: "tc-3",
      name: "delete",
      status: "completed",
      args: { path: "/repo/src/old.ts" },
      result: { status: "success", value: {} },
    } as CursorSDKMessage);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "tool_result",
      name: "delete",
      callId: "tc-3",
    });
  });

  it("tool_call completed read → tool_result with content", () => {
    const events = translateCursorMessage({
      type: "tool_call",
      call_id: "tc-4",
      name: "read",
      status: "completed",
      args: { path: "/repo/src/foo.ts" },
      result: { status: "success", value: { content: "hello" } },
    } as CursorSDKMessage);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "tool_result",
      name: "read",
      callId: "tc-4",
    });
  });

  it("mcp envelope unwrapping for custom tools", () => {
    const events = translateCursorMessage({
      type: "tool_call",
      call_id: "tc-5",
      name: "mcp",
      status: "running",
      args: { toolName: "updateTodos", args: { todos: [] } },
    } as CursorSDKMessage);
    expect(events[0]).toMatchObject({
      type: "tool_start",
      name: "updateTodos",
      display: { label: "updateTodos" },
    });
  });
});

/* ─── normalizeCursorToolResult ──────────────────────────────────── */

describe("normalizeCursorToolResult", () => {
  it("null/undefined returns empty string", () => {
    expect(normalizeCursorToolResult(null)).toBe("");
    expect(normalizeCursorToolResult(undefined)).toBe("");
  });

  it("string passes through", () => {
    expect(normalizeCursorToolResult("hello")).toBe("hello");
  });

  it("custom tool envelope unwraps content", () => {
    const r = normalizeCursorToolResult({
      status: "success",
      value: { content: [{ text: { text: "result" } }] },
    });
    expect(r).toBe("result");
  });

  it("unknown object falls back to JSON", () => {
    const r = normalizeCursorToolResult({ foo: "bar" });
    expect(r).toContain("foo");
    expect(r).toContain("bar");
  });
});
