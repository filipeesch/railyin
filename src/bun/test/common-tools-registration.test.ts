import { describe, expect, it } from "bun:test";
import { COMMON_TOOL_DEFINITIONS, executeCommonTool } from "../engine/common-tools.ts";
import { buildCopilotTools } from "../engine/copilot/tools.ts";
import { buildClaudeToolServer } from "../engine/claude/tools.ts";
import { TodoRepository } from "../db/todos.ts";

import type { CommonToolContext } from "../engine/types.ts";

const baseContext: CommonToolContext = {
    taskId: 1,
    boardId: 1,
    onTransition: () => { },
    onHumanTurn: () => { },
    onCancel: () => { },
    onTaskUpdated: () => { },
    todoRepo: new TodoRepository(),
};

describe("shared common tool registration", () => {
    it("includes interview_me in shared common tool definitions", () => {
        const names = COMMON_TOOL_DEFINITIONS.map((tool) => tool.name);
        expect(names).toContain("interview_me");
        expect(names.filter((name) => name === "interview_me")).toHaveLength(1);
    });

    it("registers interview_me through Copilot mapped common tools", () => {
        const tools = buildCopilotTools(baseContext);
        const names = tools.map((tool) => tool.name);
        expect(names).toContain("interview_me");
        expect(names.filter((name) => name === "interview_me")).toHaveLength(1);
    });

    it("registers interview_me through Claude shared tool server mapping", () => {
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
        expect(registeredNames).toContain("interview_me");
        expect(registeredNames.filter((name) => name === "interview_me")).toHaveLength(1);
    });
});

describe("executeCommonTool / interview_me", () => {
    it("returns a suspend result with the structured payload", async () => {
        const result = await executeCommonTool(
            "interview_me",
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
            "interview_me",
            {},
            baseContext,
        );

        expect(result.type).toBe("result");
        if (result.type === "result") {
            expect(result.text).toContain("Error: field 'questions' is required");
        }
    });
});
