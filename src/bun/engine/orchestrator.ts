/**
 * Orchestrator — sits between RPC handlers and the active ExecutionEngine.
 *
 * For the native engine, the orchestrator delegates directly to the existing
 * callback-based functions in workflow/engine.ts (which handle all DB writes).
 *
 * For non-native engines (e.g. Copilot), the orchestrator builds ExecutionParams,
 * calls engine.execute(), and consumes the EngineEvent stream to drive DB writes
 * and RPC relay. This path is scaffolded here and completed in Task Group 5/7.
 */

import type { ExecutionEngine, EngineEvent, ExecutionParams, NativeExecutionType } from "./types.ts";
import { NativeEngine } from "./native/engine.ts";
import type { LoadedConfig } from "../config/index.ts";
import type { Task, ConversationMessage } from "../../shared/rpc-types.ts";
import type { ExecutionCoordinator } from "./coordinator.ts";
import type { OnToken, OnError, OnTaskUpdated, OnNewMessage, OnStreamEvent } from "../workflow/engine.ts";
import {
  handleTransition,
  handleHumanTurn,
  handleRetry,
  handleCodeReview,
  cancelExecution as nativeCancelExecution,
  resolveShellApproval,
  appendMessage,
  ensureTaskConversation,
} from "../workflow/engine.ts";
import { formatReviewMessageForLLM } from "../workflow/review.ts";
import { mapTask, mapConversationMessage } from "../db/mappers.ts";
import { getDb } from "../db/index.ts";
import type { TaskRow, ConversationMessageRow, TaskGitContextRow } from "../db/row-types.ts";
import { getProjectByKey } from "../project-store.ts";
import { runWithConfig } from "../config/index.ts";
import { resolveEngine } from "./resolver.ts";
import { getBoardWorkspaceKey, getDefaultWorkspaceKey, getTaskWorkspaceKey, getWorkspaceConfig } from "../workspace-context.ts";
import type { MessageType } from "../../shared/rpc-types.ts";

export class Orchestrator implements ExecutionCoordinator {
  private readonly injectedEngine: ExecutionEngine | null;
  private readonly onToken: OnToken;
  private readonly onError: OnError;
  private readonly onTaskUpdated: OnTaskUpdated;
  private readonly onNewMessage: OnNewMessage;
  private onStreamEvent?: OnStreamEvent;
  private readonly engines = new Map<string, ExecutionEngine>();

  /** Map of executionId → AbortController for managing cancellation */
  private readonly abortControllers = new Map<number, AbortController>();
  /** Per-execution sequence counter for raw model message ordering. */
  private readonly rawMessageSeq = new Map<number, number>();

  setOnStreamEvent(cb: OnStreamEvent): void {
    this.onStreamEvent = cb;
  }

  constructor(
    engine: ExecutionEngine,
    onToken: OnToken,
    onError: OnError,
    onTaskUpdated: OnTaskUpdated,
    onNewMessage: OnNewMessage,
  );
  constructor(
    onToken: OnToken,
    onError: OnError,
    onTaskUpdated: OnTaskUpdated,
    onNewMessage: OnNewMessage,
  );
  constructor(
    engineOrOnToken: ExecutionEngine | OnToken,
    onTokenOrOnError: OnToken | OnError,
    onErrorOrOnTaskUpdated: OnError | OnTaskUpdated,
    onTaskUpdatedOrOnNewMessage: OnTaskUpdated | OnNewMessage,
    maybeOnNewMessage?: OnNewMessage,
  ) {
    if (typeof engineOrOnToken === "object" && "execute" in engineOrOnToken) {
      this.injectedEngine = engineOrOnToken;
      this.onToken = onTokenOrOnError as OnToken;
      this.onError = onErrorOrOnTaskUpdated as OnError;
      this.onTaskUpdated = onTaskUpdatedOrOnNewMessage as OnTaskUpdated;
      this.onNewMessage = maybeOnNewMessage!;
      return;
    }
    this.injectedEngine = null;
    this.onToken = engineOrOnToken;
    this.onError = onTokenOrOnError as OnError;
    this.onTaskUpdated = onErrorOrOnTaskUpdated as OnTaskUpdated;
    this.onNewMessage = onTaskUpdatedOrOnNewMessage as OnNewMessage;
  }

  // ─── Engine type check ──────────────────────────────────────────────────────

  private isNativeEngine(engine: ExecutionEngine): boolean {
    return engine instanceof NativeEngine;
  }

  private getEngineForWorkspace(workspaceKey: string): { config: LoadedConfig; engine: ExecutionEngine } {
    const config = getWorkspaceConfig(workspaceKey);
    if (this.injectedEngine) {
      return { config, engine: this.injectedEngine };
    }
    let engine = this.engines.get(config.workspaceKey);
    if (!engine) {
      engine = resolveEngine(config, this.onTaskUpdated, this.onNewMessage);
      this.engines.set(config.workspaceKey, engine);
    }
    return { config, engine };
  }

  // ─── Execution dispatch ─────────────────────────────────────────────────────

  async executeTransition(
    taskId: number,
    toState: string,
  ): Promise<{ task: Task; executionId: number | null }> {
    const db = getDb();
    const task = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    const { config, engine } = this.getEngineForWorkspace(getBoardWorkspaceKey(task.board_id));
    if (this.isNativeEngine(engine)) {
      return runWithConfig(
        config,
        () => handleTransition(taskId, toState, this.onToken, this.onError, this.onTaskUpdated, this.onNewMessage, this.onStreamEvent),
      );
    }

    // Ensure conversation exists
    let conversationId = task.conversation_id;
    if (conversationId == null) {
      const convResult = db.run("INSERT INTO conversations (task_id) VALUES (?)", [taskId]);
      conversationId = convResult.lastInsertRowid as number;
      db.run("UPDATE tasks SET conversation_id = ? WHERE id = ?", [conversationId, taskId]);
    }

    const fromState = task.workflow_state;
    db.run("UPDATE tasks SET workflow_state = ? WHERE id = ?", [toState, taskId]);

    appendMessage(taskId, conversationId, "transition_event", null, "", { from: fromState, to: toState });

    const column = this._getColumnConfig(config, task.board_id, toState);

    // Resolve model from explicit task/column settings only.
    // Do not apply workspace default_model for non-native engines.
    const resolvedModel = column?.model ?? task.model ?? "";
    if (column?.model != null) {
      db.run("UPDATE tasks SET model = ? WHERE id = ?", [column.model, taskId]);
    } else if (resolvedModel) {
      db.run("UPDATE tasks SET model = ? WHERE id = ?", [resolvedModel, taskId]);
    }

    // No prompt → idle
    if (!column?.on_enter_prompt) {
      db.run("UPDATE tasks SET execution_state = 'idle' WHERE id = ?", [taskId]);
      const updated = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(taskId)!;
      return { task: mapTask(updated), executionId: null };
    }

    // Resolve on_enter_prompt
    const resolvedPrompt = column.on_enter_prompt;
    appendMessage(
      taskId,
      conversationId,
      "user",
      "prompt",
      resolvedPrompt,
    );

    const execResult = db.run(
      `INSERT INTO executions (task_id, from_state, to_state, prompt_id, status, attempt)
       VALUES (?, ?, ?, ?, 'running', 1)`,
      [taskId, fromState, toState, column.id],
    );
    const executionId = execResult.lastInsertRowid as number;
    db.run(
      "UPDATE tasks SET execution_state = 'running', current_execution_id = ? WHERE id = ?",
      [executionId, taskId],
    );

    const updatedRow = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(taskId)!;
    const execParams = this._buildExecutionParams(
      updatedRow,
      executionId,
      resolvedPrompt,
      column.stage_instructions,
      this._resolveWorkingDirectory(updatedRow),
      "transition",
      toState,
    );

    this._runNonNative(taskId, executionId, engine, execParams);
    return { task: mapTask(updatedRow), executionId };
  }

