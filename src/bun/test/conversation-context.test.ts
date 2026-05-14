import { describe, expect, it } from "vitest";
import { MICRO_COMPACT_CLEARABLE_TOOLS, TOOL_RESULT_LIMITS } from "../conversation/context.ts";

describe("MICRO_COMPACT_CLEARABLE_TOOLS — stale tool names removed", () => {
  it("does not contain 'search_text'", () => {
    expect(MICRO_COMPACT_CLEARABLE_TOOLS.has("search_text")).toBe(false);
  });

  it("does not contain 'find_files'", () => {
    expect(MICRO_COMPACT_CLEARABLE_TOOLS.has("find_files")).toBe(false);
  });
});

describe("TOOL_RESULT_LIMITS — stale tool names removed", () => {
  it("has no entry for 'search_text'", () => {
    expect(TOOL_RESULT_LIMITS.has("search_text")).toBe(false);
  });

  it("has no entry for 'find_files'", () => {
    expect(TOOL_RESULT_LIMITS.has("find_files")).toBe(false);
  });
});
