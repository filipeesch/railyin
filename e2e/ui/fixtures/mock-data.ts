/**
 * mock-data.ts — Shared factory functions for realistic mock API responses.
 *
 * All tests import from here to get consistent baseline data, then override
 * specific fields as needed for their scenario.
 */

import type {
    Board,
    Task,
    ChatSession,
    ConversationMessage,
    TransitionEventMetadata,
    WorkflowTemplate,
    WorkspaceConfig,
    Project,
} from "@shared/rpc-types";
import type { ApiMock } from "./mock-api";

export const BOARD_ID = 1;
export const WORKSPACE_KEY = "test-workspace";

/**
 * Setup boards.list and workspace.getConfig mocks for a custom workflow template.
 * Eliminates the verbose inline workspace object repeated across G-* and capacity tests.
 */
export function setupBoardWithTemplate(api: ApiMock, template: WorkflowTemplate): void {
    api
        .returns("boards.list", [makeBoard({ template } as any)])
        .returns("workspace.getConfig", makeWorkspace({ workflows: [template] }));
}

export function makeWorkspace(overrides?: Partial<WorkspaceConfig>): WorkspaceConfig {
    return {
        id: 1,
        key: WORKSPACE_KEY,
        name: "Test Workspace",
        workflows: [makeWorkflowTemplate()],
        ai: {
            baseUrl: "http://localhost",
            apiKey: "fake",
            model: "fake/test",
            provider: "fake",
        },
        worktreeBasePath: "/tmp/railyn-test",
        workspacePath: "/home/user/projects",
        enableThinking: false,
        engine: { type: "copilot", model: "copilot/gpt-4.1" },
        ...overrides,
    };
}

export function makeProject(overrides?: Partial<Project>): Project {
    return {
        key: "test-project",
        workspaceKey: WORKSPACE_KEY,
        name: "Test Project",
        projectPath: { absolute: "/home/user/projects/test", relative: "test" },
        gitRootPath: { absolute: "/home/user/projects/test", relative: "test" },
        defaultBranch: "main",
        ...overrides,
    };
}

export function makeWorkflowTemplate(): WorkflowTemplate {
    return {
        id: "default",
        name: "Default",
        columns: [
            { id: "backlog", label: "Backlog" },
            { id: "plan", label: "Plan" },
            { id: "in_progress", label: "In Progress" },
            { id: "in_review", label: "In Review" },
            { id: "done", label: "Done" },
        ],
    } as WorkflowTemplate;
}

export function makeGroupedWorkflowTemplate(): WorkflowTemplate {
    return {
        id: "grouped",
        name: "Grouped",
        columns: [
            { id: "backlog", label: "Backlog" },
            { id: "plan", label: "Plan" },
            { id: "in_progress", label: "In Progress" },
            { id: "in_review", label: "In Review" },
            { id: "done", label: "Done" },
        ],
        groups: [
            { label: "Planning", columns: ["plan", "in_progress"] },
            { label: "End", columns: ["in_review", "done"] },
        ],
    } as WorkflowTemplate;
}

export function makeBoard(overrides?: Partial<Board>): Board & { template: WorkflowTemplate } {
    return {
        id: BOARD_ID,
        workspaceKey: WORKSPACE_KEY,
        name: "Test Board",
        workflowTemplateId: "default",
        projectKeys: [],
        template: makeWorkflowTemplate(),
        ...overrides,
    };
}

let _nextTaskId = 100;

export function makeTask(overrides?: Partial<Task>): Task {
    const id = overrides?.id ?? _nextTaskId++;
    return {
        id,
        boardId: BOARD_ID,
        projectKey: "test-project",
        title: `Task ${id}`,
        description: "",
        workflowState: "backlog",
        executionState: "idle",
        conversationId: id,
        currentExecutionId: null,
        retryCount: 0,
        createdFromTaskId: null,
        createdFromExecutionId: null,
        model: "fake/test",
        enabledMcpTools: null,
        shellAutoApprove: false,
        approvedCommands: [],
        worktreeStatus: null,
        branchName: null,
        worktreePath: null,
        executionCount: 0,
        position: 0,
        ...overrides,
    };
}

let _nextMsgId = 1000;

export function makeUserMessage(
    taskId: number,
    content: string,
    overrides?: Partial<ConversationMessage>,
): ConversationMessage {
    return {
        id: _nextMsgId++,
        taskId,
        conversationId: taskId,
        type: "user",
        role: "user",
        content,
        metadata: null,
        createdAt: new Date().toISOString(),
        ...overrides,
    };
}

export function makeAssistantMessage(
    taskId: number,
    content: string,
    overrides?: Partial<ConversationMessage>,
): ConversationMessage {
    return {
        id: _nextMsgId++,
        taskId,
        conversationId: taskId,
        type: "assistant",
        role: "assistant",
        content,
        metadata: null,
        createdAt: new Date().toISOString(),
        ...overrides,
    };
}

export function makeTransitionMessage(
    taskId: number,
    metadata: TransitionEventMetadata,
    overrides?: Partial<ConversationMessage>,
): ConversationMessage {
    return {
        id: _nextMsgId++,
        taskId,
        conversationId: taskId,
        type: "transition_event",
        role: null,
        content: "",
        metadata,
        createdAt: new Date().toISOString(),
        ...overrides,
    };
}

export function makeMcpStatus(overrides?: {
    name?: string;
    state?: "idle" | "starting" | "running" | "error" | "disabled";
    tools?: { name: string; qualifiedName: string; serverName: string; description?: string; inputSchema: { type: "object" } }[];
    error?: string;
}) {
    const name = overrides?.name ?? "test-server";
    const state = overrides?.state ?? "running";
    const tools = overrides?.tools ?? [
        { name: "toolA", qualifiedName: `mcp__${name}__toolA`, serverName: name, description: "Tool A", inputSchema: { type: "object" as const } },
        { name: "toolB", qualifiedName: `mcp__${name}__toolB`, serverName: name, description: "Tool B", inputSchema: { type: "object" as const } },
    ];
    return { name, state, tools, error: overrides?.error };
}

let _nextSessionId = 200;
let _nextSessionConvId = 500;

export function makeChatSession(overrides?: Partial<ChatSession>): ChatSession {
    const id = overrides?.id ?? _nextSessionId++;
    const conversationId = overrides?.conversationId ?? _nextSessionConvId++;
    const now = new Date().toISOString();
    return {
        id,
        workspaceKey: WORKSPACE_KEY,
        title: `Chat ${id}`,
        status: "idle",
        conversationId,
        enabledMcpTools: null,
        lastActivityAt: now,
        lastReadAt: now,
        archivedAt: null,
        createdAt: now,
        ...overrides,
    };
}

export function makeChatMessage(
    sessionId: number,
    conversationId: number,
    content: string,
    role: "user" | "assistant" = "user",
    overrides?: Partial<ConversationMessage>,
): ConversationMessage {
    return {
        id: _nextMsgId++,
        taskId: null as unknown as number,
        conversationId,
        type: role === "user" ? "user" : "assistant",
        role,
        content,
        metadata: null,
        createdAt: new Date().toISOString(),
        ...overrides,
    };
}
