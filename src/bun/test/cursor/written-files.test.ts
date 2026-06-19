/**
 * Tests for normalizeBuiltinToolResult (events.ts) and the engine's
 * writtenFiles synthesis via maybeAddWrittenFiles (engine.ts).
 *
 * The Cursor SDK sends built-in tool names in lowercase ("edit", "write"),
 * so we test those forms. Capitalized variants are kept as a fallback and
 * tested here too.
 */
import { describe, expect, it, afterEach } from "vitest";
import { normalizeBuiltinToolResult } from "@bun/engine/cursor/events";
import { createCursorRpcRuntime } from "@bun/test/support/cursor-rpc-runtime.ts";
import type { BackendRpcRuntime } from "@bun/test/support/backend-rpc-runtime.ts";
import { MockCursorSdkAdapter } from "./mocks.ts";

// ─── normalizeBuiltinToolResult ─────────────────────────────────────────────

describe("normalizeBuiltinToolResult — edit (lowercase, as sent by Cursor SDK)", () => {
  it("returns human-readable result with added and removed counts", () => {
    const raw = { status: "success", value: { linesAdded: 3, linesRemoved: 1, diffString: "@@ -1 +1 @@\n-old\n+new" } };
    expect(normalizeBuiltinToolResult("edit", raw)).toEqual({
      result: "3 lines added, 1 line removed",
      detailedResult: "@@ -1 +1 @@\n-old\n+new",
    });
  });

  it("omits detailedResult when no diffString is present", () => {
    const raw = { status: "success", value: { linesAdded: 2, linesRemoved: 0 } };
    const out = normalizeBuiltinToolResult("edit", raw);
    expect(out.result).toBe("2 lines added");
    expect(out.detailedResult).toBeUndefined();
  });

  it("returns 'No changes' when counts are both zero", () => {
    expect(normalizeBuiltinToolResult("edit", { status: "success", value: {} }).result).toBe("No changes");
  });

  it("handles multiedit the same way", () => {
    const raw = { status: "success", value: { linesAdded: 5, linesRemoved: 2 } };
    expect(normalizeBuiltinToolResult("multiedit", raw).result).toBe("5 lines added, 2 lines removed");
  });
});

describe("normalizeBuiltinToolResult — capitalized variants (fallback)", () => {
  it("Edit (capitalized) still works", () => {
    const raw = { status: "success", value: { linesAdded: 1, linesRemoved: 1 } };
    expect(normalizeBuiltinToolResult("Edit", raw).result).toBe("1 line added, 1 line removed");
  });
});

describe("normalizeBuiltinToolResult — write (lowercase)", () => {
  it("returns 'File written (N lines)'", () => {
    const raw = { status: "success", value: { linesCreated: 10 } };
    expect(normalizeBuiltinToolResult("write", raw)).toEqual({ result: "File written (10 lines)" });
  });

  it("handles 1 line with singular form", () => {
    const raw = { status: "success", value: { linesCreated: 1 } };
    expect(normalizeBuiltinToolResult("write", raw).result).toBe("File written (1 line)");
  });

  it("falls back to 0 lines when value is missing", () => {
    expect(normalizeBuiltinToolResult("write", {}).result).toBe("File written (0 lines)");
  });
});

describe("normalizeBuiltinToolResult — unknown tool falls through to text extraction", () => {
  it("returns the text content for custom tools", () => {
    const raw = { status: "success", value: { content: [{ text: { text: "tool output" } }], isError: false } };
    expect(normalizeBuiltinToolResult("create_card", raw).result).toBe("tool output");
  });
});

// ─── writtenFiles synthesis via engine (integration) ────────────────────────

const runtimes: BackendRpcRuntime[] = [];

function createRuntime(adapter: MockCursorSdkAdapter): BackendRpcRuntime {
  const runtime = createCursorRpcRuntime(adapter);
  runtimes.push(runtime);
  return runtime;
}

afterEach(() => {
  while (runtimes.length > 0) runtimes.pop()!.cleanup();
});