  async executeHumanTurn(
    taskId: number,
    content: string,
  ): Promise<{ message: ConversationMessage; executionId: number }> {
    const db = getDb();
    const task = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    const { config, engine } = this.getEngineForWorkspace(getTaskWorkspaceKey(taskId));
    if (this.isNativeEngine(engine)) {
      return runWithConfig(
        config,
        () => handleHumanTurn(taskId, content, this.onToken, this.onError, this.onTaskUpdated, this.onNewMessage, this.onStreamEvent),
      );
    }

    const conversationId = ensureTaskConversation(taskId, task.conversation_id);

    if (task.execution_state === "waiting_user" && task.current_execution_id != null) {
      const msgId = appendMessage(taskId, conversationId, "user", "user", content);
      db.run(
        "UPDATE tasks SET execution_state = 'running' WHERE id = ?",
        [taskId],
      );
      db.run(
        "UPDATE executions SET status = 'running', finished_at = NULL WHERE id = ?",
        [task.current_execution_id],
      );
      this.onTaskUpdated(mapTask(db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(taskId)!));
      try {
        await engine.resume(task.current_execution_id, { type: "ask_user", content });
        const msgRow = db
          .query<ConversationMessageRow, [number]>("SELECT * FROM conversation_messages WHERE id = ?")
          .get(msgId)!;
        return { message: mapConversationMessage(msgRow), executionId: task.current_execution_id };
      } catch {
        // The engine has no live session for this execution (e.g. process was restarted).
        // Roll back the optimistic state writes and fall through to start a fresh execution.
        // The user message is already saved — skip re-appending it below.
        db.run(
          "UPDATE executions SET status = 'failed', finished_at = datetime('now'), details = 'Engine session lost; restarted as new execution' WHERE id = ?",
          [task.current_execution_id],
        );
        db.run(
          "UPDATE tasks SET execution_state = 'waiting_user', current_execution_id = NULL WHERE id = ?",
          [taskId],
        );

        const column = this._getColumnConfig(config, task.board_id, task.workflow_state);
        const execResult = db.run(
          `INSERT INTO executions (task_id, from_state, to_state, prompt_id, status, attempt)
           VALUES (?, ?, ?, 'human-turn', 'running', ?)`,
          [taskId, task.workflow_state, task.workflow_state, task.retry_count + 1],
        );
        const newExecutionId = execResult.lastInsertRowid as number;
        db.run(
          "UPDATE tasks SET execution_state = 'running', current_execution_id = ? WHERE id = ?",
          [newExecutionId, taskId],
        );
        this.onTaskUpdated(mapTask(db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(taskId)!));

        const execParams = this._buildExecutionParams(
          task,
          newExecutionId,
          content,
          column?.stage_instructions,
          this._resolveWorkingDirectory(task),
          "human_turn",
        );
        this._runNonNative(taskId, newExecutionId, engine, execParams);

        const msgRow = db
          .query<ConversationMessageRow, [number]>("SELECT * FROM conversation_messages WHERE id = ?")
          .get(msgId)!;
        return { message: mapConversationMessage(msgRow), executionId: newExecutionId };
      }
    }

    const column = this._getColumnConfig(config, task.board_id, task.workflow_state);

    const execResult = db.run(
      `INSERT INTO executions (task_id, from_state, to_state, prompt_id, status, attempt)
       VALUES (?, ?, ?, 'human-turn', 'running', ?)`,
      [taskId, task.workflow_state, task.workflow_state, task.retry_count + 1],
    );
    const executionId = execResult.lastInsertRowid as number;
    db.run(
      "UPDATE tasks SET execution_state = 'running', current_execution_id = ? WHERE id = ?",
      [executionId, taskId],
    );
    this.onTaskUpdated(mapTask(db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(taskId)!));

    const resolvedPrompt = content;
    const msgId = appendMessage(
      taskId,
      conversationId,
      "user",
      "user",
      content,
    );

    const execParams = this._buildExecutionParams(
      task,
      executionId,
      resolvedPrompt,
      column?.stage_instructions,
      this._resolveWorkingDirectory(task),
      "human_turn",
    );
    this._runNonNative(taskId, executionId, engine, execParams);

    const msgRow = db
      .query<ConversationMessageRow, [number]>("SELECT * FROM conversation_messages WHERE id = ?")
      .get(msgId)!;
    return { message: mapConversationMessage(msgRow), executionId };
  }

