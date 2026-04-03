import { getDb } from "../db/index.ts";
import type { Project } from "../../shared/rpc-types.ts";
import type { ProjectRow } from "../db/row-types.ts";
import { mapProject } from "../db/mappers.ts";

export function projectHandlers() {
  return {
    // Workspace-level list — all projects across workspace
    "projects.list": async (): Promise<Project[]> => {
      const db = getDb();
      return db
        .query<ProjectRow, []>(
          "SELECT * FROM projects WHERE workspace_id = 1 ORDER BY created_at ASC",
        )
        .all()
        .map(mapProject);
    },

    "projects.register": async (params: {
      name: string;
      projectPath: string;
      gitRootPath: string;
      defaultBranch: string;
      slug?: string;
      description?: string;
    }): Promise<Project> => {
      const db = getDb();

      const result = db.run(
        `INSERT INTO projects
           (workspace_id, name, project_path, git_root_path, default_branch, slug, description)
         VALUES (1, ?, ?, ?, ?, ?, ?)`,
        [
          params.name.trim(),
          params.projectPath,
          params.gitRootPath,
          params.defaultBranch,
          params.slug ?? null,
          params.description ?? null,
        ],
      );

      const row = db
        .query<ProjectRow, [number]>("SELECT * FROM projects WHERE id = ?")
        .get(result.lastInsertRowid as number)!;

      return mapProject(row);
    },
  };
}
