import type { Task, TransitionEventMetadata } from "../../../shared/rpc-types";
import type { Db } from "../../db/db.ts";
import { fetchTaskWithModel } from "../../db/task-queries.ts";
import { appendMessage } from "../../conversation/messages";
import { getWorkspaceConfig } from "../../workspace-context";
import { getColumnConfig } from "../../workflow/column-config";
import type { EngineRegistry } from "../engine-registry";
import type { ExecutionParamsBuilder } from "./execution-params-builder";
import type { IWorkingDirectoryResolver } from "./working-directory-resolver";
import type { StreamProcessor } from "../stream/stream-processor";
import type { TaskRow } from "../../db/row-types";

import { resolveModel } from "./model-resolver";
import type { IBoardToolExecutor } from "../../workflow/tools/board-tool-executor";
import type { IWorkspaceRepository } from "../../db/workspace-repository";
import { QualifiedModelId } from "../qualified-model-id";
import { CrossEngineContextInjector } from "../../conversation/cross-engine-context.ts";
import { DecisionContextInjector } from "../../conversation/decision-context-injector.ts";
import { PromptAssemblyService } from "./prompt-assembly-service.ts";
import type { PromptFilterContext } from "./custom-prompt-injector.ts";
import type { ExecutionParamsEnricher } from "./execution-params-enricher.ts";
import { SlashCommandResolver } from "./slash-command-resolver.ts";


