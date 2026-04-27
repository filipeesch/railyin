import type { ConversationMessage } from "../../../shared/rpc-types.ts";
import type { Attachment } from "../../../shared/rpc-types.ts";
import { getDb } from "../../db/index.ts";
import { mapTask, mapConversationMessage } from "../../db/mappers.ts";
import { appendMessage, ensureTaskConversation } from "../../conversation/messages.ts";
import { getTaskWorkspaceKey, getWorkspaceConfig } from "../../workspace-context.ts";
import { getColumnConfig } from "../../workflow/column-config.ts";
import type { EngineRegistry } from "../engine-registry.ts";
import type { ExecutionParamsBuilder } from "./execution-params-builder.ts";
import type { WorkingDirectoryResolver } from "./working-directory-resolver.ts";
import type { StreamProcessor } from "../stream/stream-processor.ts";
import type { OnTaskUpdated } from "../types.ts";
import type { TaskRow, ConversationMessageRow } from "../../db/row-types.ts";

export class HumanTurnExecutor {
  constructor(
    private readonly engineRegistry: EngineRegistry,
    private readonly paramsBuilder: ExecutionParamsBuilder,
    private readonly workdirResolver: WorkingDirectoryResolver,
    private readonly streamProcessor: StreamProcessor,
    private readonly onTaskUpdated: OnTaskUpdated,
  ) {}

  async execute(
    taskId: number,
    content: string,
    attachments?: Attachment[],
    engineContent?: string,
  ): Promise<{ message: ConversationMessage; executionId: number }> {
    const db = getDb();
    const task = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    const config = getWorkspaceConfig(getTaskWorkspaceKey(taskId));
    const engine = this.engineRegistry.getEngine(getTaskWorkspaceKey(taskId));

    const conversationId = ensureTaskConversation(taskId, task.conversation_id);

    if (task.execution_state === "waiting_user" && task.current_execution_id != null) {
      const msgId = appendMessage(taskId, conversationId, "user", "user", content);
      db.run("UPDATE tasks SET execution_state = 'running' WHERE id = ?", [taskId]);
      db.run(
        "UPDATE executions SET status = 'running', finished_at = NULL WHERE id = ?",
        [task.current_execution_id],
      );
      this.onTaskUpdated(mapTask(db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(taskId)!));
      try {
        await engine.resume(task.current_execution_id, { type: "ask_user", content: engineContent ?? content });
        const msgRow = db
          .query<ConversationMessageRow, [number]>("SELECT * FROM conversation_messages WHERE id = ?")
          .get(msgId)!;
        return { message: mapConversationMessage(msgRow), executionId: task.current_execution_id };
      } catch {
        // The engine has no live session for this execution (e.g. process was restarted).
        // Roll back the optimistic state writes and fall through to start a fresh execution.
        db.run(
          "UPDATE executions SET status = 'failed', finished_at = datetime('now'), details = 'Engine session lost; restarted as new execution' WHERE id = ?",
          [task.current_execution_id],
        );
        db.run(
          "UPDATE tasks SET execution_state = 'waiting_user', current_execution_id = NULL WHERE id = ?",
          [taskId],
        );

        const column = getColumnConfig(config, task.board_id, task.workflow_state);
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
        this.onTaskUpdated(mapTask(db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(taskId)!));

        const signal = this.streamProcessor.createSignal(newExecutionId);
        const execParams = this.paramsBuilder.build(
          task,
          conversationId,
          newExecutionId,
          engineContent ?? content,
          column?.stage_instructions,
          this.workdirResolver.resolve(task),
          signal,
          this.streamProcessor.makePersistCallback(taskId, conversationId, newExecutionId),
          attachments,
        );
        this.streamProcessor.runNonNative(taskId, conversationId, newExecutionId, engine, execParams);

        const msgRow = db
          .query<ConversationMessageRow, [number]>("SELECT * FROM conversation_messages WHERE id = ?")
          .get(msgId)!;
        return { message: mapConversationMessage(msgRow), executionId: newExecutionId };
      }
    }

    const column = getColumnConfig(config, task.board_id, task.workflow_state);

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
    this.onTaskUpdated(mapTask(db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(taskId)!));

    const resolvedPrompt = engineContent ?? content;
    const msgId = appendMessage(taskId, conversationId, "user", "user", content);

    const signal = this.streamProcessor.createSignal(executionId);
    const execParams = this.paramsBuilder.build(
      task,
      conversationId,
      executionId,
      resolvedPrompt,
      column?.stage_instructions,
      this.workdirResolver.resolve(task),
      signal,
      this.streamProcessor.makePersistCallback(taskId, conversationId, executionId),
      attachments,
    );
    this.streamProcessor.runNonNative(taskId, conversationId, executionId, engine, execParams);

    const msgRow = db
      .query<ConversationMessageRow, [number]>("SELECT * FROM conversation_messages WHERE id = ?")
      .get(msgId)!;
    return { message: mapConversationMessage(msgRow), executionId };
  }
}
