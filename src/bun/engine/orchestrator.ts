/**
 * Orchestrator — slim coordinator: wires extracted modules and implements ExecutionCoordinator.
 *
 * All heavy lifting is delegated to focused classes:
 *  - StreamProcessor: consumeStream, AbortController lifecycle
 *  - ExecutionParamsBuilder: builds ExecutionParams
 *  - WorkingDirectoryResolver: resolves working directory for a task
 *  - EngineRegistry: lazy per-workspace engine cache
 *  - TransitionExecutor / HumanTurnExecutor / RetryExecutor / CodeReviewExecutor / ChatExecutor
 */

import type {
  OnError,
  OnTaskUpdated,
  OnNewMessage,
  OnStreamEvent,
  EngineShutdownOptions,
} from "./types.ts";
import type { Task, ConversationMessage } from "../../shared/rpc-types.ts";
import type { ExecutionCoordinator } from "./coordinator.ts";
import { mapTask } from "../db/mappers.ts";
import { getDb } from "../db/index.ts";
import type { TaskRow } from "../db/row-types.ts";
import { runWithConfig } from "../config/index.ts";
import { getBoardWorkspaceKey, getDefaultWorkspaceKey, getTaskWorkspaceKey, getWorkspaceConfig } from "../workspace-context.ts";

import { EngineRegistry } from "./engine-registry.ts";
import { StreamProcessor } from "./stream/stream-processor.ts";
import { ExecutionParamsBuilder } from "./execution/execution-params-builder.ts";
import { WorkingDirectoryResolver } from "./execution/working-directory-resolver.ts";
import { TransitionExecutor } from "./execution/transition-executor.ts";
import { HumanTurnExecutor } from "./execution/human-turn-executor.ts";
import { RetryExecutor } from "./execution/retry-executor.ts";
import { CodeReviewExecutor } from "./execution/code-review-executor.ts";
import { ChatExecutor } from "./execution/chat-executor.ts";

export class Orchestrator implements ExecutionCoordinator {
  private readonly registry: EngineRegistry;
  private readonly streamProcessor: StreamProcessor;
  private readonly paramsBuilder: ExecutionParamsBuilder;
  private readonly workdirResolver: WorkingDirectoryResolver;
  private readonly transitionExecutor: TransitionExecutor;
  private readonly humanTurnExecutor: HumanTurnExecutor;
  private readonly retryExecutor: RetryExecutor;
  private readonly codeReviewExecutor: CodeReviewExecutor;
  private readonly chatExecutor: ChatExecutor;

  private readonly onTaskUpdated: OnTaskUpdated;
  private readonly onNewMessage: OnNewMessage;

  setOnStreamEvent(cb: OnStreamEvent): void {
    this.streamProcessor.setOnStreamEvent(cb);
  }

  constructor(
    registry: EngineRegistry,
    onError: OnError,
    onTaskUpdated: OnTaskUpdated,
    onNewMessage: OnNewMessage,
  ) {
    this.registry = registry;
    this.onTaskUpdated = onTaskUpdated;
    this.onNewMessage = onNewMessage;

    this.streamProcessor = new StreamProcessor(() => {}, onError, onTaskUpdated, onNewMessage);
    this.paramsBuilder = new ExecutionParamsBuilder();
    this.workdirResolver = new WorkingDirectoryResolver();

    this.transitionExecutor = new TransitionExecutor(registry, this.paramsBuilder, this.workdirResolver, this.streamProcessor);
    this.humanTurnExecutor = new HumanTurnExecutor(registry, this.paramsBuilder, this.workdirResolver, this.streamProcessor, onTaskUpdated);
    this.retryExecutor = new RetryExecutor(registry, this.paramsBuilder, this.workdirResolver, this.streamProcessor);
    this.codeReviewExecutor = new CodeReviewExecutor(registry, this.paramsBuilder, this.workdirResolver, this.streamProcessor, onTaskUpdated, onNewMessage);
    this.chatExecutor = new ChatExecutor(registry, this.paramsBuilder, this.streamProcessor);
  }

  // ─── Execution dispatch ─────────────────────────────────────────────────────

  executeTransition(taskId: number, toState: string): Promise<{ task: Task; executionId: number | null }> {
    return this.transitionExecutor.execute(taskId, toState);
  }

  executeHumanTurn(
    taskId: number,
    content: string,
    attachments?: import("../../shared/rpc-types.ts").Attachment[],
    engineContent?: string,
  ): Promise<{ message: ConversationMessage; executionId: number }> {
    return this.humanTurnExecutor.execute(taskId, content, attachments, engineContent);
  }

  executeRetry(taskId: number): Promise<{ task: Task; executionId: number }> {
    return this.retryExecutor.execute(taskId);
  }

  executeCodeReview(
    taskId: number,
    manualEdits?: import("../../shared/rpc-types.ts").ManualEdit[],
  ): Promise<{ message: ConversationMessage; executionId: number }> {
    return this.codeReviewExecutor.execute(taskId, manualEdits);
  }

