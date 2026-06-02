import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DefaultFileStateCache } from "../engine/claude/file-state-cache.ts";
import { translateClaudeMessage } from "../engine/claude/events.ts";

/**
 * FS integration tests: validates the full capture → disk-write → translateClaudeMessage path.
 *
 * These tests use a real temp directory and the real DefaultFileStateCache.
 * Tool execution is simulated via writeFileSync (no Claude SDK needed).
 */
describe("Claude file diff integration (CFI)", () => {
  let dir: string;
  let cache: DefaultFileStateCache;
  let toolMetaMap: Map<string, { name: string; arguments?: unknown }>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "railyn-cfi-"));
    cache = new DefaultFileStateCache();
    toolMetaMap = new Map();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** Build a synthetic user message containing a tool_result block. */
  function makeToolResultMessage(callId: string, content: string, toolName: string): any {
    toolMetaMap.set(callId, { name: toolName, arguments: { file_path: "target.txt" } });
    return {
      type: "user",
      message: {
        content: [{
          type: "tool_result",
          tool_use_id: callId,
          content: JSON.stringify({ detailedContent: content }),
          is_error: false,
        }],
      },
    };
  }

  it("CFI-1: overwrite existing file → added/removed count only changed lines", () => {
    const original = "line1\nline2\nline3\n";
    const modified = "line1\nMODIFIED\nline3\n";

    // Step 1: capture before-content (simulates tool_use time)
    writeFileSync(join(dir, "target.txt"), original);
    cache.capture("call-1", dir, "target.txt");

    // Step 2: simulate tool execution (writes new content to disk)
    writeFileSync(join(dir, "target.txt"), modified);

    // Step 3: translate the tool_result
    const message = makeToolResultMessage("call-1", modified, "write");
    const events = translateClaudeMessage(message, {
      toolMetaByCallId: toolMetaMap,
      fileStateCache: cache,
      worktreePath: dir,
    });

    expect(events).toHaveLength(1);
    const toolResult = events[0] as any;
    expect(toolResult.type).toBe("tool_result");
    expect(toolResult.writtenFiles).toHaveLength(1);
    expect(toolResult.writtenFiles[0].operation).toBe("write_file");
    expect(toolResult.writtenFiles[0].added).toBe(1);
    expect(toolResult.writtenFiles[0].removed).toBe(1);
    expect(toolResult.writtenFiles[0].hunks).toHaveLength(1);
    expect(toolResult.writtenFiles[0].is_new).toBeUndefined();
  });

  it("CFI-2: new file creation → is_new: true, all lines added, removed: 0", () => {
    const newContent = "brand new\nline two\nline three\n";

    // Step 1: capture before-content for non-existent file
    cache.capture("call-2", dir, "target.txt");

    // Step 2: simulate tool execution (creates the file)
    writeFileSync(join(dir, "target.txt"), newContent);

    // Step 3: translate
    const message = makeToolResultMessage("call-2", newContent, "write");
    const events = translateClaudeMessage(message, {
      toolMetaByCallId: toolMetaMap,
      fileStateCache: cache,
      worktreePath: dir,
    });

    const toolResult = events[0] as any;
    expect(toolResult.writtenFiles[0].is_new).toBe(true);
    expect(toolResult.writtenFiles[0].removed).toBe(0);
    expect(toolResult.writtenFiles[0].added).toBe(3);
  });

  it("CFI-3: two sequential writes to same file → each result diffs only its own change", () => {
    const original = "a\nb\nc\n";
    const afterFirst = "A\nb\nc\n";
    const afterSecond = "A\nB\nc\n";

    // First write
    writeFileSync(join(dir, "target.txt"), original);
    cache.capture("call-a", dir, "target.txt");
    writeFileSync(join(dir, "target.txt"), afterFirst);

    const msgA = makeToolResultMessage("call-a", afterFirst, "write");
    const eventsA = translateClaudeMessage(msgA, {
      toolMetaByCallId: toolMetaMap,
      fileStateCache: cache,
      worktreePath: dir,
    });

    // Second write (diffs against post-first-write state)
    cache.capture("call-b", dir, "target.txt");
    writeFileSync(join(dir, "target.txt"), afterSecond);

    const msgB = makeToolResultMessage("call-b", afterSecond, "write");
    const eventsB = translateClaudeMessage(msgB, {
      toolMetaByCallId: toolMetaMap,
      fileStateCache: cache,
      worktreePath: dir,
    });

    // First diff: a → A (1 added, 1 removed)
    const resultA = eventsA[0] as any;
    expect(resultA.writtenFiles[0].added).toBe(1);
    expect(resultA.writtenFiles[0].removed).toBe(1);

    // Second diff: b → B (1 added, 1 removed) — NOT a → A + b → B
    const resultB = eventsB[0] as any;
    expect(resultB.writtenFiles[0].added).toBe(1);
    expect(resultB.writtenFiles[0].removed).toBe(1);
    // Should NOT include the first change
    expect(resultB.writtenFiles[0].added).not.toBe(2);
    expect(resultB.writtenFiles[0].removed).not.toBe(2);
  });

  it("CFI-4: edit tool → correct hunk diff via cache", () => {
    const before = "function greet(name: string): string {\n  return `Hello, ${name}`;\n}\n";
    const after = "function greet(name: string): string {\n  return `Hi, ${name}`;\n}\n";

    writeFileSync(join(dir, "target.txt"), before);
    cache.capture("call-edit", dir, "target.txt");
    writeFileSync(join(dir, "target.txt"), after);

    toolMetaMap.set("call-edit", { name: "edit", arguments: { file_path: "target.txt" } });
    const message = {
      type: "user",
      message: {
        content: [{
          type: "tool_result",
          tool_use_id: "call-edit",
          content: JSON.stringify({ detailedContent: after }),
          is_error: false,
        }],
      },
    };

    const events = translateClaudeMessage(message, {
      toolMetaByCallId: toolMetaMap,
      fileStateCache: cache,
      worktreePath: dir,
    });

    const toolResult = events[0] as any;
    expect(toolResult.writtenFiles[0].operation).toBe("edit_file");
    expect(toolResult.writtenFiles[0].added).toBe(1);
    expect(toolResult.writtenFiles[0].removed).toBe(1);
  });
});
