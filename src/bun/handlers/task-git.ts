import type { Database } from "bun:sqlite";
import type { Task } from "../../shared/rpc-types.ts";
import type { TaskRow } from "../db/row-types.ts";
import { mapTask } from "../db/mappers.ts";
import { triggerWorktreeIfNeeded, removeWorktree, createWorktree, listBranches } from "../git/worktree.ts";
import type { OnTaskUpdated } from "../engine/types.ts";

export function taskGitHandlers(db: Database, onTaskUpdated: OnTaskUpdated) {
  return {
    // ─── tasks.listBranches ────────────────────────────────────────────────────
    "tasks.listBranches": async (params: { taskId: number }): Promise<{ branches: string[] }> => {
      const branches = await listBranches(params.taskId);
      return { branches };
    },

    // ─── tasks.createWorktree ──────────────────────────────────────────────────
    "tasks.createWorktree": async (params: {
      taskId: number;
      path: string;
      mode: "new" | "existing";
      branchName: string;
      sourceBranch?: string;
    }): Promise<Task> => {
      await createWorktree(params.taskId, {
        mode: params.mode,
        branchName: params.branchName,
        path: params.path,
        sourceBranch: params.sourceBranch,
      });
      const row = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(params.taskId);
      if (!row) throw new Error(`Task ${params.taskId} not found`);
      const task = mapTask(row);
      onTaskUpdated(task);
      return task;
    },

    // ─── tasks.removeWorktree ──────────────────────────────────────────────────
    "tasks.removeWorktree": async (params: { taskId: number }): Promise<{ warning?: string }> => {
      const { warning } = await removeWorktree(params.taskId);
      const row = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(params.taskId);
      if (row) onTaskUpdated(mapTask(row));
      return { ...(warning ? { warning } : {}) };
    },

    // ─── tasks.getGitStat ─────────────────────────────────────────────────────
    "tasks.getGitStat": async (params: { taskId: number }): Promise<import("../../shared/rpc-types.ts").GitNumstat | null> => {
      const gitRow = db
        .query<{ worktree_path: string | null; worktree_status: string | null; base_sha: string | null }, [number]>(
          "SELECT worktree_path, worktree_status, base_sha FROM task_git_context WHERE task_id = ?",
        )
        .get(params.taskId);
      if (!gitRow?.worktree_path || gitRow.worktree_status !== "ready") return null;
      try {
        const diffRange = gitRow.base_sha ? [gitRow.base_sha, "HEAD"] : ["HEAD"];
        const [proc, untrackedProc] = [
          Bun.spawn(["git", "diff", "--numstat", ...diffRange], { cwd: gitRow.worktree_path, stdout: "pipe", stderr: "pipe" }),
          Bun.spawn(["git", "ls-files", "--others", "--exclude-standard"], { cwd: gitRow.worktree_path, stdout: "pipe", stderr: "pipe" }),
        ];
        await Promise.all([proc.exited, untrackedProc.exited]);
        const out = (await new Response(proc.stdout).text()).trim();
        const untrackedOut = (await new Response(untrackedProc.stdout).text()).trim();
        const files: import("../../shared/rpc-types.ts").GitFileNumstat[] = [];
        let totalAdditions = 0;
        let totalDeletions = 0;
        if (out) {
          for (const line of out.split("\n")) {
            const parts = line.split("\t");
            if (parts.length < 3) continue;
            const additions = parseInt(parts[0], 10) || 0;
            const deletions = parseInt(parts[1], 10) || 0;
            const filePath = parts[2];
            files.push({ path: filePath, additions, deletions });
            totalAdditions += additions;
            totalDeletions += deletions;
          }
        }
        if (untrackedOut) {
          const trackedPaths = new Set(files.map((f) => f.path));
          for (const untrackedPath of untrackedOut.split("\n").filter(Boolean)) {
            if (trackedPaths.has(untrackedPath)) continue;
            try {
              const content = await Bun.file(`${gitRow.worktree_path}/${untrackedPath}`).text();
              const lineCount = content.split("\n").length;
              files.push({ path: untrackedPath, additions: lineCount, deletions: 0 });
              totalAdditions += lineCount;
            } catch { /* skip unreadable */ }
          }
        }
        return files.length > 0 ? { files, totalAdditions, totalDeletions } : null;
      } catch {
        return null;
      }
    },

    // ─── tasks.getChangedFiles ─────────────────────────────────────────────────
    "tasks.getChangedFiles": async (params: { taskId: number }): Promise<string[]> => {
      const gitRow = db
        .query<{ worktree_path: string | null; worktree_status: string | null; base_sha: string | null }, [number]>(
          "SELECT worktree_path, worktree_status, base_sha FROM task_git_context WHERE task_id = ?",
        )
        .get(params.taskId);
      if (!gitRow?.worktree_path || gitRow.worktree_status !== "ready") return [];
      try {
        const diffArgs = gitRow.base_sha
          ? ["git", "diff", gitRow.base_sha, "HEAD", "--name-only", "--diff-filter=ACDMR"]
          : ["git", "diff", "HEAD", "--name-only", "--diff-filter=ACDMR"];
        const [trackedProc, untrackedProc] = [
          Bun.spawn(diffArgs, { cwd: gitRow.worktree_path, stdout: "pipe", stderr: "pipe" }),
          Bun.spawn(["git", "ls-files", "--others", "--exclude-standard"], { cwd: gitRow.worktree_path, stdout: "pipe", stderr: "pipe" }),
        ];
        await Promise.all([trackedProc.exited, untrackedProc.exited]);
        const trackedOut = await new Response(trackedProc.stdout).text();
        const untrackedOut = await new Response(untrackedProc.stdout).text();
        const tracked = trackedOut.trim() ? trackedOut.trim().split("\n") : [];
        const untracked = untrackedOut.trim() ? untrackedOut.trim().split("\n") : [];
        // Deduplicate (shouldn't overlap, but be safe)
        return [...new Set([...tracked, ...untracked])];
      } catch {
        return [];
      }
    },
  };
}
