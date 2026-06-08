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
            projects: { listByWorkspace: () => [] },
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

// ─── list_projects tool registration (LPT-R) ──────────────────────────────────

describe("list_projects tool registration", () => {
  it("LPT-R1: list_projects in COMMON_TOOL_DEFINITIONS (single entry)", () => {
    const matches = COMMON_TOOL_DEFINITIONS.filter((t) => t.name === "list_projects");
    expect(matches).toHaveLength(1);
    expect(matches[0].parameters.required ?? []).toHaveLength(0);
  });

  it("LPT-R2: list_projects in COMMON_TOOL_NAMES", () => {
    expect(COMMON_TOOL_NAMES.has("list_projects")).toBe(true);
  });

  it("LPT-R3: buildCommonToolDisplay returns correct label", () => {
    const { buildCommonToolDisplay } = require("../engine/common-tools.ts");
    const display = buildCommonToolDisplay("list_projects", {});
    expect(display).toEqual({ label: "list projects" });
  });

  it("LPT-R4: Copilot engine registers list_projects", () => {
    const tools = buildCopilotTools(baseContext);
    const names = tools.map((t) => t.name);
    expect(names).toContain("list_projects");
  });

  it("LPT-R5: Claude engine registers list_projects", () => {
    const registeredNames: string[] = [];
    const sdk = {
      tool: (name: string, _d: string, _s: unknown, _h: unknown) => {
        registeredNames.push(name);
        return { name };
      },
      createSdkMcpServer: (o: unknown) => o,
    };
    const scalar = () => ({ optional: () => ({}) });
    const z = {
      string: scalar, number: scalar, boolean: scalar, any: scalar,
      array: (_i: unknown) => ({ optional: () => ({}) }),
      object: (_s: unknown) => ({ optional: () => ({}) }),
      enum: (_v: [string, ...string[]]) => ({ optional: () => ({}) }),
    };

    buildClaudeToolServer(sdk as any, z as any, baseContext);
    expect(registeredNames).toContain("list_projects");
  });
});

// ─── list_projects execution (LPT-E) ──────────────────────────────────────────

describe("list_projects execution", () => {
  it("LPT-E1: Empty workspace returns no projects message", async () => {
    baseContext.repos.projects.listByWorkspace = () => [];
    const result = await executeCommonTool("list_projects", {}, baseContext);
    expect(result.type).toBe("result");
    if (result.type === "result") {
      expect(result.text).toBe("No projects configured in this workspace.");
    }
  });

  it("LPT-E2: Single project returns JSON with detailedContent and data", async () => {
    const mockProject = {
      key: "my-project", name: "My Project", workspaceKey: "default",
      projectPath: { absolute: "/workspace/my-project", relative: "my-project" },
      gitRootPath: { absolute: "/workspace/my-project", relative: "my-project" },
      defaultBranch: "main",
    };
    baseContext.repos.projects.listByWorkspace = () => [mockProject];
    const result = await executeCommonTool("list_projects", {}, baseContext);
    expect(result.type).toBe("result");
    if (result.type === "result") {
      const parsed = JSON.parse(result.text);
      expect(typeof parsed.detailedContent).toBe("string");
      expect(Array.isArray(parsed.data)).toBe(true);
      expect(parsed.data).toHaveLength(1);
    }
  });

  it("LPT-E3: Multiple projects all appear in data array", async () => {
    const mockProjects = [
      { key: "a", name: "A", workspaceKey: "default", projectPath: { absolute: "/a", relative: "a" }, gitRootPath: { absolute: "/a", relative: "a" }, defaultBranch: "main" },
      { key: "b", name: "B", workspaceKey: "default", projectPath: { absolute: "/b", relative: "b" }, gitRootPath: { absolute: "/b", relative: "b" }, defaultBranch: "main" },
      { key: "c", name: "C", workspaceKey: "default", projectPath: { absolute: "/c", relative: "c" }, gitRootPath: { absolute: "/c", relative: "c" }, defaultBranch: "main" },
    ];
    baseContext.repos.projects.listByWorkspace = () => mockProjects;
    const result = await executeCommonTool("list_projects", {}, baseContext);
    expect(result.type).toBe("result");
    if (result.type === "result") {
      const parsed = JSON.parse(result.text);
      expect(parsed.data).toHaveLength(3);
      expect(parsed.data.map((p: any) => p.key)).toEqual(["a", "b", "c"]);
    }
  });

  it("LPT-E4: detailedContent uses relative paths only (no absolute paths)", async () => {
    const mockProject = {
      key: "my-project", name: "My Project", workspaceKey: "default",
      projectPath: { absolute: "/home/user/workspace/my-project", relative: "my-project" },
      gitRootPath: { absolute: "/home/user/workspace/my-project", relative: "my-project" },
      defaultBranch: "main",
    };
    baseContext.repos.projects.listByWorkspace = () => [mockProject];
    const result = await executeCommonTool("list_projects", {}, baseContext);
    expect(result.type).toBe("result");
    if (result.type === "result") {
      const parsed = JSON.parse(result.text);
      expect(parsed.detailedContent).toContain("my-project");
      expect(parsed.detailedContent).not.toContain("/home/user/workspace");
    }
  });

  it("LPT-E5: data includes all Project fields when set", async () => {
    const mockProject = {
      key: "full-project", name: "Full Project", workspaceKey: "default",
      projectPath: { absolute: "/full", relative: "full" },
      gitRootPath: { absolute: "/full", relative: "full" },
      defaultBranch: "develop", slug: "full-slug", description: "A full project",
    };
    baseContext.repos.projects.listByWorkspace = () => [mockProject];
    const result = await executeCommonTool("list_projects", {}, baseContext);
    expect(result.type).toBe("result");
    if (result.type === "result") {
      const parsed = JSON.parse(result.text);
      const p = parsed.data[0];
      expect(p.key).toBe("full-project");
      expect(p.name).toBe("Full Project");
      expect(p.defaultBranch).toBe("develop");
      expect(p.slug).toBe("full-slug");
      expect(p.description).toBe("A full project");
    }
  });

  it("LPT-E6: data omits optional fields when not set", async () => {
    const mockProject = {
      key: "minimal", name: "Minimal", workspaceKey: "default",
      projectPath: { absolute: "/min", relative: "min" },
      gitRootPath: { absolute: "/min", relative: "min" },
      defaultBranch: "main",
    };
    baseContext.repos.projects.listByWorkspace = () => [mockProject];
    const result = await executeCommonTool("list_projects", {}, baseContext);
    expect(result.type).toBe("result");
    if (result.type === "result") {
      const parsed = JSON.parse(result.text);
      const p = parsed.data[0];
      expect(p.slug).toBeUndefined();
      expect(p.description).toBeUndefined();
    }
  });

  it("LPT-E7: Workspace scoping — mock returns only projects for ctx.workspaceKey", async () => {
    const defaultProjects = [{ key: "def", name: "Default", workspaceKey: "default", projectPath: { absolute: "/def", relative: "def" }, gitRootPath: { absolute: "/def", relative: "def" }, defaultBranch: "main" }];
    const otherProjects = [{ key: "other", name: "Other", workspaceKey: "other", projectPath: { absolute: "/other", relative: "other" }, gitRootPath: { absolute: "/other", relative: "other" }, defaultBranch: "main" }];
    baseContext.repos.projects.listByWorkspace = (wk: string) => wk === "default" ? defaultProjects : otherProjects;
    baseContext.workspaceKey = "default";
    const result = await executeCommonTool("list_projects", {}, baseContext);
    expect(result.type).toBe("result");
    if (result.type === "result") {
      const parsed = JSON.parse(result.text);
      expect(parsed.data).toHaveLength(1);
      expect(parsed.data[0].key).toBe("def");
    }
  });
});

