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
import type { WorktreeManager } from "../git/WorktreeManager.ts";
import { taskLspRegistry } from "../lsp/task-registry.ts";
import type { OnTaskUpdated } from "../engine/types.ts";
import type { ExecutionCoordinator } from "../engine/coordinator.ts";
import type { IWorkspaceRepository } from "../db/workspace-repository.ts";
import { getWorkspaceConfig } from "../workspace-context.ts";
import { getLoadedProjectByKey } from "../project-store.ts";
import { resolveContextWindow } from "../context-usage.ts";
import { prepareMessageForEngine } from "../utils/attachment-routing.ts";
import { validateTransition } from "../workflow/transition-validator.ts";
import { getColumnConfig } from "../workflow/column-config.ts";
import { PositionService } from "./position-service.ts";
import { seedConversationModel } from "../engine/execution/model-resolver";
import { DecisionRepository } from "../db/repositories/decision-repository.ts";

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
              (SELECT COUNT(*) FROM executions e WHERE e.task_id = t.id) AS execution_count,
              c.model AS conversation_model
       FROM tasks t 
       LEFT JOIN task_git_context gc ON gc.task_id = t.id
       LEFT JOIN conversations c ON c.id = t.conversation_id
       WHERE t.id = ?`,
    )
    .get(taskId);
  return row ? mapTask(row) : null;
}

export function taskHandlers(db: Database, wsRepo: IWorkspaceRepository, orchestrator: ExecutionCoordinator | null, onTaskUpdated: OnTaskUpdated, worktreeManager: WorktreeManager) {
  const positionService = new PositionService(db);
  return {
    "tasks.list": async (params: { boardId: number }): Promise<Task[]> => {
      return db
        .query<TaskRow, [number]>(
          `SELECT t.*,
                  gc.worktree_status, gc.branch_name, gc.worktree_path,
                  c.model AS conversation_model,
                  (SELECT COUNT(*) FROM executions WHERE task_id = t.id) AS execution_count
           FROM tasks t
           LEFT JOIN task_git_context gc ON gc.task_id = t.id
           LEFT JOIN conversations c ON c.id = t.conversation_id
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

      const workspaceKey = wsRepo.getBoardWorkspaceKey(params.boardId);
      const project = getLoadedProjectByKey(workspaceKey, params.projectKey);
      if (!project) {
        throw new Error(`Project ${params.projectKey} not found in workspace ${workspaceKey}`);
      }

      // Create conversation first with placeholder task_id=0
      const convResult = db.run("INSERT INTO conversations (task_id) VALUES (0)");
      const conversationId = convResult.lastInsertRowid as number;

      // Seed conversation model with workspace default (if configured)
      seedConversationModel(db, conversationId, params.boardId, wsRepo);

      // Note: No automatic model seeding in new architecture
      // Model must be explicitly set via tasks.setModel after creation

      const taskResult = db.run(
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
          worktreeManager.registerContext(taskId, project.gitRootPath);
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

      const row = fetchTaskWithDetail(db, taskId);
      if (!row) throw new Error(`Task ${taskId} not found after creation`);

      onTaskUpdated(row);
      return row;
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
          .query<{ min_pos: number | null }, [number, string]>(
            "SELECT MIN(position) as min_pos FROM tasks WHERE board_id = (SELECT board_id FROM tasks WHERE id = ?) AND workflow_state = ?",
          )
          .get(params.taskId, params.toState);
        const topPos = minRow?.min_pos != null ? minRow.min_pos / 2 : 500;
        db.run("UPDATE tasks SET position = ? WHERE id = ?", [topPos, params.taskId]);
      }
      if (validation.ok) {
        positionService.rebalanceColumnPositions(validation.boardId, params.toState);
      }

      // ── Deferred-path: running task ──────────────────────────────────────────
      // If the task is currently executing, skip worktree setup and orchestrator.
      // Just update the workflow_state and set needs_column_prompt if the target
      // column has an on_enter_prompt. The StreamProcessor drain will fire the
      // column prompt once the current execution completes.
      const runningCheck = db
        .query<{ execution_state: string; board_id: number; conversation_id: number | null }, [number]>(
          "SELECT execution_state, board_id, conversation_id FROM tasks WHERE id = ?",
        )
        .get(params.taskId);

      if (runningCheck?.execution_state === "running") {
        const fromStateRow = db
          .query<{ workflow_state: string }, [number]>("SELECT workflow_state FROM tasks WHERE id = ?")
          .get(params.taskId);
        const fromState = fromStateRow?.workflow_state ?? params.toState;

        db.run(
          "UPDATE tasks SET workflow_state = ? WHERE id = ?",
          [params.toState, params.taskId],
        );

        const wsKey = wsRepo.getBoardWorkspaceKey(runningCheck.board_id);
        const config = getWorkspaceConfig(wsKey);
        const col = getColumnConfig(config, runningCheck.board_id, params.toState);
        if (col?.on_enter_prompt) {
          db.run("UPDATE tasks SET needs_column_prompt = 1 WHERE id = ?", [params.taskId]);
        }

        const convId = runningCheck.conversation_id;
        if (convId != null) {
          appendMessage(db, params.taskId, convId, "transition_event", null, "", {
            from: fromState,
            to: params.toState,
          } as unknown as Record<string, unknown>);
        }

        const deferredRow = fetchTaskWithDetail(db, params.taskId);
        if (!deferredRow) throw new Error(`Task ${params.taskId} not found`);
        onTaskUpdated(deferredRow);
        return { task: deferredRow, executionId: null };
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
        const wsKey = wsRepo.getTaskWorkspaceKey(params.taskId);
        const project = getLoadedProjectByKey(wsKey, taskRow.project_key);
        if (project?.gitRootPath) {
          worktreeManager.registerContext(params.taskId, project.gitRootPath);
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
          await worktreeManager.triggerWorktreeIfNeeded(params.taskId, postStatus);
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
          const failedRow = fetchTaskWithDetail(db, params.taskId);
          if (!failedRow) throw new Error(`Task ${params.taskId} not found`);
          onTaskUpdated(failedRow);
          return { task: failedRow, executionId: null };
        }
      }

      return requireOrchestrator(orchestrator).executeTransition(params.taskId, params.toState);
    }, 

    "tasks.sendMessage": async (params: {
      taskId: number;
      content: string;
      engineContent?: string;
      attachments?: import("../../shared/rpc-types.ts").Attachment[];
      decisionBatch?: { label?: string; records: import("../../shared/rpc-types.ts").DecisionInput[] };
    }): Promise<{ message: ConversationMessage; executionId: number }> => {
      // Check if content is a code review trigger
      type ParsedCodeReview = { _type?: string; manualEdits?: import("../../shared/rpc-types.ts").ManualEdit[] };
      let parsed: ParsedCodeReview | null = null;
      try {
        parsed = JSON.parse(params.content) as ParsedCodeReview;
      } catch { /* not JSON — treat as plain text */ }
      const codeReviewData = parsed;
      if (codeReviewData !== null && codeReviewData._type === "code_review") {
        return requireOrchestrator(orchestrator).executeCodeReview(params.taskId, codeReviewData.manualEdits);
      }

      const taskWorkspaceKey = wsRepo.getTaskWorkspaceKey(params.taskId);
      const taskRow2 = db.query<{ conversation_model: string | null }, [number]>(
        "SELECT c.model AS conversation_model FROM tasks t LEFT JOIN conversations c ON c.id = t.conversation_id WHERE t.id = ?"
      ).get(params.taskId);
      const resolvedCtxWindow = taskRow2?.conversation_model
        ? await resolveContextWindow(taskRow2.conversation_model, taskWorkspaceKey, orchestrator)
        : 128_000;
      const warning = estimateContextWarning(db, params.taskId, resolvedCtxWindow);
      if (warning) {
        console.warn(`[railyn] context warning for task ${params.taskId}: ${warning}`);
      }
      const { extractChips } = await import("../../mainview/utils/chat-chips.ts");
      const promptContent = params.engineContent ?? extractChips(params.content).humanText;
      const engine = getWorkspaceConfig(taskWorkspaceKey).engine.type;
      const prepared = await prepareMessageForEngine(engine, promptContent, params.attachments);

      const result = await requireOrchestrator(orchestrator).executeHumanTurn(params.taskId, params.content, prepared.attachments, prepared.content);

      if (params.decisionBatch) {
        const taskConvRow = db.query<{ conversation_id: number | null }, [number]>(
          "SELECT conversation_id FROM tasks WHERE id = ?"
        ).get(params.taskId);
        const conversationId = taskConvRow?.conversation_id;
        if (conversationId != null) {
          const decisionRepo = new DecisionRepository(db);
          const batch = decisionRepo.createBatch(conversationId, params.decisionBatch.label);
          for (const record of params.decisionBatch.records) {
            decisionRepo.createRecord(conversationId, {
              batchId: batch.id,
              question: record.question,
              answer: record.answer,
              weight: record.weight ?? "medium",
              notes: record.notes,
              isSourceAi: false,
            });
          }
        }
      }

      return result;
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

        const wsKey = wsRepo.getTaskWorkspaceKey(params.taskId);
        const project = getLoadedProjectByKey(wsKey, taskRow.project_key);
        if (project?.gitRootPath) {
          worktreeManager.registerContext(params.taskId, project.gitRootPath);
        }

        const postStatus = (msg: string) => {
          appendMessage(db, params.taskId, retryConvId!, "system", null, msg);
          const updated = fetchTaskWithDetail(db, params.taskId);
          if (updated) onTaskUpdated(updated);
        };

        try {
          await worktreeManager.triggerWorktreeIfNeeded(params.taskId, postStatus);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          db.run("UPDATE tasks SET execution_state = 'failed' WHERE id = ?", [params.taskId]);
          appendMessage(db, params.taskId, retryConvId!, "system", null, `Worktree setup failed: ${errMsg}`);
          const failedRow = fetchTaskWithDetail(db, params.taskId);
          if (!failedRow) throw new Error(`Task ${params.taskId} not found`);
          onTaskUpdated(failedRow);
          // Return a fake execution id of -1 since we can't proceed — caller won't use it
          return { task: failedRow, executionId: -1 };
        }
      }

      return requireOrchestrator(orchestrator).executeRetry(params.taskId);
    },

    // ─── tasks.setModel ──────────────────────────────────────────────────────
    "tasks.setModel": async (params: { taskId: number; model: string | null }): Promise<Task> => {
      const task = fetchTaskWithDetail(db, params.taskId);
      if (!task) throw new Error(`Task ${params.taskId} not found`);
      if (task.conversationId === null) {
        throw new Error(`Task ${params.taskId} has no conversation`);
      }
      db.run("UPDATE conversations SET model = ? WHERE id = ?", [params.model, task.conversationId]);
      // Return updated task with the new model
      return { ...task, model: params.model };
    },

    // ─── tasks.contextUsage ──────────────────────────────────────────────────
    "tasks.contextUsage": async (params: { taskId: number }): Promise<{ usedTokens: number; maxTokens: number; fraction: number }> => {

      const task = db
        .query<{ conversation_model: string | null }, [number]>(
          "SELECT c.model AS conversation_model FROM tasks t LEFT JOIN conversations c ON c.id = t.conversation_id WHERE t.id = ?",
        )
        .get(params.taskId);
      const taskModel = task?.conversation_model ?? null;
      const workspaceKey = wsRepo.getTaskWorkspaceKey(params.taskId);
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
    "tasks.delete": async (params: { taskId: number }): Promise<{ success: boolean; warning?: string }> => {


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
      const { warning } = await worktreeManager.removeWorktree(params.taskId);

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

