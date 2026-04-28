import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import yaml from "js-yaml";
import { setupTestConfig, initDb } from "./helpers.ts";
import { workspaceHandlers } from "../handlers/workspace.ts";
import { projectHandlers } from "../handlers/projects.ts";
import { getWorkspaceRegistry, loadConfig, resetConfig, patchWorkspaceYaml } from "../config/index.ts";

let cleanupConfig: () => void;

beforeEach(() => {
  cleanupConfig = setupTestConfig().cleanup;
});

afterEach(() => {
  cleanupConfig();
});

describe("workspaceHandlers", () => {
  it("returns workspace-local workflow templates in config", async () => {
    const configDir = process.env.RAILYN_CONFIG_DIR!;
    const workflowsDir = join(configDir, "workflows");
    rmSync(join(configDir, "workflows.yaml"), { force: true });
    mkdirSync(workflowsDir, { recursive: true });
    writeFileSync(
      join(workflowsDir, "open-spec.yaml"),
      [
        "id: openspec",
        "name: Open Spec",
        "columns:",
        "  - id: backlog",
        "    label: Backlog",
      ].join("\n"),
      "utf-8",
    );

    const handlers = workspaceHandlers();
    const result = await handlers["workspace.getConfig"]({});

    expect(result.workflows.map((workflow) => workflow.id)).toContain("openspec");
    expect(result.workflows.find((workflow) => workflow.id === "openspec")?.name).toBe("Open Spec");
  });

  it("allows anthropic and lsp blocks with supported engines", async () => {
    const configDir = process.env.RAILYN_CONFIG_DIR!;
    const workspaceFileName = process.env.RAILYN_DB === ":memory:" ? "workspace.test.yaml" : "workspace.yaml";
    writeFileSync(
      join(configDir, workspaceFileName),
      [
        "name: test",
        "engine:",
        "  type: copilot",
        "  model: copilot/mock-model",
        "anthropic:",
        "  enable_thinking: true",
        "lsp:",
        "  servers:",
        "    - name: typescript-language-server",
        "      command: typescript-language-server",
        "      args: ['--stdio']",
        "      extensions: ['.ts']",
      ].join("\n"),
      "utf-8",
    );
    resetConfig();

    const handlers = workspaceHandlers();
    const result = await handlers["workspace.getConfig"]({});

    expect(result.enableThinking).toBe(true);
    expect(result.key).toBe("default");
  });

  it("creates the default workspace only under the workspaces root", () => {
    cleanupConfig();

    const dataDir = mkdtempSync(join(tmpdir(), "railyn-data-"));
    const workspacesDir = join(dataDir, "workspaces");
    process.env.RAILYN_DATA_DIR = dataDir;
    process.env.RAILYN_DB = ":memory:";
    delete process.env.RAILYN_CONFIG_DIR;

    resetConfig();
    const result = loadConfig();
    const registry = getWorkspaceRegistry();
    const workspaceFile = join(workspacesDir, "default", "workspace.test.yaml");

    expect(result.error).toBeNull();
    expect(registry).toHaveLength(1);
    expect(registry[0]?.configDir).toBe(join(workspacesDir, "default"));
    expect(existsSync(workspaceFile)).toBe(true);
    expect(readFileSync(workspaceFile, "utf-8")).toContain("type: copilot");

    rmSync(dataDir, { recursive: true, force: true });
    delete process.env.RAILYN_DATA_DIR;
    delete process.env.RAILYN_DB;
    resetConfig();
    cleanupConfig = setupTestConfig().cleanup;
  });

  it("workspace.getConfig returns engine type and model", async () => {
    const handlers = workspaceHandlers();
    const result = await handlers["workspace.getConfig"]({});
    expect(result.engine).toBeDefined();
    expect(result.engine.type).toBe("copilot");
    expect(result.engine.model).toBe("copilot/mock-model");
  });

  it("workspace.update patches name and engine in workspace yaml", async () => {
    const configDir = process.env.RAILYN_CONFIG_DIR!;
    const handlers = workspaceHandlers();
    await handlers["workspace.update"]({ name: "Updated Workspace", engineType: "claude" });
    const raw = readFileSync(join(configDir, "workspace.test.yaml"), "utf-8");
    const parsed = yaml.load(raw) as Record<string, unknown>;
    expect(parsed.name).toBe("Updated Workspace");
    expect((parsed.engine as Record<string, unknown>).type).toBe("claude");
  });

  it("workspace.update deep-merges engine block (preserves type when only model is updated)", async () => {
    const configDir = process.env.RAILYN_CONFIG_DIR!;
    const handlers = workspaceHandlers();
    await handlers["workspace.update"]({ engineModel: "copilot/gpt-4.1" });
    const raw = readFileSync(join(configDir, "workspace.test.yaml"), "utf-8");
    const parsed = yaml.load(raw) as Record<string, unknown>;
    expect((parsed.engine as Record<string, unknown>).type).toBe("copilot");
    expect((parsed.engine as Record<string, unknown>).model).toBe("copilot/gpt-4.1");
  });

  it("patchWorkspaceYaml strips git_path and shell_env_timeout_ms", () => {
    const configDir = process.env.RAILYN_CONFIG_DIR!;
    writeFileSync(
      join(configDir, "workspace.test.yaml"),
      ["name: test", "git_path: /usr/bin/git", "shell_env_timeout_ms: 5000", "engine:", "  type: copilot"].join("\n"),
      "utf-8",
    );
    resetConfig();
    patchWorkspaceYaml({ name: "patched" });
    const raw = readFileSync(join(configDir, "workspace.test.yaml"), "utf-8");
    expect(raw).not.toContain("git_path");
    expect(raw).not.toContain("shell_env_timeout_ms");
    expect(raw).toContain("patched");
  });

  it("workspace.resolveGitRoot returns git root for a valid git repo", async () => {
    const handlers = workspaceHandlers();
    // Use the cwd which is always inside a git repo during tests
    const result = await handlers["workspace.resolveGitRoot"]({ path: process.cwd() });
    expect(result.gitRoot).toBeTruthy();
    expect(typeof result.gitRoot).toBe("string");
  });

  it("workspace.resolveGitRoot returns null for a non-git path", async () => {
    const handlers = workspaceHandlers();
    const result = await handlers["workspace.resolveGitRoot"]({ path: tmpdir() });
    expect(result.gitRoot).toBeNull();
  });
});

