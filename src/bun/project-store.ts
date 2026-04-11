import { getDb } from "./db/index.ts";
import {
  getConfig,
  getWorkspaceRegistry,
  loadConfig,
  patchWorkspaceYaml,
  type LoadedConfig,
  type LoadedProject,
  type WorkspaceProjectYaml,
} from "./config/index.ts";
import { getWorkspaceConfigById } from "./workspace-context.ts";
import type { Project } from "../shared/rpc-types.ts";
import type { ProjectRow } from "./db/row-types.ts";

function sanitizeProjectKey(raw: string | undefined, fallback: string): string {
  const key = (raw ?? fallback).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
  return key || fallback;
}

function toProject(project: LoadedProject): Project {
  return {
    id: project.id,
    key: project.key,
    workspaceId: project.workspaceId,
    workspaceKey: project.workspaceKey,
    name: project.name,
    projectPath: project.projectPath,
    gitRootPath: project.gitRootPath,
    defaultBranch: project.defaultBranch,
    ...(project.slug ? { slug: project.slug } : {}),
    ...(project.description ? { description: project.description } : {}),
  };
}

function loadAllWorkspaceConfigs(): LoadedConfig[] {
  return getWorkspaceRegistry().map((entry) => loadConfig(entry.key).config ?? getConfig(entry.key));
}

export function listFileBackedProjects(): Project[] {
  return loadAllWorkspaceConfigs().flatMap((config) => config.projects.map(toProject));
}

function legacyProjectRowToProject(row: ProjectRow): Project {
  return {
    id: row.id,
    key: sanitizeProjectKey(row.slug ?? undefined, row.name),
    workspaceId: row.workspace_id,
    workspaceKey: row.workspace_id === 1 ? "default" : `legacy-${row.workspace_id}`,
    name: row.name,
    projectPath: row.project_path,
    gitRootPath: row.git_root_path,
    defaultBranch: row.default_branch,
    ...(row.slug ? { slug: row.slug } : {}),
    ...(row.description ? { description: row.description } : {}),
  };
}

function getLegacyProjectById(projectId: number): Project | null {
  const db = getDb();
  try {
    const row = db.query<ProjectRow, [number]>("SELECT * FROM projects WHERE id = ?").get(projectId);
    return row ? legacyProjectRowToProject(row) : null;
  } catch {
    return null;
  }
}

export function listProjects(): Project[] {
  const fileBackedProjects = listFileBackedProjects();
  const ids = new Set(fileBackedProjects.map((project) => project.id));
  const db = getDb();
  try {
    const legacyRows = db.query<ProjectRow, []>("SELECT * FROM projects ORDER BY created_at ASC").all();
    for (const row of legacyRows) {
      if (ids.has(row.id)) continue;
      fileBackedProjects.push(legacyProjectRowToProject(row));
    }
  } catch {
    // Legacy table may not exist in newer DBs.
  }
  return fileBackedProjects;
}

export function listProjectsForWorkspace(workspaceId: number): Project[] {
  return listProjects().filter((project) => project.workspaceId === workspaceId);
}

export function getProjectById(projectId: number): Project | null {
  for (const config of loadAllWorkspaceConfigs()) {
    const project = config.projects.find((entry) => entry.id === projectId);
    if (project) return toProject(project);
  }
  return getLegacyProjectById(projectId);
}

export function registerProject(params: {
  workspaceId: number;
  name: string;
  projectPath: string;
  gitRootPath: string;
  defaultBranch: string;
  slug?: string;
  description?: string;
}): Project {
  const workspaceConfig = getWorkspaceConfigById(params.workspaceId);
  const currentProjects = workspaceConfig.workspace.projects ?? [];
  const keyBase = params.slug?.trim() || params.name;
  const key = sanitizeProjectKey(keyBase, params.name);
  if (currentProjects.some((project) => sanitizeProjectKey(project.key ?? project.slug, project.name) === key)) {
    throw new Error(`Project key already exists in workspace: ${key}`);
  }

  const nextProject: WorkspaceProjectYaml = {
    key,
    name: params.name.trim(),
    project_path: params.projectPath,
    git_root_path: params.gitRootPath,
    default_branch: params.defaultBranch,
    ...(params.slug ? { slug: params.slug } : {}),
    ...(params.description ? { description: params.description } : {}),
  };

  patchWorkspaceYaml({
    projects: [...currentProjects, nextProject],
  }, workspaceConfig.workspaceKey);

  const reloaded = loadConfig(workspaceConfig.workspaceKey).config ?? getConfig(workspaceConfig.workspaceKey);
  const project = reloaded.projects.find((entry) => entry.key === key);
  if (!project) throw new Error(`Failed to register project ${key}`);
  return toProject(project);
}
