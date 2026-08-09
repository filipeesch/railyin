import { describe, it, expect } from "vitest";
import type { FileDiffPayload } from "@shared/rpc-types";
import {
  truncateToolOutput,
  computeDiffStats,
  toolStatusToIcon,
  isErrorResult,
  buildDiffPayloadsFromArgs,
  CANONICAL_TOOL_SLOTS,
  slotForToolCall,
} from "./toolCardDisplay";

const TRUNCATED_MARKER = "\n…[truncated]";

describe("truncateToolOutput", () => {
  it("TCD-1: leaves text at exactly 800 chars unchanged (no marker)", () => {
    const text = "a".repeat(800);
    expect(truncateToolOutput(text)).toBe(text);
  });

  it("TCD-2: appends the truncated marker past 800 chars", () => {
    const text = "a".repeat(801);
    const result = truncateToolOutput(text);
    expect(result).toBe("a".repeat(800) + TRUNCATED_MARKER);
  });

  it("TCD-3: marker text is present and truncation preserves the head", () => {
    const text = "head-" + "x".repeat(900);
    const result = truncateToolOutput(text);
    expect(result.startsWith("head-")).toBe(true);
    expect(result.endsWith(TRUNCATED_MARKER)).toBe(true);
    expect(result.length).toBe(800 + TRUNCATED_MARKER.length);
  });

  it("TCD-4: honors a custom max", () => {
    const text = "abcdef";
    expect(truncateToolOutput(text, 4)).toBe("abcd" + TRUNCATED_MARKER);
  });
});

describe("computeDiffStats", () => {
  const payload = (added: number, removed: number): FileDiffPayload => ({
    operation: "write_file",
    path: "/tmp/f.ts",
    added,
    removed,
  });

  it("TCD-5: sums added/removed across mixed payloads", () => {
    const stats = computeDiffStats([payload(3, 1), payload(2, 5)]);
    expect(stats).toEqual({ added: 5, removed: 6 });
  });

  it("TCD-6: returns zeroed sums for an empty list", () => {
    expect(computeDiffStats([])).toEqual({ added: 0, removed: 0 });
  });

  it("TCD-7: treats missing added/removed fields as zero", () => {
    const partial: FileDiffPayload = {
      operation: "rename_file",
      path: "/tmp/a.ts",
      to_path: "/tmp/b.ts",
      added: 0,
      removed: 0,
    };
    expect(computeDiffStats([partial])).toEqual({ added: 0, removed: 0 });
  });
});

describe("toolStatusToIcon", () => {
  it("TCD-8: inProgress maps to the spinner icon", () => {
    const { icon, style } = toolStatusToIcon("inProgress");
    expect(icon).toContain("pi-spinner");
    expect(style).toBeUndefined();
  });

  it("TCD-9: executing maps to the spinner icon", () => {
    const { icon } = toolStatusToIcon("executing");
    expect(icon).toContain("pi-spinner");
  });

  it("TCD-10: complete maps to the check icon (green)", () => {
    const { icon, style } = toolStatusToIcon("complete");
    expect(icon).toBe("pi-check-circle");
    expect(style?.color).toBe("#16a34a");
  });

  it("TCD-11: error (result-content detection) maps to times-circle with #dc2626", () => {
    const { icon, style } = toolStatusToIcon("complete", true);
    expect(icon).toBe("pi-times-circle");
    expect(style?.color).toBe("#dc2626");
  });

  it("TCD-12: error takes precedence even when status is complete", () => {
    const { icon } = toolStatusToIcon("complete", true);
    expect(icon).toBe("pi-times-circle");
  });
});

describe("isErrorResult", () => {
  it("TCD-13: undefined/empty result is not an error", () => {
    expect(isErrorResult(undefined)).toBe(false);
    expect(isErrorResult("")).toBe(false);
  });

  it("TCD-14: JSON with isError:true flags an error", () => {
    expect(isErrorResult(JSON.stringify({ isError: true, message: "boom" }))).toBe(true);
  });

  it("TCD-15: JSON with a non-empty error field flags an error", () => {
    expect(isErrorResult(JSON.stringify({ error: "command not found" }))).toBe(true);
    expect(isErrorResult(JSON.stringify({ error: "" }))).toBe(false);
  });

  it("TCD-16: JSON with success:false or error-ish status flags an error", () => {
    expect(isErrorResult(JSON.stringify({ success: false }))).toBe(true);
    expect(isErrorResult(JSON.stringify({ status: "failed" }))).toBe(true);
    expect(isErrorResult(JSON.stringify({ status: "complete" }))).toBe(false);
  });

  it("TCD-17: plain output text is not an error unless it starts with an error marker", () => {
    expect(isErrorResult("everything went fine")).toBe(false);
    expect(isErrorResult("Error: command exited with 1")).toBe(true);
    expect(isErrorResult("exit code 1")).toBe(true);
  });
});

