import { describe, expect, it } from "bun:test";
import { buildClaudeToolServer, extractWrittenFilesFromResult } from "../engine/claude/tools.ts";
import { INTERVIEW_ME_TOOL_DEFINITION } from "../engine/interview-tool-definition.ts";
import { executeCommonTool } from "../engine/common-tools.ts";

// ---------------------------------------------------------------------------
// Minimal ZodLike spy — records calls so we can assert schema structure
// ---------------------------------------------------------------------------
type SpyNode =
  | { kind: "string" }
  | { kind: "number" }
  | { kind: "boolean" }
  | { kind: "any" }
  | { kind: "enum"; values: string[] }
  | { kind: "array"; items: SpyNode }
  | { kind: "object"; shape: Record<string, SpyNode> }
  | { kind: "optional"; inner: SpyNode };

function makeSpyZod() {
  const wrap = (node: SpyNode): SpyNode & { optional: () => SpyNode } => ({
    ...node,
    optional: () => wrap({ kind: "optional", inner: node }),
  });

  return {
    string: () => wrap({ kind: "string" }),
    number: () => wrap({ kind: "number" }),
    boolean: () => wrap({ kind: "boolean" }),
    any: () => wrap({ kind: "any" }),
    enum: (values: [string, ...string[]]) => wrap({ kind: "enum", values }),
    array: (items: SpyNode) => wrap({ kind: "array", items }),
    object: (shape: Record<string, SpyNode>) => wrap({ kind: "object", shape }),
  };
}

type SpyZod = ReturnType<typeof makeSpyZod>;

function capturedTools(z: SpyZod): Record<string, { name: string; shape: Record<string, SpyNode> }> {
  const tools: Record<string, { name: string; shape: Record<string, SpyNode> }> = {};
  const sdk = {
    tool: (name: string, _desc: string, shape: Record<string, SpyNode>) => {
      tools[name] = { name, shape };
      return {};
    },
    createSdkMcpServer: () => ({}),
  };
  buildClaudeToolServer(sdk as never, z as never, {} as never);
  return tools;
}

// Recursively strip the .optional() method from nodes (they're SpyNode + optional fn)
function strip(node: unknown): SpyNode {
  const { optional: _o, ...rest } = node as SpyNode & { optional?: unknown };
  if ("shape" in rest && rest.shape) {
    return { ...rest, shape: Object.fromEntries(Object.entries(rest.shape).map(([k, v]) => [k, strip(v)])) } as SpyNode;
  }
  if ("items" in rest && rest.items) {
    return { ...rest, items: strip(rest.items) } as SpyNode;
  }
  if ("inner" in rest && rest.inner) {
    return { ...rest, inner: strip(rest.inner) } as SpyNode;
  }
  return rest as SpyNode;
}

// ---------------------------------------------------------------------------
// Schema shape tests
// ---------------------------------------------------------------------------
describe("buildClaudeToolServer — return contract", () => {
  it("returns { server, takePendingSuspend } — regression guard for adapter.ts destructuring", () => {
    const z = makeSpyZod();
    const sdk = {
      tool: (_name: string, _desc: string, _shape: unknown, _handler: unknown) => ({}),
      createSdkMcpServer: (opts: unknown) => ({ _mcpServer: true, opts }),
    };
    const result = buildClaudeToolServer(sdk as never, z as never, {} as never);
    // adapter.ts does: const { server: toolServer, takePendingSuspend } = buildClaudeToolServer(...)
    // If this destructuring returns undefined, the SDK crashes with '$1.type' at runtime.
    expect(result).toHaveProperty("server");
    expect(result).toHaveProperty("takePendingSuspend");
    expect(typeof (result as { takePendingSuspend: unknown }).takePendingSuspend).toBe("function");
    expect((result as { takePendingSuspend: () => unknown }).takePendingSuspend()).toBeUndefined();
    expect((result as { server: unknown }).server).toBeDefined();
  });
});

