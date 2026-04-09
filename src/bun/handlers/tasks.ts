import { getDb } from "../db/index.ts";
import { createHash } from "crypto";
import type { Task, ConversationMessage, HunkDecision, HunkWithDecisions, ReviewerDecision, FileDiffContent, ProviderModelList, ModelInfo } from "../../shared/rpc-types.ts";
import type { TaskRow } from "../db/row-types.ts";
import { mapTask } from "../db/mappers.ts";
import {
  appendMessage,
  estimateContextWarning,
  estimateContextUsage,
  compactConversation,
  resolveModelContextWindow,
} from "../workflow/engine.ts";
import { triggerWorktreeIfNeeded, registerProjectGitContext, removeWorktree } from "../git/worktree.ts";
import type { ProjectRow } from "../db/row-types.ts";
import type { OnTaskUpdated, OnNewMessage } from "../workflow/engine.ts";
import type { Orchestrator } from "../engine/orchestrator.ts";


// ─── Helper: fetch a single task with git context + execution count ───────────

function fetchTaskWithDetail(db: ReturnType<typeof getDb>, taskId: number): Task | null {
  const row = db
    .query<TaskRow, [number]>(
      `SELECT t.*,
              gc.worktree_status, gc.branch_name, gc.worktree_path,
              (SELECT COUNT(*) FROM executions e WHERE e.task_id = t.id) AS execution_count
       FROM tasks t
       LEFT JOIN task_git_context gc ON gc.task_id = t.id
       WHERE t.id = ?`,
    )
    .get(taskId);
  return row ? mapTask(row) : null;
}

