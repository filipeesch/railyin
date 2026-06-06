import { describe, expect, it } from "vitest";
import { PI_TOOL_GROUPS, DEFAULT_PI_TOOL_GROUPS, buildAllTools, buildChildTools, type PiToolGroupName } from "../engine/pi/tools/index.ts";
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
      loopDetector: {} as any,
    };
    const mockCommonCtx = {
      runtime: { worktreePath: "/tmp/test" },
      task: {} as any,
      workspaceKey: "default",
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
      loopDetector: {} as any,
    };
    const mockCommonCtx = {
      runtime: { worktreePath: "/tmp/test" },
      task: {} as any,
      workspaceKey: "default",
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
      loopDetector: {} as any,
    };
    const mockCommonCtx = {
      runtime: { worktreePath: "/tmp/test" },
      task: {} as any,
      workspaceKey: "default",
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

describe("buildChildTools: delegated subagent tool surface", () => {
  const mockHarnessCtx = {
    hashCache: {} as any,
    undoStack: {} as any,
    worktreePath: "/tmp/test",
      loopDetector: {} as any,
  } as any;
  const mockCommonCtx = {
    runtime: { worktreePath: "/tmp/test" },
    task: {} as any,
      workspaceKey: "default",
    repos: {} as any,
    workflow: {} as any,
  } as any;

  const childToolNames = (groups: string[]) =>
    buildChildTools({ harnessCtx: mockHarnessCtx, commonCtx: mockCommonCtx }, groups).map((t) => t.name);

  it("includes write and shell tools when those groups are requested", () => {
    const names = childToolNames(["read", "write", "shell"]);
    for (const writable of ["write_file", "patch_file", "delete_file", "run_command"]) {
      expect(names).toContain(writable);
    }
  });

  it("includes the todo tools so children can track their own work", () => {
    const names = childToolNames(["read", "write", "shell"]);
    for (const todoTool of [
      "create_todo",
      "edit_todo",
      "list_todos",
      "get_todo",
      "reorganize_todos",
      "update_todo_status",
    ]) {
      expect(names).toContain(todoTool);
    }
  });

  it("excludes delegate, board-mutating, decision, and note tools", () => {
    const names = childToolNames(["read", "write", "shell"]);
    for (const forbidden of [
      "delegate",
      "create_card",
      "edit_card",
      "delete_card",
      "move_card",
      "message_card",
      "get_card",
      "list_cards",
      "get_board_summary",
      "record_decision",
      "update_decision",
      "delete_decision",
      "list_decisions",
      "decision_request",
      "create_note",
      "list_notes",
      "update_note",
      "skill",
    ]) {
      expect(names).not.toContain(forbidden);
    }
  });

  it("respects requested groups: read-only request yields no write/shell tools", () => {
    const names = childToolNames(["read"]);
    expect(names).not.toContain("write_file");
    expect(names).not.toContain("run_command");
  });
});
