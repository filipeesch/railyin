import { describe, it, expect } from "bun:test";
import { WORKSPACE_TOOL_DEFINITIONS, WORKSPACE_TOOL_NAMES } from "@bun/engine/workspace-tool-definitions.ts";

describe("workspace tool definitions", () => {
  describe("list_projects", () => {
    it("exists in WORKSPACE_TOOL_DEFINITIONS with no required params", () => {
      const tool = WORKSPACE_TOOL_DEFINITIONS.find((d) => d.name === "list_projects");
      expect(tool).toBeDefined();
      expect(tool?.parameters.required).toEqual([]);
      expect(tool?.parameters.properties).toEqual({});
    });
  });

  describe("list_workflows", () => {
    it("exists in WORKSPACE_TOOL_DEFINITIONS with no required params", () => {
      const tool = WORKSPACE_TOOL_DEFINITIONS.find((d) => d.name === "list_workflows");
      expect(tool).toBeDefined();
      expect(tool?.parameters.required).toEqual([]);
      expect(tool?.parameters.properties).toEqual({});
    });
  });

  describe("WORKSPACE_TOOL_NAMES", () => {
    it("contains list_projects", () => {
      expect(WORKSPACE_TOOL_NAMES.has("list_projects")).toBe(true);
    });

    it("contains list_workflows", () => {
      expect(WORKSPACE_TOOL_NAMES.has("list_workflows")).toBe(true);
    });
  });

  describe("tool descriptions", () => {
    it("list_projects description mentions workspace context guidance", () => {
      const tool = WORKSPACE_TOOL_DEFINITIONS.find((d) => d.name === "list_projects");
      expect(tool?.description).toContain("workspace");
      expect(tool?.description).toContain("context");
    });

    it("list_workflows description mentions workspace context guidance", () => {
      const tool = WORKSPACE_TOOL_DEFINITIONS.find((d) => d.name === "list_workflows");
      expect(tool?.description).toContain("workspace");
      expect(tool?.description).toContain("context");
    });
  });
});
