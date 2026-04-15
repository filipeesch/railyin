import type { Project } from "../../shared/rpc-types.ts";
import { listProjects, registerProject } from "../project-store.ts";

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
  };
}
