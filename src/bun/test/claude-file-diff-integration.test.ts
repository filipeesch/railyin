import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { translateClaudeMessage } from "../engine/claude/events.ts";

/**
 * Trim-proof tests: the writtenFiles / FileStateCache file-diff machinery was
 * removed with the EngineEvent trim (07-02). FileChangesRenderer renders diffs
 * from tool ARGS (buildDiffPayloadsFromArgs) — the EngineEvent tool_result no
 * longer carries computed diffs.
 *
 * These tests pin the post-trim contract: write/edit tool_result events carry
 * result + detailedResult, and NEVER a writtenFiles member.
 */
describe("Claude tool_result trim (CFT)", () => {
  let dir: string;
  let toolMetaMap: Map<string, { name: string; arguments?: unknown }>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "railyn-cft-"));
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

  it("CFT-1: write tool_result carries result + detailedResult but no writtenFiles", () => {
    // Simulate a real tool execution on disk (result content only — no diff machinery).
    writeFileSync(join(dir, "target.txt"), "line1\nMODIFIED\nline3\n");

    const message = makeToolResultMessage("call-1", "line1\nMODIFIED\nline3\n", "write");
    const events = translateClaudeMessage(message, {
      toolMetaByCallId: toolMetaMap,
      worktreePath: dir,
    });

    expect(events).toHaveLength(1);
    const toolResult = events[0] as any;
    expect(toolResult.type).toBe("tool_result");
    expect(toolResult.result).toContain("detailedContent");
    expect(toolResult.detailedResult).toBe("line1\nMODIFIED\nline3\n");
    // The trimmed field must never be populated.
    expect(toolResult.writtenFiles).toBeUndefined();
  });

  it("CFT-2: edit tool_result does not compute diffs from disk state", () => {
    const before = "function greet() { return 1; }\n";
    const after = "function greet() { return 2; }\n";
    writeFileSync(join(dir, "target.txt"), before);
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
      worktreePath: dir,
    });

    const toolResult = events[0] as any;
    expect(toolResult.detailedResult).toBe(after);
    expect(toolResult.writtenFiles).toBeUndefined();
    // No diff field is computed against the pre-edit content.
    expect(toolResult).not.toHaveProperty("added");
    expect(toolResult).not.toHaveProperty("removed");
  });
});
