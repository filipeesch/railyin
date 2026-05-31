import { describe, expect, it } from "bun:test";
import { canonicalToolDisplayLabel, stripRailyinMcpPrefix, humanizeToolName, stripWorktreePath } from "../tool-display.ts";

describe("tool display normalization", () => {
    it("normalizes read aliases", () => {
        expect(canonicalToolDisplayLabel("read")).toBe("read");
        expect(canonicalToolDisplayLabel("read_file")).toBe("read");
        expect(canonicalToolDisplayLabel("view")).toBe("read");
    });

    it("normalizes run aliases", () => {
        expect(canonicalToolDisplayLabel("bash")).toBe("run");
        expect(canonicalToolDisplayLabel("run_in_terminal")).toBe("run");
        expect(canonicalToolDisplayLabel("run")).toBe("run");
    });

    it("normalizes search aliases", () => {
        expect(canonicalToolDisplayLabel("grep")).toBe("search");
        expect(canonicalToolDisplayLabel("rg")).toBe("search");
        expect(canonicalToolDisplayLabel("grep_search")).toBe("search");
    });

    it("normalizes operation aliases", () => {
        expect(canonicalToolDisplayLabel("delete_file")).toBe("delete");
        expect(canonicalToolDisplayLabel("rename_file")).toBe("rename");
        expect(canonicalToolDisplayLabel("task")).toBe("task");
        expect(canonicalToolDisplayLabel("skill")).toBe("skill");
        expect(canonicalToolDisplayLabel("store_memory")).toBe("store memory");
    });
});

describe("stripRailyinMcpPrefix", () => {
    it("strips mcp__railyin__ prefix from railyin tool names", () => {
        expect(stripRailyinMcpPrefix("mcp__railyin__decision_request")).toBe("decision_request");
        expect(stripRailyinMcpPrefix("mcp__railyin__report_intent")).toBe("report_intent");
        expect(stripRailyinMcpPrefix("mcp__railyin__record_decision")).toBe("record_decision");
    });

    it("leaves external MCP server names unchanged", () => {
        expect(stripRailyinMcpPrefix("mcp__other-server__do_thing")).toBe("mcp__other-server__do_thing");
    });

    it("leaves bare tool names unchanged", () => {
        expect(stripRailyinMcpPrefix("bash")).toBe("bash");
        expect(stripRailyinMcpPrefix("decision_request")).toBe("decision_request");
    });

    it("handles empty string safely", () => {
        expect(stripRailyinMcpPrefix("")).toBe("");
    });
});

describe("humanizeToolName", () => {
    it("replaces underscores with spaces in bare tool names", () => {
        expect(humanizeToolName("some_custom_tool")).toBe("some custom tool");
    });

    it("strips mcp__ prefix then humanizes external MCP tool names", () => {
        expect(humanizeToolName("mcp__other-server__do_thing")).toBe("other-server do thing");
    });

    it("strips mcp__ and replaces both separator types", () => {
        expect(humanizeToolName("mcp__my_server__list_items")).toBe("my server list items");
    });

    it("returns bare tool name unchanged when no underscores", () => {
        expect(humanizeToolName("bash")).toBe("bash");
    });

    it("is transport-agnostic: railyin MCP tool produces predictable output", () => {
        expect(humanizeToolName("mcp__railyin__decision_request")).toBe("railyin decision request");
    });
});

describe("stripWorktreePath", () => {
    it("strips the absolute worktree path prefix from a subject", () => {
        expect(stripWorktreePath("/repo/src/foo.ts", "/repo")).toBe("src/foo.ts");
    });

    it("handles trailing slash in worktreePath", () => {
        expect(stripWorktreePath("/repo/src/foo.ts", "/repo/")).toBe("src/foo.ts");
    });

    it("returns subject unchanged when it does not start with worktreePath", () => {
        expect(stripWorktreePath("/other/path/file.ts", "/repo")).toBe("/other/path/file.ts");
    });

    it("returns undefined for undefined subject", () => {
        expect(stripWorktreePath(undefined, "/repo")).toBeUndefined();
    });

    it("returns subject unchanged when worktreePath is absent", () => {
        expect(stripWorktreePath("src/foo.ts", undefined)).toBe("src/foo.ts");
    });
});
