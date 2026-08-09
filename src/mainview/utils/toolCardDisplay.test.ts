import { describe, it, expect } from "vitest";
import type { FileDiffPayload } from "@shared/rpc-types";
import {
  truncateToolOutput,
  computeDiffStats,
  toolStatusToIcon,
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

describe("CANONICAL_TOOL_SLOTS / slotForToolCall", () => {
  it("TCD-13: canonical families mirror the tool-display list", () => {
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
