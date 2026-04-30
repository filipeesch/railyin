import type { Database } from "bun:sqlite";
import type { FileDiffContent, HunkDecision, LineComment } from "../../shared/rpc-types.ts";
import { readFileDiffContent, parseGitDiffHunks, computeHunkHash, extractHunkPatch } from "../git/diff-utils.ts";

export function codeReviewHandlers(db: Database) {
  return {
    // ─── tasks.getFileDiff ─────────────────────────────────────────────────────
    "tasks.getFileDiff": async (params: { taskId: number; filePath: string; checkpointRef?: string }): Promise<FileDiffContent> => {
      const gitRow = db
        .query<{ worktree_path: string | null; base_sha: string | null }, [number]>(
          "SELECT worktree_path, base_sha FROM task_git_context WHERE task_id = ?",
        )
        .get(params.taskId);
      if (!gitRow?.worktree_path) return { original: "", modified: "", hunks: [] };
      return readFileDiffContent(db, params.taskId, gitRow.worktree_path, params.filePath, params.checkpointRef, gitRow.base_sha ?? undefined);
    },

    // ─── tasks.rejectHunk ─────────────────────────────────────────────────────
    "tasks.rejectHunk": async (params: { taskId: number; filePath: string; hunkIndex: number }): Promise<FileDiffContent> => {
      const gitRow = db
        .query<{ worktree_path: string | null; base_sha: string | null }, [number]>(
          "SELECT worktree_path, base_sha FROM task_git_context WHERE task_id = ?",
        )
        .get(params.taskId);
      if (!gitRow?.worktree_path) throw new Error("Worktree not found for task");

      const worktreePath = gitRow.worktree_path;
      const baseSha = gitRow.base_sha ?? undefined;
      const { filePath, hunkIndex } = params;

      // Get the current diff for the file
      const baseRef = baseSha ?? "HEAD";
      const diffArgs = baseRef !== "HEAD"
        ? ["git", "diff", baseRef, "HEAD", "--", filePath]
        : ["git", "diff", "HEAD", "--", filePath];
      const diffProc = Bun.spawn(diffArgs, {
        cwd: worktreePath,
        stdout: "pipe",
        stderr: "pipe",
      });
      await diffProc.exited;
      const diffOutput = await new Response(diffProc.stdout).text();

      if (!diffOutput.trim()) {
        // File may be untracked (never `git add`ed) — no diff against HEAD exists.
        // For untracked files the entire content IS the "hunk", so we just record
        // the rejection and let readFileDiffContent return the updated state.
        const diskFile = Bun.file(`${worktreePath}/${filePath}`);
        if (!(await diskFile.exists())) {
          throw new Error("No diff found for file — it may already be at HEAD");
        }
        const content = await diskFile.text();
        const modifiedLines = content.split("\n");
        const hash = computeHunkHash(filePath, [], modifiedLines);
        db.run(
          `INSERT INTO task_hunk_decisions (task_id, hunk_hash, file_path, reviewer_type, reviewer_id, decision, comment, original_start, modified_start, updated_at)
           VALUES (?, ?, ?, 'human', 'user', 'rejected', NULL, 0, 1, datetime('now'))
           ON CONFLICT(task_id, hunk_hash, reviewer_id) DO UPDATE SET
             decision = 'rejected', comment = NULL, updated_at = datetime('now')`,
          [params.taskId, hash, filePath],
        );
        return readFileDiffContent(db, params.taskId, worktreePath, filePath, undefined, baseSha);
      }

      // Parse hunks to get hash of the hunk being rejected
      const parsedHunks = parseGitDiffHunks(diffOutput, filePath);
      if (hunkIndex >= parsedHunks.length) {
        throw new Error(`Hunk index ${hunkIndex} out of range (${parsedHunks.length} hunks found)`);
      }
      const targetHunk = parsedHunks[hunkIndex];

      // Apply the inverse patch
      const hunkPatch = extractHunkPatch(diffOutput, hunkIndex, filePath);
      const applyProc = Bun.spawn(
        ["git", "apply", "--reverse", "--whitespace=fix"],
        {
          cwd: worktreePath,
          stdout: "pipe",
          stderr: "pipe",
          stdin: new TextEncoder().encode(hunkPatch),
        },
      );
      await applyProc.exited;
      if (applyProc.exitCode !== 0) {
        const errText = await new Response(applyProc.stderr).text();
        throw new Error(`Could not revert this hunk — the file has been modified manually. ${errText.trim()}`);
      }

      // Persist the rejected decision to DB
      db.run(
        `INSERT INTO task_hunk_decisions (task_id, hunk_hash, file_path, reviewer_type, reviewer_id, decision, comment, original_start, modified_start, updated_at)
         VALUES (?, ?, ?, 'human', 'user', 'rejected', NULL, ?, ?, datetime('now'))
         ON CONFLICT(task_id, hunk_hash, reviewer_id) DO UPDATE SET
           decision = 'rejected', comment = NULL, updated_at = datetime('now')`,
        [params.taskId, targetHunk.hash, filePath, targetHunk.originalStart, targetHunk.modifiedStart],
      );

      // Return updated content
      return readFileDiffContent(db, params.taskId, worktreePath, filePath, undefined, baseSha);
    },

    // ─── tasks.decideAllHunks ─────────────────────────────────────────────────
    "tasks.decideAllHunks": async (params: { taskId: number; decision: "accepted" | "rejected" }): Promise<{ decided: number }> => {
      const gitRow = db
        .query<{ worktree_path: string | null; worktree_status: string | null; base_sha: string | null }, [number]>(
          "SELECT worktree_path, worktree_status, base_sha FROM task_git_context WHERE task_id = ?",
        )
        .get(params.taskId);
      if (!gitRow?.worktree_path || gitRow.worktree_status !== "ready") return { decided: 0 };

      const worktreePath = gitRow.worktree_path;
      const baseSha = gitRow.base_sha ?? undefined;

      // Get all changed files using the same base_sha range
      const diffArgs = baseSha
        ? ["git", "diff", baseSha, "HEAD", "--name-only", "--diff-filter=ACDMR"]
        : ["git", "diff", "HEAD", "--name-only", "--diff-filter=ACDMR"];
      const [trackedProc, untrackedProc] = [
        Bun.spawn(diffArgs, { cwd: worktreePath, stdout: "pipe", stderr: "pipe" }),
        Bun.spawn(["git", "ls-files", "--others", "--exclude-standard"], { cwd: worktreePath, stdout: "pipe", stderr: "pipe" }),
      ];
      await Promise.all([trackedProc.exited, untrackedProc.exited]);
      const trackedOut = await new Response(trackedProc.stdout).text();
      const untrackedOut = await new Response(untrackedProc.stdout).text();
      const allFiles = [
        ...(trackedOut.trim() ? trackedOut.trim().split("\n") : []),
        ...(untrackedOut.trim() ? untrackedOut.trim().split("\n") : []),
      ];

      let decided = 0;
      for (const filePath of allFiles) {
        const diff = await readFileDiffContent(db, params.taskId, worktreePath, filePath, undefined, baseSha);
        for (const hunk of diff.hunks) {
          if (hunk.humanDecision !== "pending") continue;
          db.run(
            `INSERT INTO task_hunk_decisions (task_id, hunk_hash, file_path, reviewer_type, reviewer_id, decision, comment, original_start, original_end, modified_start, modified_end, updated_at)
             VALUES (?, ?, ?, 'human', 'user', ?, NULL, ?, ?, ?, ?, datetime('now'))
             ON CONFLICT(task_id, hunk_hash, reviewer_id) DO UPDATE SET
               decision = excluded.decision, comment = NULL, updated_at = datetime('now')`,
            [params.taskId, hunk.hash, filePath, params.decision, hunk.originalStart, hunk.originalEnd, hunk.modifiedStart, hunk.modifiedEnd],
          );
          decided++;
        }
      }
      return { decided };
    },

    // ─── tasks.setHunkDecision ────────────────────────────────────────────────
    "tasks.setHunkDecision": async (params: {
      taskId: number;
      hunkHash: string;
      filePath: string;
      decision: HunkDecision;
      comment: string | null;
      originalStart: number;
      originalEnd: number;
      modifiedStart: number;
      modifiedEnd: number;
    }): Promise<void> => {
      db.run(
        `INSERT INTO task_hunk_decisions (task_id, hunk_hash, file_path, reviewer_type, reviewer_id, decision, comment, original_start, original_end, modified_start, modified_end, updated_at)
         VALUES (?, ?, ?, 'human', 'user', ?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(task_id, hunk_hash, reviewer_id) DO UPDATE SET
           decision = excluded.decision,
           comment  = excluded.comment,
           file_path = excluded.file_path,
           original_end = excluded.original_end,
           modified_end = excluded.modified_end,
           updated_at = datetime('now')`,
        [params.taskId, params.hunkHash, params.filePath, params.decision, params.comment, params.originalStart, params.originalEnd, params.modifiedStart, params.modifiedEnd],
      );
    },

    // ─── tasks.addLineComment ─────────────────────────────────────────────────
    "tasks.addLineComment": async (params: {
      taskId: number;
      filePath: string;
      lineStart: number;
      lineEnd: number;
      colStart?: number;
      colEnd?: number;
      lineText: string[];
      contextLines: string[];
      comment: string;
    }): Promise<LineComment> => {
      const colStart = params.colStart ?? 0;
      const colEnd = params.colEnd ?? 0;
      const result = db.run(
        `INSERT INTO task_line_comments (task_id, file_path, line_start, line_end, col_start, col_end, line_text, context_lines, comment, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        [params.taskId, params.filePath, params.lineStart, params.lineEnd, colStart, colEnd, JSON.stringify(params.lineText), JSON.stringify(params.contextLines), params.comment],
      );
      return {
        id: result.lastInsertRowid as number,
        filePath: params.filePath,
        lineStart: params.lineStart,
        lineEnd: params.lineEnd,
        colStart,
        colEnd,
        lineText: params.lineText,
        contextLines: params.contextLines,
        comment: params.comment,
        reviewerType: "human",
      };
    },

    // ─── tasks.getLineComments ────────────────────────────────────────────────
    "tasks.getLineComments": async (params: { taskId: number }): Promise<LineComment[]> => {
      const rows = db.query(
        `SELECT id, file_path, line_start, line_end, col_start, col_end, line_text, context_lines, comment, reviewer_type
         FROM task_line_comments
         WHERE task_id = ? AND sent = 0
         ORDER BY file_path, line_start`,
      ).all(params.taskId) as Array<{
        id: number;
        file_path: string;
        line_start: number;
        line_end: number;
        col_start: number;
        col_end: number;
        line_text: string;
        context_lines: string;
        comment: string;
        reviewer_type: string;
      }>;
      return rows.map((r) => ({
        id: r.id,
        filePath: r.file_path,
        lineStart: r.line_start,
        lineEnd: r.line_end,
        colStart: r.col_start,
        colEnd: r.col_end,
        lineText: JSON.parse(r.line_text),
        contextLines: JSON.parse(r.context_lines),
        comment: r.comment,
        reviewerType: r.reviewer_type as "human" | "ai",
      }));
    },

    // ─── tasks.deleteLineComment ──────────────────────────────────────────────
    "tasks.deleteLineComment": async (params: { taskId: number; commentId: number }): Promise<void> => {
      db.run(`DELETE FROM task_line_comments WHERE id = ? AND task_id = ?`, [params.commentId, params.taskId]);
    },

    // ─── tasks.writeFile ──────────────────────────────────────────────────────
    "tasks.writeFile": async (params: { taskId: number; filePath: string; content: string }): Promise<void> => {
      const gitRow = db
        .query<{ worktree_path: string | null }, [number]>(
          "SELECT worktree_path FROM task_git_context WHERE task_id = ?",
        )
        .get(params.taskId);
      if (!gitRow?.worktree_path) throw new Error("Worktree not found for task");
      const { resolve, normalize } = await import("node:path");
      const resolvedPath = resolve(gitRow.worktree_path, params.filePath);
      // Path traversal guard
      if (!resolvedPath.startsWith(normalize(gitRow.worktree_path) + "/") && resolvedPath !== normalize(gitRow.worktree_path)) {
        throw new Error("Invalid file path: path traversal detected");
      }
      await Bun.write(resolvedPath, params.content);
    },

    // ─── tasks.getPendingHunkSummary ──────────────────────────────────────────
    "tasks.getPendingHunkSummary": async (params: { taskId: number }): Promise<{ filePath: string; pendingCount: number }[]> => {
      // Count decided hunks per file (sent=0 means not yet submitted).
      // A file is fully decided when ALL its hunks have a decision row.
      // Files with no decisions at all won't appear here — the frontend
      // must default those to "all pending".
      const rows = db
        .query<{ file_path: string; totalDecided: number; acceptedCount: number }, [number]>(
          `SELECT file_path,
                  COUNT(*) as totalDecided,
                  SUM(CASE WHEN decision = 'accepted' THEN 1 ELSE 0 END) as acceptedCount
           FROM task_hunk_decisions
           WHERE task_id = ? AND sent = 0
           GROUP BY file_path`,
        )
        .all(params.taskId);
      // Return pendingCount=0 only for files where every decision is accounted for.
      // (The frontend still needs to add files absent from this list as fully pending.)
      return rows.map((r) => ({
        filePath: r.file_path,
        pendingCount: r.acceptedCount === r.totalDecided && r.totalDecided > 0 ? 0 : r.totalDecided,
      }));
    },

    // ─── tasks.getCheckpointRef ───────────────────────────────────────────────
    "tasks.getCheckpointRef": async (params: { taskId: number }): Promise<string | null> => {
      // Find the most recent execution for this task that has unsent pending hunk decisions
      const row = db
        .query<{ stash_ref: string | null }, [number]>(
          `SELECT tec.stash_ref
           FROM task_execution_checkpoints tec
           JOIN executions e ON tec.execution_id = e.id
           WHERE e.task_id = ?
             AND EXISTS (
               SELECT 1 FROM task_hunk_decisions thd
               WHERE thd.task_id = ? AND thd.sent = 0
             )
           ORDER BY tec.created_at DESC
           LIMIT 1`,
        )
        .get(params.taskId, params.taskId);
      return row?.stash_ref ?? null;
    },
  };
}