export function taskHandlers(orchestrator: Orchestrator | null, onTaskUpdated: OnTaskUpdated, onNewMessage: OnNewMessage) {
  return {
    "tasks.list": async (params: { boardId: number }): Promise<Task[]> => {
      const db = getDb();
      return db
        .query<TaskRow, [number]>(
          `SELECT t.*,
                  gc.worktree_status, gc.branch_name, gc.worktree_path,
                  (SELECT COUNT(*) FROM executions e WHERE e.task_id = t.id) AS execution_count
           FROM tasks t
           LEFT JOIN task_git_context gc ON gc.task_id = t.id
           WHERE t.board_id = ?
           ORDER BY t.created_at ASC`,
        )
        .all(params.boardId)
        .map(mapTask);
    },

    "tasks.create": async (params: {
      boardId: number;
      projectId: number;
      title: string;
      description: string;
    }): Promise<Task> => {
      const db = getDb();

      // Create conversation first with placeholder task_id=0
      const convResult = db.run("INSERT INTO conversations (task_id) VALUES (0)");
      const conversationId = convResult.lastInsertRowid as number;

      const taskResult = db.run(
        `INSERT INTO tasks
           (board_id, project_id, title, description, workflow_state, execution_state, conversation_id)
         VALUES (?, ?, ?, ?, 'backlog', 'idle', ?)`,
        [
          params.boardId,
          params.projectId,
          params.title.trim(),
          params.description.trim(),
          conversationId,
        ],
      );
      const taskId = taskResult.lastInsertRowid as number;

      // Fix up conversation → task link
      db.run("UPDATE conversations SET task_id = ? WHERE id = ?", [taskId, conversationId]);

      // Register git context for this task so tool calling works (best-effort)
      try {
        const project = db
          .query<Pick<ProjectRow, "git_root_path">, [number]>(
            "SELECT git_root_path FROM projects WHERE id = ?",
          )
          .get(params.projectId);
        if (project?.git_root_path) {
          registerProjectGitContext(taskId, project.git_root_path);
        }
      } catch (err) {
        console.warn("[railyn] failed to register git context for task", taskId, err);
      }

      // Seed conversation with task description as first system message
      appendMessage(
        taskId,
        conversationId,
        "system",
        null,
        `Task: ${params.title}\n\n${params.description}`,
      );

      const row = db
        .query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?")
        .get(taskId)!;

      return mapTask(row);
    },

    "tasks.transition": async (params: {
      taskId: number;
      toState: string;
    }): Promise<{ task: Task; executionId: number | null }> => {
      const db = getDb();

      const taskRow = db
        .query<{ project_id: number; conversation_id: number }, [number]>(
          "SELECT project_id, conversation_id FROM tasks WHERE id = ?",
        )
        .get(params.taskId);

      if (taskRow) {
        // Ensure conversation exists — tasks created before conversations were required may have null conversation_id.
        let convId = (taskRow.conversation_id as number | null);
        if (convId == null) {
          const convResult = db.run("INSERT INTO conversations (task_id) VALUES (?)", [params.taskId]);
          convId = convResult.lastInsertRowid as number;
          db.run("UPDATE tasks SET conversation_id = ? WHERE id = ?", [convId, params.taskId]);
        }

        // Backfill git context for tasks created before this was wired up
        const project = db
          .query<Pick<ProjectRow, "git_root_path">, [number]>(
            "SELECT git_root_path FROM projects WHERE id = ?",
          )
          .get(taskRow.project_id);
        if (project?.git_root_path) {
          registerProjectGitContext(params.taskId, project.git_root_path);
        }

        const postStatus = (msg: string) => {
          appendMessage(params.taskId, convId!, "system", null, msg);
          const updated = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(params.taskId);
          if (updated) onTaskUpdated(mapTask(updated));
        };

        try {
          await triggerWorktreeIfNeeded(params.taskId, postStatus);
        } catch (err) {
          // Worktree is required — fail the task so the user sees the error in the UI
          const errMsg = err instanceof Error ? err.message : String(err);
          db.run("UPDATE tasks SET execution_state = 'failed' WHERE id = ?", [params.taskId]);
          appendMessage(
            params.taskId,
            convId!,
            "system",
            null,
            `Worktree setup failed: ${errMsg}`,
          );
          const failedRow = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(params.taskId)!;
          onTaskUpdated(mapTask(failedRow));
          return { task: mapTask(failedRow), executionId: null };
        }
      }

      if (!orchestrator) throw new Error("Engine not initialized — check workspace config");
      return orchestrator.executeTransition(params.taskId, params.toState);
    },

    "tasks.sendMessage": async (params: {
      taskId: number;
      content: string;
    }): Promise<{ message: ConversationMessage; executionId: number }> => {
      // Check if content is a code review trigger
      try {
        const parsed = JSON.parse(params.content) as { _type?: string };
        if (parsed._type === "code_review") {
          if (!orchestrator) throw new Error("Engine not initialized — check workspace config");
          return orchestrator.executeCodeReview(params.taskId);
        }
      } catch { /* not JSON — treat as plain text */ }

      const warning = estimateContextWarning(params.taskId);
      if (warning) {
        console.warn(`[railyn] context warning for task ${params.taskId}: ${warning}`);
      }
      if (!orchestrator) throw new Error("Engine not initialized — check workspace config");
      return orchestrator.executeHumanTurn(params.taskId, params.content);
    },

    "tasks.retry": async (params: {
      taskId: number;
    }): Promise<{ task: Task; executionId: number }> => {
      const db = getDb();

      // Retry worktree setup if it previously failed — same logic as tasks.transition
      const taskRow = db
        .query<{ project_id: number; conversation_id: number }, [number]>(
          "SELECT project_id, conversation_id FROM tasks WHERE id = ?",
        )
        .get(params.taskId);

      if (taskRow) {
        // Ensure conversation exists — tasks created before conversations were required may have null conversation_id.
        let retryConvId = (taskRow.conversation_id as number | null);
        if (retryConvId == null) {
          const convResult = db.run("INSERT INTO conversations (task_id) VALUES (?)", [params.taskId]);
          retryConvId = convResult.lastInsertRowid as number;
          db.run("UPDATE tasks SET conversation_id = ? WHERE id = ?", [retryConvId, params.taskId]);
        }

        const project = db
          .query<Pick<ProjectRow, "git_root_path">, [number]>(
            "SELECT git_root_path FROM projects WHERE id = ?",
          )
          .get(taskRow.project_id);
        if (project?.git_root_path) {
          registerProjectGitContext(params.taskId, project.git_root_path);
        }

        const postStatus = (msg: string) => {
          appendMessage(params.taskId, retryConvId!, "system", null, msg);
          const updated = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(params.taskId);
          if (updated) onTaskUpdated(mapTask(updated));
        };

        try {
          await triggerWorktreeIfNeeded(params.taskId, postStatus);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          db.run("UPDATE tasks SET execution_state = 'failed' WHERE id = ?", [params.taskId]);
          appendMessage(params.taskId, retryConvId!, "system", null, `Worktree setup failed: ${errMsg}`);
          const failedRow = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(params.taskId)!;
          onTaskUpdated(mapTask(failedRow));
          // Return a fake execution id of -1 since we can't proceed — caller won't use it
          return { task: mapTask(failedRow), executionId: -1 };
        }
      }

      if (!orchestrator) throw new Error("Engine not initialized — check workspace config");
      return orchestrator.executeRetry(params.taskId);
    },

    // ─── models.list ─────────────────────────────────────────────────────────
    "models.list": async (): Promise<ProviderModelList[]> => {
      const db = getDb();

      if (!orchestrator) throw new Error("Engine not initialized — check workspace config");

      const enabledSet = new Set(
        db
          .query<{ qualified_model_id: string }, [number]>(
            "SELECT qualified_model_id FROM enabled_models WHERE workspace_id = ?",
          )
          .all(1)
          .map((r) => r.qualified_model_id),
      );

      try {
        const engineModels = await orchestrator.listModels();
        // Group models by provider (first part of the qualified ID before slash)
        const byProvider = new Map<string, typeof engineModels>();
        for (const model of engineModels) {
          const [providerId] = model.qualifiedId.split("/");
          if (!byProvider.has(providerId)) byProvider.set(providerId, []);
          byProvider.get(providerId)!.push(model);
        }

        return Array.from(byProvider.entries()).map(([providerId, models]) => ({
          id: providerId,
          models: models.map((m) => ({
            id: m.qualifiedId,
            displayName: m.displayName,
            contextWindow: m.contextWindow,
            enabled: enabledSet.has(m.qualifiedId),
            ...(m.supportsThinking ? { supportsAdaptiveThinking: true } : {}),
          })),
        }));
      } catch (err) {
        return [
          {
            id: "error",
            models: [],
            error: err instanceof Error ? err.message : String(err),
          },
        ];
      }
    },

    // ─── models.setEnabled ───────────────────────────────────────────────────
    "models.setEnabled": async (params: { qualifiedModelId: string; enabled: boolean }): Promise<Record<string, never>> => {
      const db = getDb();
      if (params.enabled) {
        db.run(
          "INSERT OR IGNORE INTO enabled_models (workspace_id, qualified_model_id) VALUES (?, ?)",
          [1, params.qualifiedModelId],
        );
      } else {
        db.run(
          "DELETE FROM enabled_models WHERE workspace_id = ? AND qualified_model_id = ?",
          [1, params.qualifiedModelId],
        );
      }
      return {};
    },

    // ─── models.listEnabled ──────────────────────────────────────────────────
    // Cross-references the DB with the engine's actual model list so stale entries
    // from previous engine configurations are silently dropped. If none of the
    // enabled DB entries match the current engine, all engine models are returned
    // (default-all-enabled behaviour on first use / engine switch).
    "models.listEnabled": async (): Promise<ModelInfo[]> => {
      const db = getDb();
      if (!orchestrator) return [];

      const [engineModels, dbRows] = await Promise.all([
        orchestrator.listModels(),
        db
          .query<{ qualified_model_id: string }, [number]>(
            "SELECT qualified_model_id FROM enabled_models WHERE workspace_id = ? ORDER BY qualified_model_id",
          )
          .all(1),
      ]);

      const engineIds = new Set(engineModels.map((m) => m.qualifiedId));
      const enabledIds = dbRows.map((r) => r.qualified_model_id).filter((id) => engineIds.has(id));

      // No overlap → engine switched or first use; treat all engine models as enabled.
      const activeIds = enabledIds.length > 0 ? enabledIds : [...engineIds];

      return engineModels
        .filter((m) => activeIds.includes(m.qualifiedId))
        .map((m) => ({ id: m.qualifiedId, displayName: m.displayName, contextWindow: m.contextWindow ?? null }));
    },

    // ─── tasks.setModel ──────────────────────────────────────────────────────
    "tasks.setModel": async (params: { taskId: number; model: string | null }): Promise<Task> => {
      const db = getDb();
      db.run("UPDATE tasks SET model = ? WHERE id = ?", [params.model, params.taskId]);
      const task = fetchTaskWithDetail(db, params.taskId);
      if (!task) throw new Error(`Task ${params.taskId} not found`);
      return task;
    },

    // ─── tasks.contextUsage ──────────────────────────────────────────────────
    "tasks.contextUsage": async (params: { taskId: number }): Promise<{ usedTokens: number; maxTokens: number; fraction: number }> => {
      const db = getDb();
      const task = db.query<{ model: string | null }, [number]>("SELECT model FROM tasks WHERE id = ?").get(params.taskId);
      const taskModel = task?.model ?? null;
      const maxTokens = taskModel
        ? await resolveModelContextWindow(taskModel)
        : 128_000;
      return estimateContextUsage(params.taskId, maxTokens);
    },

    // ─── tasks.compact ───────────────────────────────────────────────────────
    "tasks.compact": async (params: { taskId: number }): Promise<ConversationMessage> => {
      return compactConversation(params.taskId);
    },

    // ─── tasks.cancel ────────────────────────────────────────────────────────
    "tasks.cancel": async (params: { taskId: number }): Promise<Task> => {
      const db = getDb();
      const row = db
        .query<{ current_execution_id: number | null }, [number]>(
          "SELECT current_execution_id FROM tasks WHERE id = ?",
        )
        .get(params.taskId);
      if (row?.current_execution_id != null) {
        orchestrator?.cancel(row.current_execution_id);
      }
      const task = fetchTaskWithDetail(db, params.taskId);
      if (!task) throw new Error(`Task ${params.taskId} not found`);
      return task;
    },

    // ─── tasks.update ────────────────────────────────────────────────────────
    "tasks.update": async (params: { taskId: number; title: string; description: string }): Promise<Task> => {
      const db = getDb();
      const gitRow = db
        .query<{ worktree_status: string | null }, [number]>(
          "SELECT worktree_status FROM task_git_context WHERE task_id = ?",
        )
        .get(params.taskId);
      if (gitRow && gitRow.worktree_status && gitRow.worktree_status !== "not_created") {
        throw new Error("Cannot edit task once a worktree has been created");
      }
      db.run(
        "UPDATE tasks SET title = ?, description = ? WHERE id = ?",
        [params.title.trim(), params.description.trim(), params.taskId],
      );
      const task = fetchTaskWithDetail(db, params.taskId);
      if (!task) throw new Error(`Task ${params.taskId} not found`);
      return task;
    },

    // ─── tasks.delete ────────────────────────────────────────────────────────
    "tasks.delete": async (params: { taskId: number }): Promise<{ success: boolean }> => {
      const db = getDb();

      // Cancel any running execution first
      const row = db
        .query<{ current_execution_id: number | null; conversation_id: number }, [number]>(
          "SELECT current_execution_id, conversation_id FROM tasks WHERE id = ?",
        )
        .get(params.taskId);
      if (row?.current_execution_id != null) {
        orchestrator?.cancel(row.current_execution_id);
      }

      // Remove worktree (no-op if not created, returns warning if directory is gone)
      const { warning } = await removeWorktree(params.taskId);

      // Cascade delete — tasks must be deleted before conversations (FK ref)
      db.run("DELETE FROM conversation_messages WHERE task_id = ?", [params.taskId]);
      db.run("DELETE FROM executions WHERE task_id = ?", [params.taskId]);
      db.run("DELETE FROM task_git_context WHERE task_id = ?", [params.taskId]);
      db.run("DELETE FROM tasks WHERE id = ?", [params.taskId]);
      if (row?.conversation_id) {
        db.run("DELETE FROM conversations WHERE id = ?", [row.conversation_id]);
      }

      return { success: true, ...(warning ? { warning } : {}) };
    },

    // ─── tasks.getGitStat ────────────────────────────────────────────────────
    "tasks.getGitStat": async (params: { taskId: number }): Promise<string | null> => {
      const db = getDb();
      const gitRow = db
        .query<{ worktree_path: string | null; worktree_status: string | null }, [number]>(
          "SELECT worktree_path, worktree_status FROM task_git_context WHERE task_id = ?",
        )
        .get(params.taskId);
      if (!gitRow?.worktree_path || gitRow.worktree_status !== "ready") return null;
      try {
        const proc = Bun.spawn(["git", "diff", "--stat", "HEAD"], {
          cwd: gitRow.worktree_path,
          stdout: "pipe",
          stderr: "pipe",
        });
        await proc.exited;
        const out = await new Response(proc.stdout).text();
        return out.trim() || null;
      } catch {
        return null;
      }
    },

    // ─── tasks.getChangedFiles ───────────────────────────────────────────────
    "tasks.getChangedFiles": async (params: { taskId: number }): Promise<string[]> => {
      const db = getDb();
      const gitRow = db
        .query<{ worktree_path: string | null; worktree_status: string | null }, [number]>(
          "SELECT worktree_path, worktree_status FROM task_git_context WHERE task_id = ?",
        )
        .get(params.taskId);
      if (!gitRow?.worktree_path || gitRow.worktree_status !== "ready") return [];
      try {
        const [trackedProc, untrackedProc] = [
          Bun.spawn(["git", "diff", "HEAD", "--name-only", "--diff-filter=ACDMR"], { cwd: gitRow.worktree_path, stdout: "pipe", stderr: "pipe" }),
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

    // ─── tasks.getFileDiff ───────────────────────────────────────────────────
    "tasks.getFileDiff": async (params: { taskId: number; filePath: string }): Promise<FileDiffContent> => {
      const db = getDb();
      const gitRow = db
        .query<{ worktree_path: string | null }, [number]>(
          "SELECT worktree_path FROM task_git_context WHERE task_id = ?",
        )
        .get(params.taskId);
      if (!gitRow?.worktree_path) return { original: "", modified: "", hunks: [] };
      return readFileDiffContent(db, params.taskId, gitRow.worktree_path, params.filePath);
    },

    // ─── tasks.rejectHunk ────────────────────────────────────────────────────
    "tasks.rejectHunk": async (params: { taskId: number; filePath: string; hunkIndex: number }): Promise<FileDiffContent> => {
      const db = getDb();
      const gitRow = db
        .query<{ worktree_path: string | null }, [number]>(
          "SELECT worktree_path FROM task_git_context WHERE task_id = ?",
        )
        .get(params.taskId);
      if (!gitRow?.worktree_path) throw new Error("Worktree not found for task");

      const worktreePath = gitRow.worktree_path;
      const { filePath, hunkIndex } = params;

      // Get the current diff for the file
      const diffProc = Bun.spawn(["git", "diff", "HEAD", "--", filePath], {
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
        return readFileDiffContent(db, params.taskId, worktreePath, filePath);
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
      return readFileDiffContent(db, params.taskId, worktreePath, filePath);
    },

    // ─── tasks.setHunkDecision ───────────────────────────────────────────────
    "tasks.setHunkDecision": async (params: {
      taskId: number;
      hunkHash: string;
      filePath: string;
      decision: HunkDecision;
      comment: string | null;
      originalStart: number;
      modifiedStart: number;
    }): Promise<void> => {
      const db = getDb();
      db.run(
        `INSERT INTO task_hunk_decisions (task_id, hunk_hash, file_path, reviewer_type, reviewer_id, decision, comment, original_start, modified_start, updated_at)
         VALUES (?, ?, ?, 'human', 'user', ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(task_id, hunk_hash, reviewer_id) DO UPDATE SET
           decision = excluded.decision,
           comment  = excluded.comment,
           file_path = excluded.file_path,
           updated_at = datetime('now')`,
        [params.taskId, params.hunkHash, params.filePath, params.decision, params.comment, params.originalStart, params.modifiedStart],
      );
    },

    // ─── tasks.respondShellApproval ──────────────────────────────────────────
    "tasks.respondShellApproval": async (params: { taskId: number; decision: "approve_once" | "approve_all" | "deny" }): Promise<{ ok: boolean }> => {
      if (!orchestrator) return { ok: false };
      orchestrator.respondShellApproval(params.taskId, params.decision);
      return { ok: true };
    },

    // ─── tasks.setShellAutoApprove ────────────────────────────────────────────
    "tasks.setShellAutoApprove": async (params: { taskId: number; enabled: boolean }): Promise<Task> => {
      const db = getDb();
      db.run("UPDATE tasks SET shell_auto_approve = ? WHERE id = ?", [params.enabled ? 1 : 0, params.taskId]);
      const updated = fetchTaskWithDetail(db, params.taskId);
      if (!updated) throw new Error(`Task ${params.taskId} not found`);
      onTaskUpdated(updated);
      return updated;
    },

    // ─── todos.list ───────────────────────────────────────────────────────────
    "todos.list": async (params: { taskId: number }) => {
      const { listTodos } = await import("../db/todos.ts");
      return listTodos(params.taskId);
    },
  };
}

// ─── Shared helpers for file diff content ────────────────────────────────────

async function readFileDiffContent(
  db: ReturnType<typeof getDb>,
  taskId: number,
  worktreePath: string,
  filePath: string,
): Promise<FileDiffContent> {
  let original = "";
  try {
    const headProc = Bun.spawn(["git", "show", `HEAD:${filePath}`], {
      cwd: worktreePath,
      stdout: "pipe",
      stderr: "pipe",
    });
    await headProc.exited;
    if (headProc.exitCode === 0) {
      original = await new Response(headProc.stdout).text();
    }
  } catch { /* new file */ }

  let modified = "";
  try {
    const file = Bun.file(`${worktreePath}/${filePath}`);
    if (await file.exists()) {
      modified = await file.text();
    }
  } catch { /* deleted file */ }

  // Parse git diff to get hunk metadata + hashes
  let hunks: HunkWithDecisions[] = [];
  try {
    const diffProc = Bun.spawn(["git", "diff", "HEAD", "--", filePath], {
      cwd: worktreePath,
      stdout: "pipe",
      stderr: "pipe",
    });
    await diffProc.exited;
    const diffOutput = await new Response(diffProc.stdout).text();
    if (diffOutput.trim()) {
      const parsed = parseGitDiffHunks(diffOutput, filePath);
      // Join with decisions from DB for the human reviewer
      const decisionRows = db
        .query<{ hunk_hash: string; reviewer_type: string; reviewer_id: string; decision: string; comment: string | null }, [number, string]>(
          "SELECT hunk_hash, reviewer_type, reviewer_id, decision, comment FROM task_hunk_decisions WHERE task_id = ? AND file_path = ?",
        )
        .all(taskId, filePath);
      const decisionMap = new Map<string, { reviewerType: string; reviewerId: string; decision: string; comment: string | null }[]>();
      for (const row of decisionRows) {
        const existing = decisionMap.get(row.hunk_hash) ?? [];
        existing.push({ reviewerType: row.reviewer_type, reviewerId: row.reviewer_id, decision: row.decision, comment: row.comment });
        decisionMap.set(row.hunk_hash, existing);
      }

      hunks = parsed.map((h) => {
        const allDecisions = decisionMap.get(h.hash) ?? [];
        const decisions: ReviewerDecision[] = allDecisions.map((d) => ({
          reviewerId: d.reviewerId,
          reviewerType: d.reviewerType as "human" | "ai",
          decision: d.decision as HunkDecision,
          comment: d.comment,
        }));
        const humanDecisionRow = allDecisions.find((d) => d.reviewerId === "user");
        return {
          hash: h.hash,
          hunkIndex: h.hunkIndex,
          originalStart: h.originalStart,
          originalEnd: h.originalEnd,
          modifiedStart: h.modifiedStart,
          modifiedEnd: h.modifiedEnd,
          modifiedContentStart: h.modifiedContentStart,
          modifiedContentEnd: h.modifiedContentEnd,
          originalContentStart: h.originalContentStart,
          originalContentEnd: h.originalContentEnd,
          decisions,
          humanDecision: (humanDecisionRow?.decision ?? "pending") as HunkDecision,
          humanComment: humanDecisionRow?.comment ?? null,
        };
      });
    } else if (!original && modified) {
      // Untracked file (never `git add`ed): no diff from git, but file exists on disk.
      // Synthesize a single hunk covering the whole file so the review UI can show it.
      const modifiedLines = modified.split("\n");
      const hash = computeHunkHash(filePath, [], modifiedLines);
      const humanDecisionRow = db
        .query<{ decision: string; comment: string | null }, [number, string]>(
          "SELECT decision, comment FROM task_hunk_decisions WHERE task_id = ? AND hunk_hash = ? AND reviewer_id = 'user' LIMIT 1",
        )
        .get(taskId, hash);
      hunks = [{
        hash,
        hunkIndex: 0,
        originalStart: 0,
        originalEnd: 0,
        modifiedStart: 1,
        modifiedEnd: modifiedLines.length,
        modifiedContentStart: 1,
        modifiedContentEnd: modifiedLines.length,
        originalContentStart: 0,
        originalContentEnd: 0,
        decisions: humanDecisionRow
          ? [{ reviewerId: "user", reviewerType: "human", decision: humanDecisionRow.decision as HunkDecision, comment: humanDecisionRow.comment }]
          : [],
        humanDecision: (humanDecisionRow?.decision ?? "pending") as HunkDecision,
        humanComment: humanDecisionRow?.comment ?? null,
      }];
    }
  } catch { /* ignore diff parse errors */ }

  return { original, modified, hunks };
}

// ─── Hunk hash computation ───────────────────────────────────────────────────

function computeHunkHash(filePath: string, originalLines: string[], modifiedLines: string[]): string {
  return createHash("sha256")
    .update(filePath + "\0" + originalLines.join("\n") + "\0" + modifiedLines.join("\n"))
    .digest("hex");
}

// ─── Git diff hunk parser ────────────────────────────────────────────────────

interface ParsedHunk {
  hash: string;
  hunkIndex: number;
  originalStart: number;
  originalEnd: number;
  modifiedStart: number;
  modifiedEnd: number;
  /** First/last "+" line in the modified file (excluding context). Both 0 for pure deletions. */
  modifiedContentStart: number;
  modifiedContentEnd: number;
  /** First/last "-" line in the original file (excluding context). Both 0 for pure additions. */
  originalContentStart: number;
  originalContentEnd: number;
}

function parseGitDiffHunks(diffOutput: string, filePath: string): ParsedHunk[] {
  const lines = diffOutput.split("\n");
  const result: ParsedHunk[] = [];
  let hunkIndex = 0;

  // Regex: @@ -<orig_start>,<orig_count> +<mod_start>,<mod_count> @@
  const hhRe = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

  let i = 0;
  while (i < lines.length) {
    const m = hhRe.exec(lines[i]);
    if (!m) { i++; continue; }

    const origStart = parseInt(m[1], 10);
    const origCount = m[2] !== undefined ? parseInt(m[2], 10) : 1;
    const modStart = parseInt(m[3], 10);
    const modCount = m[4] !== undefined ? parseInt(m[4], 10) : 1;

    // Collect lines of this hunk (until next @@ or end)
    const hunkBodyLines: string[] = [];
    i++;
    while (i < lines.length && !hhRe.test(lines[i])) {
      hunkBodyLines.push(lines[i]);
      i++;
    }

    const originalLines = hunkBodyLines.filter((l) => l.startsWith("-") || l.startsWith(" ")).map((l) => l.slice(1));
    const modifiedLines = hunkBodyLines.filter((l) => l.startsWith("+") || l.startsWith(" ")).map((l) => l.slice(1));
    const hash = computeHunkHash(filePath, originalLines, modifiedLines);

    // Compute content ranges: first/last actual +/- lines, excluding surrounding context.
    // These are used by correlateHunks in the frontend to correctly place action bar zones.
    let origI = origStart;
    let modI = modStart;
    let modifiedContentStart = 0, modifiedContentEnd = 0;
    let originalContentStart = 0, originalContentEnd = 0;
    for (const line of hunkBodyLines) {
      if (line.startsWith("+")) {
        if (modifiedContentStart === 0) modifiedContentStart = modI;
        modifiedContentEnd = modI;
        modI++;
      } else if (line.startsWith("-")) {
        if (originalContentStart === 0) originalContentStart = origI;
        originalContentEnd = origI;
        origI++;
      } else if (line.startsWith(" ")) {
        modI++;
        origI++;
      }
    }

    result.push({
      hash,
      hunkIndex,
      originalStart: origStart,
      originalEnd: origStart + origCount - 1,
      modifiedStart: modStart,
      modifiedEnd: modStart + modCount - 1,
      modifiedContentStart,
      modifiedContentEnd,
      originalContentStart,
      originalContentEnd,
    });
    hunkIndex++;
  }

  return result;
}

// ─── Hunk patch extraction helper ───────────────────────────────────────────

function extractHunkPatch(diffOutput: string, hunkIndex: number, filePath: string): string {
  const lines = diffOutput.split("\n");

  // Find the file header lines (--- and +++ lines)
  let headerLines: string[] = [];
  let hunkStarts: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("--- ") || line.startsWith("+++ ")) {
      headerLines.push(line);
    } else if (line.startsWith("@@ ")) {
      hunkStarts.push(i);
    }
  }

  if (hunkIndex >= hunkStarts.length) {
    throw new Error(`Hunk index ${hunkIndex} out of range (${hunkStarts.length} hunks found)`);
  }

  const hunkStart = hunkStarts[hunkIndex];
  const hunkEnd = hunkIndex + 1 < hunkStarts.length ? hunkStarts[hunkIndex + 1] : lines.length;
  const hunkLines = lines.slice(hunkStart, hunkEnd);

  // Build a minimal patch with just this hunk
  const patch = [
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
    ...hunkLines,
    "",
  ].join("\n");

  return patch;
}
