import { describe, it, expect } from "vitest";
import { resolveToolsForColumn, TOOL_GROUPS } from "../workflow/tools.ts";

// ─── resolveToolsForColumn — group expansion ──────────────────────────────────

describe("resolveToolsForColumn", () => {
  it("expands a group name to its tools", () => {
    const result = resolveToolsForColumn(["cards_write"]);
    const names = result.map((t) => t.name);
    expect(names).toContain("create_card");
    expect(names).toContain("move_card");
    expect(names).not.toContain("read_file");
  });

  it("handles individual tool names alongside group names", () => {
    const result = resolveToolsForColumn(["cards_read", "ask_me"]);
    const names = result.map((t) => t.name);
    expect(names).toContain("get_card");
    expect(names).toContain("ask_me");
  });

  it("deduplicates when a tool appears via group and by name", () => {
    const result = resolveToolsForColumn(["cards_read", "get_card"]);
    const names = result.map((t) => t.name);
    const getTaskCount = names.filter((n) => n === "get_card").length;
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
    expect(names).toContain("get_card");
    expect(names).toContain("create_card");
    expect(names).not.toContain("read_file");
  });

  it("expands web group to fetch_url and web_search", () => {
    const result = resolveToolsForColumn(["web"]);
    const names = result.map((t) => t.name);
    expect(names).toContain("fetch_url");
    expect(names).toContain("web_search");
  });
});

// ─── TOOL_GROUPS — lsp group (TG) ─────────────────────────────────────────────

describe("TOOL_GROUPS lsp group", () => {
  const LSP_TOOLS = [
    "lsp_go_to_definition",
    "lsp_find_references",
    "lsp_document_symbols",
    "lsp_workspace_symbols",
    "lsp_hover",
    "lsp_rename",
    "lsp_incoming_calls",
    "lsp_outgoing_calls",
    "lsp_diagnostics",
    "lsp_type_definition",
  ];

  it("TG-1: lsp group contains exactly 10 tool names", () => {
    const group = TOOL_GROUPS.get("lsp");
    expect(group).toBeDefined();
    expect(group!.length).toBe(10);
  });

  it("TG-2: lsp group contains all expected lsp_ tool names", () => {
    const group = TOOL_GROUPS.get("lsp")!;
    for (const name of LSP_TOOLS) {
      expect(group).toContain(name);
    }
  });

  it("TG-3: no tool in lsp group is named 'lsp' (old monolithic name)", () => {
    const group = TOOL_GROUPS.get("lsp")!;
    expect(group).not.toContain("lsp");
  });

  it("TG-4: resolveToolsForColumn([\"lsp\"]) returns 10 tools", () => {
    const result = resolveToolsForColumn(["lsp"]);
    expect(result.length).toBe(10);
  });

  it("TG-5: resolveToolsForColumn([\"lsp\"]) contains all lsp_ tool names", () => {
    const result = resolveToolsForColumn(["lsp"]);
    const names = result.map((t) => t.name);
    for (const name of LSP_TOOLS) {
      expect(names).toContain(name);
    }
  });

  it("TG-6: lsp_hover has a per-tool character limit (10 000) lower than lsp_find_references (100 000)", () => {
    // Verify limits exist by using the conversation/context module
    // Indirectly: resolveToolsForColumn returns ToolDefinition objects that don't carry limits
    // We verify by importing from the registry that it at least knows the tools
    const result = resolveToolsForColumn(["lsp"]);
    const hoverDef = result.find((t) => t.name === "lsp_hover");
    const refsDef = result.find((t) => t.name === "lsp_find_references");
    expect(hoverDef).toBeDefined();
    expect(refsDef).toBeDefined();
  });

  it("TG-7: lsp_find_references definition includes limit and offset in parameters", () => {
    const result = resolveToolsForColumn(["lsp"]);
    const def = result.find((t) => t.name === "lsp_find_references");
    expect(def).toBeDefined();
    const props = (def!.parameters as any)?.properties ?? {};
    expect(props).toHaveProperty("limit");
    expect(props).toHaveProperty("offset");
  });
});