  async executeRetry(
    taskId: number,
  ): Promise<{ task: Task; executionId: number }> {
    const db = getDb();
    const task = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    const { config, engine } = this.getEngineForWorkspace(getTaskWorkspaceKey(taskId));
    if (this.isNativeEngine(engine)) {
      return runWithConfig(
        config,
        () => handleRetry(taskId, this.onToken, this.onError, this.onTaskUpdated, this.onNewMessage, this.onStreamEvent),
      );
    }

    db.run("UPDATE tasks SET retry_count = retry_count + 1 WHERE id = ?", [taskId]);
    const attempt = (task.retry_count ?? 0) + 1;

    const column = this._getColumnConfig(config, task.board_id, task.workflow_state);
    const execResult = db.run(
      `INSERT INTO executions (task_id, from_state, to_state, prompt_id, status, attempt)
       VALUES (?, ?, ?, ?, 'running', ?)`,
      [taskId, task.workflow_state, task.workflow_state, column?.id ?? "retry", attempt],
    );
    const executionId = execResult.lastInsertRowid as number;
    db.run(
      "UPDATE tasks SET execution_state = 'running', current_execution_id = ? WHERE id = ?",
      [executionId, taskId],
    );
    appendMessage(taskId, task.conversation_id ?? 0, "system", null, `Retry attempt ${attempt}`);

    const updatedRow = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(taskId)!;

    const retryPrompt = column?.on_enter_prompt ?? "Please continue with the task.";

    const execParams = this._buildExecutionParams(
      updatedRow,
      executionId,
      retryPrompt,
      column?.stage_instructions,
      this._resolveWorkingDirectory(updatedRow),
      "retry",
    );
    this._runNonNative(taskId, executionId, engine, execParams);

    return { task: mapTask(updatedRow), executionId };
  }

  async executeCodeReview(
    taskId: number,
    manualEdits?: import("../../shared/rpc-types.ts").ManualEdit[],
  ): Promise<{ message: ConversationMessage; executionId: number }> {
    const db = getDb();
    const task = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    const { config, engine } = this.getEngineForWorkspace(getTaskWorkspaceKey(taskId));
    if (this.isNativeEngine(engine)) {
      return runWithConfig(
        config,
        () => handleCodeReview(taskId, this.onToken, this.onError, this.onTaskUpdated, this.onNewMessage, manualEdits, this.onStreamEvent),
      );
    }

    type DecisionRow = {
      hunk_hash: string;
      file_path: string;
      decision: string;
      comment: string | null;
      original_start: number;
      original_end: number;
      modified_start: number;
      modified_end: number;
    };
    type LineCommentRow = {
      id: number;
      file_path: string;
      line_start: number;
      line_end: number;
      line_text: string;
      context_lines: string;
      comment: string;
      reviewer_type: string;
    };

    const decisions = db
      .query<DecisionRow, [number]>(
        `SELECT hunk_hash, file_path, decision, comment, original_start, original_end, modified_start, modified_end
          FROM task_hunk_decisions
          WHERE task_id = ? AND reviewer_id = 'user' AND sent = 0
          ORDER BY file_path, modified_start`,
      )
      .all(taskId);
    const lineComments = db
      .query<LineCommentRow, [number]>(
        `SELECT id, file_path, line_start, line_end, line_text, context_lines, comment, reviewer_type
         FROM task_line_comments
         WHERE task_id = ? AND sent = 0
         ORDER BY file_path, line_start`,
      )
      .all(taskId);

    const gitRow = db
      .query<Pick<TaskGitContextRow, "worktree_path" | "worktree_status">, [number]>(
        "SELECT worktree_path, worktree_status FROM task_git_context WHERE task_id = ?",
      )
      .get(taskId);
    const worktreePath = gitRow?.worktree_status === "ready" ? (gitRow.worktree_path ?? "") : "";

    type HunkLines = { originalLines: string[]; modifiedLines: string[] };
    const diffCache = new Map<string, Map<string, HunkLines>>();
    const uniqueFiles = [...new Set(decisions.map((row) => row.file_path))];
    for (const filePath of uniqueFiles) {
      const hunkLineMap = new Map<string, HunkLines>();
      if (worktreePath) {
        try {
          const proc = Bun.spawn(["git", "diff", "HEAD", "--", filePath], {
            cwd: worktreePath,
            stdout: "pipe",
            stderr: "pipe",
          });
          await proc.exited;
          const diffOut = await new Response(proc.stdout).text();
          if (diffOut.trim()) {
            const hhRe = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
            const lines = diffOut.split("\n");
            let i = 0;
            while (i < lines.length) {
              if (!hhRe.test(lines[i])) { i++; continue; }
              i++;
              const body: string[] = [];
              while (i < lines.length && !hhRe.test(lines[i])) { body.push(lines[i]); i++; }
              const origL = body.filter((line) => line.startsWith("-") || line.startsWith(" ")).map((line) => line.slice(1));
              const modL = body.filter((line) => line.startsWith("+") || line.startsWith(" ")).map((line) => line.slice(1));
              const { createHash } = await import("node:crypto");
              const hash = createHash("sha256")
                .update(filePath + "\0" + origL.join("\n") + "\0" + modL.join("\n"))
                .digest("hex");
              hunkLineMap.set(hash, { originalLines: origL, modifiedLines: modL });
            }
          }
        } catch {
          // Ignore diff parsing failures; the fallback payload still includes ranges/comments.
        }
      }
      diffCache.set(filePath, hunkLineMap);
    }

    const fileMap = new Map<string, {
      hunks: import("../../shared/rpc-types.ts").CodeReviewHunk[];
      lineComments: import("../../shared/rpc-types.ts").LineComment[];
    }>();
    for (const row of decisions) {
      if (!fileMap.has(row.file_path)) fileMap.set(row.file_path, { hunks: [], lineComments: [] });
      const hunkLines = diffCache.get(row.file_path)?.get(row.hunk_hash) ?? { originalLines: [], modifiedLines: [] };
      fileMap.get(row.file_path)!.hunks.push({
        hunkIndex: 0,
        originalRange: [row.original_start, row.original_end],
        modifiedRange: [row.modified_start, row.modified_end],
        decision: row.decision as import("../../shared/rpc-types.ts").HunkDecision,
        comment: row.comment,
        originalLines: hunkLines.originalLines,
        modifiedLines: hunkLines.modifiedLines,
      });
    }
    for (const row of lineComments) {
      if (!fileMap.has(row.file_path)) fileMap.set(row.file_path, { hunks: [], lineComments: [] });
      fileMap.get(row.file_path)!.lineComments.push({
        id: row.id,
        filePath: row.file_path,
        lineStart: row.line_start,
        lineEnd: row.line_end,
        lineText: JSON.parse(row.line_text),
        contextLines: JSON.parse(row.context_lines),
        comment: row.comment,
        reviewerType: row.reviewer_type as "human" | "ai",
      });
    }

    const payload: import("../../shared/rpc-types.ts").CodeReviewPayload = {
      taskId,
      files: Array.from(fileMap.entries()).map(([path, data]) => ({ path, hunks: data.hunks, lineComments: data.lineComments })),
      manualEdits,
    };
    const reviewText = formatReviewMessageForLLM(payload);

    db.run(
      `UPDATE task_hunk_decisions SET sent = 1 WHERE task_id = ? AND reviewer_id = 'user' AND sent = 0`,
      [taskId],
    );
    db.run(
      `UPDATE task_line_comments SET sent = 1 WHERE task_id = ? AND sent = 0`,
      [taskId],
    );

    const reviewMsgId = appendMessage(taskId, task.conversation_id ?? 0, "code_review", "user", JSON.stringify(payload));
    appendMessage(taskId, task.conversation_id ?? 0, "user", "user", reviewText);

    const column = this._getColumnConfig(config, task.board_id, task.workflow_state);
    const execResult = db.run(
      `INSERT INTO executions (task_id, from_state, to_state, prompt_id, status, attempt)
       VALUES (?, ?, ?, 'code-review', 'running', ?)`,
      [taskId, task.workflow_state, task.workflow_state, task.retry_count + 1],
    );
    const executionId = execResult.lastInsertRowid as number;
    db.run(
      "UPDATE tasks SET execution_state = 'running', current_execution_id = ? WHERE id = ?",
      [executionId, taskId],
    );
    this.onTaskUpdated(mapTask(db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(taskId)!));

    const reviewMsgRow = db
      .query<ConversationMessageRow, [number]>("SELECT * FROM conversation_messages WHERE id = ?")
      .get(reviewMsgId)!;
    this.onNewMessage(mapConversationMessage(reviewMsgRow));

    const execParams = this._buildExecutionParams(
      task,
      executionId,
      reviewText,
      column?.stage_instructions,
      this._resolveWorkingDirectory(task),
      "code_review",
    );
    this._runNonNative(taskId, executionId, engine, execParams);

    return { message: mapConversationMessage(reviewMsgRow), executionId };
  }

