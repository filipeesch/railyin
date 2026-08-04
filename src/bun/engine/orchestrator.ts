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
  EngineModelInfo,
} from "./types.ts";
import type { Task, ConversationMessage } from "../../shared/rpc-types.ts";
import type { ExecutionCoordinator } from "./coordinator.ts";
import { mapTask, mapConversationMessage } from "../db/mappers.ts";
import { fetchTaskWithModel } from "../db/task-queries.ts";
import type { Db } from "../db/db.ts";
import type { TaskRow, ConversationMessageRow } from "../db/row-types.ts";
import { runWithConfig } from "../config/index.ts";
import { getEffectiveWorkspacePath } from "../config/path-utils.ts";
import { getDefaultWorkspaceKey, getWorkspaceConfig } from "../workspace-context.ts";
import type { IWorkspaceRepository } from "../db/workspace-repository.ts";
import { BoardToolExecutor } from "../workflow/tools/board-tool-executor.ts";
import type { WorktreeManager } from "../git/WorktreeManager.ts";

import { EngineRegistry } from "./engine-registry.ts";
import { StreamProcessor } from "./stream/stream-processor.ts";
import { ExecutionParamsBuilder } from "./execution/execution-params-builder.ts";
import { WorkingDirectoryResolver } from "./execution/working-directory-resolver.ts";
import { TransitionExecutor } from "./execution/transition-executor.ts";
import { HumanTurnExecutor } from "./execution/human-turn-executor.ts";
import { RetryExecutor } from "./execution/retry-executor.ts";
import { CodeReviewExecutor } from "./execution/code-review-executor.ts";
import { ChatExecutor } from "./execution/chat-executor.ts";
import { createRawMessageBuffer } from "./stream/raw-message-buffer.ts";
import type { RawMessageItem } from "./stream/raw-message-buffer.ts";
import { CrossEngineContextInjector } from "../conversation/cross-engine-context.ts";
import { DecisionContextInjector } from "../conversation/decision-context-injector.ts";
import { StageInstructionsInjector } from "../conversation/stage-instructions-injector.ts";
import type { ModelSettingsRepository } from "../db/repositories/model-settings-repository.ts";
import { CustomPromptInjector } from "./execution/custom-prompt-injector.ts";
import { PromptAssemblyService } from "./execution/prompt-assembly-service.ts";
import { SlashCommandResolver } from "./execution/slash-command-resolver.ts";
import { ExecutionParamsEnricher } from "./execution/execution-params-enricher.ts";
import type { McpRegistryPool } from "../mcp/registry-pool.ts";

export class Orchestrator implements ExecutionCoordinator {
  private readonly db: Db;
  private readonly registry: EngineRegistry;
  private readonly streamProcessor: StreamProcessor;
  private readonly paramsBuilder: ExecutionParamsBuilder;
  private readonly workdirResolver: WorkingDirectoryResolver;
  private readonly transitionExecutor: TransitionExecutor;
  private readonly humanTurnExecutor: HumanTurnExecutor;
  private readonly retryExecutor: RetryExecutor;
  private readonly codeReviewExecutor: CodeReviewExecutor;
  private readonly chatExecutor: ChatExecutor;
  private readonly wsRepo: IWorkspaceRepository;

  private readonly onTaskUpdated: OnTaskUpdated;
  private readonly onNewMessage: OnNewMessage;

  setOnStreamEvent(cb: OnStreamEvent): void {
    this.streamProcessor.setOnStreamEvent(cb);
  }

