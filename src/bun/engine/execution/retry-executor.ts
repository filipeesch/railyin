import type { Task } from "../../../shared/rpc-types.ts";
import type { Database } from "bun:sqlite";
import { mapTask } from "../../db/mappers";
import { appendMessage, ensureTaskConversation } from "../../conversation/messages";
import { getWorkspaceConfig } from "../../workspace-context";
import { buildSystemInstructions, getColumnConfig } from "../../workflow/column-config";
import type { EngineRegistry } from "../engine-registry.ts";
import type { ExecutionParamsBuilder } from "./execution-params-builder.ts";
import type { IWorkingDirectoryResolver } from "./working-directory-resolver.ts";
import type { StreamProcessor } from "../stream/stream-processor.ts";
import type { TaskRow } from "../../db/row-types.ts";
import type { IWorkspaceRepository } from "../../db/workspace-repository.ts";
import type { IBoardToolExecutor } from "../../workflow/tools/board-tool-executor.ts";
import { resolveModel } from "./model-resolver";


export class RetryExecutor {
  constructor(
    private readonly db: Database,
    private readonly engineRegistry: EngineRegistry,
    private readonly paramsBuilder: ExecutionParamsBuilder,
    private readonly workdirResolver: IWorkingDirectoryResolver,
    private readonly streamProcessor: StreamProcessor,
    private readonly wsRepo: IWorkspaceRepository,
    private readonly boardTools: IBoardToolExecutor,
  ) {}

  async execute(taskId: number): Promise<{ task: Task; executionId: number }> {
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
    db.run("UPDATE tasks SET retry_count = retry_count + 1 WHERE id = ?", [taskId]);
    const attempt = (task.retry_count ?? 0) + 1;

    const column = getColumnConfig(config, task.board_id, task.workflow_state);
    // Use centralized model resolver with isColumnTransition=false (not a transition)
    const taskWithModel = { ...task, conversation_model: (task as any).conversation_model };
    const effectiveModel = resolveModel(taskWithModel, column?.model, false);
    // Note: No model updates during retry - conversation model is authoritative
    const engine = this.engineRegistry.resolveEngineForModel(workspaceKey, effectiveModel);

    const execResult = db.run(
      `INSERT INTO executions (task_id, conversation_id, from_state, to_state, prompt_id, status, attempt)
       VALUES (?, ?, ?, ?, ?, 'running', ?)`,
      [taskId, conversationId, task.workflow_state, task.workflow_state, column?.id ?? "retry", attempt],
    );
    const executionId = execResult.lastInsertRowid as number;
    db.run(
      "UPDATE tasks SET execution_state = 'running', current_execution_id = ? WHERE id = ?",
      [executionId, taskId],
    );
    appendMessage(db, taskId, conversationId, "system", null, `Retry attempt ${attempt}`);

    const updatedRow = db.query<TaskRow & { conversation_model: string | null }, [number]>(
      `SELECT t.*, c.model AS conversation_model 
       FROM tasks t 
       LEFT JOIN conversations c ON c.id = t.conversation_id 
       WHERE t.id = ?`
    ).get(taskId)!;
    const retryPrompt = column?.on_enter_prompt ?? "Please continue with the task.";

    const signal = this.streamProcessor.createSignal(executionId);
    
    const execParams = {
      ...this.paramsBuilder.build(
        updatedRow,
        conversationId,
        executionId,
        retryPrompt,
        buildSystemInstructions(config, task.board_id, task.workflow_state),
        this.workdirResolver.resolve(updatedRow),
        signal,
        this.streamProcessor.makePersistCallback(taskId, conversationId, executionId),
      ),
      boardTools: this.boardTools,
      onSoftCancel: () => this.streamProcessor.abort(executionId),
      model: resolveModel(updatedRow, null, false) ?? "", // Use centralized resolver
    };
    this.streamProcessor.runNonNative(taskId, conversationId, executionId, engine, execParams);

    return { task: mapTask(updatedRow), executionId };
  }
}
