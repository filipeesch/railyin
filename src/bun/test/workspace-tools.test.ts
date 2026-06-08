import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WORKSPACE_TOOL_DEFINITIONS, WORKSPACE_TOOL_NAMES, buildWorkspaceToolDisplay } from "../engine/workspace-tool-definitions.ts";
import { executeCommonTool } from "../engine/common-tools.ts";
import { ConfigProjectRepository } from "../db/project-repository.ts";
import { TodoRepository } from "../db/todos.ts";
import { DecisionRepository } from "../db/repositories/decision-repository.ts";
import { NoteRepository } from "../db/repositories/note-repository.ts";
import { WorkspaceRepository } from "../db/workspace-repository.ts";
import { BoardToolExecutor } from "../workflow/tools/board-tool-executor.ts";
import { initDb, setupTestConfig } from "./helpers.ts";
import type { CommonToolContext } from "../engine/types.ts";

// ─── Module export tests (LPT-M) ──────────────────────────────────────────────

describe("workspace tool module exports", () => {
  it("LPT-M1: WORKSPACE_TOOL_DEFINITIONS exports exist (array, set, function)", () => {
    expect(Array.isArray(WORKSPACE_TOOL_DEFINITIONS)).toBe(true);
    expect(WORKSPACE_TOOL_NAMES instanceof Set).toBe(true);
    expect(typeof buildWorkspaceToolDisplay).toBe("function");
  });

  it("LPT-M2: WORKSPACE_TOOL_DEFINITIONS contains list_projects", () => {
    const names = WORKSPACE_TOOL_DEFINITIONS.map((t) => t.name);
    expect(names).toContain("list_projects");
  });

  it("LPT-M3: WORKSPACE_TOOL_NAMES contains list_projects", () => {
    expect(WORKSPACE_TOOL_NAMES.has("list_projects")).toBe(true);
  });

  it("LPT-M4: buildWorkspaceToolDisplay returns correct label", () => {
    const display = buildWorkspaceToolDisplay("list_projects", {});
    expect(display).toEqual({ label: "list projects" });
  });
});

// ─── Integration tests with real config (LPT-I) ───────────────────────────────

describe("list_projects integration", () => {
  let ctx: CommonToolContext;
  let cleanup: () => void;

  afterEach(() => {
    cleanup();
  });

  function makeIntegrationCtx() {
    const db = initDb();
    const wsRepo = new WorkspaceRepository(db);
    return {
      task: { id: 1, boardId: 1, conversationId: 1 },
      workspaceKey: "default",
      repos: {
        todos: new TodoRepository(db),
        decisions: new DecisionRepository(db),
        notes: new NoteRepository(db),
        projects: new ConfigProjectRepository(),
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

  it("LPT-I1: executeCommonTool with real config returns test-project", async () => {
    const { cleanup: c } = setupTestConfig();
    cleanup = c;
    ctx = makeIntegrationCtx();

    const result = await executeCommonTool("list_projects", {}, ctx);
    expect(result.type).toBe("result");
    if (result.type === "result") {
      const parsed = JSON.parse(result.text);
      expect(parsed.data).toHaveLength(1);
      expect(parsed.data[0].key).toBe("test-project");
    }
  });

  it("LPT-I2: Multiple projects via extraYaml are all returned", async () => {
    const extraYaml = `
  - key: second-project
    name: Second Project
    project_path: second-project
    git_root_path: second-project
    default_branch: main`;
    const { cleanup: c } = setupTestConfig(extraYaml);
    cleanup = c;
    ctx = makeIntegrationCtx();

    const result = await executeCommonTool("list_projects", {}, ctx);
    expect(result.type).toBe("result");
    if (result.type === "result") {
      const parsed = JSON.parse(result.text);
      expect(parsed.data).toHaveLength(2);
      const keys = parsed.data.map((p: any) => p.key);
      expect(keys).toContain("test-project");
      expect(keys).toContain("second-project");
    }
  });

  it("LPT-I3: Project with slug and description includes optional fields", async () => {
    const extraYaml = `
  - key: rich-project
    name: Rich Project
    project_path: rich-project
    git_root_path: rich-project
    default_branch: main
    slug: my-rich-project
    description: A project with optional fields`;
    const { cleanup: c } = setupTestConfig(extraYaml);
    cleanup = c;
    ctx = makeIntegrationCtx();

    const result = await executeCommonTool("list_projects", {}, ctx);
    expect(result.type).toBe("result");
    if (result.type === "result") {
      const parsed = JSON.parse(result.text);
      const rich = parsed.data.find((p: any) => p.key === "rich-project");
      expect(rich).toBeDefined();
      expect(rich.slug).toBe("my-rich-project");
      expect(rich.description).toBe("A project with optional fields");
    }
  });

  it("LPT-I4: Project without optional fields omits slug/description", async () => {
    const { cleanup: c } = setupTestConfig();
    cleanup = c;
    ctx = makeIntegrationCtx();

    const result = await executeCommonTool("list_projects", {}, ctx);
    expect(result.type).toBe("result");
    if (result.type === "result") {
      const parsed = JSON.parse(result.text);
      const p = parsed.data[0];
      expect(p.slug).toBeUndefined();
      expect(p.description).toBeUndefined();
    }
  });
});