  constructor(
    db: Db,
    registry: EngineRegistry,
    onError: OnError,
    onTaskUpdated: OnTaskUpdated,
    onNewMessage: OnNewMessage,
    wsRepo: IWorkspaceRepository,
    onRawMessageEnqueued?: (item: RawMessageItem) => void,
    worktreeManager?: WorktreeManager,
    modelSettingsRepo?: ModelSettingsRepository,
    registryPool?: McpRegistryPool,
  ) {
    this.db = db;
    this.registry = registry;
    this.onTaskUpdated = onTaskUpdated;
    this.onNewMessage = onNewMessage;
    this.wsRepo = wsRepo;

    const rawBuffer = createRawMessageBuffer(db, { onEnqueue: onRawMessageEnqueued });
    rawBuffer.start();

    const boardTools = new BoardToolExecutor(db, wsRepo, worktreeManager);

    this.streamProcessor = new StreamProcessor(
      db, rawBuffer, () => {}, onError, onTaskUpdated, onNewMessage,
      (tid, state) => void this.transitionExecutor.execute(tid, state),
      (tid, msg) => void this.humanTurnExecutor.execute(tid, msg),
    );
    this.paramsBuilder = new ExecutionParamsBuilder(registryPool ?? null);
    this.workdirResolver = new WorkingDirectoryResolver(db, wsRepo);
    const customPromptInjector = new CustomPromptInjector();
    const promptAssemblyService = new PromptAssemblyService(customPromptInjector, new StageInstructionsInjector(db));
    const slashCommandResolver = new SlashCommandResolver();
    const paramsEnricher = new ExecutionParamsEnricher(db, modelSettingsRepo);
    const crossEngineInjector = new CrossEngineContextInjector(db, registry);

    this.transitionExecutor = new TransitionExecutor(
      db, registry, this.paramsBuilder, this.workdirResolver, this.streamProcessor, boardTools, wsRepo,
      crossEngineInjector,
      new DecisionContextInjector(db),
      promptAssemblyService,
      slashCommandResolver,
      (tid, state) => void this.transitionExecutor.execute(tid, state),
      (tid, msg) => void this.humanTurnExecutor.execute(tid, msg),
      paramsEnricher,
    );
    this.humanTurnExecutor = new HumanTurnExecutor(
      db, registry, this.paramsBuilder, this.workdirResolver, this.streamProcessor, onTaskUpdated, wsRepo, boardTools,
      crossEngineInjector,
      new DecisionContextInjector(db),
      promptAssemblyService,
      slashCommandResolver,
      (tid, state) => void this.transitionExecutor.execute(tid, state),
      (tid, msg) => void this.humanTurnExecutor.execute(tid, msg),
      paramsEnricher,
    );
    this.retryExecutor = new RetryExecutor(db, registry, this.paramsBuilder, this.workdirResolver, this.streamProcessor, wsRepo, boardTools, promptAssemblyService, slashCommandResolver, paramsEnricher);
    this.codeReviewExecutor = new CodeReviewExecutor(db, registry, this.paramsBuilder, this.workdirResolver, this.streamProcessor, onTaskUpdated, onNewMessage, wsRepo, boardTools, promptAssemblyService);
    this.chatExecutor = new ChatExecutor(db, registry, this.paramsBuilder, this.streamProcessor, this.workdirResolver, customPromptInjector, crossEngineInjector, slashCommandResolver, paramsEnricher, boardTools, onNewMessage);
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

  markClaudeExecution(executionId: number): void {
    this.streamProcessor.markClaudeExecution(executionId);
  }

  async cancel(executionId: number): Promise<void> {
    this.streamProcessor.abort(executionId);

    const db = this.db;
    // Fetch row BEFORE nativeCancelExecution — it may overwrite status to 'failed'
    // (zombie cleanup path) which would prevent our non-native 'cancelled' update below.
    const execRow = await db.get<{ task_id: number | null; status: string; finished_at: string | null }>(
      "SELECT task_id, status, finished_at FROM executions WHERE id = $1",
      [executionId],
    );

    this.registry.cancelAll(executionId);

    if (!execRow) return;
    const taskId = execRow.task_id ?? null;
    const execConvRow = await db.get<{ conversation_id: number | null }>(
      "SELECT conversation_id FROM executions WHERE id = $1",
      [executionId],
    );
    const conversationId = execConvRow?.conversation_id ?? 0;
    if (taskId != null) {
      if (execRow.status === "running" && execRow.finished_at == null) {
        await db.exec(`UPDATE executions SET status = 'cancelled', finished_at = ${db.dialect.now()} WHERE id = $1`, [executionId]);
        await db.exec("UPDATE tasks SET execution_state = 'waiting_user' WHERE id = $1", [taskId]);
        const taskRow = await fetchTaskWithModel(db, taskId);
        if (taskRow) {
          this.onTaskUpdated(taskRow);
        }
        this.streamProcessor.emitDone(taskId, conversationId, executionId);
      }
    } else if (execRow.status === "running" && execRow.finished_at == null) {
      await db.exec(`UPDATE executions SET status = 'cancelled', finished_at = ${db.dialect.now()} WHERE id = $1`, [executionId]);
      if (conversationId) {
        await db.exec("UPDATE chat_sessions SET status = 'idle' WHERE conversation_id = $1", [conversationId]);
      }
      this.streamProcessor.emitDone(null, conversationId, executionId);
    }
  }

  // ─── Model listing ─────────────────────────────────────────────────────────

  async listModels(workspaceKey?: string, engineType?: string): Promise<EngineModelInfo[]> {
    const key = workspaceKey ?? getDefaultWorkspaceKey();
    const config = getWorkspaceConfig(key);

    if (engineType) {
      const engine = this.registry.getEngineById(engineType);
      if (!engine) throw new Error(`Engine '${engineType}' is not registered`);
      return runWithConfig(config, () => engine.listModels());
    }

    const engines = this.registry.listAllEngines(key);
    const results = await Promise.all(
      engines.map((engine) => {
        const call = runWithConfig(config, () => engine.listModels());
        const timeout = new Promise<EngineModelInfo[]>((_, reject) =>
          setTimeout(() => reject(new Error("listModels timed out")), 8_000),
        );
        return Promise.race([call, timeout]).catch((err: unknown) => {
          console.error("[orchestrator] listModels failed for engine:", err instanceof Error ? err.message : err);
          return [] as EngineModelInfo[];
        });
      }),
    );
    return results.flat();
  }

  // ─── Command listing ────────────────────────────────────────────────────────

  async listCommands(taskId: number) {
    const db = this.db;
    const task = await db.get<{ board_id: number; conversation_id: number | null }>(
      "SELECT board_id, conversation_id FROM tasks WHERE id = $1",
      [taskId],
    );
    if (!task) return [];
    const key = await this.wsRepo.getBoardWorkspaceKey(task.board_id);
    const config = getWorkspaceConfig(key);
    const conversationModel = task.conversation_id
      ? (await db.get<{ model: string | null }>("SELECT model FROM conversations WHERE id = $1", [task.conversation_id]))?.model
      : null;
    const engine = this.registry.resolveEngineForModel(key, conversationModel);
    return runWithConfig(config, () => engine.listCommands(taskId));
  }

  async shutdownNonNativeEngines(options: EngineShutdownOptions = { reason: "app-exit", deadlineMs: 3_000 }): Promise<void> {
    return this.registry.shutdown(options);
  }

  // ─── Shell approval ─────────────────────────────────────────────────────────

  async respondShellApprovalByExecution(
    executionId: number,
    decision: "approve_once" | "approve_all" | "deny",
  ): Promise<void> {
    const db = this.db;

    const execRow = await db.get<{ task_id: number | null; conversation_id: number | null; model: string | null }>(
      `SELECT e.task_id, e.conversation_id, c.model
         FROM executions e
         LEFT JOIN conversations c ON c.id = e.conversation_id
         WHERE e.id = $1`,
      [executionId],
    );

    if (!execRow) return;

    const { task_id: taskId, conversation_id: conversationId } = execRow;

    const workspaceKey = taskId != null
      ? await this.wsRepo.getTaskWorkspaceKey(taskId)
      : (await db.get<{ workspace_key: string }>(
          "SELECT cs.workspace_key FROM chat_sessions cs WHERE cs.conversation_id = $1",
          [conversationId ?? 0],
        ))?.workspace_key ?? getDefaultWorkspaceKey();

    const engine = this.registry.resolveEngineForModel(workspaceKey, execRow.model);
    await engine.resume(executionId, { type: "shell_approval", decision });

    if (taskId != null) {
      await db.exec("UPDATE tasks SET execution_state = 'running' WHERE id = $1", [taskId]);
      await db.exec(
        "UPDATE executions SET status = 'running', finished_at = NULL WHERE id = $1",
        [executionId],
      );
      this.onTaskUpdated((await fetchTaskWithModel(db, taskId))!);
    } else if (conversationId != null) {
      await db.exec("UPDATE chat_sessions SET status = 'running' WHERE conversation_id = $1", [conversationId]);
      await db.exec(
        "UPDATE executions SET status = 'running', finished_at = NULL WHERE id = $1",
        [executionId],
      );
    }
  }

  async compactTask(taskId: number): Promise<void> {
    const db = this.db;
    const task = await db.get<TaskRow & { conversation_model: string | null }>(
      `SELECT t.*, c.model AS conversation_model FROM tasks t LEFT JOIN conversations c ON c.id = t.conversation_id WHERE t.id = $1`,
      [taskId],
    );
    if (!task) throw new Error(`Task ${taskId} not found`);
    const workspaceKey = await this.wsRepo.getTaskWorkspaceKey(taskId);
    const engine = this.registry.resolveEngineForModel(workspaceKey, task.conversation_model);
    if (!engine.compact) {
      throw new Error(`Engine for task ${taskId} does not support manual compaction`);
    }
    const workingDirectory = await this.workdirResolver.resolve(task);
    const conversationId = task.conversation_id ?? 0;
    await engine.compact(taskId, conversationId, workingDirectory, workspaceKey);
    const lastMsg = await db.get<ConversationMessageRow>(
      "SELECT * FROM conversation_messages WHERE conversation_id = $1 AND type = 'compaction_summary' ORDER BY id DESC LIMIT 1",
      [conversationId],
    );
    if (lastMsg) {
      this.onNewMessage(mapConversationMessage(lastMsg));
    }
  }

  async compactConversation(conversationId: number, workspaceKey = getDefaultWorkspaceKey()): Promise<void> {
    const config = getWorkspaceConfig(workspaceKey);
    const conversationModel = (await this.db.get<{ model: string | null }>("SELECT model FROM conversations WHERE id = $1", [conversationId]))?.model;
    const engine = this.registry.resolveEngineForModel(workspaceKey, conversationModel);
    if (!engine.compact) {
      throw new Error(`Engine for conversation ${conversationId} does not support manual compaction`);
    }
    const workingDirectory = getEffectiveWorkspacePath(config);
    await engine.compact(null, conversationId, workingDirectory, workspaceKey);
    const lastMsg = await this.db.get<ConversationMessageRow>(
      "SELECT * FROM conversation_messages WHERE conversation_id = $1 AND type = 'compaction_summary' ORDER BY id DESC LIMIT 1",
      [conversationId],
    );
    if (lastMsg) {
      this.onNewMessage(mapConversationMessage(lastMsg));
    }
  }
}
