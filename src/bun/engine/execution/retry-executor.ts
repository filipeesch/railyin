import type { Task } from "../../../shared/rpc-types.ts";
import { QualifiedModelId } from "../qualified-model-id";
import type { Db } from "../../db/db.ts";
import { fetchTaskWithModel } from "../../db/task-queries.ts";
import { appendMessage, ensureTaskConversation } from "../../conversation/messages";
import { getWorkspaceConfig } from "../../workspace-context";
import { getColumnConfig } from "../../workflow/column-config";
import type { EngineRegistry } from "../engine-registry.ts";
import type { ExecutionParamsBuilder } from "./execution-params-builder.ts";
import type { IWorkingDirectoryResolver } from "./working-directory-resolver.ts";
import type { StreamProcessor } from "../stream/stream-processor.ts";
import type { TaskRow } from "../../db/row-types.ts";
import type { IWorkspaceRepository } from "../../db/workspace-repository.ts";
import type { IBoardToolExecutor } from "../../workflow/tools/board-tool-executor.ts";
import { resolveModel } from "./model-resolver";
import { PromptAssemblyService } from "./prompt-assembly-service.ts";
import type { PromptFilterContext } from "./custom-prompt-injector.ts";
import type { ExecutionParamsEnricher } from "./execution-params-enricher.ts";
import { SlashCommandResolver } from "./slash-command-resolver.ts";


export class RetryExecutor {
  constructor(
    private readonly db: Db,
    private readonly engineRegistry: EngineRegistry,
    private readonly paramsBuilder: ExecutionParamsBuilder,
    private readonly workdirResolver: IWorkingDirectoryResolver,
    private readonly streamProcessor: StreamProcessor,
    private readonly wsRepo: IWorkspaceRepository,
    private readonly boardTools: IBoardToolExecutor,
    private readonly promptAssemblyService: PromptAssemblyService,
    private readonly slashCommandResolver: SlashCommandResolver,
    private readonly paramsEnricher?: ExecutionParamsEnricher,
  ) {}

  async execute(taskId: number): Promise<{ task: Task; executionId: number }> {
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
    await db.exec("UPDATE tasks SET retry_count = retry_count + 1 WHERE id = $1", [taskId]);
    const attempt = (task.retry_count ?? 0) + 1;

    const column = await getColumnConfig(config, task.board_id, task.workflow_state);
    const taskWithModel = { ...task, conversation_model: (task as any).conversation_model };
    const effectiveModel = resolveModel(taskWithModel, column?.model, false);
    const engine = this.engineRegistry.resolveEngineForModel(workspaceKey, effectiveModel);

    const execResult = await db.exec(
      `INSERT INTO executions (task_id, conversation_id, from_state, to_state, prompt_id, status, attempt)
       VALUES ($1, $2, $3, $4, $5, 'running', $6)`,
      [taskId, conversationId, task.workflow_state, task.workflow_state, column?.id ?? "retry", attempt],
    );
    const executionId = execResult.lastInsertRowid as number;
    await db.exec(
      "UPDATE tasks SET execution_state = 'running', current_execution_id = $1 WHERE id = $2",
      [executionId, taskId],
    );
    await appendMessage(db, taskId, conversationId, "system", null, `Retry attempt ${attempt}`);

    const updatedRow = (await db.get<TaskRow & { conversation_model: string | null }>(
      `SELECT t.*, c.model AS conversation_model
       FROM tasks t
       LEFT JOIN conversations c ON c.id = t.conversation_id
       WHERE t.id = $1`,
      [taskId],
    ))!;
    const retryPrompt = column?.on_enter_prompt ?? "Please continue with the task.";

    const signal = this.streamProcessor.createSignal(executionId);

    // Build system instructions + stageInstructionsBlock via the shared collaborator
    const promptFilter: PromptFilterContext = {
      modelId: effectiveModel ?? "",
      engineId: QualifiedModelId.tryParse(effectiveModel)?.engineId ?? config.engines[0]?.id ?? "copilot",
      executionType: "task",
      projectPath: await this.workdirResolver.resolve(updatedRow),
    };
    const { systemInstructions, stageInstructionsBlock } = await this.promptAssemblyService.assemble({
      config,
      boardId: task.board_id,
      columnId: task.workflow_state,
      conversationId,
      promptFilter,
      isTransition: false,
    });

    // Resolve slash-command references in the raw retry prompt (on_enter_prompt) BEFORE
    // joining with stageInstructionsBlock — SlashCommandDialect only matches a leading
    // "/command" anchored at the start of the string.
    const resolvedRetryPrompt = await this.slashCommandResolver.resolve(
      config,
      promptFilter.engineId,
      retryPrompt,
      promptFilter.projectPath ?? await this.workdirResolver.resolve(updatedRow),
      config.projects.find((p) => p.key === updatedRow.project_key)?.projectPath,
    );

    const retryContent = [stageInstructionsBlock, resolvedRetryPrompt].filter(Boolean).join("\n\n");

    const retryBase = {
      ...this.paramsBuilder.build(
        updatedRow,
        conversationId,
        executionId,
        retryContent,
        systemInstructions,
        await this.workdirResolver.resolve(updatedRow),
        signal,
        this.streamProcessor.makePersistCallback(taskId, conversationId, executionId),
        undefined,
        undefined,
        config.projects.find((p) => p.key === updatedRow.project_key)?.projectPath,
        workspaceKey,
      ),
      boardTools: this.boardTools,
      onSoftCancel: () => this.streamProcessor.abort(executionId),
      model: resolveModel(updatedRow, null, false) ?? "",
    };

    const execParams = this.paramsEnricher
      ? await this.paramsEnricher.enrich(retryBase, {
          workspaceKey,
          conversationId,
          columnPreset: column?.sampling_preset,
          model: effectiveModel ?? "",
        })
      : retryBase;
    this.streamProcessor.runNonNative(taskId, conversationId, executionId, engine, execParams);

    return { task: (await fetchTaskWithModel(db, taskId))!, executionId };
  }
}
