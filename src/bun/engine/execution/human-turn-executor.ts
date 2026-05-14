import type { ConversationMessage } from "../../../shared/rpc-types";
import type { Attachment } from "../../../shared/rpc-types";
import type { Database } from "bun:sqlite";
import { mapTask, mapConversationMessage } from "../../db/mappers";
import { appendMessage, ensureTaskConversation } from "../../conversation/messages";
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
import type { ModelSettingsRepository } from "../../db/repositories/model-settings-repository.ts";
import { SystemPromptAssembler } from "./system-prompt-assembler.ts";
import { CustomPromptInjector, type PromptFilterContext } from "./custom-prompt-injector.ts";


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
    private readonly customPromptInjector: CustomPromptInjector,
    private readonly onTransitionCallback?: (taskId: number, toState: string) => void,
    private readonly onHumanTurnCallback?: (taskId: number, message: string) => void,
    private readonly modelSettingsRepo?: ModelSettingsRepository,
  ) {}

  async execute(
    taskId: number,
    content: string,
    attachments?: Attachment[],
    engineContent?: string,
  ): Promise<{ message: ConversationMessage; executionId: number }> {
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
      const msgId = appendMessage(db, taskId, conversationId, "user", "user", content);
      db.run("UPDATE tasks SET execution_state = 'running' WHERE id = ?", [taskId]);
      db.run(
        "UPDATE executions SET status = 'running', finished_at = NULL WHERE id = ?",
        [task.current_execution_id],
      );
      this.onTaskUpdated(mapTask(db.query<TaskRow, [number]>(
        `SELECT t.*, c.model AS conversation_model 
         FROM tasks t 
         LEFT JOIN conversations c ON c.id = t.conversation_id 
         WHERE t.id = ?`
      ).get(taskId)!));
      const resumeEngine = this.engineRegistry.resolveEngineForModel(workspaceKey, (task as any).conversation_model);
      try {
        await resumeEngine.resume(task.current_execution_id, { type: "ask_user", content: engineContent ?? content });
        const msgRow = db
          .query<ConversationMessageRow, [number]>("SELECT * FROM conversation_messages WHERE id = ?")
          .get(msgId)!;
        return { message: mapConversationMessage(msgRow), executionId: task.current_execution_id };
      } catch {
        // Roll back optimistic state writes — engine session lost; restart as new execution
        db.run(
          "UPDATE executions SET status = 'failed', finished_at = datetime('now'), details = 'Engine session lost; restarted as new execution' WHERE id = ?",
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
        this.onTaskUpdated(mapTask(db.query<TaskRow, [number]>(
          `SELECT t.*, c.model AS conversation_model 
           FROM tasks t 
           LEFT JOIN conversations c ON c.id = t.conversation_id 
           WHERE t.id = ?`
        ).get(taskId)!));

        const signal = this.streamProcessor.createSignal(newExecutionId);
        const execParams = {
          ...this.paramsBuilder.build(
            taskForFallback,
            conversationId,
            newExecutionId,
            engineContent ?? content,
            undefined,
            this.workdirResolver.resolve(taskForFallback),
            signal,
            this.streamProcessor.makePersistCallback(taskId, conversationId, newExecutionId),
            attachments,
          ),
          boardTools: this.boardTools,
          onSoftCancel: () => this.streamProcessor.abort(newExecutionId),
          ...(this.onTransitionCallback ? { onTransition: this.onTransitionCallback } : {}),
          ...(this.onHumanTurnCallback ? { onHumanTurn: this.onHumanTurnCallback } : {}),
          ...(this.modelSettingsRepo && effectiveModel ? { contextWindowOverride: this.modelSettingsRepo.getContextWindow(workspaceKey, effectiveModel) ?? undefined } : {}),
        };
        this.streamProcessor.runNonNative(taskId, conversationId, newExecutionId, this.engineRegistry.resolveEngineForModel(workspaceKey, effectiveModel), execParams);

        const msgRow = db
          .query<ConversationMessageRow, [number]>("SELECT * FROM conversation_messages WHERE id = ?")
          .get(msgId)!;
        return { message: mapConversationMessage(msgRow), executionId: newExecutionId };
      }
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
    this.onTaskUpdated(mapTask(db.query<TaskRow, [number]>(
      `SELECT t.*, c.model AS conversation_model 
       FROM tasks t 
       LEFT JOIN conversations c ON c.id = t.conversation_id 
       WHERE t.id = ?`
    ).get(taskId)!));

    const resolvedPrompt = engineContent ?? content;
    const msgId = appendMessage(db, taskId, conversationId, "user", "user", content);

    const signal = this.streamProcessor.createSignal(executionId);
    const workingDirectory = this.workdirResolver.resolve(taskForExecution);
    const targetEngineId = QualifiedModelId.tryParse(resolvedModel)?.engineId ?? config.engines[0]?.id ?? "copilot";
    const engine = this.engineRegistry.resolveEngineForModel(workspaceKey, resolvedModel);
    const sourceEngine = this.engineRegistry.resolveEngineForModel(workspaceKey, (task as any).conversation_model);
    const targetModelInfo = (await engine.listModels()).find(m => m.qualifiedId === resolvedModel);
    const { historyBlock } = await this.crossEngineInjector.prepareSwitch(
      conversationId,
      targetEngineId,
      sourceEngine,
      targetModelInfo,
      workingDirectory,
      workspaceKey,
    );
    const { decisionsBlock } = this.decisionInjector.prepare(conversationId);

    // Build system instructions with custom prompt injection
    const assembler = SystemPromptAssembler.fromConfig(config, task.board_id, task.workflow_state);
    const promptFilter: PromptFilterContext = {
      modelId: resolvedModel ?? "",
      engineId: targetEngineId,
      executionType: "task",
      projectPath: workingDirectory,
    };
    assembler.addCustomPrompts(this.customPromptInjector, promptFilter);
    const systemInstructions = assembler.assemble();
    
    const userContent = [historyBlock, decisionsBlock, resolvedPrompt].filter(Boolean).join("\n\n");

    const execParams = {
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
      ),
      boardTools: this.boardTools,
      onSoftCancel: () => this.streamProcessor.abort(executionId),
      ...(this.onTransitionCallback ? { onTransition: this.onTransitionCallback } : {}),
      ...(this.onHumanTurnCallback ? { onHumanTurn: this.onHumanTurnCallback } : {}),
      ...(this.modelSettingsRepo && resolvedModel ? { contextWindowOverride: this.modelSettingsRepo.getContextWindow(workspaceKey, resolvedModel) ?? undefined } : {}),
    };
    this.streamProcessor.runNonNative(taskId, conversationId, executionId, engine, execParams);
    db.run("UPDATE conversations SET last_engine_type = ? WHERE id = ?", [targetEngineId, conversationId]);

    const msgRow = db
      .query<ConversationMessageRow, [number]>("SELECT * FROM conversation_messages WHERE id = ?")
      .get(msgId)!;
    return { message: mapConversationMessage(msgRow), executionId };
  }
}
