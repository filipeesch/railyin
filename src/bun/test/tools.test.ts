import { describe, it, expect } from "vitest";
import { resolveToolsForColumn, TOOL_GROUPS } from "../workflow/tools.ts";

// ─── resolveToolsForColumn — group expansion ──────────────────────────────────

describe("resolveToolsForColumn", () => {
  it("expands a group name to its tools", () => {
    const result = resolveToolsForColumn(["tasks_write"]);
    const names = result.map((t) => t.name);
    expect(names).toContain("create_task");
    expect(names).toContain("move_task");
    expect(names).not.toContain("read_file");
  });

  it("handles individual tool names alongside group names", () => {
    const result = resolveToolsForColumn(["tasks_read", "ask_me"]);
    const names = result.map((t) => t.name);
    expect(names).toContain("get_task");
    expect(names).toContain("ask_me");
  });

  it("deduplicates when a tool appears via group and by name", () => {
    const result = resolveToolsForColumn(["tasks_read", "get_task"]);
    const names = result.map((t) => t.name);
    const getTaskCount = names.filter((n) => n === "get_task").length;
    expect(getTaskCount).toBe(1);
  });

  it("expands all known groups without unknown-tool warnings", () => {
    // Every group name should resolve to at least one known tool definition
    for (const [groupName] of TOOL_GROUPS) {
      const result = resolveToolsForColumn([groupName]);
      expect(result.length).toBeGreaterThan(0);
    }
  });

  it("uses defaults when columnTools is undefined", () => {
    const result = resolveToolsForColumn(undefined);
    const names = result.map((t) => t.name);
    expect(names).toContain("get_task");
    expect(names).toContain("create_task");
    expect(names).not.toContain("read_file");
  });

  it("expands web group to fetch_url and search_internet", () => {
    const result = resolveToolsForColumn(["web"]);
    const names = result.map((t) => t.name);
    expect(names).toContain("fetch_url");
    expect(names).toContain("search_internet");
  });
});