  // ─── Cancellation ──────────────────────────────────────────────────────────

  cancel(executionId: number): void {
    const controller = this.abortControllers.get(executionId);
    if (controller) {
      controller.abort();
    }
    nativeCancelExecution(executionId);
    const db = getDb();
    const execRow = db.query<{ task_id: number; status: string; finished_at: string | null }, [number]>(
      "SELECT task_id, status, finished_at FROM executions WHERE id = ?",
    ).get(executionId);

    if (this.injectedEngine) {
      this.injectedEngine.cancel(executionId);
    }
    for (const engine of this.engines.values()) {
      engine.cancel(executionId);
    }

    if (!execRow) return;
    const { engine } = this.getEngineForWorkspace(getTaskWorkspaceKey(execRow.task_id));
    if (!this.isNativeEngine(engine) && execRow.status === "running" && execRow.finished_at == null) {
      db.run("UPDATE executions SET status = 'cancelled', finished_at = datetime('now') WHERE id = ?", [executionId]);
      db.run("UPDATE tasks SET execution_state = 'waiting_user' WHERE id = ?", [execRow.task_id]);
      const taskRow = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(execRow.task_id);
      if (taskRow) {
        this.onTaskUpdated(mapTask(taskRow));
      }
      this.onToken(execRow.task_id, executionId, "", true);
    }
  }

  // ─── Model listing ─────────────────────────────────────────────────────────

  listModels(workspaceKey?: string) {
    const { config, engine } = this.getEngineForWorkspace(workspaceKey ?? getDefaultWorkspaceKey());
    return runWithConfig(config, () => engine.listModels());
  }

  async shutdownNonNativeEngines(
    options: import("./types.ts").EngineShutdownOptions = { reason: "app-exit", deadlineMs: 3_000 },
  ): Promise<void> {
    const targets = new Set<ExecutionEngine>();
    if (this.injectedEngine) targets.add(this.injectedEngine);
    for (const engine of this.engines.values()) targets.add(engine);

    const shutdowns: Array<Promise<void>> = [];
    for (const engine of targets) {
      if (this.isNativeEngine(engine)) continue;
      if (!engine.shutdown) continue;
      shutdowns.push(engine.shutdown(options).catch((err) => {
        console.warn("[orchestrator] Non-native shutdown failed", {
          reason: options.reason,
          error: err instanceof Error ? err.message : String(err),
        });
      }));
    }

    await Promise.all(shutdowns);
  }

  // ─── Shell approval ─────────────────────────────────────────────────────────

  async respondShellApproval(
    taskId: number,
    decision: "approve_once" | "approve_all" | "deny",
  ): Promise<void> {
    const db = getDb();
    const task = db
      .query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?")
      .get(taskId);
    if (!task?.current_execution_id) return;

    const { config, engine } = this.getEngineForWorkspace(getTaskWorkspaceKey(taskId));
    if (this.isNativeEngine(engine)) {
      runWithConfig(config, () => resolveShellApproval(taskId, decision, this.onTaskUpdated));
      return;
    }

    await engine.resume(task.current_execution_id, { type: "shell_approval", decision });

    db.run("UPDATE tasks SET execution_state = 'running' WHERE id = ?", [taskId]);
    db.run(
      "UPDATE executions SET status = 'running', finished_at = NULL WHERE id = ?",
      [task.current_execution_id],
    );
    this.onTaskUpdated(mapTask(db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(taskId)!));
  }

  async compactTask(taskId: number): Promise<void> {
    const { engine } = this.getEngineForWorkspace(getTaskWorkspaceKey(taskId));
    if (!engine.compact) {
      throw new Error(`Engine for task ${taskId} does not support manual compaction`);
    }
    const db = getDb();
    const task = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    const workingDirectory = this._resolveWorkingDirectory(task);
    await engine.compact(taskId, workingDirectory);
  }

  // ─── Non-native engine helpers ─────────────────────────────────────────────

  private _getColumnConfig(config: LoadedConfig, boardId: number, columnId: string) {
    const db = getDb();
    const board = db
      .query<{ workflow_template_id: string }, [number]>(
        "SELECT workflow_template_id FROM boards WHERE id = ?",
      )
      .get(boardId);
    const templateId = board?.workflow_template_id ?? "delivery";
    const template = config.workflows.find((w) => w.id === templateId);
    return template?.columns.find((c) => c.id === columnId) ?? null;
  }

