import type { Database } from "bun:sqlite";
import type { Task, ConversationMessage } from "../../shared/rpc-types.ts";
import type { TaskRow } from "../db/row-types.ts";
import { mapTask } from "../db/mappers.ts";
import {
  estimateContextWarning,
  estimateContextUsage,
} from "../conversation/context.ts";
import { appendMessage } from "../conversation/messages.ts";
import { readSessionMemory } from "../workflow/session-memory.ts";
import { runWithConfig } from "../config/index.ts";
import { triggerWorktreeIfNeeded, registerProjectGitContext, removeWorktree } from "../git/worktree.ts";
import { taskLspRegistry } from "../lsp/task-registry.ts";
import type { OnTaskUpdated } from "../engine/types.ts";
import type { ExecutionCoordinator } from "../engine/coordinator.ts";
import { getBoardWorkspaceKey, getTaskWorkspaceKey, getWorkspaceConfig } from "../workspace-context.ts";
import { getLoadedProjectByKey } from "../project-store.ts";
import { resolveContextWindow } from "../context-usage.ts";
import { prepareMessageForEngine } from "../utils/attachment-routing.ts";
import { validateTransition } from "../workflow/transition-validator.ts";
import { PositionService } from "./position-service.ts";

// ─── Helper: assert orchestrator is initialised ──────────────────────────────

function requireOrchestrator(o: ExecutionCoordinator | null): ExecutionCoordinator {
  if (!o) throw new Error("Engine not initialized — check workspace config");
  return o;
}

// ─── Helper: fetch a single task with git context + execution count ───────────

