import {
  getConfig,
  getWorkspaceRegistry,
  loadConfig,
  patchWorkspaceYaml,
  type LoadedConfig,
  type LoadedProject,
  type WorkspaceProjectYaml,
} from "./config/index.ts";
import { getEffectiveWorkspacePath, toWorkspaceRelativePath, isInsideWorkspace, resolveConfigPath } from "./config/path-utils.ts";
import { getWorkspaceConfig } from "./workspace-context.ts";
import { getDb } from "./db/index.ts";
import { existsSync } from "fs";
import { isAbsolute } from "path";
import type { Project } from "../shared/rpc-types.ts";

function sanitizeProjectKey(raw: string | undefined, fallback: string): string {
  const key = (raw ?? fallback).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
  return key || fallback;
}

function toProject(project: LoadedProject, workspacePath: string): Project {
  return {
    key: project.key,
    workspaceKey: project.workspaceKey,
    name: project.name,
    projectPath: {
      absolute: project.projectPath,
      relative: toWorkspaceRelativePath(workspacePath, project.projectPath),
    },
    gitRootPath: {
      absolute: project.gitRootPath,
      relative: toWorkspaceRelativePath(workspacePath, project.gitRootPath),
    },
    defaultBranch: project.defaultBranch,
    ...(project.slug ? { slug: project.slug } : {}),
    ...(project.description ? { description: project.description } : {}),
  };
}

function loadAllWorkspaceConfigs(): LoadedConfig[] {
  return getWorkspaceRegistry().flatMap((entry) => {
    const { config } = loadConfig(entry.key);
    return config ? [config] : [];
  });
}

export function listFileBackedProjects(): Project[] {
  return loadAllWorkspaceConfigs().flatMap((config) => {
    const workspacePath = getEffectiveWorkspacePath(config);
    return config.projects.map((p) => toProject(p, workspacePath));
  });
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
    if (project) return toProject(project, getEffectiveWorkspacePath(config));
  }
  return null;
}

export function getLoadedProjectByKey(workspaceKey: string, projectKey: string): LoadedProject | null {
  for (const config of loadAllWorkspaceConfigs()) {
    if (config.workspaceKey !== workspaceKey) continue;
    const project = config.projects.find((entry) => entry.key === projectKey);
    if (project) return project;
  }
  return null;
}

/**
 * Normalizes an input path (absolute or relative) to a workspace-relative path.
 * Validates that the path exists on disk and is inside the workspace.
 */
function normalizeProjectPath(inputPath: string, workspacePath: string, fieldName: string): string {
  const absolutePath = isAbsolute(inputPath) ? inputPath : resolveConfigPath(workspacePath, inputPath);
  if (!existsSync(absolutePath)) {
    throw new Error(`${fieldName} does not exist: ${absolutePath}`);
  }
  if (!isInsideWorkspace(workspacePath, absolutePath)) {
    throw new Error(`${fieldName} must be inside workspace_path.\nPath: ${absolutePath}\nWorkspace: ${workspacePath}`);
  }
  return toWorkspaceRelativePath(workspacePath, absolutePath);
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
  const workspacePath = getEffectiveWorkspacePath(workspaceConfig);
  if (!workspaceConfig.workspace.workspace_path) {
    throw new Error(`workspace_path must be set before registering or updating projects`);
  }
  const currentProjects = workspaceConfig.workspace.projects ?? [];
  const idx = currentProjects.findIndex(
    (p) => sanitizeProjectKey(p.key ?? p.slug, p.name) === params.key,
  );
  if (idx < 0) throw new Error(`Project not found: ${params.key}`);
  const existing = currentProjects[idx]!;
  const updated: WorkspaceProjectYaml = {
    ...existing,
    ...(params.name !== undefined ? { name: params.name.trim() } : {}),
    ...(params.projectPath !== undefined ? { project_path: normalizeProjectPath(params.projectPath, workspacePath, "project_path") } : {}),
    ...(params.gitRootPath !== undefined ? { git_root_path: normalizeProjectPath(params.gitRootPath, workspacePath, "git_root_path") } : {}),
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
  return toProject(project, workspacePath);
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
  if (!workspaceConfig.workspace.workspace_path) {
    throw new Error(`workspace_path must be set before registering projects`);
  }
  const workspacePath = getEffectiveWorkspacePath(workspaceConfig);
  const currentProjects = workspaceConfig.workspace.projects ?? [];
  const keyBase = params.slug?.trim() || params.name;
  const key = sanitizeProjectKey(keyBase, params.name);
  if (currentProjects.some((project) => sanitizeProjectKey(project.key ?? project.slug, project.name) === key)) {
    throw new Error(`Project key already exists in workspace: ${key}`);
  }

  const relProjectPath = normalizeProjectPath(params.projectPath, workspacePath, "project_path");
  const relGitRootPath = normalizeProjectPath(params.gitRootPath, workspacePath, "git_root_path");

  const nextProject: WorkspaceProjectYaml = {
    key,
    name: params.name.trim(),
    project_path: relProjectPath,
    git_root_path: relGitRootPath,
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
  return toProject(project, workspacePath);
}
