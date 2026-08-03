import type { ConversationMessage } from "../../../shared/rpc-types";
import type { Attachment } from "../../../shared/rpc-types";
import type { Db } from "../../db/db.ts";
import { mapConversationMessage } from "../../db/mappers";
import { appendMessage, ensureTaskConversation } from "../../conversation/messages";
import { fetchTaskWithModel } from "../../db/task-queries";
import { getWorkspaceConfig } from "../../workspace-context";
import { getColumnConfig } from "../../workflow/column-config";
import type { EngineRegistry } from "../engine-registry";
import type { ExecutionParamsBuilder } from "./execution-params-builder";
import type { IWorkingDirectoryResolver } from "./working-directory-resolver";
import type { StreamProcessor } from "../stream/stream-processor";
import type { OnTaskUpdated } from "../types";
import type { TaskRow, ConversationMessageRow } from "../../db/row-types";
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


export class HumanTurnExecutor {

  constructor(
    private readonly db: Db,
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
  ): Promise<{ message: ConversationMessage; executionId: number }> {
    const db = this.db;
    const task = await db.get<TaskRow>(
      `SELECT t.*, c.model AS conversation_model
       FROM tasks t
       LEFT JOIN conversations c ON c.id = t.conversation_id
       WHERE t.id = $1`,
      [taskId],
    );
    if (!task) throw new Error(`Task ${taskId} not found`);
    const workspaceKey = await this.wsRepo.getTaskWorkspaceKey(taskId);
    const config = getWorkspaceConfig(workspaceKey);

    const conversationId = await ensureTaskConversation(db, taskId, task.conversation_id);

    if (task.execution_state === "waiting_user" && task.current_execution_id != null) {
      const msgId = await appendMessage(db, taskId, conversationId, "user", "user", content);
      await db.exec("UPDATE tasks SET execution_state = 'running' WHERE id = $1", [taskId]);
      await db.exec(
        "UPDATE executions SET status = 'running', finished_at = NULL WHERE id = $1",
        [task.current_execution_id],
      );
      this.onTaskUpdated((await fetchTaskWithModel(db, taskId))!);
      const resumeEngine = this.engineRegistry.resolveEngineForModel(workspaceKey, (task as any).conversation_model);
      try {
        await resumeEngine.resume(task.current_execution_id, { type: "ask_user", content: engineContent ?? content });
        const msgRow = (await db
          .get<ConversationMessageRow>("SELECT * FROM conversation_messages WHERE id = $1", [msgId]))!;
        return { message: mapConversationMessage(msgRow), executionId: task.current_execution_id };
      } catch {
        // Roll back optimistic state writes — engine session lost; restart as new execution
        await db.exec(
          `UPDATE executions SET status = 'failed', finished_at = ${db.dialect.now()}, details = 'Engine session lost; restarted as new execution' WHERE id = $1`,
          [task.current_execution_id],
        );
        await db.exec(
          "UPDATE tasks SET execution_state = 'waiting_user', current_execution_id = NULL WHERE id = $1",
          [taskId],
        );

        const conversationModel = await db
          .get<{ model: string | null }>("SELECT model FROM conversations WHERE id = $1", [task.conversation_id]);
        const modelValue = conversationModel?.model ?? null;

        const column = await getColumnConfig(config, task.board_id, task.workflow_state);
        const taskWithModelFallback = { ...task, conversation_model: modelValue };
        const effectiveModel = resolveModel(taskWithModelFallback, column?.model, false);
        const taskForFallback: TaskRow = { ...task, conversation_model: modelValue };
        const execResult = await db.exec(
          `INSERT INTO executions (task_id, conversation_id, from_state, to_state, prompt_id, status, attempt)
           VALUES ($1, $2, $3, $4, 'human-turn', 'running', $5)`,
          [taskId, conversationId, task.workflow_state, task.workflow_state, task.retry_count + 1],
        );
        const newExecutionId = execResult.lastInsertRowid as number;
        await db.exec(
          "UPDATE tasks SET execution_state = 'running', current_execution_id = $1 WHERE id = $2",
          [newExecutionId, taskId],
        );
        this.onTaskUpdated((await fetchTaskWithModel(db, taskId))!);

        const signal = this.streamProcessor.createSignal(newExecutionId);
        const fallbackWorkingDirectory = await this.workdirResolver.resolve(taskForFallback);
        const fallbackTargetEngineId =
          QualifiedModelId.tryParse(effectiveModel)?.engineId ?? config.engines[0]?.id ?? "copilot";
        const fallbackPromptFilter: PromptFilterContext = {
          modelId: effectiveModel ?? "",
          engineId: fallbackTargetEngineId,
          executionType: "task",
          projectPath: fallbackWorkingDirectory,
        };
        const { systemInstructions: fallbackSystemInstructions, stageInstructionsBlock: fallbackStageInstructionsBlock } =
          await this.promptAssemblyService.assemble({
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
            this.streamProcessor.makePersistCallback(taskId, conversationId, newExecutionId),
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
          ? await this.paramsEnricher.enrich(fallbackBase, {
              workspaceKey,
              conversationId,
              columnPreset: column?.sampling_preset,
              model: effectiveModel ?? "",
            })
          : fallbackBase;
        this.streamProcessor.runNonNative(taskId, conversationId, newExecutionId, this.engineRegistry.resolveEngineForModel(workspaceKey, effectiveModel), execParams);

        const msgRow = (await db
          .get<ConversationMessageRow>("SELECT * FROM conversation_messages WHERE id = $1", [msgId]))!;
        return { message: mapConversationMessage(msgRow), executionId: newExecutionId };
      }
    }

    const column = await getColumnConfig(config, task.board_id, task.workflow_state);
    const taskWithModel = { ...task, conversation_model: (task as any).conversation_model };
    const resolvedModel = resolveModel(taskWithModel, column?.model, false);
    if (resolvedModel && !task.conversation_model) {
      await db.exec("UPDATE conversations SET model = $1 WHERE id = $2", [resolvedModel, task.conversation_id]);
    }
    const taskForExecution: TaskRow = resolvedModel ? { ...task, conversation_model: resolvedModel } : task;

    const execResult = await db.exec(
      `INSERT INTO executions (task_id, conversation_id, from_state, to_state, prompt_id, status, attempt)
       VALUES ($1, $2, $3, $4, 'human-turn', 'running', $5)`,
      [taskId, conversationId, task.workflow_state, task.workflow_state, task.retry_count + 1],
    );
    const executionId = execResult.lastInsertRowid as number;
    await db.exec(
      "UPDATE tasks SET execution_state = 'running', current_execution_id = $1 WHERE id = $2",
      [executionId, taskId],
    );
    this.onTaskUpdated((await fetchTaskWithModel(db, taskId))!);

    const resolvedPrompt = engineContent ?? content;
    const msgId = await appendMessage(db, taskId, conversationId, "user", "user", content);

    const signal = this.streamProcessor.createSignal(executionId);
    const workingDirectory = await this.workdirResolver.resolve(taskForExecution);
    const targetEngineId = QualifiedModelId.tryParse(resolvedModel)?.engineId ?? config.engines[0]?.id ?? "copilot";
    const engine = this.engineRegistry.resolveEngineForModel(workspaceKey, resolvedModel);
    const targetModelInfo = (await engine.listModels()).find(m => m.qualifiedId === resolvedModel);
    const { historyBlock } = await this.crossEngineInjector.prepareSwitch(
      conversationId,
      targetEngineId,
      targetModelInfo,
      workingDirectory,
      workspaceKey,
      msgId,
    );
    const { decisionsBlock } = await this.decisionInjector.prepare(conversationId);

    // Build system instructions + stageInstructionsBlock via the shared collaborator
    const promptFilter: PromptFilterContext = {
      modelId: resolvedModel ?? "",
      engineId: targetEngineId,
      executionType: "task",
      projectPath: workingDirectory,
    };
    const { systemInstructions, stageInstructionsBlock } = await this.promptAssemblyService.assemble({
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
        this.streamProcessor.makePersistCallback(taskId, conversationId, executionId),
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
      ? await this.paramsEnricher.enrich(baseParams, {
          workspaceKey,
          conversationId,
          columnPreset: column?.sampling_preset,
          model: resolvedModel ?? "",
        })
      : baseParams;
    this.streamProcessor.runNonNative(taskId, conversationId, executionId, engine, execParams);
    await db.exec("UPDATE conversations SET last_engine_type = $1 WHERE id = $2", [targetEngineId, conversationId]);

    const msgRow = (await db
      .get<ConversationMessageRow>("SELECT * FROM conversation_messages WHERE id = $1", [msgId]))!;
    return { message: mapConversationMessage(msgRow), executionId };
  }
}