describe("buildDiffPayloadsFromArgs", () => {
  it("TCD-18: write_file args with content derive a write payload with added line count", () => {
    const payloads = buildDiffPayloadsFromArgs({ path: "/tmp/a.ts", content: "l1\nl2\nl3" });
    expect(payloads).toEqual([{ operation: "write_file", path: "/tmp/a.ts", added: 3, removed: 0 }]);
  });

  it("TCD-19: edit args with old/new strings derive added/removed counts", () => {
    const payloads = buildDiffPayloadsFromArgs({
      file_path: "/tmp/a.ts",
      old_string: "a\nb",
      new_string: "a\nb\nc",
    });
    expect(payloads).toEqual([{ operation: "edit_file", path: "/tmp/a.ts", added: 3, removed: 2 }]);
  });

  it("TCD-20: diff-shaped args pass through as payloads", () => {
    const raw = { path: "/tmp/a.ts", operation: "rename_file", to_path: "/tmp/b.ts", added: 0, removed: 0 };
    expect(buildDiffPayloadsFromArgs(raw)).toEqual([raw]);
  });

  it("TCD-21: empty / pathless args yield no payloads", () => {
    expect(buildDiffPayloadsFromArgs(undefined)).toEqual([]);
    expect(buildDiffPayloadsFromArgs({})).toEqual([]);
    expect(buildDiffPayloadsFromArgs("not json or path")).toEqual([]);
  });

  it("TCD-22: string args parse as JSON", () => {
    const payloads = buildDiffPayloadsFromArgs(JSON.stringify({ path: "/tmp/c.ts", content: "x\ny" }));
    expect(payloads).toEqual([{ operation: "write_file", path: "/tmp/c.ts", added: 2, removed: 0 }]);
  });
});

describe("CANONICAL_TOOL_SLOTS / slotForToolCall", () => {
  it("TCD-23: canonical families mirror the tool-display list", () => {
    expect(CANONICAL_TOOL_SLOTS).toEqual({
      bash: "shell",
      run: "shell",
      run_in_terminal: "shell",
      read: "file",
      read_file: "file",
      view: "file",
      write: "file",
      write_file: "file",
      create: "file",
      edit: "file",
      multiedit: "file",
      apply_patch: "file",
      subagent: "delegate",
    });
  });

  it("TCD-14: shell family resolves to shell", () => {
    expect(slotForToolCall("bash")).toBe("shell");
    expect(slotForToolCall("run")).toBe("shell");
    expect(slotForToolCall("run_in_terminal")).toBe("shell");
  });

  it("TCD-15: read/write/edit/patch families resolve to file", () => {
    for (const name of ["read", "read_file", "view", "write", "write_file", "create", "edit", "multiedit", "apply_patch"]) {
      expect(slotForToolCall(name)).toBe("file");
    }
  });

  it("TCD-16: delegate family resolves to delegate", () => {
    expect(slotForToolCall("subagent")).toBe("delegate");
  });

  it("TCD-17: unknown / MCP tools return null (default card)", () => {
    expect(slotForToolCall("webfetch")).toBeNull();
    expect(slotForToolCall("create_card")).toBeNull();
    expect(slotForToolCall("record_decision")).toBeNull();
  });
});

describe("RailyinChat named tool-call slots (05-04, Pitfall 1 guard)", () => {
  // Reads RailyinChat.vue's template and collects the declared
  // `#tool-call-<name>` slot names. The template-literal slot type is
  // `tool-call-${string}` (CopilotChatToolCallsView.vue.d.ts) — a future
  // engine tool name added to CANONICAL_TOOL_SLOTS without a matching slot
  // here silently falls through to the default card; these tests make that a
  // hard failure instead (05-04 acceptance criteria, RESEARCH Pitfall 1).
  function declaredToolCallSlotNames(): Set<string> {
    const fs = require("node:fs");
    const source = fs.readFileSync(new URL("../components/chat/RailyinChat.vue", import.meta.url), "utf8");
    const template = source.match(/<template>([\s\S]*?)<\/template>/);
    expect(template).not.toBeNull();
    const names = new Set<string>();
    for (const match of template![1].matchAll(/#tool-call-([A-Za-z0-9_]+)/g)) {
      names.add(match[1]);
    }
    return names;
  }

  it("TCD-24: RailyinChat declares a #tool-call-<name> slot for EVERY canonical family name", () => {
    const declared = declaredToolCallSlotNames();
    for (const name of Object.keys(CANONICAL_TOOL_SLOTS)) {
      expect(declared.has(name), `RailyinChat is missing the #tool-call-${name} slot`).toBe(true);
    }
  });

  it("TCD-25: RailyinChat declares NO generic #tool-call slot (D-04 anti-pattern)", () => {
    const fs = require("node:fs");
    const source = fs.readFileSync(new URL("../components/chat/RailyinChat.vue", import.meta.url), "utf8");
    const template = source.match(/<template>([\s\S]*?)<\/template>/);
    expect(template).not.toBeNull();
    // A bare `#tool-call` (not followed by `-`) would short-circuit
    // useDefaultRenderTool for every tool — forbidden (RESEARCH Anti-Patterns).
    const bare = [...template![1].matchAll(/#tool-call(?!-)/g)];
    expect(bare).toHaveLength(0);
  });
});
