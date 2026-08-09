import type { Attachment } from "../../../shared/rpc-types";
import type { Database } from "bun:sqlite";
import { ensureTaskConversation } from "../../db/task-queries";
import { fetchTaskWithModel } from "../../db/task-queries";
import { getWorkspaceConfig } from "../../workspace-context";
import { getColumnConfig } from "../../workflow/column-config";
import type { EngineRegistry } from "../engine-registry";
import type { ExecutionParamsBuilder } from "./execution-params-builder";
import type { IWorkingDirectoryResolver } from "./working-directory-resolver";
import type { StreamProcessor } from "../stream/stream-processor";
import type { OnTaskUpdated } from "../types";
import type { TaskRow } from "../../db/row-types";
import type { IWorkspaceRepository } from "../../db/workspace-repository";
import type { IBoardToolExecutor } from "../../workflow/tools/board-tool-executor";
import { resolveModel } from "./model-resolver";
import { QualifiedModelId } from "../qualified-model-id";
import { CrossEngineContextInjector } from "../../conversation/cross-engine-context.ts";
import { DecisionContextInjector } from "../../conversation/decision-context-injector.ts";
import { PromptAssemblyService } from "./prompt-assembly-service.ts";
import type { PromptFilterContext } from "./custom-prompt-injector.ts";
import type { ExecutionParamsEnricher } from "./execution-params-enricher.ts";
import { SlashCommandResolver } from "./slash-command-resolver.ts";
import type { ChatTurnOpts } from "../coordinator.ts";


export class HumanTurnExecutor {

  constructor(
    private readonly db: Database,
    private readonly engineRegistry: EngineRegistry,
    private readonly paramsBuilder: ExecutionParamsBuilder,
    private readonly workdirResolver: IWorkingDirectoryResolver,
    private readonly streamProcessor: StreamProcessor,
    private readonly onTaskUpdated: OnTaskUpdated,
    private readonly wsRepo: IWorkspaceRepository,
    private readonly boardTools: IBoardToolExecutor,
    private readonly crossEngineInjector: CrossEngineContextInjector,
    private readonly decisionInjector: DecisionContextInjector,
    private readonly promptAssemblyService: PromptAssemblyService,
    private readonly slashCommandResolver: SlashCommandResolver,
    private readonly onTransitionCallback?: (taskId: number, toState: string) => void,
    private readonly onHumanTurnCallback?: (taskId: number, message: string) => void,
    private readonly paramsEnricher?: ExecutionParamsEnricher,
  ) {}

