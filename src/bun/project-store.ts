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