  private _resolveWorkingDirectory(task: TaskRow): string {
    const db = getDb();
    const gitRow = db
      .query<Pick<TaskGitContextRow, "worktree_path" | "worktree_status">, [number]>(
        "SELECT worktree_path, worktree_status FROM task_git_context WHERE task_id = ?",
      )
      .get(task.id);
    if (gitRow?.worktree_status === "ready" && gitRow.worktree_path) {
      return gitRow.worktree_path;
    }
    const workspaceKey = getTaskWorkspaceKey(task.id);
    const projectDirectory = getProjectByKey(workspaceKey, task.project_key)?.projectPath?.trim() ?? "";
    if (!projectDirectory) {
      throw new Error(`Project directory not found for project_key=${task.project_key}`);
    }
    return projectDirectory;
  }

  private _buildExecutionParams(
    task: TaskRow,
    executionId: number,
    prompt: string,
    systemInstructions: string | undefined,
    workingDirectory: string,
    nativeExecType: NativeExecutionType,
    toState?: string,
    signal?: AbortSignal,
  ): ExecutionParams {
    const controller = new AbortController();
    this.abortControllers.set(executionId, controller);

    // Prepend task title and description so the model always has context
    // about what it's working on (assembleMessages() is not called for non-native engines)
    const taskContext = [`## Task`, `**Title:** ${task.title}`];
    if (task.description?.trim()) {
      taskContext.push(`**Description:** ${task.description.trim()}`);
    }
    const fullSystemInstructions = systemInstructions
      ? `${taskContext.join("\n")}\n\n${systemInstructions}`
      : taskContext.join("\n");

    return {
      executionId,
      taskId: task.id,
      boardId: task.board_id,
      prompt,
      systemInstructions: fullSystemInstructions,
      workingDirectory,
      model: task.model ?? "",
      signal: signal ?? controller.signal,
      onRawModelMessage: (raw) => this._persistRawModelMessage(task.id, executionId, raw),
      nativeExecType,
      toState,
    };
  }

