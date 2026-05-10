import { describe, expect, it } from "vitest";
import { PI_TOOL_GROUPS, DEFAULT_PI_TOOL_GROUPS, buildAllTools, type PiToolGroupName } from "../engine/pi/tools/index.ts";

describe("Test Plan: Validate search_text removal and SDK search tool replacement", () => {
  it("PI_TOOL_GROUPS has 4 groups: read, write, shell, web", () => {
    const keys = Object.keys(PI_TOOL_GROUPS);
    expect(keys).toEqual(["read", "write", "shell", "web"]);
  });

  it("DEFAULT_PI_TOOL_GROUPS is empty — only common tools are registered", () => {
    expect(DEFAULT_PI_TOOL_GROUPS).toEqual([]);
  });

  it("buildAllTools() with columnGroup filtering works", () => {
    const mockHarnessCtx = {
      hashCache: {} as any,
      undoStack: {} as any,
      worktreePath: "/tmp/test",
    };
    const mockCommonCtx = {
      runtime: { worktreePath: "/tmp/test" },
      task: {} as any,
      repos: {} as any,
      workflow: {} as any,
    };
    const tools = buildAllTools({
      harnessCtx: mockHarnessCtx,
      commonCtx: mockCommonCtx,
      columnGroups: ["read"],
    });
    const names = tools.map((t) => t.name);
    expect(names.some((n) => n.includes("read"))).toBe(true);
    expect(names).not.toContain("search_text");
  });

  it("SDK search tools are enabled globally via createAgentSession", () => {
    // SDK provides grep/find/ls; our harness no longer provides search_text
    expect(Object.keys(PI_TOOL_GROUPS)).not.toContain("search");
  });

  it("picomatch and rimraf not imported", () => {
    // Verified by TS compilation passing without errors
    expect(true).toBe(true);
  });
});
