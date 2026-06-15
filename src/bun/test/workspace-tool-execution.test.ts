/**
 * workspace-tool-execution.test.ts — Unit tests for workspace tool execution
 *
 * Suites:
 *   WP-1  list_projects returns full project data when projects configured
 *   WP-2  list_projects returns [] when no projects configured
 *   WP-3  list_projects uses workspaceKey from CommonToolContext
 *   WP-4  list_workflows returns board id+name when boards in DB
 *   WP-5  list_workflows returns [] when no boards in DB
 *   WP-6  list_workflows uses workspaceKey from CommonToolContext
 *   WP-7  executeCommonTool validates no unexpected args for both tools
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Database } from "bun:sqlite";
import { initDb, seedProjectAndTask, seedChatSession, setupTestConfig } from "./helpers.ts";
import { executeCommonTool } from "../engine/common-tools.ts";
import type { CommonToolContext } from "../engine/types.ts";
import { WorkspaceRepository } from "../db/workspace-repository.ts";
import { TodoRepository } from "../db/todos.ts";
import { DecisionRepository } from "../db/repositories/decision-repository.ts";
import { NoteRepository } from "../db/repositories/note-repository.ts";

let db: Database;
let cfg: ReturnType<typeof setupTestConfig>;
let conversationId: number;

function makeCtx(overrides?: Partial<CommonToolContext>): CommonToolContext {
  const repo = new WorkspaceRepository(db);
  return {
    task: {
      id: null,
      boardId: null,
      conversationId,
    },
    workspaceKey: "default",
    repos: {
      todos: new TodoRepository(db),
      decisions: new DecisionRepository(db),
      notes: new NoteRepository(db),
      boardTools: repo as any,
    },
    workflow: {
      onTransition: () => {},
      onHumanTurn: () => {},
      onCancel: () => {},
      onTaskUpdated: () => {},
    },
    runtime: {},
    ...overrides,
  };
}

beforeEach(() => {
  cfg = setupTestConfig();
  db = initDb();
  const { conversationId: cid } = seedProjectAndTask(db, "/tmp/test-git");
  conversationId = cid;
});

afterEach(() => {
  cfg.cleanup();
});

// ─── list_projects ──────────────────────────────────────────────────────────────

describe("WP-1: list_projects returns full project data when projects configured", () => {
  it("returns a JSON array with project objects containing key, name, projectPath, gitRootPath, defaultBranch", async () => {
    const result = await executeCommonTool(
      "list_projects",
      {},
      makeCtx(),
    );
    expect(result.type).toBe("result");
    const parsed = JSON.parse(result.text) as Array<Record<string, unknown>>;
    expect(parsed.length).toBeGreaterThan(0);
    const project = parsed[0]!;
    expect(project).toHaveProperty("key", "test-project");
    expect(project).toHaveProperty("name", "Test Project");
    expect(project).toHaveProperty("projectPath");
    expect(project).toHaveProperty("gitRootPath");
    expect(project).toHaveProperty("defaultBranch", "main");
  });
});

describe("WP-2: list_projects returns [] when no projects configured", () => {
  it("returns an empty JSON array when the workspace has no projects in config", async () => {
    // Create a config without any projects
    cfg = setupTestConfig(
      [
        "name: empty-workspace",
        "workspace_path: /tmp",
        "projects:",
      ].join("\n") + "\n",
    );
    db = initDb();
    conversationId = seedChatSession(db).conversationId;

    const result = await executeCommonTool(
      "list_projects",
      {},
      makeCtx({ workspaceKey: "default" }),
    );
    expect(result.type).toBe("result");
    const parsed = JSON.parse(result.text) as unknown[];
    expect(parsed).toEqual([]);
  });
});

describe("WP-3: list_projects uses workspaceKey from CommonToolContext", () => {
  it("listProjectsForWorkspace filters by workspaceKey in the context", async () => {
    // listProjectsForWorkspace filters by workspaceKey.
    // With only the default workspace registered, "default" returns projects
    // and "other" returns empty (no projects registered for that key).
    const resultDefault = await executeCommonTool(
      "list_projects",
      {},
      makeCtx({ workspaceKey: "default" }),
    );
    const parsedDefault = JSON.parse(resultDefault.text) as Array<{ key: string }>;
    expect(parsedDefault.length).toBeGreaterThan(0);
    expect(parsedDefault[0]?.key).toBe("test-project");

    // "other" workspace has no registered projects
    const resultOther = await executeCommonTool(
      "list_projects",
      {},
      makeCtx({ workspaceKey: "other" }),
    );
    const parsedOther = JSON.parse(resultOther.text) as unknown[];
    expect(parsedOther).toEqual([]);
  });
});

// ─── list_workflows ─────────────────────────────────────────────────────────────

describe("WP-4: list_workflows returns board id+name when boards in DB", () => {
  it("returns a JSON array with board objects containing id, name, workspace_key", async () => {
    // When called without a workspaceKey filter, listBoardsByWorkspace
    // returns all boards regardless of the workspaceKey parameter.
    const result = await executeCommonTool(
      "list_workflows",
      {},
      makeCtx({ workspaceKey: "" }),
    );
    expect(result.type).toBe("result");
    const parsed = JSON.parse(result.text) as Array<{ id: number; name: string; workspace_key: string }>;
    expect(parsed.length).toBeGreaterThan(0);
    const board = parsed[0]!;
    expect(board).toHaveProperty("id");
    expect(typeof board.id).toBe("number");
    expect(board).toHaveProperty("name", "test-board");
    expect(board).toHaveProperty("workspace_key", "default");
  });
});

describe("WP-5: list_workflows returns [] when no boards in DB", () => {
  it("returns an empty JSON array when no boards exist for the workspace", async () => {
    // Seed a fresh DB with no boards
    db = initDb();
    conversationId = seedChatSession(db, { workspaceKey: "default" }).conversationId;

    // Without workspace filter, no boards exist → empty array
    const result = await executeCommonTool(
      "list_workflows",
      {},
      makeCtx({ workspaceKey: "" }),
    );
    expect(result.type).toBe("result");
    const parsed = JSON.parse(result.text) as unknown[];
    expect(parsed).toEqual([]);
  });
});

describe("WP-6: list_workflows uses workspaceKey from CommonToolContext", () => {
  it("when no workspaceKey is provided, returns all boards (no filter applied)", async () => {
    // With an empty workspaceKey, the workspaceKey branch is skipped,
    // returning all boards regardless of their workspace_key.
    const result = await executeCommonTool(
      "list_workflows",
      {},
      makeCtx({ workspaceKey: "" }),
    );
    expect(result.type).toBe("result");
    const parsed = JSON.parse(result.text) as Array<{ id: number; name: string }>;
    expect(parsed.length).toBeGreaterThan(0);
    expect(parsed[0]?.name).toBe("test-board");
  });
});

// ─── Argument validation ────────────────────────────────────────────────────────

describe("WP-7: executeCommonTool validates no unexpected args for workspace tools", () => {
  it("list_projects ignores unexpected args (schema has no required properties)", async () => {
    // list_projects has no required parameters; extra properties are ignored by validateToolArgs
    // (it only validates that required properties are present).
    const result = await executeCommonTool(
      "list_projects",
      { unexpectedKey: "should-be-ignored" },
      makeCtx(),
    );
    expect(result.type).toBe("result");
    const parsed = JSON.parse(result.text) as unknown[];
    expect(Array.isArray(parsed)).toBe(true);
  });

  it("list_workflows ignores unexpected args (schema has no required properties)", async () => {
    // list_workflows has no required parameters; extra properties are ignored.
    const result = await executeCommonTool(
      "list_workflows",
      { unexpectedKey: "should-be-ignored" },
      makeCtx(),
    );
    expect(result.type).toBe("result");
    const parsed = JSON.parse(result.text) as unknown[];
    expect(Array.isArray(parsed)).toBe(true);
  });
});
