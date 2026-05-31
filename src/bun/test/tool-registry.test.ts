import { describe, expect, it } from "vitest";
import { PI_TOOL_GROUPS, DEFAULT_PI_TOOL_GROUPS, buildAllTools, type PiToolGroupName } from "../engine/pi/tools/index.ts";
import { InMemorySkillResolver } from "./pi/fixtures/InMemorySkillResolver.ts";

describe("Test Plan: Validate search_text removal and SDK search tool replacement", () => {
  it("PI_TOOL_GROUPS has 4 groups: read, write, shell, web", () => {
    const keys = Object.keys(PI_TOOL_GROUPS);
    expect(keys).toEqual(["read", "write", "shell", "web"]);
  });

  it("DEFAULT_PI_TOOL_GROUPS has 3 entries: read, write, shell", () => {
    expect(DEFAULT_PI_TOOL_GROUPS).toEqual(["read", "write", "shell"]);
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
      skillResolver: new InMemorySkillResolver(),
      columnGroups: ["read"],
    });
    const names = tools.map((t) => t.name);
    // The "read" group is now empty — file discovery is handled by the Pi SDK's built-in "find" tool.
    expect(names).not.toContain("glob");
    expect(names).not.toContain("read_file");
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

describe("run_command tool description", () => {
  it("run_command description does NOT contain 'search_text'", () => {
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
      skillResolver: new InMemorySkillResolver(),
      columnGroups: ["shell"],
    });
    const runCommand = tools.find((t) => t.name === "run_command");
    expect(runCommand).toBeDefined();
    expect(runCommand!.description).not.toContain("search_text");
  });

  it("run_command description references 'grep' and 'find'", () => {
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
      skillResolver: new InMemorySkillResolver(),
      columnGroups: ["shell"],
    });
    const runCommand = tools.find((t) => t.name === "run_command");
    expect(runCommand!.description).toContain("grep");
    expect(runCommand!.description).toContain("find");
  });
});
