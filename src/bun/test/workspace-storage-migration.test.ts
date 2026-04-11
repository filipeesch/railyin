import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { tmpdir } from "os";
import yaml from "js-yaml";
import { mkdtempSync } from "fs";
import { initDb } from "./helpers.ts";
import { _resetForTests as resetDbSingleton } from "../db/index.ts";
import {
  getConfig,
  getProjectIdForKey,
  getWorkspaceIdForKey,
  getWorkspaceRegistry,
  loadConfig,
  resetConfig,
  runWithConfig,
  type WorkspaceYaml,
} from "../config/index.ts";
import { migrateLegacyWorkspaceStorage } from "../workspace-storage-migration.ts";
import { getWorkspaceConfigById } from "../workspace-context.ts";
import { resolveProvider, clearProviderCache } from "../ai/index.ts";

let tempDir: string;

function writeYaml(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, yaml.dump(value, { noRefs: true }), "utf-8");
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "railyn-migration-"));
  process.env.RAILYN_DATA_DIR = tempDir;
  process.env.RAILYN_DB = ":memory:";
  delete process.env.RAILYN_CONFIG_DIR;
  delete process.env.RAILYN_WORKSPACES_DIR;
  resetDbSingleton();
  resetConfig();
  clearProviderCache();
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
  delete process.env.RAILYN_DATA_DIR;
  delete process.env.RAILYN_DB;
  delete process.env.RAILYN_CONFIG_DIR;
  delete process.env.RAILYN_WORKSPACES_DIR;
  resetDbSingleton();
  resetConfig();
  clearProviderCache();
});

describe("workspace storage migration", () => {
  it("migrates legacy workspace/project rows to file-backed workspace folders and rewrites DB references", () => {
    const db = initDb();
    const configDir = join(tempDir, "config");
    const supportSourceDir = join(tempDir, "legacy-support");
    mkdirSync(join(configDir, "workflows"), { recursive: true });
    mkdirSync(join(supportSourceDir, "workflows"), { recursive: true });

    writeYaml(join(configDir, "workspace.test.yaml"), {
      name: "Work Projects",
      providers: [{ id: "fake", type: "fake" }],
    } satisfies WorkspaceYaml);
    writeYaml(join(configDir, "workflows", "delivery.yaml"), {
      id: "delivery",
      name: "Work Delivery",
      columns: [{ id: "backlog", label: "Backlog" }],
    });
    writeYaml(join(supportSourceDir, "workspace.test.yaml"), {
      name: "Personal Projects",
      providers: [{ id: "fake", type: "fake" }],
    } satisfies WorkspaceYaml);
    writeYaml(join(supportSourceDir, "workflows", "delivery.yaml"), {
      id: "delivery",
      name: "Personal Delivery",
      columns: [{ id: "backlog", label: "Backlog" }],
    });
    writeYaml(join(configDir, "config.yaml"), {
      defaults: { git_path: "/usr/bin/git" },
      workspaces: [{ key: "personal", name: "Personal Projects", config_dir: supportSourceDir }],
    });

    db.run("INSERT INTO workspaces (id, name, config_key) VALUES (2, 'Personal Projects', 'personal')");
    db.run(
      `INSERT INTO projects
         (id, workspace_id, name, project_path, git_root_path, default_branch, slug, description)
       VALUES
         (11, 1, 'API', '/tmp/api', '/tmp/api', 'main', 'api', 'Work API'),
         (22, 2, 'Blog', '/tmp/blog', '/tmp/blog', 'main', 'blog', 'Personal blog')`,
    );
    db.run("INSERT INTO boards (id, workspace_id, name, workflow_template_id, project_ids) VALUES (101, 1, 'Work Board', 'delivery', '[11]')");
    db.run("INSERT INTO boards (id, workspace_id, name, workflow_template_id, project_ids) VALUES (202, 2, 'Personal Board', 'delivery', '[22]')");
    db.run("INSERT INTO conversations (id, task_id) VALUES (1, 0)");
    db.run("INSERT INTO conversations (id, task_id) VALUES (2, 0)");
    db.run("INSERT INTO tasks (id, board_id, project_id, title, workflow_state, execution_state, conversation_id) VALUES (1001, 101, 11, 'Work Task', 'backlog', 'idle', 1)");
    db.run("INSERT INTO tasks (id, board_id, project_id, title, workflow_state, execution_state, conversation_id) VALUES (1002, 202, 22, 'Personal Task', 'backlog', 'idle', 2)");
    db.run("UPDATE conversations SET task_id = 1001 WHERE id = 1");
    db.run("UPDATE conversations SET task_id = 1002 WHERE id = 2");
    db.run("INSERT INTO enabled_models (workspace_id, qualified_model_id) VALUES (2, 'fake/test')");

    const result = migrateLegacyWorkspaceStorage();

    const personalWorkspaceId = getWorkspaceIdForKey("personal");
    const workProjectId = getProjectIdForKey("default", "api");
    const personalProjectId = getProjectIdForKey("personal", "blog");

    expect(result.workspaceIdMap[2]).toBe(personalWorkspaceId);
    expect(result.projectIdMap[11]).toBe(workProjectId);
    expect(result.projectIdMap[22]).toBe(personalProjectId);
    expect(existsSync(join(tempDir, "workspaces", "default", "workspace.test.yaml"))).toBe(true);
    expect(existsSync(join(tempDir, "workspaces", "personal", "workspace.test.yaml"))).toBe(true);

    const migratedWorkYaml = yaml.load(readFileSync(join(tempDir, "workspaces", "default", "workspace.test.yaml"), "utf-8")) as WorkspaceYaml;
    const migratedPersonalYaml = yaml.load(readFileSync(join(tempDir, "workspaces", "personal", "workspace.test.yaml"), "utf-8")) as WorkspaceYaml;
    expect(migratedWorkYaml.projects?.map((project) => project.key)).toContain("api");
    expect(migratedPersonalYaml.projects?.map((project) => project.key)).toContain("blog");

    const board = db.query<{ workspace_id: number; project_ids: string }, [number]>("SELECT workspace_id, project_ids FROM boards WHERE id = ?").get(202)!;
    const task = db.query<{ project_id: number }, [number]>("SELECT project_id FROM tasks WHERE id = ?").get(1002)!;
    const modelRow = db.query<{ workspace_id: number }, [string]>("SELECT workspace_id FROM enabled_models WHERE qualified_model_id = ?").get("fake/test")!;
    expect(board.workspace_id).toBe(personalWorkspaceId);
    expect(JSON.parse(board.project_ids)).toEqual([personalProjectId]);
    expect(task.project_id).toBe(personalProjectId);
    expect(modelRow.workspace_id).toBe(personalWorkspaceId);

    const configYaml = yaml.load(readFileSync(join(configDir, "config.yaml"), "utf-8")) as { workspaces?: unknown };
    expect(configYaml.workspaces).toBeUndefined();
  });

  it("is safe to rerun on an already-migrated database", () => {
    const db = initDb();
    const configDir = join(tempDir, "config");
    mkdirSync(configDir, { recursive: true });
    writeYaml(join(configDir, "workspace.test.yaml"), {
      name: "My Workspace",
      providers: [{ id: "fake", type: "fake" }],
      projects: [{ key: "api", name: "API", project_path: "/tmp/api", git_root_path: "/tmp/api", default_branch: "main" }],
    } satisfies WorkspaceYaml);

    db.run(
      `INSERT INTO projects
         (id, workspace_id, name, project_path, git_root_path, default_branch, slug, description)
       VALUES (1, 1, 'API', '/tmp/api', '/tmp/api', 'main', 'api', 'Work API')`,
    );

    migrateLegacyWorkspaceStorage();
    expect(() => migrateLegacyWorkspaceStorage()).not.toThrow();
  });
});

