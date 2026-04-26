import type { Project } from "../../shared/rpc-types.ts";
import { listProjects, registerProject, updateProject, deleteProject } from "../project-store.ts";

export function projectHandlers() {
  return {
    // Workspace-level list — all projects across workspace
    "projects.list": async (): Promise<Project[]> => {
      return listProjects();
    },

    "projects.register": async (params: {
      workspaceKey: string;
      name: string;
      projectPath: string;
      gitRootPath: string;
      defaultBranch: string;
      slug?: string;
      description?: string;
    }): Promise<Project> => {
      const project = registerProject(params);
      return project;
    },
    "projects.update": async (params: {
      workspaceKey: string;
      key: string;
      name?: string;
      projectPath?: string;
      gitRootPath?: string;
      defaultBranch?: string;
      slug?: string;
      description?: string;
    }): Promise<Project> => {
      return updateProject(params);
    },

    "projects.delete": async (params: { workspaceKey: string; key: string }): Promise<Record<string, never>> => {
      deleteProject(params.workspaceKey, params.key);
      return {};
    },
  };
}
