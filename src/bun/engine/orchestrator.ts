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
import type { LoadedConfig } from "../config/index.ts";
import type { Task, ConversationMessage } from "../../shared/rpc-types.ts";
import type { ExecutionCoordinator } from "./coordinator.ts";
import type { OnToken, OnError, OnTaskUpdated, OnNewMessage } from "../workflow/engine.ts";
import {
  handleTransition,
  handleHumanTurn,
  handleRetry,
  handleCodeReview,
  cancelExecution as nativeCancelExecution,
  resolveShellApproval,
  appendMessage,
} from "../workflow/engine.ts";
import { mapTask, mapConversationMessage } from "../db/mappers.ts";
import { getDb } from "../db/index.ts";
import type { TaskRow, ConversationMessageRow, TaskGitContextRow } from "../db/row-types.ts";
import { runWithConfig } from "../config/index.ts";
import { resolveSlashReference } from "../workflow/slash-prompt.ts";
import { resolveEngine } from "./resolver.ts";
import { getBoardWorkspaceId, getDefaultWorkspaceId, getTaskWorkspaceId, getWorkspaceConfigById } from "../workspace-context.ts";

export class Orchestrator implements ExecutionCoordinator {
  private readonly injectedEngine: ExecutionEngine | null;
  private readonly onToken: OnToken;
  private readonly onError: OnError;
  private readonly onTaskUpdated: OnTaskUpdated;
  private readonly onNewMessage: OnNewMessage;
  private readonly engines = new Map<string, ExecutionEngine>();