describe("buildClaudeToolServer — interview_me schema shape", () => {
  const z = makeSpyZod();
  const tools = capturedTools(z);

  it("registers interview_me tool", () => {
    expect(tools["interview_me"]).toBeDefined();
  });

  it("questions is advertised as array (not any/{})", () => {
    const shape = tools["interview_me"].shape;
    const questions = strip(shape["questions"]);
    expect(questions.kind).toBe("array");
  });

  it("questions items is an object", () => {
    const shape = tools["interview_me"].shape;
    const questions = strip(shape["questions"]) as { kind: "array"; items: SpyNode };
    expect(questions.items.kind).toBe("object");
  });

  it("questions[].type is advertised as enum with correct values", () => {
    const shape = tools["interview_me"].shape;
    const questions = strip(shape["questions"]) as { kind: "array"; items: SpyNode };
    const itemShape = (questions.items as { kind: "object"; shape: Record<string, SpyNode> }).shape;
    const typeField = strip(itemShape["type"]) as { kind: "optional"; inner: SpyNode };
    // type is optional so unwrap one level
    const inner = typeField.kind === "optional" ? typeField.inner : typeField;
    expect(inner.kind).toBe("enum");
    expect((inner as { kind: "enum"; values: string[] }).values).toEqual(["exclusive", "non_exclusive", "freetext"]);
  });

  it("questions[].weight is advertised as optional enum", () => {
    const shape = tools["interview_me"].shape;
    const questions = strip(shape["questions"]) as { kind: "array"; items: SpyNode };
    const itemShape = (questions.items as { kind: "object"; shape: Record<string, SpyNode> }).shape;
    const weightField = strip(itemShape["weight"]) as { kind: "optional"; inner: SpyNode };
    const inner = weightField.kind === "optional" ? weightField.inner : weightField;
    expect(inner.kind).toBe("enum");
    expect((inner as { kind: "enum"; values: string[] }).values).toEqual(["critical", "medium", "easy"]);
  });

  it("INTERVIEW_ME_TOOL_DEFINITION.parameters matches what buildClaudeToolServer advertises (regression guard)", () => {
    // Verify the definition still has the enum inline so no future refactor silently breaks it
    const questionItems = (INTERVIEW_ME_TOOL_DEFINITION.parameters as {
      properties: { questions: { items: { properties: { type: { type: string; enum: string[] } } } } };
    }).properties.questions.items.properties.type;
    expect(questionItems.type).toBe("string");
    expect(questionItems.enum).toEqual(["exclusive", "non_exclusive", "freetext"]);
  });
});

// ---------------------------------------------------------------------------
// executeCommonTool — interview_me input validation
// ---------------------------------------------------------------------------
describe("executeCommonTool — interview_me input validation", () => {
  const ctx = {} as never;

  it("returns error when questions is wrong type (not an array)", async () => {
    const result = await executeCommonTool("interview_me", { questions: "not-an-array" }, ctx);
    expect(result.type).toBe("result");
    expect((result as { type: "result"; text: string }).text).toMatch(/must be array|questions/);
  });

  it("returns error when questions array is empty", async () => {
    const result = await executeCommonTool("interview_me", { questions: [] }, ctx);
    expect(result.type).toBe("result");
    expect((result as { type: "result"; text: string }).text).toMatch(/at least 1/);
  });

  it("returns clear error when question type is invalid (e.g. single_choice)", async () => {
    const questions = [{ question: "Pick one", type: "single_choice" }];
    const result = await executeCommonTool("interview_me", { questions }, ctx);
    expect(result.type).toBe("result");
    const text = (result as { type: "result"; text: string }).text;
    expect(text).toMatch(/single_choice/);
    expect(text).toMatch(/exclusive/);
    expect(text).toMatch(/non_exclusive/);
    expect(text).toMatch(/freetext/);
  });

  it("returns error when question.question field is missing", async () => {
    const questions = [{ type: "exclusive" }];
    const result = await executeCommonTool("interview_me", { questions }, ctx);
    expect(result.type).toBe("result");
    expect((result as { type: "result"; text: string }).text).toMatch(/question/);
  });

  it("suspends with valid exclusive question", async () => {
    const questions = [
      { question: "Pick a DB", type: "exclusive", options: [{ title: "PG", description: "Postgres" }] },
    ];
    const result = await executeCommonTool("interview_me", { questions }, ctx);
    expect(result.type).toBe("suspend");
  });

  it("suspends with valid non_exclusive question", async () => {
    const questions = [
      { question: "Pick strategies", type: "non_exclusive", options: [{ title: "A", description: "opt A" }] },
    ];
    const result = await executeCommonTool("interview_me", { questions }, ctx);
    expect(result.type).toBe("suspend");
  });

  it("suspends with valid freetext question", async () => {
    const questions = [{ question: "Any constraints?", type: "freetext" }];
    const result = await executeCommonTool("interview_me", { questions }, ctx);
    expect(result.type).toBe("suspend");
  });
});

describe("Claude tools writtenFiles extraction", () => {
  it("returns undefined for invalid JSON", () => {
    expect(extractWrittenFilesFromResult("not-json")).toBeUndefined();
  });

  it("returns undefined when writtenFiles is missing or not an array", () => {
    expect(extractWrittenFilesFromResult(JSON.stringify({ ok: true }))).toBeUndefined();
    expect(extractWrittenFilesFromResult(JSON.stringify({ writtenFiles: {} }))).toBeUndefined();
  });

  it("filters invalid entries and keeps only object entries with string path", () => {
    const payload = {
      writtenFiles: [
        null,
        1,
        {},
        { path: 42, operation: "patch_file", added: 0, removed: 0 },
        { path: "src/valid.ts", operation: "patch_file", added: 1, removed: 1 },
      ],
    };

    expect(extractWrittenFilesFromResult(JSON.stringify(payload))).toEqual([
      { path: "src/valid.ts", operation: "patch_file", added: 1, removed: 1 },
    ]);
  });

  it("preserves richer valid entries like rename metadata", () => {
    const payload = {
      writtenFiles: [
        {
          operation: "rename_file",
          path: "src/old.ts",
          to_path: "src/new.ts",
          added: 0,
          removed: 0,
        },
      ],
    };

    expect(extractWrittenFilesFromResult(JSON.stringify(payload))).toEqual(payload.writtenFiles);
  });
});
