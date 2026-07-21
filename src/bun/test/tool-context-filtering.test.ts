import { describe, it, expect, beforeEach } from "vitest";
import { TODO_TOOL_NAMES, COMMON_TOOL_DEFINITIONS, COMMON_TOOL_NAMES } from "../engine/common-tools.ts";
import { buildCopilotTools } from "../engine/copilot/tools.ts";
import { buildClaudeToolServer } from "../engine/claude/tools.ts";
import { buildCursorTools } from "../engine/cursor/tools.ts";
import { buildCommonTools } from "../engine/pi/tools/common.ts";
import { TodoRepository } from "../db/todos.ts";
import { DecisionRepository } from "../db/repositories/decision-repository.ts";
import { NoteRepository } from "../db/repositories/note-repository.ts";
import { WorkspaceRepository } from "../db/workspace-repository.ts";
import { BoardToolExecutor } from "../workflow/tools/board-tool-executor.ts";
import { initDb } from "./helpers.ts";
import type { CommonToolContext } from "../engine/types.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeContext(taskId: number | null, conversationId = 1): CommonToolContext {
  const db = initDb();
  const wsRepo = new WorkspaceRepository(db);
  return {
    task: { id: taskId, boardId: taskId != null ? 1 : null, conversationId },
    workspaceKey: "default",
    repos: {
      todos: new TodoRepository(db),
      decisions: new DecisionRepository(db),
      notes: new NoteRepository(db),
      boardTools: new BoardToolExecutor(db, wsRepo),
    },
    workflow: {
      onTransition: () => {},
      onHumanTurn: () => {},
      onCancel: () => {},
      onTaskUpdated: () => {},
    },
    runtime: {},
  };
}

// ─── TODO_TOOL_NAMES constant ─────────────────────────────────────────────────

describe("TCF-1: TODO_TOOL_NAMES contains all task-scoped tool names", () => {
  it("contains exactly 6 task-scoped tool names", () => {
    expect(TODO_TOOL_NAMES.size).toBe(6);
    expect(TODO_TOOL_NAMES.has("create_todo")).toBe(true);
    expect(TODO_TOOL_NAMES.has("edit_todo")).toBe(true);
    expect(TODO_TOOL_NAMES.has("list_todos")).toBe(true);
    expect(TODO_TOOL_NAMES.has("get_todo")).toBe(true);
    expect(TODO_TOOL_NAMES.has("reorganize_todos")).toBe(true);
    expect(TODO_TOOL_NAMES.has("update_todo_status")).toBe(true);
  });
});

// ─── Pi engine filtering ──────────────────────────────────────────────────────

describe("Pi engine tool filtering", () => {
  it("TCF-2: excludes todo tools for chat sessions (taskId null)", () => {
    const ctx = makeContext(null);
    const tools = buildCommonTools(ctx);
    const names = tools.map((t) => t.name);
    for (const todoName of TODO_TOOL_NAMES) {
      expect(names).not.toContain(todoName);
    }
  });

  it("TCF-3: includes todo tools for task executions (taskId set)", () => {
    const ctx = makeContext(1);
    const tools = buildCommonTools(ctx);
    const names = tools.map((t) => t.name);
    for (const todoName of TODO_TOOL_NAMES) {
      expect(names).toContain(todoName);
    }
  });
});

// ─── Copilot engine filtering ─────────────────────────────────────────────────

describe("Copilot engine tool filtering", () => {
  it("TCF-4: excludes todo tools for chat sessions (taskId null)", () => {
    const ctx = makeContext(null);
    const tools = buildCopilotTools(ctx);
    const names = tools.map((t) => t.name);
    for (const todoName of TODO_TOOL_NAMES) {
      expect(names).not.toContain(todoName);
    }
  });

  it("TCF-5: includes todo tools for task executions (taskId set)", () => {
    const ctx = makeContext(1);
    const tools = buildCopilotTools(ctx);
    const names = tools.map((t) => t.name);
    for (const todoName of TODO_TOOL_NAMES) {
      expect(names).toContain(todoName);
    }
  });
});

// ─── Claude engine filtering ──────────────────────────────────────────────────

describe("Claude engine tool filtering", () => {
  it("TCF-6: excludes todo tools for chat sessions (taskId null)", () => {
    const ctx = makeContext(null);
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

    buildClaudeToolServer(sdk as any, z as any, ctx);
    for (const todoName of TODO_TOOL_NAMES) {
      expect(registeredNames).not.toContain(todoName);
    }
  });
});

// ─── Cursor engine filtering ──────────────────────────────────────────────────

describe("Cursor engine tool filtering", () => {
  it("TCF-7: excludes todo tools for chat sessions (taskId null)", () => {
    const ctx = makeContext(null);
    const tools = buildCursorTools(ctx);
    const names = Object.keys(tools);
    for (const todoName of TODO_TOOL_NAMES) {
      expect(names).not.toContain(todoName);
    }
  });
});

// ─── Other tools remain available ─────────────────────────────────────────────

describe("TCF-9: Other tools remain available in chat sessions", () => {
  it("note tools remain available when taskId is null", () => {
    const ctx = makeContext(null);
    const tools = buildCopilotTools(ctx);
    const names = tools.map((t) => t.name);
    expect(names).toContain("create_note");
    expect(names).toContain("list_notes");
    expect(names).toContain("update_note");
  });

  it("decision tools remain available when taskId is null", () => {
    const ctx = makeContext(null);
    const tools = buildCopilotTools(ctx);
    const names = tools.map((t) => t.name);
    expect(names).toContain("decision_request");
    expect(names).toContain("list_decisions");
    expect(names).toContain("record_decision");
  });

  it("board tools remain available when taskId is null", () => {
    const ctx = makeContext(null);
    const tools = buildCopilotTools(ctx);
    const names = tools.map((t) => t.name);
    expect(names).toContain("list_boards");
    expect(names).toContain("list_cards");
    expect(names).toContain("get_board_summary");
  });

  it("workspace tools remain available when taskId is null", () => {
    const ctx = makeContext(null);
    const tools = buildCopilotTools(ctx);
    const names = tools.map((t) => t.name);
    expect(names).toContain("list_projects");
    expect(names).toContain("list_workflows");
  });
});
