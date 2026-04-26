import {
  getConfig,
  getWorkspaceRegistry,
  loadConfig,
  patchWorkspaceYaml,
  type LoadedConfig,
  type LoadedProject,
  type WorkspaceProjectYaml,
} from "./config/index.ts";
import { getWorkspaceConfig } from "./workspace-context.ts";
import { getDb } from "./db/index.ts";
import type { Project } from "../shared/rpc-types.ts";

function sanitizeProjectKey(raw: string | undefined, fallback: string): string {
  const key = (raw ?? fallback).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
  return key || fallback;
}

function toProject(project: LoadedProject): Project {
  return {
    key: project.key,
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

export function listProjects(): Project[] {
  return listFileBackedProjects();
}

export function listProjectsForWorkspace(workspaceKey: string): Project[] {
  return listProjects().filter((project) => project.workspaceKey === workspaceKey);
}

export function getProjectByKey(workspaceKey: string, projectKey: string): Project | null {
  for (const config of loadAllWorkspaceConfigs()) {
    if (config.workspaceKey !== workspaceKey) continue;
    const project = config.projects.find((entry) => entry.key === projectKey);
    if (project) return toProject(project);
  }
  return null;
}

export function updateProject(params: {
  workspaceKey: string;
  key: string;
  name?: string;
  projectPath?: string;
  gitRootPath?: string;
  defaultBranch?: string;
  slug?: string;
  description?: string;
}): Project {
  const workspaceConfig = getWorkspaceConfig(params.workspaceKey);
  const currentProjects = workspaceConfig.workspace.projects ?? [];
  const idx = currentProjects.findIndex(
    (p) => sanitizeProjectKey(p.key ?? p.slug, p.name) === params.key,
  );
  if (idx < 0) throw new Error(`Project not found: ${params.key}`);
  const existing = currentProjects[idx]!;
  const updated: WorkspaceProjectYaml = {
    ...existing,
    ...(params.name !== undefined ? { name: params.name.trim() } : {}),
    ...(params.projectPath !== undefined ? { project_path: params.projectPath } : {}),
    ...(params.gitRootPath !== undefined ? { git_root_path: params.gitRootPath } : {}),
    ...(params.defaultBranch !== undefined ? { default_branch: params.defaultBranch } : {}),
    ...(params.slug !== undefined ? { slug: params.slug } : {}),
    ...(params.description !== undefined ? { description: params.description } : {}),
  };
  const updatedProjects = [...currentProjects];
  updatedProjects[idx] = updated;
  patchWorkspaceYaml({ projects: updatedProjects }, params.workspaceKey);
  const reloaded = loadConfig(params.workspaceKey).config ?? getConfig(params.workspaceKey);
  const project = reloaded.projects.find((p) => p.key === params.key);
  if (!project) throw new Error(`Failed to reload project ${params.key}`);
  return toProject(project);
}

export function deleteProject(workspaceKey: string, projectKey: string): void {
  const workspaceConfig = getWorkspaceConfig(workspaceKey);
  const currentProjects = workspaceConfig.workspace.projects ?? [];
  const idx = currentProjects.findIndex(
    (p) => sanitizeProjectKey(p.key ?? p.slug, p.name) === projectKey,
  );
  if (idx < 0) throw new Error(`Project not found: ${projectKey}`);
  const filtered = currentProjects.filter((_, i) => i !== idx);
  patchWorkspaceYaml({ projects: filtered }, workspaceKey);
  // Cascade: delete all tasks belonging to this project in this workspace
  const db = getDb();
  db.run(
    "DELETE FROM tasks WHERE project_key = ? AND board_id IN (SELECT id FROM boards WHERE workspace_key = ?)",
    [projectKey, workspaceKey],
  );
}

export function registerProject(params: {
  workspaceKey: string;
  name: string;
  projectPath: string;
  gitRootPath: string;
  defaultBranch: string;
  slug?: string;
  description?: string;
}): Project {
  const workspaceConfig = getWorkspaceConfig(params.workspaceKey);
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
