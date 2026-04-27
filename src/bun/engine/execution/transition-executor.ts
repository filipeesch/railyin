import type { Task } from "../../../shared/rpc-types.ts";
import { getDb } from "../../db/index.ts";
import { mapTask } from "../../db/mappers.ts";
import { appendMessage } from "../../conversation/messages.ts";
import { getBoardWorkspaceKey, getWorkspaceConfig } from "../../workspace-context.ts";
import { getColumnConfig } from "../../workflow/column-config.ts";
import type { EngineRegistry } from "../engine-registry.ts";
import type { ExecutionParamsBuilder } from "./execution-params-builder.ts";
import type { WorkingDirectoryResolver } from "./working-directory-resolver.ts";
import type { StreamProcessor } from "../stream/stream-processor.ts";
import type { TaskRow } from "../../db/row-types.ts";

export class TransitionExecutor {
  constructor(
    private readonly engineRegistry: EngineRegistry,
    private readonly paramsBuilder: ExecutionParamsBuilder,
    private readonly workdirResolver: WorkingDirectoryResolver,
    private readonly streamProcessor: StreamProcessor,
  ) {}

  async execute(
    taskId: number,
    toState: string,
  ): Promise<{ task: Task; executionId: number | null }> {
    const db = getDb();
    const task = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    const config = getWorkspaceConfig(getBoardWorkspaceKey(task.board_id));
    const engine = this.engineRegistry.getEngine(getBoardWorkspaceKey(task.board_id));

    let conversationId = task.conversation_id;
    if (conversationId == null) {
      const convResult = db.run("INSERT INTO conversations (task_id) VALUES (?)", [taskId]);
      conversationId = convResult.lastInsertRowid as number;
      db.run("UPDATE tasks SET conversation_id = ? WHERE id = ?", [conversationId, taskId]);
    }

    const fromState = task.workflow_state;
    db.run("UPDATE tasks SET workflow_state = ? WHERE id = ?", [toState, taskId]);

    appendMessage(taskId, conversationId, "transition_event", null, "", { from: fromState, to: toState });

    const column = getColumnConfig(config, task.board_id, toState);

    const resolvedModel = column?.model ?? task.model ?? "";
    if (column?.model != null) {
      db.run("UPDATE tasks SET model = ? WHERE id = ?", [column.model, taskId]);
    } else if (resolvedModel) {
      db.run("UPDATE tasks SET model = ? WHERE id = ?", [resolvedModel, taskId]);
    }

    if (!column?.on_enter_prompt) {
      db.run("UPDATE tasks SET execution_state = 'idle' WHERE id = ?", [taskId]);
      const updated = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(taskId)!;
      return { task: mapTask(updated), executionId: null };
    }

    const resolvedPrompt = column.on_enter_prompt;
    appendMessage(taskId, conversationId, "user", "prompt", resolvedPrompt);

    const execResult = db.run(
      `INSERT INTO executions (task_id, conversation_id, from_state, to_state, prompt_id, status, attempt)
       VALUES (?, ?, ?, ?, ?, 'running', 1)`,
      [taskId, conversationId, fromState, toState, column.id],
    );
    const executionId = execResult.lastInsertRowid as number;
    db.run(
      "UPDATE tasks SET execution_state = 'running', current_execution_id = ? WHERE id = ?",
      [executionId, taskId],
    );

    const updatedRow = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(taskId)!;
    const signal = this.streamProcessor.createSignal(executionId);
    const execParams = this.paramsBuilder.build(
      updatedRow,
      conversationId,
      executionId,
      resolvedPrompt,
      column.stage_instructions,
      this.workdirResolver.resolve(updatedRow),
      signal,
      this.streamProcessor.makePersistCallback(taskId, conversationId, executionId),
    );

    this.streamProcessor.runNonNative(taskId, conversationId, executionId, engine, execParams);
    return { task: mapTask(updatedRow), executionId };
  }
}
