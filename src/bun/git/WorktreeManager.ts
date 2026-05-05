import type { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import type { IWorkspaceRepository } from "../db/workspace-repository.ts";
import type { IProjectResolver } from "./IProjectResolver.ts";
import type { ITaskGitContextRepository } from "../db/repositories/ITaskGitContextRepository.ts";
import type { GitRepositoryManager } from "./GitRepositoryManager.ts";

// ─── Branch naming ────────────────────────────────────────────────────────────

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

function buildBranchName(taskId: number, title: string): string {
  return `task/${taskId}-${slugify(title)}`;
}

// ─── Options ──────────────────────────────────────────────────────────────────

export interface CreateWorktreeOptions {
  mode?: "new" | "existing";
  branchName?: string;
  path?: string;
  sourceBranch?: string;
}

// ─── WorktreeManager ──────────────────────────────────────────────────────────

export class WorktreeManager {
  constructor(
    private readonly db: Database,
    private readonly wsRepo: IWorkspaceRepository,
    private readonly projectResolver: IProjectResolver,
    private readonly gitRepo: GitRepositoryManager,
    private readonly taskGitContextRepo: ITaskGitContextRepository,
  ) {}

  registerContext(taskId: number, gitRootPath: string, subrepoPath?: string): void {
    this.taskGitContextRepo.upsertContext(taskId, gitRootPath, subrepoPath);
  }

  async createWorktree(
    taskId: number,
    options?: CreateWorktreeOptions,
  ): Promise<{ path: string; branch: string }> {
    const ctx = this.taskGitContextRepo.getContext(taskId);
    if (!ctx) throw new Error(`No git context for task ${taskId}`);

    // Guard against double-creation in the auto-creation path
    if (
      !options &&
      (ctx.worktreeStatus === "ready" || ctx.worktreeStatus === "creating") &&
      ctx.worktreePath
    ) {
      return {
        path: ctx.worktreePath,
        branch: ctx.branchName ?? branchFromPath(ctx.worktreePath),
      };
    }

    const taskRow = this.db
      .query<{ id: number; title: string; project_key: string }, [number]>(
        "SELECT id, title, project_key FROM tasks WHERE id = ?",
      )
      .get(taskId);
    if (!taskRow) throw new Error(`Task ${taskId} not found`);

    const wsKey = this.wsRepo.getTaskWorkspaceKey(taskId);

    // THE FIX: use project.defaultBranch instead of "HEAD" when no explicit sourceBranch
    const sourceBranch =
      options?.sourceBranch ?? this.projectResolver.getDefaultBranch(wsKey, taskRow.project_key);

    const branch = options?.branchName ?? buildBranchName(taskId, taskRow.title);
    const worktreePath =
      options?.path ??
      `${this.projectResolver.getWorktreeBasePath(wsKey, taskRow.project_key, ctx.gitRootPath)}/${buildBranchName(taskId, taskRow.title)}`;

    if (!existsSync(ctx.gitRootPath)) {
      this.taskGitContextRepo.updateStatus(taskId, "error");
      throw new Error(
        `git_root_path does not exist: "${ctx.gitRootPath}". ` +
        `Check the project's Git Root Path in settings.`,
      );
    }

    const worktreeParent = dirname(worktreePath);
    if (!existsSync(worktreeParent)) {
      mkdirSync(worktreeParent, { recursive: true });
    }

    this.taskGitContextRepo.updateCreating(taskId, worktreePath, branch);

    try {
      await this.gitRepo.addWorktree(
        ctx.gitRootPath,
        branch,
        worktreePath,
        sourceBranch,
        options?.mode ?? "new",
      );

      const baseSha = await this.gitRepo.revParseHead(worktreePath);
      this.taskGitContextRepo.updateReady(taskId, baseSha);

      return { path: worktreePath, branch };
    } catch (err) {
      this.taskGitContextRepo.updateStatus(taskId, "error");
      throw err;
    }
  }

  async removeWorktree(taskId: number): Promise<{ warning?: string }> {
    const ctx = this.taskGitContextRepo.getContext(taskId);
    if (!ctx?.worktreePath) return {};

    if (!existsSync(ctx.gitRootPath)) {
      return {
        warning: `Worktree directory could not be removed: git root "${ctx.gitRootPath}" no longer exists on disk.`,
      };
    }

    try {
      await this.gitRepo.removeWorktree(ctx.gitRootPath, ctx.worktreePath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { warning: `Worktree could not be removed: ${msg}` };
    }

    this.taskGitContextRepo.updateRemoved(taskId);
    return {};
  }

  async triggerWorktreeIfNeeded(
    taskId: number,
    onStatus?: (msg: string) => void,
  ): Promise<void> {
    const ctx = this.taskGitContextRepo.getContext(taskId);

    if (
      ctx?.gitRootPath &&
      (ctx.worktreeStatus === "not_created" ||
        ctx.worktreeStatus === "error" ||
        ctx.worktreeStatus === "removed")
    ) {
      onStatus?.("Creating worktree for this task…");
      const result = await this.createWorktree(taskId);
      onStatus?.(`Worktree ready at \`${result.branch}\``);
    }
  }

  async listBranches(taskId: number): Promise<string[]> {
    const ctx = this.taskGitContextRepo.getContext(taskId);
    if (!ctx?.gitRootPath) return [];
    return this.gitRepo.listBranches(ctx.gitRootPath);
  }
}

function branchFromPath(worktreePath: string): string {
  const parts = worktreePath.split("/");
  return parts[parts.length - 1] ?? worktreePath;
}
