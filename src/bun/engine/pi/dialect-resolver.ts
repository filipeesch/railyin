/**
 * PiDialectResolver — resolves slash prompts, skill paths, and project paths.
 *
 * Wraps the SlashCommandDialect and encapsulates the DB lookups needed to find the
 * project path for a given task/board pair. Keeping this logic here removes the need
 * for the execution controller to import DB helpers directly.
 */

import type { SlashCommandDialect, ResolvedPrompt } from "../dialects/slash-command-dialect.ts";
import type { CommandInfo } from "../types.ts";
import { FileSystemSkillResolver } from "./skill-resolver.ts";

export class PiDialectResolver {
  constructor(private readonly dialect: SlashCommandDialect) {}

  async resolvePrompt(prompt: string, cwd: string, projectPath: string | undefined): Promise<ResolvedPrompt> {
    return this.dialect.resolvePrompt(prompt, cwd, projectPath);
  }

  getSkillResolver(cwd: string, projectPath: string | undefined): FileSystemSkillResolver {
    const skillPaths = this.dialect.getSkillPaths(cwd, projectPath);
    return new FileSystemSkillResolver(skillPaths);
  }

  listCommands(worktreePath: string, projectPath: string | undefined): CommandInfo[] {
    return this.dialect.listCommands(worktreePath, projectPath);
  }

  /**
   * Look up the project path for a task/board pair.
   * Returns undefined when no project path is configured or the task is not found.
   */
  async lookupProjectPath(taskId: number, boardId: number, worktreePath: string): Promise<string | undefined> {
    const { getDb } = await import("../../db/index.ts");
    const { getDefaultWorkspaceKey } = await import("../../workspace-context.ts");
    const { getLoadedProjectByKey } = await import("../../project-store.ts");

    const db = getDb();
    const taskRow = db
      .query<{ project_key: string }, [number]>(
        "SELECT project_key FROM tasks WHERE id = ?",
      )
      .get(taskId);

    if (!taskRow) return undefined;

    const wsKey =
      db.query<{ workspace_key: string }, [number]>(
        "SELECT workspace_key FROM boards WHERE id = ?",
      ).get(boardId)?.workspace_key ?? getDefaultWorkspaceKey();

    const project = getLoadedProjectByKey(wsKey, taskRow.project_key);
    if (project?.projectPath && project.projectPath !== worktreePath) {
      return project.projectPath;
    }
    return undefined;
  }

  /**
   * Look up the project path for a task/board pair, using a board→workspace lookup
   * pattern matching the listCommands() use case.
   */
  async lookupProjectPathForTask(
    taskId: number,
    boardId: number,
    projectKey: string,
    worktreePath: string,
  ): Promise<string | undefined> {
    const { getDb } = await import("../../db/index.ts");
    const { getDefaultWorkspaceKey } = await import("../../workspace-context.ts");
    const { getLoadedProjectByKey } = await import("../../project-store.ts");

    const db = getDb();
    const wsKey =
      db.query<{ workspace_key: string }, [number]>(
        "SELECT workspace_key FROM boards WHERE id = ?",
      ).get(boardId)?.workspace_key ?? getDefaultWorkspaceKey();
    void taskId;

    const project = getLoadedProjectByKey(wsKey, projectKey);
    if (project?.projectPath && project.projectPath !== worktreePath) {
      return project.projectPath;
    }
    return undefined;
  }
}