describe("projectHandlers", () => {
  let cleanupDb: () => void;

  beforeEach(() => {
    initDb();
    cleanupDb = () => { /* db is :memory: — reset via setupTestConfig cleanup */ };
  });

  it("projects.update modifies an existing project in workspace yaml", async () => {
    const configDir = process.env.RAILYN_CONFIG_DIR!;
    const handlers = projectHandlers();
    const updated = await handlers["projects.update"]({
      workspaceKey: "default",
      key: "test-project",
      name: "Updated Project",
      defaultBranch: "develop",
    });
    expect(updated.name).toBe("Updated Project");
    expect(updated.defaultBranch).toBe("develop");
    const raw = readFileSync(join(configDir, "workspace.test.yaml"), "utf-8");
    expect(raw).toContain("Updated Project");
    expect(raw).toContain("develop");
  });

  it("projects.update throws for non-existent project key", async () => {
    const handlers = projectHandlers();
    await expect(
      handlers["projects.update"]({ workspaceKey: "default", key: "does-not-exist", name: "X" }),
    ).rejects.toThrow("Project not found");
  });

  it("projects.delete removes the project from yaml and cascades tasks", async () => {
    const configDir = process.env.RAILYN_CONFIG_DIR!;
    const { getDb } = await import("../db/index.ts");
    const db = getDb();
    // Seed a board and task for the project
    db.run("INSERT INTO boards (workspace_key, name, workflow_template_id) VALUES ('default', 'b', 'delivery')");
    const boardId = (db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!).id;
    db.run("INSERT INTO conversations (task_id) VALUES (0)");
    const convId = (db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!).id;
    db.run("INSERT INTO tasks (board_id, project_key, title, conversation_id) VALUES (?, 'test-project', 'T', ?)", [boardId, convId]);

    const handlers = projectHandlers();
    await handlers["projects.delete"]({ workspaceKey: "default", key: "test-project" });

    const raw = readFileSync(join(configDir, "workspace.test.yaml"), "utf-8");
    expect(raw).not.toContain("test-project");
    const remaining = db.query<{ cnt: number }, []>("SELECT count(*) as cnt FROM tasks WHERE project_key = 'test-project'").get()!;
    expect(remaining.cnt).toBe(0);
  });
});
