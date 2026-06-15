import { describe, expect, it, beforeEach } from "vitest";
import { COMMON_TOOL_DEFINITIONS, COMMON_TOOL_NAMES, executeCommonTool } from "../engine/common-tools.ts";
import { buildCopilotTools } from "../engine/copilot/tools.ts";
import { buildClaudeToolServer } from "../engine/claude/tools.ts";
import { TodoRepository } from "../db/todos.ts";
import { DecisionRepository } from "../db/repositories/decision-repository.ts";
import { NoteRepository } from "../db/repositories/note-repository.ts";
import { WorkspaceRepository } from "../db/workspace-repository.ts";
import { BoardToolExecutor } from "../workflow/tools/board-tool-executor.ts";
import { initDb } from "./helpers.ts";

import type { CommonToolContext } from "../engine/types.ts";

let baseContext: CommonToolContext;

beforeEach(() => {
    const db = initDb();
    const wsRepo = new WorkspaceRepository(db);
    baseContext = {
        task: { id: 1, boardId: 1, conversationId: 1 },
        workspaceKey: "default",
        repos: {
            todos: new TodoRepository(db),
            decisions: new DecisionRepository(db),
            notes: new NoteRepository(db),
            boardTools: new BoardToolExecutor(db, wsRepo),
        },
        workflow: {
            onTransition: () => { },
            onHumanTurn: () => { },
            onCancel: () => { },
            onTaskUpdated: () => { },
        },
        runtime: {},
    };
});

describe("shared common tool registration", () => {
    it("includes decision_request in shared common tool definitions", () => {
        const names = COMMON_TOOL_DEFINITIONS.map((tool) => tool.name);
        expect(names).toContain("decision_request");
        expect(names.filter((name) => name === "decision_request")).toHaveLength(1);
    });

    it("registers decision_request through Copilot mapped common tools", () => {
        const tools = buildCopilotTools(baseContext);
        const names = tools.map((tool) => tool.name);
        expect(names).toContain("decision_request");
        expect(names.filter((name) => name === "decision_request")).toHaveLength(1);
    });

    it("registers decision_request through Claude shared tool server mapping", () => {
        const registeredNames: string[] = [];
        const sdk = {
            tool: (
                name: string,
                _description: string,
                _inputSchema: Record<string, unknown>,
                _handler: (args: Record<string, unknown>, extra: unknown) => Promise<Record<string, unknown>>,
            ) => {
                registeredNames.push(name);
                return { name };
            },
            createSdkMcpServer: (options: { name: string; version?: string; tools?: unknown[] }) => options,
        };
        const scalar = () => ({ optional: () => ({}) });
        const z = {
            string: scalar,
            number: scalar,
            boolean: scalar,
            any: scalar,
            array: (_item: unknown) => ({ optional: () => ({}) }),
            object: (_shape: Record<string, unknown>) => ({ optional: () => ({}) }),
            enum: (_values: [string, ...string[]]) => ({ optional: () => ({}) }),
        };

        buildClaudeToolServer(sdk, z, baseContext);
        expect(registeredNames).toContain("decision_request");
        expect(registeredNames.filter((name) => name === "decision_request")).toHaveLength(1);
    });
});

describe("executeCommonTool / decision_request", () => {
    it("returns a suspend result with the structured payload", async () => {
        const result = await executeCommonTool(
            "decision_request",
            {
                context: "Need a decision",
                questions: [
                    {
                        question: "Which option?",
                        type: "exclusive",
                        options: [{ title: "A", description: "Option A" }, { title: "B", description: "Option B" }],
                    },
                ],
            },
            baseContext,
        );

        expect(result.type).toBe("suspend");
        if (result.type === "suspend") {
            const parsed = JSON.parse(result.payload);
            expect(parsed.context).toBe("Need a decision");
            expect(Array.isArray(parsed.questions)).toBe(true);
        }
    });

    it("returns a result error when questions is missing", async () => {
        const result = await executeCommonTool(
            "decision_request",
            {},
            baseContext,
        );

        expect(result.type).toBe("result");
        if (result.type === "result") {
            expect(result.text).toContain("Error: field 'questions' is required");
        }
    });
});

