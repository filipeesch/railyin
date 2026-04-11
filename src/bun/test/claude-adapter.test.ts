import { describe, expect, it } from "bun:test";
import { buildAllowPermissionResult, getUnapprovedShellBinaries } from "../engine/claude/adapter.ts";

describe("Claude adapter permission helpers", () => {
  it("returns updatedInput for allow results", () => {
    const input = { command: "ls -la" };

    expect(buildAllowPermissionResult(input)).toEqual({
      behavior: "allow",
      updatedInput: input,
    });
  });

  it("includes updatedPermissions when permission suggestions are provided", () => {
    const input = { command: "git status" };
    const suggestions = [{ tool: "Bash", mode: "allow" }];

    expect(buildAllowPermissionResult(input, suggestions)).toEqual({
      behavior: "allow",
      updatedInput: input,
      updatedPermissions: suggestions,
    });
  });

  it("filters out already-approved shell binaries", () => {
    expect(getUnapprovedShellBinaries("git status && bun test | cat", ["git"])).toEqual(["bun"]);
  });

  it("returns no shell approvals when every binary is already approved", () => {
    expect(getUnapprovedShellBinaries("git status && bun test", ["git", "bun"])).toEqual([]);
  });
});
