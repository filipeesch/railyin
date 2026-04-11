import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, copyFileSync } from "fs";
import { join } from "path";
import yaml from "js-yaml";
import { getDb } from "./db/index.ts";
import {
  getProjectIdForKey,
  getWorkspaceIdForKey,
  readGlobalConfig,
  resetConfig,
  type WorkspaceProjectYaml,
  type WorkspaceYaml,
} from "./config/index.ts";

type LegacyWorkspaceRow = {
  id: number;
  name: string;
  config_key: string | null;
};

type LegacyProjectRow = {
  id: number;
  workspace_id: number;
  name: string;
  project_path: string;
  git_root_path: string;
  default_branch: string;
  slug: string | null;
  description: string | null;
  created_at: string;
};

export interface WorkspaceStorageMigrationResult {
  migratedWorkspaceCount: number;
  migratedProjectCount: number;
  workspaceIdMap: Record<number, number>;
  projectIdMap: Record<number, number>;
}

function getDataDir(): string {
  return process.env.RAILYN_DATA_DIR ?? join(process.env.HOME ?? "~", ".railyn");
}

function getLegacyConfigDir(): string {
  return process.env.RAILYN_CONFIG_DIR ?? join(getDataDir(), "config");
}

function getWorkspaceRootDir(): string {
  return process.env.RAILYN_WORKSPACES_DIR ?? join(getDataDir(), "workspaces");
}

function getWorkspaceFileName(): string {
  return process.env.RAILYN_DB === ":memory:" ? "workspace.test.yaml" : "workspace.yaml";
}

function sanitizeWorkspaceKey(raw: string | undefined, fallback: string): string {
  const key = (raw ?? fallback).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
  return key || fallback;
}

function sanitizeProjectKey(raw: string | undefined, fallback: string): string {
  const key = (raw ?? fallback).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
  return key || fallback;
}

function readWorkspaceYaml(configDir: string): WorkspaceYaml {
  const filePath = join(configDir, getWorkspaceFileName());
  if (!existsSync(filePath)) return {};
  try {
    const parsed = yaml.load(readFileSync(filePath, "utf-8"));
    return (typeof parsed === "object" && parsed !== null ? parsed : {}) as WorkspaceYaml;
  } catch {
    return {};
  }
}

function writeWorkspaceYaml(configDir: string, workspace: WorkspaceYaml): void {
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, getWorkspaceFileName()), yaml.dump(workspace, { noRefs: true }), "utf-8");
}

function copyWorkflowDir(fromDir: string, toDir: string): void {
  if (!existsSync(fromDir)) return;
  mkdirSync(toDir, { recursive: true });
  for (const entry of readdirSync(fromDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".yaml") && !entry.name.endsWith(".yml")) continue;
    copyFileSync(join(fromDir, entry.name), join(toDir, entry.name));
  }
}