describe("file-backed workspace resolution", () => {
  it("discovers workspace folders and loads workspace-local workflows and engine config", () => {
    const workspaceRoot = join(tempDir, "workspaces");
    mkdirSync(join(workspaceRoot, "work", "workflows"), { recursive: true });
    mkdirSync(join(workspaceRoot, "personal", "workflows"), { recursive: true });

    writeYaml(join(workspaceRoot, "work", "workspace.test.yaml"), {
      name: "Work Projects",
      engine: { type: "native", providers: [{ id: "fake", type: "fake" }] },
      projects: [{ key: "api", name: "API", project_path: "/tmp/api", git_root_path: "/tmp/api", default_branch: "main" }],
    });
    writeYaml(join(workspaceRoot, "work", "workflows", "delivery.yaml"), {
      id: "delivery",
      name: "Work Delivery",
      columns: [{ id: "backlog", label: "Backlog" }],
    });
    writeYaml(join(workspaceRoot, "personal", "workspace.test.yaml"), {
      name: "Personal Projects",
      engine: { type: "copilot", model: "gpt-5.4" },
      projects: [{ key: "blog", name: "Blog", project_path: "/tmp/blog", git_root_path: "/tmp/blog", default_branch: "main" }],
    });
    writeYaml(join(workspaceRoot, "personal", "workflows", "delivery.yaml"), {
      id: "delivery",
      name: "Personal Delivery",
      columns: [{ id: "backlog", label: "Inbox" }],
    });

    const registry = getWorkspaceRegistry();
    const work = registry.find((entry) => entry.key === "work");
    const personal = registry.find((entry) => entry.key === "personal");
    expect(work).toBeDefined();
    expect(personal).toBeDefined();

    const workConfig = loadConfig("work").config ?? getConfig("work");
    const personalConfig = loadConfig("personal").config ?? getConfig("personal");

    expect(workConfig.workflows.find((workflow) => workflow.id === "delivery")?.name).toBe("Work Delivery");
    expect(personalConfig.workflows.find((workflow) => workflow.id === "delivery")?.name).toBe("Personal Delivery");
    expect(workConfig.engine.type).toBe("native");
    expect(getWorkspaceConfigById(personal!.id).engine.type).toBe("copilot");
  });

  it("keeps provider cache scoped per workspace so concurrent lookups do not share config", async () => {
    const workspaceRoot = join(tempDir, "workspaces");
    mkdirSync(join(workspaceRoot, "work"), { recursive: true });
    mkdirSync(join(workspaceRoot, "personal"), { recursive: true });

    writeYaml(join(workspaceRoot, "work", "workspace.test.yaml"), {
      name: "Work Projects",
      providers: [{ id: "fake", type: "fake" }],
    });
    writeYaml(join(workspaceRoot, "personal", "workspace.test.yaml"), {
      name: "Personal Projects",
      providers: [{ id: "fake", type: "fake" }],
    });

    const workConfig = loadConfig("work").config ?? getConfig("work");
    const personalConfig = loadConfig("personal").config ?? getConfig("personal");

    const [workProvider, personalProvider] = await Promise.all([
      runWithConfig(workConfig, async () => resolveProvider("fake/fake", workConfig.providers).provider),
      runWithConfig(personalConfig, async () => resolveProvider("fake/fake", personalConfig.providers).provider),
    ]);

    expect(workProvider).not.toBe(personalProvider);
  });
});