export class TransitionExecutor {
  constructor(
    private readonly db: Db,
    private readonly engineRegistry: EngineRegistry,
    private readonly paramsBuilder: ExecutionParamsBuilder,
    private readonly workdirResolver: IWorkingDirectoryResolver,
    private readonly streamProcessor: StreamProcessor,
    private readonly boardTools: IBoardToolExecutor,
    private readonly wsRepo: IWorkspaceRepository,
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
    toState: string,
  ): Promise<{ task: Task; executionId: number | null }> {
    const db = this.db;
    const task = await db.get<TaskRow>(
      `SELECT t.*, c.model AS conversation_model
       FROM tasks t
       LEFT JOIN conversations c ON c.id = t.conversation_id
       WHERE t.id = $1`,
      [taskId],
    );
    if (!task) throw new Error(`Task ${taskId} not found`);
    const workspaceKey = await this.wsRepo.getBoardWorkspaceKey(task.board_id);
    const config = getWorkspaceConfig(workspaceKey);

    let conversationId = task.conversation_id;
    if (conversationId == null) {
      const convResult = await db.exec("INSERT INTO conversations (task_id) VALUES ($1) RETURNING id", [taskId]);
      conversationId = (convResult.rows[0] as { id: number }).id;
      await db.exec("UPDATE tasks SET conversation_id = $1 WHERE id = $2", [conversationId, taskId]);
    }

    const fromState = task.workflow_state;
    await db.exec("UPDATE tasks SET workflow_state = $1 WHERE id = $2", [toState, taskId]);

    const column = await getColumnConfig(config, task.board_id, toState);

    // Use centralized model resolver with isColumnTransition=true
    const taskWithModel = { ...task, conversation_model: (task as any).conversation_model };
    const effectiveModel = resolveModel(taskWithModel, column?.model, true);
    const engine = this.engineRegistry.resolveEngineForModel(workspaceKey, effectiveModel);

    if (!column?.on_enter_prompt) {
      await appendMessage(db, taskId, conversationId, "transition_event", null, "", { from: fromState, to: toState });
      await db.exec("UPDATE tasks SET execution_state = 'idle' WHERE id = $1", [taskId]);
      return { task: (await fetchTaskWithModel(db, taskId))!, executionId: null };
    }

    const resolvedPrompt = column.on_enter_prompt;
    const updatedRow = (await db.get<TaskRow>(
      `SELECT t.*, c.model AS conversation_model
       FROM tasks t
       LEFT JOIN conversations c ON c.id = t.conversation_id
       WHERE t.id = $1`,
      [taskId],
    ))!;
    const workingDirectory = await this.workdirResolver.resolve(updatedRow);
    const targetEngineId = QualifiedModelId.tryParse(effectiveModel)?.engineId ?? config.engines[0]?.id ?? "copilot";
    const transitionMetadata = this.buildTransitionMetadata(
      targetEngineId,
      fromState,
      toState,
      resolvedPrompt,
      workingDirectory,
    );
    await appendMessage(db, taskId, conversationId, "transition_event", null, "", transitionMetadata as unknown as Record<string, unknown>);

    const execResult = await db.exec(
      `INSERT INTO executions (task_id, conversation_id, from_state, to_state, prompt_id, status, attempt)
       VALUES ($1, $2, $3, $4, $5, 'running', 1)
       RETURNING id`,
      [taskId, conversationId, fromState, toState, column.id],
    );
    const executionId = (execResult.rows[0] as { id: number }).id;
    await db.exec(
      "UPDATE tasks SET execution_state = 'running', current_execution_id = $1 WHERE id = $2",
      [executionId, taskId],
    );

    const freshTask = (await fetchTaskWithModel(db, taskId))!;
    const signal = this.streamProcessor.createSignal(executionId);

    const targetModelInfo = (await engine.listModels()).find(m => m.qualifiedId === effectiveModel);
    const { historyBlock } = await this.crossEngineInjector.prepareSwitch(
      conversationId,
      targetEngineId,
      targetModelInfo,
      workingDirectory,
      workspaceKey,
    );
    const { decisionsBlock } = await this.decisionInjector.prepare(conversationId);

    // Build system instructions + stageInstructionsBlock via the shared collaborator
    const promptFilter: PromptFilterContext = {
      modelId: effectiveModel ?? "",
      engineId: targetEngineId,
      executionType: "task",
      projectPath: workingDirectory,
    };
    const { systemInstructions, stageInstructionsBlock } = await this.promptAssemblyService.assemble({
      config,
      boardId: task.board_id,
      columnId: toState,
      conversationId,
      promptFilter,
      isTransition: true,
    });

    // Resolve slash-command references in the raw on_enter_prompt tail BEFORE joining
    // with historyBlock/decisionsBlock/stageInstructionsBlock — SlashCommandDialect only
    // matches a leading "/command" anchored at the start of the string.
    const projectPath = config.projects.find((p) => p.key === task.project_key)?.projectPath;
    const resolvedTail = await this.slashCommandResolver.resolve(config, targetEngineId, resolvedPrompt, workingDirectory, projectPath);

    const userContent = [historyBlock, decisionsBlock, stageInstructionsBlock, resolvedTail].filter(Boolean).join("\n\n");

    const baseParams = {
      ...this.paramsBuilder.build(
        updatedRow,
        conversationId,
        executionId,
        userContent,
        systemInstructions,
        workingDirectory,
        signal,
        this.streamProcessor.makePersistCallback(taskId, conversationId, executionId),
        undefined,
        effectiveModel ?? undefined,
        config.projects.find((p) => p.key === task.project_key)?.projectPath,
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
          columnPreset: column.sampling_preset,
          model: effectiveModel ?? "",
        })
      : baseParams;

    this.streamProcessor.runNonNative(taskId, conversationId, executionId, engine, execParams);
    await db.exec("UPDATE conversations SET last_engine_type = $1 WHERE id = $2", [targetEngineId, conversationId]);
    return { task: (await fetchTaskWithModel(db, taskId))!, executionId };
  }

  private buildTransitionMetadata(
    _engineId: string,
    fromState: string,
    toState: string,
    prompt: string,
    _workingDirectory: string,
  ): TransitionEventMetadata {
    const sourceKind = prompt.trimStart().startsWith("/") ? "slash" : "inline";

    return {
      from: fromState,
      to: toState,
      instructionDetail: {
        displayText: prompt,
        sourceText: prompt,
        sourceKind,
        ...(sourceKind === "slash" ? { sourceRef: prompt.trim().split(/\s+/, 1)[0] } : {}),
      },
    };
  }
}
