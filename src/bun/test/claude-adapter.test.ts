import { describe, expect, it } from "vitest";
import { buildAllowPermissionResult, getUnapprovedShellBinaries } from "../engine/claude/adapter.ts";

describe("Claude adapter permission helpers", () => {
  it("CA-1: buildAllowPermissionResult returns PreToolUse hook-compatible allow shape", () => {
    const input = { command: "ls -la" };

    expect(buildAllowPermissionResult(input)).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        updatedInput: input,
      },
    });
  });

  it("CA-2: buildAllowPermissionResult ignores legacy suggestions parameter", () => {
    const input = { command: "git status" };
    const suggestions = [{ tool: "Bash", mode: "allow" }];

    expect(buildAllowPermissionResult(input, suggestions)).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        updatedInput: input,
      },
    });
  });

  it("CA-3: filters out already-approved shell binaries", () => {
    expect(getUnapprovedShellBinaries("git status && bun test | cat", ["git"])).toEqual(["bun", "cat"]);
  });

  it("returns no shell approvals when every binary is already approved", () => {
    expect(getUnapprovedShellBinaries("git status && bun test", ["git", "bun"])).toEqual([]);
  });
});

