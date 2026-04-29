import type { Task } from "../../../shared/rpc-types.ts";
import type { Database } from "bun:sqlite";
import { mapTask } from "../../db/mappers.ts";
import { appendMessage, ensureTaskConversation } from "../../conversation/messages.ts";
import { getTaskWorkspaceKey, getWorkspaceConfig } from "../../workspace-context.ts";
import { buildSystemInstructions, getColumnConfig } from "../../workflow/column-config.ts";
import type { EngineRegistry } from "../engine-registry.ts";
import type { ExecutionParamsBuilder } from "./execution-params-builder.ts";
import type { WorkingDirectoryResolver } from "./working-directory-resolver.ts";
import type { StreamProcessor } from "../stream/stream-processor.ts";
import type { TaskRow } from "../../db/row-types.ts";
import { resolveTaskModel } from "./model-resolver.ts";

export class RetryExecutor {
  constructor(
    private readonly db: Database,
    private readonly engineRegistry: EngineRegistry,
    private readonly paramsBuilder: ExecutionParamsBuilder,
    private readonly workdirResolver: WorkingDirectoryResolver,
    private readonly streamProcessor: StreamProcessor,
  ) {}

  async execute(taskId: number): Promise<{ task: Task; executionId: number }> {
    const db = this.db;
    const task = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    const config = getWorkspaceConfig(getTaskWorkspaceKey(taskId));
    const engine = this.engineRegistry.getEngine(getTaskWorkspaceKey(taskId));

    const conversationId = ensureTaskConversation(db, taskId, task.conversation_id);
    db.run("UPDATE tasks SET retry_count = retry_count + 1 WHERE id = ?", [taskId]);
    const attempt = (task.retry_count ?? 0) + 1;

    const column = getColumnConfig(config, task.board_id, task.workflow_state);
    const resolvedModel = resolveTaskModel(column?.model, task.model, config.engine);
    if (resolvedModel && !task.model) {
      db.run("UPDATE tasks SET model = ? WHERE id = ?", [resolvedModel, taskId]);
    }
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

    const updatedRow = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(taskId)!;
    const retryPrompt = column?.on_enter_prompt ?? "Please continue with the task.";

    const signal = this.streamProcessor.createSignal(executionId);
    const execParams = this.paramsBuilder.build(
      updatedRow,
      conversationId,
      executionId,
      retryPrompt,
      buildSystemInstructions(config, task.board_id, task.workflow_state),
      this.workdirResolver.resolve(updatedRow),
      signal,
      this.streamProcessor.makePersistCallback(taskId, conversationId, executionId),
    );
    this.streamProcessor.runNonNative(taskId, conversationId, executionId, engine, execParams);

    return { task: mapTask(updatedRow), executionId };
  }
}