describe("record_decision tool description enforcement", () => {
    it("CTR-D-1: record_decision description contains ALWAYS/NEVER enforcement language", () => {
        const tool = COMMON_TOOL_DEFINITIONS.find(t => t.name === "record_decision");
        expect(tool).toBeDefined();
        expect(tool!.description).toContain("ALWAYS");
        expect(tool!.description).toContain("NEVER");
    });

    it("CTR-D-2: record_decision description mentions list_decisions before calling record_decision", () => {
        const tool = COMMON_TOOL_DEFINITIONS.find(t => t.name === "record_decision");
        expect(tool!.description).toContain("list_decisions()");
    });

    it("CTR-D-3: record_decision description mentions update_decision to avoid duplicates", () => {
        const tool = COMMON_TOOL_DEFINITIONS.find(t => t.name === "record_decision");
        expect(tool!.description).toContain("update_decision");
    });
});

// ─── LSP tool registration (CR) ───────────────────────────────────────────────

const LSP_SPLIT_TOOLS = [
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

describe("LSP tool registration in common tools", () => {
  it("CR-1: COMMON_TOOL_DEFINITIONS does not contain a tool named 'lsp'", () => {
    const names = COMMON_TOOL_DEFINITIONS.map((t) => t.name);
    expect(names).not.toContain("lsp");
  });

  it("CR-2: COMMON_TOOL_DEFINITIONS contains exactly 10 lsp_ split tools", () => {
    const names = COMMON_TOOL_DEFINITIONS.map((t) => t.name);
    const lspTools = names.filter((n) => n.startsWith("lsp_"));
    expect(lspTools.length).toBe(10);
  });

  it("CR-3: Copilot engine registers all 10 lsp_ tools", () => {
    const tools = buildCopilotTools(baseContext);
    const names = tools.map((t) => t.name);
    for (const name of LSP_SPLIT_TOOLS) {
      expect(names).toContain(name);
    }
  });

  it("CR-4: Claude engine registers all 10 lsp_ tools", () => {
    const registeredNames: string[] = [];
    const sdk = {
      tool: (name: string, _desc: string, _schema: unknown, _handler: unknown) => {
        registeredNames.push(name);
        return { name };
      },
      createSdkMcpServer: (options: unknown) => options,
    };
    const scalar = () => ({ optional: () => ({}) });
    const z = {
      string: scalar,
      number: scalar,
      boolean: scalar,
      any: scalar,
      array: (_item: unknown) => ({ optional: () => ({}) }),
      object: (_shape: unknown) => ({ optional: () => ({}) }),
      enum: (_values: [string, ...string[]]) => ({ optional: () => ({}) }),
    };

    buildClaudeToolServer(sdk as any, z as any, baseContext);
    for (const name of LSP_SPLIT_TOOLS) {
      expect(registeredNames).toContain(name);
    }
  });
});

describe("note tools", () => {
  it("CTR-N1: create_note is present in COMMON_TOOL_DEFINITIONS with required content parameter", () => {
    const def = COMMON_TOOL_DEFINITIONS.find((t) => t.name === "create_note");
    expect(def).toBeDefined();
    expect(def!.parameters.properties).toHaveProperty("content");
    expect((def!.parameters.properties as Record<string, { type: string }>)["content"].type).toBe("string");
    expect(def!.parameters.required).toContain("content");
  });

  it("CTR-N2: list_notes is present in COMMON_TOOL_DEFINITIONS with no required parameters", () => {
    const def = COMMON_TOOL_DEFINITIONS.find((t) => t.name === "list_notes");
    expect(def).toBeDefined();
    expect(def!.parameters.required ?? []).toHaveLength(0);
  });

  it("CTR-N3: update_note is present in COMMON_TOOL_DEFINITIONS with id (number) and content (string) required", () => {
    const def = COMMON_TOOL_DEFINITIONS.find((t) => t.name === "update_note");
    expect(def).toBeDefined();
    const props = def!.parameters.properties as Record<string, { type: string }>;
    expect(props["id"].type).toBe("number");
    expect(props["content"].type).toBe("string");
    expect(def!.parameters.required).toContain("id");
    expect(def!.parameters.required).toContain("content");
  });

  it("CTR-N4: all three note tool names are in COMMON_TOOL_NAMES", () => {
    expect(COMMON_TOOL_NAMES.has("create_note")).toBe(true);
    expect(COMMON_TOOL_NAMES.has("list_notes")).toBe(true);
    expect(COMMON_TOOL_NAMES.has("update_note")).toBe(true);
  });
});
describe("workspace tool registration", () => {
  it("CTR-WK-1: list_projects is present in COMMON_TOOL_DEFINITIONS with no required params", () => {
    const def = COMMON_TOOL_DEFINITIONS.find((t) => t.name === "list_projects");
    expect(def).toBeDefined();
    expect(def!.parameters.required ?? []).toHaveLength(0);
    expect(def!.parameters.properties).toEqual({});
  });

  it("CTR-WK-2: list_workflows is present in COMMON_TOOL_DEFINITIONS with no required params", () => {
    const def = COMMON_TOOL_DEFINITIONS.find((t) => t.name === "list_workflows");
    expect(def).toBeDefined();
    expect(def!.parameters.required ?? []).toHaveLength(0);
    expect(def!.parameters.properties).toEqual({});
  });

  it("CTR-WK-3: both workspace tool names are in COMMON_TOOL_NAMES", () => {
    expect(COMMON_TOOL_NAMES.has("list_projects")).toBe(true);
    expect(COMMON_TOOL_NAMES.has("list_workflows")).toBe(true);
  });

  it("CTR-WK-4: Copilot engine registers list_projects via buildCopilotTools()", () => {
    const tools = buildCopilotTools(baseContext);
    const names = tools.map((t) => t.name);
    expect(names).toContain("list_projects");
  });

  it("CTR-WK-5: Copilot engine registers list_workflows via buildCopilotTools()", () => {
    const tools = buildCopilotTools(baseContext);
    const names = tools.map((t) => t.name);
    expect(names).toContain("list_workflows");
  });

  it("CTR-WK-6: Claude engine registers list_projects via buildClaudeToolServer()", () => {
    const registeredNames: string[] = [];
    const sdk = {
      tool: (name: string, _desc: string, _schema: unknown, _handler: unknown) => {
        registeredNames.push(name);
        return { name };
      },
      createSdkMcpServer: (options: unknown) => options,
    };
    const scalar = () => ({ optional: () => ({}) });
    const z = {
      string: scalar,
      number: scalar,
      boolean: scalar,
      any: scalar,
      array: (_item: unknown) => ({ optional: () => ({}) }),
      object: (_shape: unknown) => ({ optional: () => ({}) }),
      enum: (_values: [string, ...string[]]) => ({ optional: () => ({}) }),
    };

    buildClaudeToolServer(sdk as any, z as any, baseContext);
    expect(registeredNames).toContain("list_projects");
  });

  it("CTR-WK-7: Claude engine registers list_workflows via buildClaudeToolServer()", () => {
    const registeredNames: string[] = [];
    const sdk = {
      tool: (name: string, _desc: string, _schema: unknown, _handler: unknown) => {
        registeredNames.push(name);
        return { name };
      },
      createSdkMcpServer: (options: unknown) => options,
    };
    const scalar = () => ({ optional: () => ({}) });
    const z = {
      string: scalar,
      number: scalar,
      boolean: scalar,
      any: scalar,
      array: (_item: unknown) => ({ optional: () => ({}) }),
      object: (_shape: unknown) => ({ optional: () => ({}) }),
      enum: (_values: [string, ...string[]]) => ({ optional: () => ({}) }),
    };

    buildClaudeToolServer(sdk as any, z as any, baseContext);
    expect(registeredNames).toContain("list_workflows");
  });
});