export function migrateLegacyWorkspaceStorage(): WorkspaceStorageMigrationResult {
  const db = getDb();
  const workspaceColumns = db
    .query<Record<string, unknown>, []>("PRAGMA table_info(workspaces)")
    .all()
    .map((column) => String(column.name ?? ""));
  if (!workspaceColumns.includes("config_key")) {
    try {
      db.exec("ALTER TABLE workspaces ADD COLUMN config_key TEXT");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes("duplicate column name: config_key")) {
        throw err;
      }
    }
    db.run("UPDATE workspaces SET config_key = 'default' WHERE id = 1 AND config_key IS NULL");
  }
  const workspaceRows = db
    .query<LegacyWorkspaceRow, []>("SELECT id, name, config_key FROM workspaces ORDER BY id ASC")
    .all();
  const projectRows = db
    .query<LegacyProjectRow, []>(
      `SELECT id, workspace_id, name, project_path, git_root_path, default_branch, slug, description, created_at
       FROM projects ORDER BY workspace_id ASC, created_at ASC, id ASC`,
    )
    .all();

  const globalConfig = readGlobalConfig();
  const configuredDirs = new Map<string, string>();
  for (const entry of globalConfig.workspaces ?? []) {
    const key = sanitizeWorkspaceKey(entry.key, "default");
    if (entry.config_dir?.trim()) configuredDirs.set(key, entry.config_dir.trim());
  }

  const workspaceRootDir = getWorkspaceRootDir();
  const legacyConfigDir = getLegacyConfigDir();
  mkdirSync(workspaceRootDir, { recursive: true });

  const workspaceIdMap = new Map<number, number>();
  const projectIdMap = new Map<number, number>();
  const migratedWorkspaceRows: Array<{ id: number; name: string; config_key: string }> = [];
  const migratedProjectRows: Array<LegacyProjectRow & { id: number; workspace_id: number; slug: string }> = [];

  for (const workspace of workspaceRows) {
    const key = sanitizeWorkspaceKey(
      workspace.config_key ?? undefined,
      workspace.id === 1 ? "default" : workspace.name || `workspace-${workspace.id}`,
    );
    const sourceDir = configuredDirs.get(key) ?? (workspace.id === 1 ? legacyConfigDir : join(workspaceRootDir, key));
    const targetDir = join(workspaceRootDir, key);

    const existing = readWorkspaceYaml(sourceDir);
    const existingProjects = existing.projects ?? [];
    const legacyProjects = projectRows.filter((project) => project.workspace_id === workspace.id);

    const mergedProjects: WorkspaceProjectYaml[] = [...existingProjects];
    for (const project of legacyProjects) {
      const projectKey = sanitizeProjectKey(project.slug ?? undefined, project.name);
      const existingByKey = mergedProjects.find((entry) =>
        sanitizeProjectKey(entry.key ?? entry.slug, entry.name) === projectKey
          || entry.project_path === project.project_path,
      );
      if (!existingByKey) {
        mergedProjects.push({
          key: projectKey,
          name: project.name,
          project_path: project.project_path,
          git_root_path: project.git_root_path,
          default_branch: project.default_branch,
          ...(project.slug ? { slug: project.slug } : {}),
          ...(project.description ? { description: project.description } : {}),
        });
      }
      projectIdMap.set(project.id, getProjectIdForKey(key, projectKey));
      migratedProjectRows.push({
        ...project,
        id: getProjectIdForKey(key, projectKey),
        workspace_id: getWorkspaceIdForKey(key),
        slug: project.slug ?? projectKey,
      });
    }

    writeWorkspaceYaml(targetDir, {
      ...existing,
      name: existing.name ?? workspace.name,
      projects: mergedProjects,
    });
    copyWorkflowDir(join(sourceDir, "workflows"), join(targetDir, "workflows"));

    workspaceIdMap.set(workspace.id, getWorkspaceIdForKey(key));
    migratedWorkspaceRows.push({
      id: getWorkspaceIdForKey(key),
      name: existing.name ?? workspace.name,
      config_key: key,
    });
  }

  db.exec("PRAGMA foreign_keys = OFF;");
  try {
    db.transaction(() => {

    for (const [oldWorkspaceId, newWorkspaceId] of workspaceIdMap.entries()) {
      db.run("UPDATE boards SET workspace_id = ? WHERE workspace_id = ?", [newWorkspaceId, oldWorkspaceId]);
      db.run("UPDATE enabled_models SET workspace_id = ? WHERE workspace_id = ?", [newWorkspaceId, oldWorkspaceId]);
    }

    const boards = db.query<{ id: number; project_ids: string }, []>("SELECT id, project_ids FROM boards").all();
    for (const board of boards) {
      let projectIds: number[] = [];
      try {
        projectIds = JSON.parse(board.project_ids ?? "[]");
      } catch {
        projectIds = [];
      }
      const migratedIds = projectIds.map((projectId) => projectIdMap.get(projectId) ?? projectId);
      db.run("UPDATE boards SET project_ids = ? WHERE id = ?", [JSON.stringify(migratedIds), board.id]);
    }

    for (const [oldProjectId, newProjectId] of projectIdMap.entries()) {
      db.run("UPDATE tasks SET project_id = ? WHERE project_id = ?", [newProjectId, oldProjectId]);
    }

    db.run("DELETE FROM projects");
    db.run("DELETE FROM workspaces");

    for (const workspace of migratedWorkspaceRows) {
      db.run("INSERT INTO workspaces (id, name, config_key) VALUES (?, ?, ?)", [
        workspace.id,
        workspace.name,
        workspace.config_key,
      ]);
    }

    for (const project of migratedProjectRows) {
      db.run(
        `INSERT INTO projects
           (id, workspace_id, name, project_path, git_root_path, default_branch, slug, description, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          project.id,
          project.workspace_id,
          project.name,
          project.project_path,
          project.git_root_path,
          project.default_branch,
          project.slug,
          project.description,
          project.created_at,
        ],
      );
    }

    })();
  } finally {
    db.exec("PRAGMA foreign_keys = ON;");
  }

  const configPath = join(getDataDir(), "config", "config.yaml");
  if (existsSync(configPath)) {
    const trimmed = { ...globalConfig };
    delete trimmed.workspaces;
    writeFileSync(configPath, yaml.dump(trimmed, { noRefs: true }), "utf-8");
  }

  resetConfig();

  return {
    migratedWorkspaceCount: migratedWorkspaceRows.length,
    migratedProjectCount: migratedProjectRows.length,
    workspaceIdMap: Object.fromEntries(workspaceIdMap.entries()),
    projectIdMap: Object.fromEntries(projectIdMap.entries()),
  };
}
