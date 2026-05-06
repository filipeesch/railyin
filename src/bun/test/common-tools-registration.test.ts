import { describe, expect, it, beforeEach } from "vitest";
import { COMMON_TOOL_DEFINITIONS, executeCommonTool } from "../engine/common-tools.ts";
import { buildCopilotTools } from "../engine/copilot/tools.ts";
import { buildClaudeToolServer } from "../engine/claude/tools.ts";
import { TodoRepository } from "../db/todos.ts";
import { DecisionRepository } from "../db/repositories/decision-repository.ts";
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
        repos: {
            todos: new TodoRepository(db),
            decisions: new DecisionRepository(db),
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
                        options: [{ title: "A", description: "Option A" }],
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