function fetchTaskWithDetail(db: Database, taskId: number): Task | null {
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

export function taskHandlers(db: Database, orchestrator: ExecutionCoordinator | null, onTaskUpdated: OnTaskUpdated) {
  const positionService = new PositionService(db);
  return {
    "tasks.list": async (params: { boardId: number }): Promise<Task[]> => {
      return db
        .query<TaskRow, [number]>(
          `SELECT t.*,
                  gc.worktree_status, gc.branch_name, gc.worktree_path,
                  (SELECT COUNT(*) FROM executions WHERE task_id = t.id) AS execution_count
           FROM tasks t
           LEFT JOIN task_git_context gc ON gc.task_id = t.id
           WHERE t.board_id = ?
           ORDER BY t.position ASC`,
        )
        .all(params.boardId)
        .map(mapTask);
    },

    "tasks.reorder": async (params: { taskId: number; position: number }): Promise<Task> => {
      db.run("UPDATE tasks SET position = ? WHERE id = ?", [params.position, params.taskId]);
      const boardRow = db.query<{ board_id: number; workflow_state: string }, [number]>(
        "SELECT board_id, workflow_state FROM tasks WHERE id = ?",
      ).get(params.taskId);
      if (boardRow) {
        positionService.rebalanceColumnPositions(boardRow.board_id, boardRow.workflow_state);
      }
      const task = fetchTaskWithDetail(db, params.taskId);
      if (!task) throw new Error(`Task ${params.taskId} not found`);
      return task;
    },

    "tasks.reorderColumn": async (params: { boardId: number; columnId: string; taskIds: number[] }): Promise<void> => {
      positionService.reorderColumn(params.boardId, params.taskIds);
    },

    "tasks.create": async (params: {
      boardId: number;
      projectKey: string;
      title: string;
      description: string;
    }): Promise<Task> => {

      const workspaceKey = getBoardWorkspaceKey(params.boardId);
      const project = getLoadedProjectByKey(workspaceKey, params.projectKey);
      if (!project) {
        throw new Error(`Project ${params.projectKey} not found in workspace ${workspaceKey}`);
      }

      // Create conversation first with placeholder task_id=0
      const convResult = db.run("INSERT INTO conversations (task_id) VALUES (0)");
      const conversationId = convResult.lastInsertRowid as number;

      const engineModel = (() => {
        const engine = getWorkspaceConfig(workspaceKey).engine;
        return "model" in engine ? (engine.model || null) : null;
      })();

      const taskResult = engineModel
        ? db.run(
            `INSERT INTO tasks
               (board_id, project_key, title, description, workflow_state, execution_state, conversation_id, position, model)
             VALUES (?, ?, ?, ?, 'backlog', 'idle', ?,
               COALESCE((SELECT MAX(position) FROM tasks WHERE board_id = ? AND workflow_state = 'backlog'), 0) + 1000, ?)`,
            [
              params.boardId,
              params.projectKey,
              params.title.trim(),
              params.description.trim(),
              conversationId,
              params.boardId,
              engineModel,
            ],
          )
        : db.run(
            `INSERT INTO tasks
               (board_id, project_key, title, description, workflow_state, execution_state, conversation_id, position)
             VALUES (?, ?, ?, ?, 'backlog', 'idle', ?,
               COALESCE((SELECT MAX(position) FROM tasks WHERE board_id = ? AND workflow_state = 'backlog'), 0) + 1000)`,
            [
              params.boardId,
              params.projectKey,
              params.title.trim(),
              params.description.trim(),
              conversationId,
              params.boardId,
            ],
          );
      const taskId = taskResult.lastInsertRowid as number;

      // Fix up conversation → task link
      db.run("UPDATE conversations SET task_id = ? WHERE id = ?", [taskId, conversationId]);

      // Register git context for this task so tool calling works (best-effort)
      try {
        if (project.gitRootPath) {
          registerProjectGitContext(taskId, project.gitRootPath);
        }
      } catch (err) {
        console.warn("[railyn] failed to register git context for task", taskId, err);
      }

      // Seed conversation with task description as first system message
      appendMessage(db, 
        taskId,
        conversationId,
        "system",
        null,
        `Task: ${params.title}\n\n${params.description}`,
      );

      const row = db
        .query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?")
        .get(taskId)!;

      onTaskUpdated(mapTask(row));
      return mapTask(row);
    },

    "tasks.transition": async (params: {
      taskId: number;
      toState: string;
      targetPosition?: number;
    }): Promise<{ task: Task; executionId: number | null }> => {


      const validation = validateTransition(db, params.taskId, params.toState);
      if (!validation.ok) {
        throw new Error(validation.reason);
      }

      // Update position before transition so the orchestrator sees it immediately.
      // When no targetPosition is provided, default to the top of the target column
      // (MIN(position) / 2, or 500 when the column is empty).
      if (params.targetPosition != null) {
        db.run("UPDATE tasks SET position = ? WHERE id = ?", [params.targetPosition, params.taskId]);
      } else {
        const minRow = db
          .query<{ min_pos: number | null }, [string, number]>(
            "SELECT MIN(position) as min_pos FROM tasks WHERE board_id = (SELECT board_id FROM tasks WHERE id = ?) AND workflow_state = ?",
          )
          .get(params.taskId, params.toState);
        const topPos = minRow?.min_pos != null ? minRow.min_pos / 2 : 500;
        db.run("UPDATE tasks SET position = ? WHERE id = ?", [topPos, params.taskId]);
      }
      if (validation.ok) {
        positionService.rebalanceColumnPositions(validation.boardId, params.toState);
      }

      const taskRow = db
        .query<{ project_key: string; conversation_id: number }, [number]>(
          "SELECT project_key, conversation_id FROM tasks WHERE id = ?",
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
        const wsKey = getTaskWorkspaceKey(params.taskId);
        const project = getLoadedProjectByKey(wsKey, taskRow.project_key);
        if (project?.gitRootPath) {
          registerProjectGitContext(params.taskId, project.gitRootPath);
        }

        const postStatus = (msg: string) => {
          // Do NOT call onTaskUpdated here: the DB row still carries the old
          // workflow_state while the worktree is being created (executeTransition
          // hasn't run yet). Broadcasting the stale row causes the UI card to
          // bounce back to the source column and then re-animate to the target.
          // The authoritative state update is pushed at the end of the RPC via
          // orchestrator.executeTransition → onTaskUpdated.
          appendMessage(db, params.taskId, convId!, "system", null, msg);
        };

        try {
          await triggerWorktreeIfNeeded(params.taskId, postStatus);
        } catch (err) {
          // Worktree is required — fail the task so the user sees the error in the UI
          const errMsg = err instanceof Error ? err.message : String(err);
          db.run("UPDATE tasks SET execution_state = 'failed' WHERE id = ?", [params.taskId]);
          appendMessage(db, 
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

      return requireOrchestrator(orchestrator).executeTransition(params.taskId, params.toState);
    },

    "tasks.sendMessage": async (params: {
      taskId: number;
      content: string;
      engineContent?: string;
      attachments?: import("../../shared/rpc-types.ts").Attachment[];
    }): Promise<{ message: ConversationMessage; executionId: number }> => {
      // Check if content is a code review trigger
      let parsed: { _type?: string; manualEdits?: import("../../shared/rpc-types.ts").ManualEdit[] } | null = null;
      try {
        parsed = JSON.parse(params.content) as typeof parsed;
      } catch { /* not JSON — treat as plain text */ }
      if (parsed?._type === "code_review") {
        return requireOrchestrator(orchestrator).executeCodeReview(params.taskId, parsed.manualEdits);
      }

      const taskWorkspaceKey = getTaskWorkspaceKey(params.taskId);
      const taskRow2 = db.query<{ model: string | null }, [number]>("SELECT model FROM tasks WHERE id = ?").get(params.taskId);
      const resolvedCtxWindow = taskRow2?.model
        ? await resolveContextWindow(taskRow2.model, taskWorkspaceKey, orchestrator)
        : 128_000;
      const warning = estimateContextWarning(db, params.taskId, resolvedCtxWindow);
      if (warning) {
        console.warn(`[railyn] context warning for task ${params.taskId}: ${warning}`);
      }
      const { extractChips } = await import("../../mainview/utils/chat-chips.ts");
      const promptContent = params.engineContent ?? extractChips(params.content).humanText;
      const engine = getWorkspaceConfig(taskWorkspaceKey).engine.type;
      const prepared = await prepareMessageForEngine(engine, promptContent, params.attachments);

      return requireOrchestrator(orchestrator).executeHumanTurn(params.taskId, params.content, prepared.attachments, prepared.content);
    },

    "tasks.retry": async (params: {
      taskId: number;
    }): Promise<{ task: Task; executionId: number }> => {


      // Retry worktree setup if it previously failed — same logic as tasks.transition
      const taskRow = db
        .query<{ project_key: string; conversation_id: number }, [number]>(
          "SELECT project_key, conversation_id FROM tasks WHERE id = ?",
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

        const wsKey = getTaskWorkspaceKey(params.taskId);
        const project = getLoadedProjectByKey(wsKey, taskRow.project_key);
        if (project?.gitRootPath) {
          registerProjectGitContext(params.taskId, project.gitRootPath);
        }

        const postStatus = (msg: string) => {
          appendMessage(db, params.taskId, retryConvId!, "system", null, msg);
          const updated = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(params.taskId);
          if (updated) onTaskUpdated(mapTask(updated));
        };

        try {
          await triggerWorktreeIfNeeded(params.taskId, postStatus);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          db.run("UPDATE tasks SET execution_state = 'failed' WHERE id = ?", [params.taskId]);
          appendMessage(db, params.taskId, retryConvId!, "system", null, `Worktree setup failed: ${errMsg}`);
          const failedRow = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(params.taskId)!;
          onTaskUpdated(mapTask(failedRow));
          // Return a fake execution id of -1 since we can't proceed — caller won't use it
          return { task: mapTask(failedRow), executionId: -1 };
        }
      }

      return requireOrchestrator(orchestrator).executeRetry(params.taskId);
    },

    // ─── tasks.setModel ──────────────────────────────────────────────────────
    "tasks.setModel": async (params: { taskId: number; model: string | null }): Promise<Task> => {

      db.run("UPDATE tasks SET model = ? WHERE id = ?", [params.model, params.taskId]);
      const task = fetchTaskWithDetail(db, params.taskId);
      if (!task) throw new Error(`Task ${params.taskId} not found`);
      return task;
    },

    // ─── tasks.contextUsage ──────────────────────────────────────────────────
    "tasks.contextUsage": async (params: { taskId: number }): Promise<{ usedTokens: number; maxTokens: number; fraction: number }> => {

      const task = db.query<{ model: string | null }, [number]>("SELECT model FROM tasks WHERE id = ?").get(params.taskId);
      const taskModel = task?.model ?? null;
      const workspaceKey = getTaskWorkspaceKey(params.taskId);
      const workspaceConfig = getWorkspaceConfig(workspaceKey);
      const maxTokens = await runWithConfig(workspaceConfig, async () => (
        taskModel
          ? resolveContextWindow(taskModel, workspaceKey, orchestrator)
          : Promise.resolve(128_000)
      ));
      return estimateContextUsage(db, params.taskId, maxTokens);
    },

    // ─── tasks.compact ───────────────────────────────────────────────────────
    "tasks.compact": async (params: { taskId: number }): Promise<void> => {
      await requireOrchestrator(orchestrator).compactTask(params.taskId);
    },

    // ─── tasks.cancel ────────────────────────────────────────────────────────
    "tasks.cancel": async (params: { taskId: number }): Promise<Task> => {

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

      const taskRow = db
        .query<{ workflow_state: string }, [number]>(
          "SELECT workflow_state FROM tasks WHERE id = ?",
        )
        .get(params.taskId);
      if (!taskRow) throw new Error(`Task ${params.taskId} not found`);
      // Only allow editing if the task is in the backlog column
      if (taskRow.workflow_state !== "backlog") {
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
      db.transaction(() => {
        db.run("DELETE FROM task_hunk_decisions WHERE task_id = ?", [params.taskId]);
        db.run("DELETE FROM conversation_messages WHERE task_id = ?", [params.taskId]);
        db.run("DELETE FROM executions WHERE task_id = ?", [params.taskId]);
        db.run("DELETE FROM task_git_context WHERE task_id = ?", [params.taskId]);
        db.run("DELETE FROM tasks WHERE id = ?", [params.taskId]);
        if (row?.conversation_id) {
          db.run("DELETE FROM conversations WHERE id = ?", [row.conversation_id]);
        }
      })();
      taskLspRegistry.releaseTask(params.taskId).catch(() => { });

      return { success: true, ...(warning ? { warning } : {}) };
    },

    // ─── tasks.sessionMemory ─────────────────────────────────────────────────
    // ─── tasks.sessionMemory ─────────────────────────────────────────────────
    "tasks.sessionMemory": async (params: { taskId: number }): Promise<{ content: string | null }> => {
      return { content: readSessionMemory(params.taskId) };
    },

    // ─── tasks.respondShellApproval ──────────────────────────────────────────
    "tasks.respondShellApproval": async (params: { taskId: number; decision: "approve_once" | "approve_all" | "deny" }): Promise<{ ok: boolean }> => {
      if (!orchestrator) return { ok: false };
      await orchestrator.respondShellApproval(params.taskId, params.decision);
      return { ok: true };
    },

    // ─── tasks.setShellAutoApprove ────────────────────────────────────────────
    "tasks.setShellAutoApprove": async (params: { taskId: number; enabled: boolean }): Promise<Task> => {

      db.run("UPDATE tasks SET shell_auto_approve = ? WHERE id = ?", [params.enabled ? 1 : 0, params.taskId]);
      const updated = fetchTaskWithDetail(db, params.taskId);
      if (!updated) throw new Error(`Task ${params.taskId} not found`);
      onTaskUpdated(updated);
      return updated;
    },

  };
}

