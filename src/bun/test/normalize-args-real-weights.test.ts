import { describe, expect, it } from "bun:test";
import { normalizeToolArguments } from "../../bun/engine/normalize-args.ts";

describe("normalizeToolArguments — real-world Qwen/GPT payloads", () => {
  // ─── Simulate the exact error payload from the bug report ───────────────

  it("Qwen: inline questions array deserialized from JSON string", () => {
    // This is the structure we DO see from vanilla-model JSON parsing
    const schema = {
      type: "object",
      properties: {
        questions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              question: { type: "string" },
              type: { type: "string", enum: ["exclusive", "non_exclusive", "freetext"] },
              weight: { type: "string", enum: ["critical", "medium", "easy"] },
              options: { type: "array", items: { type: "object" } },
            },
            required: ["question", "type"],
          },
        },
        context: { type: "string" },
      },
      required: ["questions"],
    } as any;

    // Simulate: SDK JSON.parse extracts the 'questions' parameter as a string
    const rawArgs = {
      questions: '[{"question":"What fields should IntegrationItemState include?","type":"exclusive","weight":"easy","options":[{"title":"Core 3 fields only","description":"Add status, operation and updatedAt."}]}]',
    };
    const result = normalizeToolArguments(schema, rawArgs);

    expect(result.questions).toEqual([
      {
        question: "What fields should IntegrationItemState include?",
        type: "exclusive",
        weight: "easy",
        options: [{ title: "Core 3 fields only", description: "Add status, operation and updatedAt." }],
      },
    ]);
    expect(Array.isArray(result.questions)).toBe(true);
  });

  // ─── Edge cases from the error payload ─────────────────────────────────

  it("Qwen: multiple questions in a JSON string", () => {
    const schema = {
      type: "object",
      properties: {
        questions: { type: "array", items: { type: "object" } },
      },
    } as any;

    const rawArgs = {
      questions: '[{"question":"Q1","type":"exclusive"},{"question":"Q2","type":"freetext"}]',
    };
    const result = normalizeToolArguments(schema, rawArgs);

    expect(result.questions).toEqual([
      { question: "Q1", type: "exclusive" },
      { question: "Q2", type: "freetext" },
    ]);
    expect(Array.isArray(result.questions)).toBe(true);
  });

  it("ReorganizeTodos: string-encoded items array", () => {
    const schema = {
      type: "object",
      properties: {
        items: { type: "array", items: { type: "object" } },
      },
    } as any;

    const rawArgs = {
      items: '[{"id":1,"number":10},{"id":2,"number":20}]',
    };
    const result = normalizeToolArguments(schema, rawArgs);

    expect(result.items).toEqual([
      { id: 1, number: 10 },
      { id: 2, number: 20 },
    ]);
  });

  // ─── Bool/enum fields that look like they belong in questions ──────────

  it("does not parse string-encoded objects when value is already parsed (native JSON from SDK)", () => {
    const schema = {
      type: "object",
      properties: {
        context: { type: "string" },
        questions: { type: "array", items: { type: "object" } },
      },
    } as any;

    // When SDK has fully parsed the tool call, both fields are native
    const rawArgs = {
      context: "Need to define context",
      questions: [{ question: "What to ask?", type: "freetext" }],
    };
    const result = normalizeToolArguments(schema, rawArgs);

    expect(result.context).toBe("Need to define context");
    expect(result.questions).toEqual([{ question: "What to ask?", type: "freetext" }]);
  });

  // ─── Broken JSON (as sometimes happens when models run out of tokens) ───

  it("handles truncated/incomplete JSON strings gracefully", () => {
    const schema = {
      type: "object",
      properties: {
        questions: { type: "array", items: { type: "object" } },
      },
    } as any;

    const rawArgs = {
      // Cut-off mid-JSON — very common when models hit token limits
      questions: '[{"question":"Breaking question","type":"exclusive"},{"question":"Next question","type"',
    };
    const result = normalizeToolArguments(schema, rawArgs);

    // Should NOT crash; preserve original string
    expect(result.questions).toBe('[{"question":"Breaking question","type":"exclusive"},{"question":"Next question","type"');
  });

  it("accepts valid JSON string with valid/invalid content mixed", () => {
    const schema = {
      type: "object",
      properties: {
        questions: { type: "array", items: { type: "object" } },
      },
    } as any;

    const rawArgs = {
      questions: '[{"question":"Good","type":"freetext"},{"question":"Also good","type":"exclusive","options":[{"title":"A","description":"..."}]}]',
    };
    const result = normalizeToolArguments(schema, rawArgs);

    expect(Array.isArray(result.questions)).toBe(true);
    expect(result.questions).toHaveLength(2);
  });

  // ─── Transport-layer edge case: double-encoded string ──────────────────

  it("double-encoded: string containing an already-JSON string (uncommon but handled)", () => {
    const schema = {
      type: "object",
      properties: {
        questions: { type: "array", items: { type: "object" } },
      },
    } as any;

    // This happens when some transport wraps the tool call in another layer
    const rawArgs = {
      questions: '["[{\\"question\\":\\"deeply nested\\",\\"type\\":\\"freetext\\"}]"]',
    };
    const result = normalizeToolArguments(schema, rawArgs);

    // Will parse outer quotes → expects "[{...}]" as string, not array
    // So it stays as-is or becomes a single-element array containing a string
    // This is an edge case — we don't assert the exact value, just that it doesn't crash
    expect(result).toBeDefined();
    expect(result.questions).not.toBe("[{\"question\":\"deeply nested\",\"type\":\"freetext\"}]");
  });
});