  // ─── Chat Session Execution ────────────────────────────────────────────────

  executeChatTurn(
    sessionId: number,
    conversationId: number,
    content: string,
    model?: string,
    enabledMcpTools?: string[] | null,
    workspaceKey = getDefaultWorkspaceKey(),
    attachments?: import("../../shared/rpc-types.ts").Attachment[],
    engineContent?: string,
  ): Promise<{ message: ConversationMessage; executionId: number }> {
    return this.chatExecutor.execute(sessionId, conversationId, content, model, enabledMcpTools, workspaceKey, attachments, engineContent);
  }

  // ─── Cancellation ──────────────────────────────────────────────────────────

  cancel(executionId: number): void {
    this.streamProcessor.abort(executionId);

    const db = getDb();
    // Fetch row BEFORE nativeCancelExecution — it may overwrite status to 'failed'
    // (zombie cleanup path) which would prevent our non-native 'cancelled' update below.
    const execRow = db.query<{ task_id: number | null; status: string; finished_at: string | null }, [number]>(
      "SELECT task_id, status, finished_at FROM executions WHERE id = ?",
    ).get(executionId);

    this.registry.cancelAll(executionId);

    if (!execRow) return;
    const taskId = execRow.task_id ?? null;
    const execConvRow = db.query<{ conversation_id: number | null }, [number]>(
      "SELECT conversation_id FROM executions WHERE id = ?",
    ).get(executionId);
    const conversationId = execConvRow?.conversation_id ?? 0;
    if (taskId != null) {
      if (execRow.status === "running" && execRow.finished_at == null) {
        db.run("UPDATE executions SET status = 'cancelled', finished_at = datetime('now') WHERE id = ?", [executionId]);
        db.run("UPDATE tasks SET execution_state = 'waiting_user' WHERE id = ?", [taskId]);
        const taskRow = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(taskId);
        if (taskRow) {
          this.onTaskUpdated(mapTask(taskRow));
        }
        this.streamProcessor.emitDone(taskId, conversationId, executionId);
      }
    } else if (execRow.status === "running" && execRow.finished_at == null) {
      db.run("UPDATE executions SET status = 'cancelled', finished_at = datetime('now') WHERE id = ?", [executionId]);
      if (conversationId) {
        db.run("UPDATE chat_sessions SET status = 'idle' WHERE conversation_id = ?", [conversationId]);
      }
      this.streamProcessor.emitDone(null, conversationId, executionId);
    }
  }

  // ─── Model listing ─────────────────────────────────────────────────────────

  listModels(workspaceKey?: string) {
    const key = workspaceKey ?? getDefaultWorkspaceKey();
    const config = getWorkspaceConfig(key);
    const engine = this.registry.getEngine(key);
    return runWithConfig(config, () => engine.listModels());
  }

  // ─── Command listing ────────────────────────────────────────────────────────

  async listCommands(taskId: number) {
    const db = getDb();
    const task = db.query<{ board_id: number }, [number]>("SELECT board_id FROM tasks WHERE id = ?").get(taskId);
    if (!task) return [];
    const key = getBoardWorkspaceKey(task.board_id);
    const config = getWorkspaceConfig(key);
    const engine = this.registry.getEngine(key);
    return runWithConfig(config, () => engine.listCommands(taskId));
  }

  async shutdownNonNativeEngines(options: EngineShutdownOptions = { reason: "app-exit", deadlineMs: 3_000 }): Promise<void> {
    return this.registry.shutdown(options);
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

    const engine = this.registry.getEngine(getTaskWorkspaceKey(taskId));
    await engine.resume(task.current_execution_id, { type: "shell_approval", decision });

    db.run("UPDATE tasks SET execution_state = 'running' WHERE id = ?", [taskId]);
    db.run(
      "UPDATE executions SET status = 'running', finished_at = NULL WHERE id = ?",
      [task.current_execution_id],
    );
    this.onTaskUpdated(mapTask(db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(taskId)!));
  }

  async compactTask(taskId: number): Promise<void> {
    const engine = this.registry.getEngine(getTaskWorkspaceKey(taskId));
    if (!engine.compact) {
      throw new Error(`Engine for task ${taskId} does not support manual compaction`);
    }
    const db = getDb();
    const task = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    const workingDirectory = this.workdirResolver.resolve(task);
    await engine.compact(taskId, task.conversation_id, workingDirectory);
  }

  async compactConversation(conversationId: number, workspaceKey = getDefaultWorkspaceKey()): Promise<void> {
    const config = getWorkspaceConfig(workspaceKey);
    const engine = this.registry.getEngine(workspaceKey);
    if (!engine.compact) {
      throw new Error(`Engine for conversation ${conversationId} does not support manual compaction`);
    }
    const workingDirectory = config.workspace.workspace_path ?? config.configDir;
    await engine.compact(null, conversationId, workingDirectory);
  }
}