  private _persistRawModelMessage(
    taskId: number,
    executionId: number,
    raw: import("./types.ts").RawModelMessage,
  ): void {
    const db = getDb();
    const seq = (this.rawMessageSeq.get(executionId) ?? 0) + 1;
    this.rawMessageSeq.set(executionId, seq);

    const payloadJson = JSON.stringify(raw.payload);
    db.run(
      `INSERT INTO model_raw_messages
         (task_id, execution_id, engine, session_id, stream_seq, direction, event_type, event_subtype, payload_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        taskId,
        executionId,
        raw.engine,
        raw.sessionId ?? null,
        seq,
        raw.direction,
        raw.eventType,
        raw.eventSubtype ?? null,
        payloadJson,
      ],
    );

    // Retention policy: enforce inline at insert time.
    db.run(
      "DELETE FROM model_raw_messages WHERE created_at < datetime('now', '-1 day')",
    );
  }

  private _runNonNative(
    taskId: number,
    executionId: number,
    engine: ExecutionEngine,
    params: ExecutionParams,
  ): void {
    const stream = engine.execute(params);
    this.consumeStream(taskId, executionId, stream).catch((err) => {
      console.error(`[orchestrator] Unhandled error from consumeStream (task=${taskId}, execution=${executionId}):`, err);
    });
  }

  private _appendPromptMessage(
    taskId: number,
    conversationId: number,
    content: string,
  ): void {
    const msgId = appendMessage(
      taskId,
      conversationId,
      "ask_user_prompt" as MessageType,
      null,
      content,
    );
    this.onNewMessage({
      id: msgId,
      taskId,
      conversationId,
      type: "ask_user_prompt",
      role: null,
      content,
      metadata: null,
      createdAt: new Date().toISOString(),
    });
  }

  private _pauseExecution(taskId: number, executionId: number): void {
    const db = getDb();
    db.run("UPDATE tasks SET execution_state = 'waiting_user' WHERE id = ?", [taskId]);
    db.run(
      "UPDATE executions SET status = 'waiting_user', finished_at = NULL WHERE id = ?",
      [executionId],
    );
    this.onToken(taskId, executionId, "", true);
  }

  // ─── Event stream consumer (for non-native engines) ───────────────────────
  // Tasks 5.2: Persist tool calls/results, accumulate tokens → assistant message
  // Tasks 5.3: Manage AbortController lifecycle
  // Tasks 5.5: Update execution_state transitions
  // Tasks 5.6: Consume usage events and persist to executions

  /**
   * Consume an EngineEvent stream and drive DB writes + RPC relay.
   * Used by non-native engines that emit structured events instead of calling callbacks.
   *
   * State machine flow:
   * - start: set execution_state='running'
   * - tokens: accumulate → single "assistant" message
   * - tool_start/tool_result: persist individual messages
   * - usage: update execution token counts
   * - done: set execution_state='completed'
   * - error: set execution_state='failed', relay error
   */
  protected async consumeStream(
    taskId: number,
    executionId: number,
    stream: AsyncIterable<EngineEvent>,
  ): Promise<void> {
    const db = getDb();
    let tokenAccum = "";
    let reasoningAccum = "";
    let hadOutput = false; // true once any visible output (tokens, tools, prompts) is produced
    // Orchestrator context stack: callIds of open (non-internal) tool_start events.
    // Tokens/reasoning emitted while this is non-empty get parentBlockId = callStack.at(-1).
    const callStack: string[] = [];
    // Track the ID of the last reasoning block flushed before a tool_start, so that
    // tool_call events can be nested under the reasoning bubble in the UI.
    let reasoningBlockId: string | null = null;
    let reasoningFlushCount = 0;

    try {
      // Task 5.3: Use the AbortController registered by _buildExecutionParams.
      // Do NOT create a new one here — that would overwrite the registered controller
      // and break cancel(), which aborts the registered instance.
      const abortController = this.abortControllers.get(executionId) ?? (() => {
        const ctrl = new AbortController();
        this.abortControllers.set(executionId, ctrl);
        return ctrl;
      })();

      // Task 5.5: Set execution state to running
      db.run("UPDATE tasks SET execution_state = 'running' WHERE id = ?", [taskId]);
      db.run(
        "UPDATE executions SET status = 'running', started_at = datetime('now') WHERE id = ?",
        [executionId],
      );

      const taskRow = db
        .query<{ conversation_id: number | null }, [number]>(
          "SELECT conversation_id FROM tasks WHERE id = ?",
        )
        .get(taskId);
      const conversationId = taskRow?.conversation_id ?? 0;

      for await (const event of stream) {
        // Check for cancellation (Task 5.3)
        if (abortController.signal.aborted) {
          // Flush reasoningAccum before cancel so the reasoning bubble closes
          if (reasoningAccum) {
            const rCancelId = appendMessage(taskId, conversationId, "reasoning", null, reasoningAccum);
            this.onNewMessage({ id: rCancelId, taskId, conversationId, type: "reasoning", role: null, content: reasoningAccum, metadata: null, createdAt: new Date().toISOString() });
            this.onStreamEvent?.({ taskId, executionId, seq: 0, blockId: "", type: "reasoning", content: reasoningAccum, metadata: null, parentBlockId: callStack.at(-1) ?? null, done: false });
            reasoningAccum = "";
          }
          // Task 5.7: Flush tokenAccum before cancel to prevent text loss
          if (tokenAccum) {
            const cancelFlushId = appendMessage(taskId, conversationId, "assistant", "assistant", tokenAccum);
            this.onNewMessage({ id: cancelFlushId, taskId, conversationId, type: "assistant", role: "assistant", content: tokenAccum, metadata: null, createdAt: new Date().toISOString() });
            this.onStreamEvent?.({ taskId, executionId, seq: 0, blockId: "", type: "assistant", content: tokenAccum, metadata: null, parentBlockId: callStack.at(-1) ?? null, done: false });
            tokenAccum = "";
          }
          db.run("UPDATE tasks SET execution_state = 'waiting_user' WHERE id = ?", [taskId]);
          db.run(
            "UPDATE executions SET status = 'cancelled', finished_at = datetime('now') WHERE id = ?",
            [executionId],
          );
          this.onToken(taskId, executionId, "", true);
          this.onStreamEvent?.({ taskId, executionId, seq: 0, blockId: `${executionId}-done`, type: "done", content: "", metadata: null, parentBlockId: null, done: true });
          return;
        }

        switch (event.type) {
          case "token": {
            // Flush any accumulated reasoning before the first text token so the
            // batcher assigns the persisted "reasoning" event the same blockId as
            // the preceding reasoning_chunk events (batcher still on block "r").
            if (reasoningAccum) {
              const rFlushId = appendMessage(taskId, conversationId, "reasoning", null, reasoningAccum);
              this.onNewMessage({ id: rFlushId, taskId, conversationId, type: "reasoning", role: null, content: reasoningAccum, metadata: null, createdAt: new Date().toISOString() });
              this.onStreamEvent?.({ taskId, executionId, seq: 0, blockId: "", type: "reasoning", content: reasoningAccum, metadata: null, parentBlockId: callStack.at(-1) ?? null, done: false });
              reasoningAccum = "";
            }
            // Text tokens mean reasoning phase is over — clear reasoning context
            reasoningBlockId = null;
            // Task 5.2: Accumulate tokens for eventual assistant message
            tokenAccum += event.content;
            hadOutput = true;
            this.onToken(taskId, executionId, event.content, false);
            this.onStreamEvent?.({ taskId, executionId, seq: 0, blockId: "", type: "text_chunk", content: event.content, metadata: null, parentBlockId: callStack.at(-1) ?? null, done: false });
            break;
          }

          case "reasoning": {
            // Task 5.2: Accumulate reasoning separately
            reasoningAccum += event.content;
            this.onToken(taskId, executionId, event.content, false, true);
            this.onStreamEvent?.({ taskId, executionId, seq: 0, blockId: "", type: "reasoning_chunk", content: event.content, metadata: null, parentBlockId: callStack.at(-1) ?? null, done: false });
            break;
          }

          case "status": {
            // Persist for debugging, relay as ephemeral to UI
            appendMessage(taskId, conversationId, "status", null, event.message);
            this.onToken(taskId, executionId, event.message, false, false, true);
            this.onStreamEvent?.({ taskId, executionId, seq: 0, blockId: "", type: "status_chunk", content: event.message, metadata: null, parentBlockId: callStack.at(-1) ?? null, done: false });
            break;
          }

          case "tool_start": {
            if (event.isInternal) break;
            hadOutput = true;
            // Flush reasoningAccum before tool_call so the reasoning bubble closes in the right position
            if (reasoningAccum) {
              const rBlockId = `${executionId}-pre-r${++reasoningFlushCount}`;
              const rId = appendMessage(taskId, conversationId, "reasoning", null, reasoningAccum);
              this.onNewMessage({ id: rId, taskId, conversationId, type: "reasoning", role: null, content: reasoningAccum, metadata: null, createdAt: new Date().toISOString() });
              this.onStreamEvent?.({ taskId, executionId, seq: 0, blockId: rBlockId, type: "reasoning", content: reasoningAccum, metadata: null, parentBlockId: callStack.at(-1) ?? null, done: false });
              reasoningBlockId = rBlockId;
              reasoningAccum = "";
            }
            // Task 5.4: Flush tokenAccum BEFORE emitting tool_call to fix ordering bug
            if (tokenAccum) {
              const flushId = appendMessage(taskId, conversationId, "assistant", "assistant", tokenAccum);
              this.onNewMessage({ id: flushId, taskId, conversationId, type: "assistant", role: "assistant", content: tokenAccum, metadata: null, createdAt: new Date().toISOString() });
              this.onStreamEvent?.({ taskId, executionId, seq: 0, blockId: "", type: "assistant", content: tokenAccum, metadata: null, parentBlockId: callStack.at(-1) ?? null, done: false });
              tokenAccum = "";
            }
            const callId = event.callId ?? `call_${Date.now()}_${Math.random().toString(36).slice(2)}`;
            const toolCallMsg = JSON.stringify({
              type: "function",
              function: { name: event.name, arguments: event.arguments },
              id: callId,
              display: event.display,
            });
            const toolMeta = {
              parent_tool_call_id: event.parentCallId ?? null,
            };
            const msgId = appendMessage(
              taskId,
              conversationId,
              "tool_call",
              null,
              toolCallMsg,
              toolMeta,
            );
            this.onNewMessage({
              id: msgId,
              taskId,
              conversationId,
              type: "tool_call",
              role: null,
              content: toolCallMsg,
              metadata: toolMeta,
              createdAt: new Date().toISOString(),
            });
            // parentBlockId: use event.parentCallId for explicit subagent nesting.
            // Tools render at root level (not nested inside reasoning bubbles).
            const toolParentBlockId = event.parentCallId ?? null;
            this.onStreamEvent?.({ taskId, executionId, seq: 0, blockId: callId, type: "tool_call", content: toolCallMsg, metadata: JSON.stringify(toolMeta), parentBlockId: toolParentBlockId, done: false });
            // Push this call onto the stack so nested tokens/reasoning inherit it as parent
            callStack.push(callId);
            break;
          }

          case "tool_result": {
            if (event.isInternal) break;
            hadOutput = true;
            // Flush any reasoning accumulated while this tool was on the callStack,
            // using the current callStack context (before popping) as parentBlockId.
            if (reasoningAccum) {
              const rId = appendMessage(taskId, conversationId, "reasoning", null, reasoningAccum);
              this.onNewMessage({ id: rId, taskId, conversationId, type: "reasoning", role: null, content: reasoningAccum, metadata: null, createdAt: new Date().toISOString() });
              this.onStreamEvent?.({ taskId, executionId, seq: 0, blockId: "", type: "reasoning", content: reasoningAccum, metadata: null, parentBlockId: callStack.at(-1) ?? null, done: false });
              reasoningAccum = "";
            }
            // Task 5.2: Persist tool_result message
            const resultMsg = JSON.stringify({
              type: "tool_result",
              tool_use_id: event.callId,
              content: event.result,
              detailedContent: event.detailedResult,
              contents: event.contentBlocks,
              is_error: event.isError,
              writtenFiles: event.writtenFiles,
            });
            const resultMeta = {
              tool_call_id: event.callId ?? null,
              parent_tool_call_id: event.parentCallId ?? null,
            };
            const msgId = appendMessage(
              taskId,
              conversationId,
              "tool_result",
              null,
              resultMsg,
              resultMeta,
            );
            this.onNewMessage({
              id: msgId,
              taskId,
              conversationId,
              type: "tool_result",
              role: null,
              content: resultMsg,
              metadata: resultMeta,
              createdAt: new Date().toISOString(),
            });
            // Pop this call from the stack before emitting, so result has the same parent as its call
            const resultCallId = event.callId ?? msgId.toString();
            const stackIdx = callStack.lastIndexOf(resultCallId);
            if (stackIdx !== -1) callStack.splice(stackIdx, 1);
            // parentBlockId of tool_result mirrors its tool_call's parentBlockId.
            const resultParentBlockId = event.parentCallId ?? reasoningBlockId ?? null;
            this.onStreamEvent?.({ taskId, executionId, seq: 0, blockId: resultCallId, type: "tool_result", content: resultMsg, metadata: JSON.stringify(resultMeta), parentBlockId: resultParentBlockId, done: false });

            // Emit UI-only file_diff messages for structured writtenFiles.
            if (!event.isError && event.callId) {
              const writtenFiles = event.writtenFiles ?? [];
              if (writtenFiles.length > 0) {
                await this._emitFileDiffFromWrittenFiles(
                  taskId,
                  conversationId,
                  executionId,
                  event.callId,
                  writtenFiles,
                );
              }
            }
            break;
          }

          case "usage": {
            // Task 5.6: Persist token usage to execution record
            db.run(
              "UPDATE executions SET input_tokens = ?, output_tokens = ? WHERE id = ?",
              [
                event.inputTokens ?? null,
                event.outputTokens ?? null,
                executionId,
              ],
            );
            break;
          }

          case "done": {
            // Flush reasoningAccum before the final assistant message
            if (reasoningAccum) {
              const rDoneId = appendMessage(taskId, conversationId, "reasoning", null, reasoningAccum);
              this.onNewMessage({ id: rDoneId, taskId, conversationId, type: "reasoning", role: null, content: reasoningAccum, metadata: null, createdAt: new Date().toISOString() });
              this.onStreamEvent?.({ taskId, executionId, seq: 0, blockId: "", type: "reasoning", content: reasoningAccum, metadata: null, parentBlockId: callStack.at(-1) ?? null, done: false });
              reasoningAccum = "";
            }
            // Task 5.8: Flush accumulated tokens as final assistant message
            if (tokenAccum) {
              const msgId = appendMessage(
                taskId,
                conversationId,
                "assistant",
                "assistant",
                tokenAccum,
              );
              this.onNewMessage({
                id: msgId,
                taskId,
                conversationId,
                type: "assistant",
                role: "assistant",
                content: tokenAccum,
                metadata: null,
                createdAt: new Date().toISOString(),
              });
              this.onStreamEvent?.({ taskId, executionId, seq: 0, blockId: "", type: "assistant", content: tokenAccum, metadata: null, parentBlockId: callStack.at(-1) ?? null, done: false });
              tokenAccum = "";
            } else if (!hadOutput) {
              // Execution completed with no model output at all — surface a
              // visible warning so the user isn't left with a silent no-op.
              const warnMsg = "Agent completed with no output. The prompt may not have been resolved correctly.";
              const msgId = appendMessage(taskId, conversationId, "system", null, warnMsg);
              this.onNewMessage({
                id: msgId,
                taskId,
                conversationId,
                type: "system",
                role: null,
                content: warnMsg,
                metadata: null,
                createdAt: new Date().toISOString(),
              });
            }

            // Task 5.5: Transition execution to completed
            db.run("UPDATE tasks SET execution_state = 'completed' WHERE id = ?", [taskId]);
            db.run(
              "UPDATE executions SET status = 'completed', finished_at = datetime('now') WHERE id = ?",
              [executionId],
            );
            this.onToken(taskId, executionId, "", true);
            this.onStreamEvent?.({ taskId, executionId, seq: 0, blockId: `${executionId}-done`, type: "done", content: "", metadata: null, parentBlockId: null, done: true });
            break;
          }

          case "error": {
            // Task 5.5: Transition to failed on fatal error
            if (event.fatal) {
              db.run("UPDATE tasks SET execution_state = 'failed' WHERE id = ?", [taskId]);
              db.run(
                "UPDATE executions SET status = 'failed', finished_at = datetime('now'), details = ? WHERE id = ?",
                [event.message, executionId],
              );
              this.onError(taskId, executionId, event.message);
              return;
            }

            // Non-fatal error — relay but continue
            this.onError(taskId, executionId, event.message);
            appendMessage(
              taskId,
              conversationId,
              "system",
              null,
              `Error: ${event.message}`,
            );
            break;
          }

          case "shell_approval": {
            this._appendPromptMessage(
              taskId,
              conversationId,
              JSON.stringify({
                subtype: "shell_approval",
                command: event.command,
                unapprovedBinaries: [],
              }),
            );
            this._pauseExecution(taskId, executionId);
            break;
          }

          case "ask_user": {
            this._appendPromptMessage(taskId, conversationId, event.payload);
            this._pauseExecution(taskId, executionId);
            break;
          }

          case "interview_me": {
            const msgId = appendMessage(
              taskId,
              conversationId,
              "interview_prompt",
              null,
              event.payload,
            );
            this.onNewMessage({
              id: msgId,
              taskId,
              conversationId,
              type: "interview_prompt",
              role: null,
              content: event.payload,
              metadata: null,
              createdAt: new Date().toISOString(),
            });
            db.run("UPDATE tasks SET execution_state = 'waiting_user' WHERE id = ?", [taskId]);
            db.run(
              "UPDATE executions SET status = 'waiting_user', finished_at = datetime('now') WHERE id = ?",
              [executionId],
            );
            this.onStreamEvent?.({ taskId, executionId, seq: 0, blockId: `${executionId}-done`, type: "done", content: "", metadata: null, parentBlockId: null, done: true });
            this.onToken(taskId, executionId, "", true);
            return;
          }

          case "compaction_start": {
            const compStartId = appendMessage(taskId, conversationId, "system", null, "Compacting conversation…");
            this.onNewMessage({
              id: compStartId,
              taskId,
              conversationId,
              type: "system",
              role: null,
              content: "Compacting conversation…",
              metadata: null,
              createdAt: new Date().toISOString(),
            });
            break;
          }

          case "compaction_done": {
            // Deduplicate: skip if the last persisted message is already compaction_summary.
            const lastMsg = db.query<{ type: string }, [number]>(
              "SELECT type FROM conversation_messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1"
            ).get(conversationId);
            if (lastMsg?.type === "compaction_summary") break;
            const compDoneId = appendMessage(taskId, conversationId, "compaction_summary", null, "");
            this.onNewMessage({
              id: compDoneId,
              taskId,
              conversationId,
              type: "compaction_summary",
              role: null,
              content: "",
              metadata: null,
              createdAt: new Date().toISOString(),
            });
            break;
          }

          case "task_updated": {
            this.onTaskUpdated(event.task);
            break;
          }

          case "new_message": {
            this.onNewMessage(event.message);
            break;
          }

          default:
            break;
        }
      }

      // The for-await loop exited: either the generator completed normally (the
      // 'done' event case above already wrote completion state and returned), or
      // the generator was aborted (done=true set by the AbortSignal listener in
      // translateCopilotStream). In the abort case no state was written yet.
      if (abortController.signal.aborted) {
        // Flush any accumulated reasoning before closing so the reasoning bubble closes
        if (reasoningAccum) {
          const rCancelId = appendMessage(taskId, conversationId, "reasoning", null, reasoningAccum);
          this.onNewMessage({ id: rCancelId, taskId, conversationId, type: "reasoning", role: null, content: reasoningAccum, metadata: null, createdAt: new Date().toISOString() });
          this.onStreamEvent?.({ taskId, executionId, seq: 0, blockId: "", type: "reasoning", content: reasoningAccum, metadata: null, parentBlockId: null, done: false });
          reasoningAccum = "";
        }
        // Flush any accumulated text so it isn't lost when cancelling
        if (tokenAccum) {
          const tCancelId = appendMessage(taskId, conversationId, "assistant", "assistant", tokenAccum);
          this.onNewMessage({ id: tCancelId, taskId, conversationId, type: "assistant", role: "assistant", content: tokenAccum, metadata: null, createdAt: new Date().toISOString() });
          this.onStreamEvent?.({ taskId, executionId, seq: 0, blockId: "", type: "assistant", content: tokenAccum, metadata: null, parentBlockId: null, done: false });
          tokenAccum = "";
        }
        db.run("UPDATE tasks SET execution_state = 'waiting_user' WHERE id = ?", [taskId]);
        db.run(
          "UPDATE executions SET status = 'cancelled', finished_at = datetime('now') WHERE id = ?",
          [executionId],
        );
        this.onToken(taskId, executionId, "", true);
        this.onStreamEvent?.({ taskId, executionId, seq: 0, blockId: `${executionId}-done`, type: "done", content: "", metadata: null, parentBlockId: null, done: true });
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      db.run("UPDATE tasks SET execution_state = 'failed' WHERE id = ?", [taskId]);
      db.run(
        "UPDATE executions SET status = 'failed', finished_at = datetime('now'), details = ? WHERE id = ?",
        [errMsg, executionId],
      );
      this.onError(taskId, executionId, errMsg);
    } finally {
      // Task 5.3: Clean up AbortController
      this.abortControllers.delete(executionId);
      this.rawMessageSeq.delete(executionId);

      // Relay updated task to UI
      const finalRow = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(taskId);
      if (finalRow) {
        this.onTaskUpdated(mapTask(finalRow));
      }
    }
  }

  private async _emitFileDiffFromWrittenFiles(
    taskId: number,
    conversationId: number,
    executionId: number,
    callId: string,
    writtenFiles: Array<import("../../shared/rpc-types.ts").FileDiffPayload>,
  ): Promise<void> {
    const db = getDb();
    const gitRow = db
      .query<Pick<TaskGitContextRow, "worktree_path" | "worktree_status">, [number]>(
        "SELECT worktree_path, worktree_status FROM task_git_context WHERE task_id = ?",
      )
      .get(taskId);
    const worktreePath = gitRow?.worktree_status === "ready" ? (gitRow.worktree_path ?? "") : "";

    for (const file of writtenFiles) {
      const payload: Record<string, unknown> = { ...file };

      if (worktreePath && file.path) {
        try {
          const proc = Bun.spawn(["git", "diff", "HEAD", "--", file.path], {
            cwd: worktreePath,
            stdout: "pipe",
            stderr: "pipe",
          });
          await proc.exited;
          const diffOut = await new Response(proc.stdout).text();
          if (diffOut.trim()) {
            payload.rawDiff = diffOut;
          }
        } catch {
          // git diff failure is non-fatal — keep structured payload as-is
        }
      }

      const diffMeta = { tool_call_id: callId };
      const diffContent = JSON.stringify(payload);
      const diffId = appendMessage(taskId, conversationId, "file_diff", null, diffContent, diffMeta);
      this.onNewMessage({
        id: diffId,
        taskId,
        conversationId,
        type: "file_diff",
        role: null,
        content: diffContent,
        metadata: diffMeta,
        createdAt: new Date().toISOString(),
      });
      this.onStreamEvent?.({
        taskId,
        executionId,
        seq: 0,
        blockId: `${callId}-diff-${file.path}`,
        type: "file_diff",
        content: diffContent,
        metadata: JSON.stringify(diffMeta),
        parentBlockId: callId,
        done: false,
      });
    }
  }

}
