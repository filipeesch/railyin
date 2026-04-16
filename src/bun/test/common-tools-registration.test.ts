import { describe, expect, it } from "bun:test";
import { COMMON_TOOL_DEFINITIONS, executeCommonTool } from "../engine/common-tools.ts";
import { buildCopilotTools } from "../engine/copilot/tools.ts";
import { buildClaudeToolServer } from "../engine/claude/tools.ts";

import type { CommonToolContext } from "../engine/types.ts";

const baseContext: CommonToolContext = {
    taskId: 1,
    boardId: 1,
    onTransition: () => { },
    onHumanTurn: () => { },
    onCancel: () => { },
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
        const z = {
            string: () => ({ optional: () => ({}) }),
            number: () => ({ optional: () => ({}) }),
            boolean: () => ({ optional: () => ({}) }),
            any: () => ({ optional: () => ({}) }),
        };

        buildClaudeToolServer(sdk, z, baseContext);
        expect(registeredNames).toContain("interview_me");
        expect(registeredNames.filter((name) => name === "interview_me")).toHaveLength(1);
    });
});

describe("executeCommonTool / interview_me", () => {
    it("invokes shared interview callback and returns suspension sentinel", async () => {
        const payloads: string[] = [];
        const result = await executeCommonTool(
            "interview_me",
            {
                context: "Need a decision",
                questions: JSON.stringify([
                    {
                        question: "Which option?",
                        type: "exclusive",
                        options: [{ title: "A", description: "Option A" }],
                    },
                ]),
            },
            {
                ...baseContext,
                onInterviewMe: (payload: string) => payloads.push(payload),
            },
        );

        expect(result).toContain("Interview suspended");
        expect(payloads).toHaveLength(1);
        const parsed = JSON.parse(payloads[0]!);
        expect(parsed.context).toBe("Need a decision");
        expect(Array.isArray(parsed.questions)).toBe(true);
    });

    it("returns an explicit error when interview callback is missing", async () => {
        const result = await executeCommonTool(
            "interview_me",
            {
                questions: JSON.stringify([{ question: "Q", type: "freetext" }]),
            },
            baseContext,
        );

        expect(result).toContain("Error: interview_me is not available");
    });
});