describe("CursorEngine — writtenFiles synthesis on edit/write tool results", () => {
  it("attaches writtenFiles to a tool_result for an 'edit' call (lowercase SDK name)", async () => {
    const diff = "@@ -1,2 +1,3 @@\n-old\n+new\n+added";
    const adapter = new MockCursorSdkAdapter().queueTurn({
      steps: [
        { kind: "emit", event: { type: "tool_start", name: "edit", arguments: JSON.stringify({ path: "/src/foo.ts" }), callId: "call-1" } },
        { kind: "emit", event: { type: "tool_result", name: "edit", result: "3 lines added, 1 line removed", callId: "call-1", isError: false, detailedResult: diff } },
      ],
    });
    const runtime = createRuntime(adapter);

    const { taskId } = await runtime.createTask();
    const { executionId } = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "edit file" });
    await runtime.recorder.waitForStreamDone(executionId);

    const events = runtime.recorder.streamEventsForExecution(executionId);
    // writtenFiles is serialized into the content JSON of the tool_result stream event.
    const toolResultEvent = events.find((e) => e.type === "tool_result");
    expect(toolResultEvent).toBeDefined();
    const parsed = JSON.parse(toolResultEvent!.content) as { writtenFiles?: Array<{ operation: string; path: string; rawDiff?: string }> };
    expect(parsed.writtenFiles).toHaveLength(1);
    expect(parsed.writtenFiles![0]!.operation).toBe("edit_file");
    expect(parsed.writtenFiles![0]!.path).toBe("/src/foo.ts");
    expect(parsed.writtenFiles![0]!.rawDiff).toBe(diff);

    // A file_diff stream event must also be emitted.
    expect(events.some((e) => e.type === "file_diff")).toBe(true);
  });

  it("attaches writtenFiles for a 'write' call with line count from result string", async () => {
    const adapter = new MockCursorSdkAdapter().queueTurn({
      steps: [
        { kind: "emit", event: { type: "tool_start", name: "write", arguments: JSON.stringify({ path: "/out/bar.ts" }), callId: "call-2" } },
        { kind: "emit", event: { type: "tool_result", name: "write", result: "File written (5 lines)", callId: "call-2", isError: false } },
      ],
    });
    const runtime = createRuntime(adapter);

    const { taskId } = await runtime.createTask();
    const { executionId } = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "write file" });
    await runtime.recorder.waitForStreamDone(executionId);

    const events = runtime.recorder.streamEventsForExecution(executionId);
    const toolResultEvent = events.find((e) => e.type === "tool_result");
    expect(toolResultEvent).toBeDefined();
    const parsed = JSON.parse(toolResultEvent!.content) as { writtenFiles?: Array<{ operation: string; path: string; added: number }> };
    expect(parsed.writtenFiles).toHaveLength(1);
    expect(parsed.writtenFiles![0]!.operation).toBe("write_file");
    expect(parsed.writtenFiles![0]!.path).toBe("/out/bar.ts");
    expect(parsed.writtenFiles![0]!.added).toBe(5);

    expect(events.some((e) => e.type === "file_diff")).toBe(true);
  });

  it("does NOT attach writtenFiles for non-edit/write tools", async () => {
    const adapter = new MockCursorSdkAdapter().queueTurn({
      steps: [
        { kind: "emit", event: { type: "tool_start", name: "create_card", arguments: JSON.stringify({ title: "x" }), callId: "call-3" } },
        { kind: "emit", event: { type: "tool_result", name: "create_card", result: "ok", callId: "call-3", isError: false } },
      ],
    });
    const runtime = createRuntime(adapter);

    const { taskId } = await runtime.createTask();
    const { executionId } = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "create card" });
    await runtime.recorder.waitForStreamDone(executionId);

    const events = runtime.recorder.streamEventsForExecution(executionId);
    const toolResultEvent = events.find((e) => e.type === "tool_result");
    expect(toolResultEvent).toBeDefined();
    const parsed = JSON.parse(toolResultEvent!.content) as { writtenFiles?: unknown[] };
    expect(parsed.writtenFiles).toBeUndefined();
    expect(events.some((e) => e.type === "file_diff")).toBe(false);
  });
});