  /** Map of executionId → AbortController for managing cancellation */
  private readonly abortControllers = new Map<number, AbortController>();

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
    return engine.constructor.name === "NativeEngine";
  }

  private getEngineForWorkspace(workspaceId: number): { config: LoadedConfig; engine: ExecutionEngine } {
    const config = getWorkspaceConfigById(workspaceId);
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
    const { config, engine } = this.getEngineForWorkspace(getBoardWorkspaceId(task.board_id));
    if (this.isNativeEngine(engine)) {
      return runWithConfig(
        config,
        () => handleTransition(taskId, toState, this.onToken, this.onError, this.onTaskUpdated, this.onNewMessage),
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

    // Resolve model
    const resolvedModel = column?.model ?? task.model ?? config.workspace.default_model ?? "";
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
    const gitRow = db
      .query<Pick<TaskGitContextRow, "worktree_path" | "worktree_status">, [number]>(
        "SELECT worktree_path, worktree_status FROM task_git_context WHERE task_id = ?",
      )
      .get(taskId);
    const worktreePath = gitRow?.worktree_status === "ready" ? (gitRow.worktree_path ?? "") : "";
    const displayPrompt = column.on_enter_prompt;
    let resolvedPrompt = column.on_enter_prompt;
    try {
      resolvedPrompt = await resolveSlashReference(column.on_enter_prompt, worktreePath);
    } catch { /* fall back to raw text */ }
    appendMessage(
      taskId,
      conversationId,
      "user",
      "prompt",
      displayPrompt,
      resolvedPrompt === displayPrompt
        ? undefined
        : {
            resolved_content: resolvedPrompt,
            display_content: displayPrompt,
          },
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
      worktreePath,
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
    const { config, engine } = this.getEngineForWorkspace(getTaskWorkspaceId(taskId));
    if (this.isNativeEngine(engine)) {
      return runWithConfig(
        config,
        () => handleHumanTurn(taskId, content, this.onToken, this.onError, this.onTaskUpdated, this.onNewMessage),
      );
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

    const gitRow = db
      .query<Pick<TaskGitContextRow, "worktree_path" | "worktree_status">, [number]>(
        "SELECT worktree_path, worktree_status FROM task_git_context WHERE task_id = ?",
      )
      .get(taskId);
    const worktreePath = gitRow?.worktree_status === "ready" ? (gitRow.worktree_path ?? "") : "";
    let resolvedPrompt = content;
    try {
      resolvedPrompt = await resolveSlashReference(content, worktreePath);
    } catch {
      // Keep raw content on non-native resolution failures — this path remains
      // non-blocking and still records what the user actually typed.
    }
    const msgId = appendMessage(
      taskId,
      task.conversation_id ?? 0,
      "user",
      "user",
      content,
      resolvedPrompt === content
        ? undefined
        : {
            resolved_content: resolvedPrompt,
            display_content: content,
          },
    );

    const execParams = this._buildExecutionParams(
      task,
      executionId,
      resolvedPrompt,
      column?.stage_instructions,
      worktreePath,
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
    const { config, engine } = this.getEngineForWorkspace(getTaskWorkspaceId(taskId));
    if (this.isNativeEngine(engine)) {
      return runWithConfig(
        config,
        () => handleRetry(taskId, this.onToken, this.onError, this.onTaskUpdated, this.onNewMessage),
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

    const gitRow = db
      .query<Pick<TaskGitContextRow, "worktree_path" | "worktree_status">, [number]>(
        "SELECT worktree_path, worktree_status FROM task_git_context WHERE task_id = ?",
      )
      .get(taskId);
    const worktreePath = gitRow?.worktree_status === "ready" ? (gitRow.worktree_path ?? "") : "";
    const retryPrompt = column?.on_enter_prompt ?? "Please continue with the task.";

    const execParams = this._buildExecutionParams(
      updatedRow,
      executionId,
      retryPrompt,
      column?.stage_instructions,
      worktreePath,
      "retry",
    );
    this._runNonNative(taskId, executionId, engine, execParams);

    return { task: mapTask(updatedRow), executionId };
  }

  async executeCodeReview(
    taskId: number,
  ): Promise<{ message: ConversationMessage; executionId: number }> {
    const db = getDb();
    const task = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    const { config, engine } = this.getEngineForWorkspace(getTaskWorkspaceId(taskId));
    if (this.isNativeEngine(engine)) {
      return runWithConfig(
        config,
        () => handleCodeReview(taskId, this.onToken, this.onError, this.onTaskUpdated, this.onNewMessage),
      );
    }

    // Build a minimal code review prompt from hunk decisions
    type DecisionRow = { hunk_hash: string; file_path: string; decision: string; comment: string | null };
    const decisions = db
      .query<DecisionRow, [number]>(
        `SELECT hunk_hash, file_path, decision, comment FROM task_hunk_decisions
         WHERE task_id = ? AND reviewer_id = 'user' ORDER BY file_path`,
      )
      .all(taskId);
    const reviewText = decisions.length > 0
      ? decisions.map((d) => `${d.file_path}: ${d.decision}${d.comment ? ` — ${d.comment}` : ""}`).join("\n")
      : "Please review the code changes and provide feedback.";

    const reviewMsgId = appendMessage(taskId, task.conversation_id ?? 0, "code_review", "user", reviewText);
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

    const gitRow = db
      .query<Pick<TaskGitContextRow, "worktree_path" | "worktree_status">, [number]>(
        "SELECT worktree_path, worktree_status FROM task_git_context WHERE task_id = ?",
      )
      .get(taskId);
    const worktreePath = gitRow?.worktree_status === "ready" ? (gitRow.worktree_path ?? "") : "";

    const execParams = this._buildExecutionParams(
      task,
      executionId,
      reviewText,
      column?.stage_instructions,
      worktreePath,
      "code_review",
    );
    this._runNonNative(taskId, executionId, engine, execParams);

    return { message: mapConversationMessage(reviewMsgRow), executionId };
  }

  // ─── Cancellation ──────────────────────────────────────────────────────────

  cancel(executionId: number): void {
    nativeCancelExecution(executionId);
    const controller = this.abortControllers.get(executionId);
    if (controller) {
      controller.abort();
    }
    if (this.injectedEngine) {
      this.injectedEngine.cancel(executionId);
    }
    for (const engine of this.engines.values()) {
      engine.cancel(executionId);
    }
  }

  // ─── Model listing ─────────────────────────────────────────────────────────

  listModels(workspaceId?: number) {
    const { config, engine } = this.getEngineForWorkspace(workspaceId ?? getDefaultWorkspaceId());
    return runWithConfig(config, () => engine.listModels());
  }

  // ─── Shell approval ─────────────────────────────────────────────────────────

  respondShellApproval(
    taskId: number,
    decision: "approve_once" | "approve_all" | "deny",
  ): void {
    resolveShellApproval(taskId, decision, this.onTaskUpdated);
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
      nativeExecType,
      toState,
    };
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
          db.run("UPDATE tasks SET execution_state = 'waiting_user' WHERE id = ?", [taskId]);
          db.run(
            "UPDATE executions SET status = 'cancelled', finished_at = datetime('now') WHERE id = ?",
            [executionId],
          );
          this.onToken(taskId, executionId, "", true);
          return;
        }

        switch (event.type) {
          case "token": {
            // Task 5.2: Accumulate tokens for eventual assistant message
            tokenAccum += event.content;
            this.onToken(taskId, executionId, event.content, false);
            break;
          }

          case "reasoning": {
            // Task 5.2: Accumulate reasoning separately
            reasoningAccum += event.content;
            this.onToken(taskId, executionId, event.content, false, true);
            break;
          }

          case "status": {
            // Ephemeral status — relay but don't persist
            this.onToken(taskId, executionId, event.message, false, false, true);
            break;
          }

          case "tool_start": {
            if (event.isInternal) break;
            // Task 5.2: Persist tool_call message immediately
            const callId = event.callId ?? `call_${Date.now()}_${Math.random().toString(36).slice(2)}`;
            const toolCallMsg = JSON.stringify({
              type: "function",
              function: { name: event.name, arguments: event.arguments },
              id: callId,
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
            break;
          }

          case "tool_result": {
            if (event.isInternal) break;
            // Task 5.2: Persist tool_result message
            const resultMsg = JSON.stringify({
              type: "tool_result",
              tool_use_id: event.callId,
              content: event.result,
              detailedContent: event.detailedResult,
              contents: event.contentBlocks,
              is_error: event.isError,
            });
            const resultMeta = {
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
            // Task 5.2: Flush accumulated tokens as final assistant message
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
            }

            // Task 5.5: Transition execution to completed
            db.run("UPDATE tasks SET execution_state = 'completed' WHERE id = ?", [taskId]);
            db.run(
              "UPDATE executions SET status = 'completed', finished_at = datetime('now') WHERE id = ?",
              [executionId],
            );
            this.onToken(taskId, executionId, "", true);
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
            // Task 5.4: This should be handled by orchestrator, not relayed here
            // (will be implemented when Copilot integration adds permission_request)
            // For now, just log
            console.warn(`[orchestrator] shell_approval event not yet handled: ${event.command}`);
            break;
          }

          case "ask_user": {
            // Task 5.4: Parse user input request and update task state
            db.run("UPDATE tasks SET execution_state = 'waiting_user' WHERE id = ?", [taskId]);
            db.run(
              "UPDATE executions SET status = 'waiting_user', finished_at = datetime('now') WHERE id = ?",
              [executionId],
            );
            this.onToken(taskId, executionId, "", true);
            return;
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
            this.onToken(taskId, executionId, "", true);
            return;
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
        db.run("UPDATE tasks SET execution_state = 'waiting_user' WHERE id = ?", [taskId]);
        db.run(
          "UPDATE executions SET status = 'cancelled', finished_at = datetime('now') WHERE id = ?",
          [executionId],
        );
        this.onToken(taskId, executionId, "", true);
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

      // Relay updated task to UI
      const finalRow = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(taskId);
      if (finalRow) {
        this.onTaskUpdated(mapTask(finalRow));
      }
    }
  }
}