// ─── auto-derived names tests (LPT-AD) ────────────────────────────────────────

describe("auto-derived tool names", () => {
  it("LPT-AD1: COMMON_TOOL_NAMES matches COMMON_TOOL_DEFINITIONS (no extras, no missing)", () => {
    const defNames = COMMON_TOOL_DEFINITIONS.map((t) => t.name);
    for (const name of defNames) {
      expect(COMMON_TOOL_NAMES.has(name)).toBe(true);
    }
    for (const name of COMMON_TOOL_NAMES) {
      expect(defNames).toContain(name);
    }
  });

  it("LPT-AD2: CHILD_COMMON_TOOL_NAMES contains exactly 6 todo tool names", async () => {
    const { CHILD_COMMON_TOOL_NAMES } = await import("../engine/pi/tools/index.ts");
    const todoTools = ["create_todo", "edit_todo", "list_todos", "get_todo", "reorganize_todos", "update_todo_status"];
    expect(CHILD_COMMON_TOOL_NAMES.size).toBe(6);
    for (const name of todoTools) {
      expect(CHILD_COMMON_TOOL_NAMES.has(name)).toBe(true);
    }
  });

  it("LPT-AD3: Todo tools have childAllowed true in COMMON_TOOL_DEFINITIONS", () => {
    const todoNames = ["create_todo", "edit_todo", "list_todos", "get_todo", "reorganize_todos", "update_todo_status"];
    for (const name of todoNames) {
      const def = COMMON_TOOL_DEFINITIONS.find((t) => t.name === name);
      expect(def).toBeDefined();
      expect(def!.childAllowed).toBe(true);
    }
  });

  it("LPT-AD4: Non-todo tools are NOT in CHILD_COMMON_TOOL_NAMES", async () => {
    const { CHILD_COMMON_TOOL_NAMES } = await import("../engine/pi/tools/index.ts");
    const nonTodoTools = ["list_projects", "decision_request", "list_decisions", "create_note", "get_card", "list_cards"];
    for (const name of nonTodoTools) {
      expect(CHILD_COMMON_TOOL_NAMES.has(name)).toBe(false);
    }
  });
});