  async execute(
    taskId: number,
    content: string,
    attachments?: Attachment[],
    engineContent?: string,
    opts?: ChatTurnOpts,
  ): Promise<{ executionId: number }> {
    const db = this.db;
    const task = db.query<TaskRow, [number]>(
      `SELECT t.*, c.model AS conversation_model 
       FROM tasks t 
       LEFT JOIN conversations c ON c.id = t.conversation_id 
       WHERE t.id = ?`
    ).get(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    const workspaceKey = this.wsRepo.getTaskWorkspaceKey(taskId);
    const config = getWorkspaceConfig(workspaceKey);

    const conversationId = ensureTaskConversation(db, taskId, task.conversation_id);

    if (task.execution_state === "waiting_user" && task.current_execution_id != null) {
      // 07-01: the engine-level ask_user/shell_approval resume channel died
      // with EngineResumeInput (the only resume channel is decision_request,
      // which flows through the AG-UI bridge via forwardedProps and arrives
      // here as a fresh human turn). A new turn on a paused task therefore
      // finalizes the old row (IN-03 status-filtered — a row the AG-UI resume
      // branch already finalized to 'completed' is never clobbered) and
      // continues as a NEW execution.
      db.run("UPDATE tasks SET execution_state = 'running' WHERE id = ?", [taskId]);
      db.run(
        "UPDATE executions SET status = 'running', finished_at = NULL WHERE id = ? AND status = 'waiting_user'",
        [task.current_execution_id],
      );
      this.onTaskUpdated(fetchTaskWithModel(db, taskId)!);

      db.run(
        "UPDATE executions SET status = 'failed', finished_at = datetime('now'), details = 'Engine session lost; restarted as new execution' WHERE id = ? AND status = 'running'",
        [task.current_execution_id],
      );
      db.run(
        "UPDATE tasks SET execution_state = 'waiting_user', current_execution_id = NULL WHERE id = ?",
        [taskId],
      );

      const conversationModel = db
        .prepare("SELECT model FROM conversations WHERE id = ?")
        .get(task.conversation_id) as { model: string | null } | undefined;
      const modelValue = conversationModel?.model ?? null;

      const column = getColumnConfig(config, task.board_id, task.workflow_state);
      const taskWithModelFallback = { ...task, conversation_model: modelValue };
      const effectiveModel = resolveModel(taskWithModelFallback, column?.model, false);
      const taskForFallback: TaskRow = { ...task, conversation_model: modelValue };
      const execResult = db.run(
        `INSERT INTO executions (task_id, conversation_id, from_state, to_state, prompt_id, status, attempt)
         VALUES (?, ?, ?, ?, 'human-turn', 'running', ?)`,
        [taskId, conversationId, task.workflow_state, task.workflow_state, task.retry_count + 1],
      );
      const newExecutionId = execResult.lastInsertRowid as number;
      db.run(
        "UPDATE tasks SET execution_state = 'running', current_execution_id = ? WHERE id = ?",
        [newExecutionId, taskId],
      );
      this.onTaskUpdated(fetchTaskWithModel(db, taskId)!);

      const signal = this.streamProcessor.createSignal(newExecutionId);
      const fallbackWorkingDirectory = this.workdirResolver.resolve(taskForFallback);
      const fallbackTargetEngineId =
        QualifiedModelId.tryParse(effectiveModel)?.engineId ?? config.engines[0]?.id ?? "copilot";
      const fallbackPromptFilter: PromptFilterContext = {
        modelId: effectiveModel ?? "",
        engineId: fallbackTargetEngineId,
        executionType: "task",
        projectPath: fallbackWorkingDirectory,
      };
      const { systemInstructions: fallbackSystemInstructions, stageInstructionsBlock: fallbackStageInstructionsBlock } =
        this.promptAssemblyService.assemble({
          config,
          boardId: task.board_id,
          columnId: task.workflow_state,
          conversationId,
          promptFilter: fallbackPromptFilter,
          isTransition: false,
        });
      const fallbackResolvedTail = await this.slashCommandResolver.resolve(
        config,
        fallbackTargetEngineId,
        engineContent ?? content,
        fallbackWorkingDirectory,
        config.projects.find((p) => p.key === taskForFallback.project_key)?.projectPath,
      );
      const fallbackUserContent = [fallbackStageInstructionsBlock, fallbackResolvedTail].filter(Boolean).join("\n\n");
      const fallbackBase = {
        ...this.paramsBuilder.build(
          taskForFallback,
          conversationId,
          newExecutionId,
          fallbackUserContent,
          fallbackSystemInstructions,
          fallbackWorkingDirectory,
          signal,
          attachments,
          undefined,
          config.projects.find((p) => p.key === taskForFallback.project_key)?.projectPath,
          workspaceKey,
        ),
        boardTools: this.boardTools,
        onSoftCancel: () => this.streamProcessor.abort(newExecutionId),
        ...(this.onTransitionCallback ? { onTransition: this.onTransitionCallback } : {}),
        ...(this.onHumanTurnCallback ? { onHumanTurn: this.onHumanTurnCallback } : {}),
      };
      const execParams = this.paramsEnricher
        ? this.paramsEnricher.enrich(fallbackBase, {
            workspaceKey,
            conversationId,
            columnPreset: column?.sampling_preset,
            model: effectiveModel ?? "",
          })
        : fallbackBase;
      this.streamProcessor.runNonNative(taskId, conversationId, newExecutionId, this.engineRegistry.resolveEngineForModel(workspaceKey, effectiveModel), execParams, opts);

      return { executionId: newExecutionId };
    }

    const column = getColumnConfig(config, task.board_id, task.workflow_state);
    const taskWithModel = { ...task, conversation_model: (task as any).conversation_model };
    const resolvedModel = resolveModel(taskWithModel, column?.model, false);
    if (resolvedModel && !task.conversation_model) {
      db.run("UPDATE conversations SET model = ? WHERE id = ?", [resolvedModel, task.conversation_id]);
    }
    const taskForExecution: TaskRow = resolvedModel ? { ...task, conversation_model: resolvedModel } : task;

    const execResult = db.run(
      `INSERT INTO executions (task_id, conversation_id, from_state, to_state, prompt_id, status, attempt)
       VALUES (?, ?, ?, ?, 'human-turn', 'running', ?)`,
      [taskId, conversationId, task.workflow_state, task.workflow_state, task.retry_count + 1],
    );
    const executionId = execResult.lastInsertRowid as number;
    db.run(
      "UPDATE tasks SET execution_state = 'running', current_execution_id = ? WHERE id = ?",
      [executionId, taskId],
    );
    this.onTaskUpdated(fetchTaskWithModel(db, taskId)!);

    const resolvedPrompt = engineContent ?? content;

    const signal = this.streamProcessor.createSignal(executionId);
    const workingDirectory = this.workdirResolver.resolve(taskForExecution);
    const targetEngineId = QualifiedModelId.tryParse(resolvedModel)?.engineId ?? config.engines[0]?.id ?? "copilot";
    const engine = this.engineRegistry.resolveEngineForModel(workspaceKey, resolvedModel);
    const targetModelInfo = (await engine.listModels()).find(m => m.qualifiedId === resolvedModel);
    const { historyBlock } = await this.crossEngineInjector.prepareSwitch(
      conversationId,
      targetEngineId,
      targetModelInfo,
      workingDirectory,
      workspaceKey,
      engine.type,
    );
    const { decisionsBlock } = this.decisionInjector.prepare(conversationId);

    // Build system instructions + stageInstructionsBlock via the shared collaborator
    const promptFilter: PromptFilterContext = {
      modelId: resolvedModel ?? "",
      engineId: targetEngineId,
      executionType: "task",
      projectPath: workingDirectory,
    };
    const { systemInstructions, stageInstructionsBlock } = this.promptAssemblyService.assemble({
      config,
      boardId: task.board_id,
      columnId: task.workflow_state,
      conversationId,
      promptFilter,
      isTransition: false,
    });

    // Resolve slash-command references in the raw tail BEFORE joining with
    // historyBlock/decisionsBlock/stageInstructionsBlock — SlashCommandDialect only
    // matches a leading "/command" anchored at the start of the string.
    const resolvedTail = await this.slashCommandResolver.resolve(
      config,
      targetEngineId,
      resolvedPrompt,
      workingDirectory,
      config.projects.find((p) => p.key === taskForExecution.project_key)?.projectPath,
    );

    const userContent = [historyBlock, decisionsBlock, stageInstructionsBlock, resolvedTail].filter(Boolean).join("\n\n");

    const baseParams = {
      ...this.paramsBuilder.build(
        taskForExecution,
        conversationId,
        executionId,
        userContent,
        systemInstructions,
        workingDirectory,
        signal,
        attachments,
        undefined,
        config.projects.find((p) => p.key === taskForExecution.project_key)?.projectPath,
        workspaceKey,
      ),
      boardTools: this.boardTools,
      onSoftCancel: () => this.streamProcessor.abort(executionId),
      ...(this.onTransitionCallback ? { onTransition: this.onTransitionCallback } : {}),
      ...(this.onHumanTurnCallback ? { onHumanTurn: this.onHumanTurnCallback } : {}),
    };

    const execParams = this.paramsEnricher
      ? this.paramsEnricher.enrich(baseParams, {
          workspaceKey,
          conversationId,
          columnPreset: column?.sampling_preset,
          model: resolvedModel ?? "",
        })
      : baseParams;
    this.streamProcessor.runNonNative(taskId, conversationId, executionId, engine, execParams, opts);
    db.run("UPDATE conversations SET last_engine_type = ? WHERE id = ?", [targetEngineId, conversationId]);

    return { executionId };
  }
}
