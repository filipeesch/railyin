import { existsSync, readdirSync } from "fs";
import { join } from "path";
import type { SlashCommandDialect, ResolvedPrompt } from "../dialects/slash-command-dialect.ts";
import type { CommandInfo } from "../types.ts";
import type { Instruction } from "../dialects/instruction-scanner.ts";
import {
  getInstructionConvention,
  scanInstructionsFromDir,
  logInstructionsLoaded,
} from "../dialects/instruction-scanner.ts";
import { FileSystemSkillResolver } from "./skill-resolver.ts";

/**
 * Known dialect names that support instruction scanning.
 */
const INSTRUCTION_DIALECTS = new Set(["copilot", "cursor"]);

export class PiDialectResolver {
  private readonly dialectName: string;

  constructor(private readonly dialect: SlashCommandDialect) {
    // Determine dialect name from constructor
    this.dialectName = this.resolveDialectName(dialect);
  }

  /**
   * Resolve the dialect name from the dialect instance.
   */
  private resolveDialectName(dialect: SlashCommandDialect): string {
    const className = dialect.constructor.name.toLowerCase();
    if (className.includes("copilot")) return "copilot";
    if (className.includes("cursor")) return "cursor";
    if (className.includes("claude")) return "claude";
    if (className.includes("null")) return "none";
    return "none";
  }

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
   * Scan instruction files based on the configured dialect convention.
   *
   * Scans both project root (cwd) and worktree root (gitWorktreeRootPath).
   * Files from cwd have higher priority (deduplicated by name).
   *
   * @param cwd - Project root path (monorepo root).
   * @param gitWorktreeRootPath - Git worktree root path.
   * @returns Array of Instruction objects.
   */
  getInstructions(cwd: string, gitWorktreeRootPath: string): Instruction[] {
    const convention = getInstructionConvention(this.dialectName);
    if (convention === null) {
      return [];
    }

    const seen = new Set<string>();
    const instructions: Instruction[] = [];

    // Scan cwd (project root) first — higher priority
    const cwdDir = join(cwd, convention.subdirectory);
    const cwdInstructions = scanInstructionsFromDir(cwdDir, convention.extensions);
    for (const inst of cwdInstructions) {
      if (!seen.has(inst.name)) {
        seen.add(inst.name);
        instructions.push(inst);
      }
    }

    // Scan worktree root if different from cwd
    if (gitWorktreeRootPath !== cwd) {
      const worktreeDir = join(gitWorktreeRootPath, convention.subdirectory);
      const worktreeInstructions = scanInstructionsFromDir(worktreeDir, convention.extensions);
      for (const inst of worktreeInstructions) {
        if (!seen.has(inst.name)) {
          seen.add(inst.name);
          instructions.push(inst);
        }
      }
    }

    logInstructionsLoaded("pi", instructions);
    return instructions;
  }

}

