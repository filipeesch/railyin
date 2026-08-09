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

import type { OnError, OnTaskUpdated, EngineShutdownOptions, EngineModelInfo } from "./types.ts";
import type { Task } from "../../shared/rpc-types.ts";
import type { ExecutionCoordinator } from "./coordinator.ts";
import { mapTask } from "../db/mappers.ts";
import { fetchTaskWithModel } from "../db/task-queries.ts";
import type { Database } from "bun:sqlite";
import { runWithConfig } from "../config/index.ts";
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
import { CrossEngineContextInjector } from "../conversation/cross-engine-context.ts";
import { DecisionContextInjector } from "../conversation/decision-context-injector.ts";
import { StageInstructionsInjector } from "../conversation/stage-instructions-injector.ts";
import type { ModelSettingsRepository } from "../db/repositories/model-settings-repository.ts";
import { CustomPromptInjector } from "./execution/custom-prompt-injector.ts";
import { PromptAssemblyService } from "./execution/prompt-assembly-service.ts";
import { SlashCommandResolver } from "./execution/slash-command-resolver.ts";
import { ExecutionParamsEnricher } from "./execution/execution-params-enricher.ts";
import type { McpRegistryPool } from "../mcp/registry-pool.ts";
import type { BoardRunLogger } from "../copilotkit/board-run-logger.ts";

export class Orchestrator implements ExecutionCoordinator {
  private readonly db: Database;
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
  /** Default chat_sessions status callback — wired into every chat/human turn so
   * the session sidebar flips running → idle even when AG-UI callers pass no opts. */
  private readonly sessionStatusCb: (conversationId: number) => void;

  constructor(
    db: Database,
    registry: EngineRegistry,
    onError: OnError,
    onTaskUpdated: OnTaskUpdated,
    wsRepo: IWorkspaceRepository,
    onSessionStatusChange?: (conversationId: number) => void,
    worktreeManager?: WorktreeManager,
    modelSettingsRepo?: ModelSettingsRepository,
    registryPool?: McpRegistryPool,
    /** WR-01: board-driven runs' AG-UI/JSONL tap (transitions/retries/code-review/RPC turns). */
    boardRunLogger?: BoardRunLogger,
  ) {
    this.db = db;
    this.registry = registry;
    this.onTaskUpdated = onTaskUpdated;
    this.wsRepo = wsRepo;
    this.sessionStatusCb = onSessionStatusChange ?? (() => {});

    const boardTools = new BoardToolExecutor(db, wsRepo, worktreeManager);

    this.streamProcessor = new StreamProcessor(
      db, () => {}, onError, onTaskUpdated,
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
      boardRunLogger,
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
      boardRunLogger,
    );
    this.retryExecutor = new RetryExecutor(db, registry, this.paramsBuilder, this.workdirResolver, this.streamProcessor, wsRepo, boardTools, promptAssemblyService, slashCommandResolver, paramsEnricher, boardRunLogger);
    this.codeReviewExecutor = new CodeReviewExecutor(db, registry, this.paramsBuilder, this.workdirResolver, this.streamProcessor, onTaskUpdated, wsRepo, boardTools, promptAssemblyService, undefined, boardRunLogger);
    this.chatExecutor = new ChatExecutor(db, registry, this.paramsBuilder, this.streamProcessor, this.workdirResolver, customPromptInjector, crossEngineInjector, slashCommandResolver, paramsEnricher, boardTools);
  }

  // ─── Execution dispatch ─────────────────────────────────────────────────────

  executeTransition(taskId: number, toState: string): Promise<{ task: Task; executionId: number | null }> {
    return this.transitionExecutor.execute(taskId, toState);
  }

  /**
   * Merges the orchestrator-level session-status default into caller opts so the
   * chatSession.updated push fires even when AG-UI callers pass no onSessionStatusChange.
   */
  private mergeSessionStatusOpts(opts?: import("./coordinator.ts").ChatTurnOpts): import("./coordinator.ts").ChatTurnOpts | undefined {
    if (!opts) return { onSessionStatusChange: this.sessionStatusCb };
    return { ...opts, onSessionStatusChange: opts.onSessionStatusChange ?? this.sessionStatusCb };
  }

  executeHumanTurn(
    taskId: number,
    content: string,
    attachments?: import("../../shared/rpc-types.ts").Attachment[],
    engineContent?: string,
    opts?: import("./coordinator.ts").ChatTurnOpts,
  ): Promise<{ executionId: number }> {
    return this.humanTurnExecutor.execute(taskId, content, attachments, engineContent, this.mergeSessionStatusOpts(opts));
  }

  executeRetry(taskId: number): Promise<{ executionId: number }> {
    return this.retryExecutor.execute(taskId);
  }

  executeCodeReview(
    taskId: number,
    manualEdits?: import("../../shared/rpc-types.ts").ManualEdit[],
  ): Promise<{ executionId: number }> {
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
    opts?: import("./coordinator.ts").ChatTurnOpts,
  ): Promise<{ executionId: number }> {
    return this.chatExecutor.execute(sessionId, conversationId, content, model, enabledMcpTools, workspaceKey, attachments, engineContent, this.mergeSessionStatusOpts(opts));
  }

  // ─── Cancellation ──────────────────────────────────────────────────────────

  cancel(executionId: number): void {
    this.streamProcessor.abort(executionId);

    const db = this.db;
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
        const taskRow = fetchTaskWithModel(db, taskId);
        if (taskRow) {
          this.onTaskUpdated(taskRow);
        }
      }
    } else if (execRow.status === "running" && execRow.finished_at == null) {
      db.run("UPDATE executions SET status = 'cancelled', finished_at = datetime('now') WHERE id = ?", [executionId]);
      if (conversationId) {
        db.run("UPDATE chat_sessions SET status = 'idle' WHERE conversation_id = ?", [conversationId]);
        // WR-05: the session-status push must fire here too — consume()'s
        // abort path normally emits it, but in the window where consume()
        // never observes the abort (executor failure between the row insert
        // and runNonNative, or an engine whose generator ends without
        // yielding — see WR-02) this direct write is the only status change
        // and the sidebar would stay stuck on 'running' (Pitfall-2 gap).
        this.sessionStatusCb(conversationId);
      }
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
    const task = db.query<{ board_id: number; conversation_id: number | null }, [number]>(
      "SELECT board_id, conversation_id FROM tasks WHERE id = ?",
    ).get(taskId);
    if (!task) return [];
    const key = this.wsRepo.getBoardWorkspaceKey(task.board_id);
    const config = getWorkspaceConfig(key);
    const conversationModel = task.conversation_id
      ? (db.prepare("SELECT model FROM conversations WHERE id = ?").get(task.conversation_id) as { model: string | null } | undefined)?.model
      : null;
    const engine = this.registry.resolveEngineForModel(key, conversationModel);
    return runWithConfig(config, () => engine.listCommands(taskId));
  }

  async shutdownNonNativeEngines(options: EngineShutdownOptions = { reason: "app-exit", deadlineMs: 3_000 }): Promise<void> {
    return this.registry.shutdown(options);
  }
}
