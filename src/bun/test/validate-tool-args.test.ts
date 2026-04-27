import { describe, expect, it } from "bun:test";
import { validateToolArgs } from "../engine/validate-tool-args.ts";
import type { AIToolDefinition } from "../ai/types.ts";
import { COMMON_TOOL_DEFINITIONS } from "../engine/common-tools.ts";
import { INTERVIEW_ME_TOOL_DEFINITION } from "../engine/interview-tool-definition.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function def(name: string, parameters: AIToolDefinition["parameters"]): AIToolDefinition {
  return { name, description: "", parameters };
}

const simpleDef = def("simple_tool", {
  type: "object",
  properties: {
    name: { type: "string", description: "A name" },
    count: { type: "number", description: "A count" },
    mode: { type: "string", enum: ["fast", "slow"], description: "Mode" },
    tags: { type: "array", minItems: 1, items: { type: "string" }, description: "Tags" },
  },
  required: ["name", "count"],
});

// ---------------------------------------------------------------------------
// V-1: valid args pass (returns null)
// ---------------------------------------------------------------------------

describe("validateToolArgs — V-1: valid args return null", () => {
  it("returns null for fully valid args", () => {
    expect(validateToolArgs(simpleDef, { name: "hello", count: 3 })).toBeNull();
  });

  it("returns null when optional fields are absent", () => {
    expect(validateToolArgs(simpleDef, { name: "x", count: 0 })).toBeNull();
  });

  it("returns null when optional enum field has a valid value", () => {
    expect(validateToolArgs(simpleDef, { name: "x", count: 1, mode: "fast" })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// V-2: missing required field → descriptive error
// ---------------------------------------------------------------------------

describe("validateToolArgs — V-2: missing required field", () => {
  it("names the missing required field", () => {
    const err = validateToolArgs(simpleDef, { count: 1 });
    expect(err).not.toBeNull();
    expect(err).toContain("'name' is required");
  });

  it("reports all missing required fields when allErrors is true", () => {
    const err = validateToolArgs(simpleDef, {});
    expect(err).not.toBeNull();
    // Both 'name' and 'count' are required
    expect(err).toContain("'name' is required");
    expect(err).toContain("'count' is required");
  });
});

// ---------------------------------------------------------------------------
// V-3: invalid enum value → names the bad value, lists valid options
// ---------------------------------------------------------------------------

describe("validateToolArgs — V-3: invalid enum value", () => {
  it("includes the bad value and all valid options", () => {
    const err = validateToolArgs(simpleDef, { name: "x", count: 1, mode: "turbo" });
    expect(err).not.toBeNull();
    expect(err).toContain("turbo");
    expect(err).toContain('"fast"');
    expect(err).toContain('"slow"');
  });
});

// ---------------------------------------------------------------------------
// V-4: wrong type → descriptive error
// ---------------------------------------------------------------------------

describe("validateToolArgs — V-4: wrong type", () => {
  it("reports expected type and actual type", () => {
    const err = validateToolArgs(simpleDef, { name: "x", count: "not-a-number" });
    expect(err).not.toBeNull();
    expect(err).toContain("must be number");
    expect(err).toContain("got string");
  });
});

// ---------------------------------------------------------------------------
// V-5: array with minItems: 1 → error when empty
// ---------------------------------------------------------------------------

describe("validateToolArgs — V-5: minItems violation", () => {
  it("reports minimum item count requirement", () => {
    const err = validateToolArgs(simpleDef, { name: "x", count: 1, tags: [] });
    expect(err).not.toBeNull();
    expect(err).toContain("at least 1 item(s)");
    expect(err).toContain("tags");
  });
});

// ---------------------------------------------------------------------------
// V-6: interview_me — valid args pass
// ---------------------------------------------------------------------------

describe("validateToolArgs — V-6: interview_me valid", () => {
  it("returns null for valid interview_me args", () => {
    const args = {
      questions: [
        {
          question: "Which DB?",
          type: "exclusive",
          options: [{ title: "PG", description: "Postgres" }],
        },
      ],
    };
    expect(validateToolArgs(INTERVIEW_ME_TOOL_DEFINITION, args)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// V-7: interview_me — missing questions
// ---------------------------------------------------------------------------

describe("validateToolArgs — V-7: interview_me missing questions", () => {
  it("returns required error for missing questions", () => {
    const err = validateToolArgs(INTERVIEW_ME_TOOL_DEFINITION, {});
    expect(err).not.toBeNull();
    expect(err).toContain("'questions' is required");
  });
});

// ---------------------------------------------------------------------------
// V-8: interview_me — empty questions array
// ---------------------------------------------------------------------------

describe("validateToolArgs — V-8: interview_me empty array", () => {
  it("returns minItems error for empty questions array", () => {
    const err = validateToolArgs(INTERVIEW_ME_TOOL_DEFINITION, { questions: [] });
    expect(err).not.toBeNull();
    expect(err).toContain("at least 1 item(s)");
  });
});

// ---------------------------------------------------------------------------
// V-9: interview_me — invalid question.type enum
// ---------------------------------------------------------------------------

describe("validateToolArgs — V-9: interview_me invalid type enum", () => {
  it("names the bad type value and lists valid options", () => {
    const err = validateToolArgs(INTERVIEW_ME_TOOL_DEFINITION, {
      questions: [{ question: "Pick one", type: "single_choice" }],
    });
    expect(err).not.toBeNull();
    expect(err).toContain("single_choice");
    expect(err).toContain("exclusive");
    expect(err).toContain("non_exclusive");
    expect(err).toContain("freetext");
  });
});

// ---------------------------------------------------------------------------
// V-10: update_todo_status — invalid status enum
// ---------------------------------------------------------------------------

describe("validateToolArgs — V-10: update_todo_status invalid status", () => {
  const updateDef = COMMON_TOOL_DEFINITIONS.find((d) => d.name === "update_todo_status")!;

  it("returns enum error for invalid status value", () => {
    const err = validateToolArgs(updateDef, { id: 1, status: "completed" });
    expect(err).not.toBeNull();
    expect(err).toContain("completed");
    expect(err).toContain("done");
    expect(err).toContain("pending");
  });

  it("returns null for valid status values", () => {
    expect(validateToolArgs(updateDef, { id: 1, status: "done" })).toBeNull();
    expect(validateToolArgs(updateDef, { id: 1, status: "in-progress" })).toBeNull();
    expect(validateToolArgs(updateDef, { id: 1, status: "blocked" })).toBeNull();
    expect(validateToolArgs(updateDef, { id: 1, status: "deleted" })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// V-11: create_todo — missing title
// ---------------------------------------------------------------------------

describe("validateToolArgs — V-11: create_todo missing title", () => {
  const createTodoDef = COMMON_TOOL_DEFINITIONS.find((d) => d.name === "create_todo")!;

  it("returns required error when title is missing", () => {
    const err = validateToolArgs(createTodoDef, { number: 10, description: "Do it" });
    expect(err).not.toBeNull();
    expect(err).toContain("'title' is required");
  });
});

// ---------------------------------------------------------------------------
// V-12: multiple errors all reported (allErrors: true)
// ---------------------------------------------------------------------------

describe("validateToolArgs — V-12: multiple errors reported", () => {
  it("reports all errors separated by '; '", () => {
    // Missing both required fields + wrong type for optional
    const err = validateToolArgs(simpleDef, {});
    expect(err).not.toBeNull();
    // Both required fields missing
    expect(err).toContain("'name' is required");
    expect(err).toContain("'count' is required");
    // Errors joined by '; '
    expect(err).toMatch(/Error:.+; Error:/);
  });
});

// ---------------------------------------------------------------------------
// V-13: unknown tool / no def → no crash
// ---------------------------------------------------------------------------

describe("validateToolArgs — V-13: graceful handling", () => {
  it("handles a def with empty required array without crashing", () => {
    const emptyDef = def("empty_tool", { type: "object", properties: {}, required: [] });
    expect(validateToolArgs(emptyDef, {})).toBeNull();
    expect(validateToolArgs(emptyDef, { anything: "ok" })).toBeNull();
  });

  it("handles additionalProperties: false gracefully", () => {
    const strictDef = def("strict_tool", {
      type: "object",
      properties: { x: { type: "string" } },
      required: ["x"],
      additionalProperties: false,
    });
    const err = validateToolArgs(strictDef, { x: "ok", extra: "oops" });
    expect(err).not.toBeNull();
    expect(err).toContain("Error");
  });
});
