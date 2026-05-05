import type { Task, TransitionEventMetadata } from "../../../shared/rpc-types";
import type { Database } from "bun:sqlite";
import { mapTask } from "../../db/mappers";
import { appendMessage } from "../../conversation/messages";
import { getWorkspaceConfig } from "../../workspace-context";
import { buildSystemInstructions, getColumnConfig } from "../../workflow/column-config";
import type { EngineRegistry } from "../engine-registry";
import type { ExecutionParamsBuilder } from "./execution-params-builder";
import type { IWorkingDirectoryResolver } from "./working-directory-resolver";
import type { StreamProcessor } from "../stream/stream-processor";
import type { TaskRow } from "../../db/row-types";
import { resolvePrompt } from "../dialects/copilot-prompt-resolver";
import { resolveModel } from "./model-resolver";
import type { IBoardToolExecutor } from "../../workflow/tools/board-tool-executor";
import type { IWorkspaceRepository } from "../../db/workspace-repository";


export class TransitionExecutor {
  constructor(
    private readonly db: Database,
    private readonly engineRegistry: EngineRegistry,
    private readonly paramsBuilder: ExecutionParamsBuilder,
    private readonly workdirResolver: IWorkingDirectoryResolver,
    private readonly streamProcessor: StreamProcessor,
    private readonly boardTools: IBoardToolExecutor,
    private readonly wsRepo: IWorkspaceRepository,
    private readonly onTransitionCallback?: (taskId: number, toState: string) => void,
    private readonly onHumanTurnCallback?: (taskId: number, message: string) => void,
  ) {}

  async execute(
    taskId: number,
    toState: string,
  ): Promise<{ task: Task; executionId: number | null }> {
    const db = this.db;
    const task = db.query<TaskRow, [number]>(
      `SELECT t.*, c.model AS conversation_model 
       FROM tasks t 
       LEFT JOIN conversations c ON c.id = t.conversation_id 
       WHERE t.id = ?`
    ).get(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    const config = getWorkspaceConfig(this.wsRepo.getBoardWorkspaceKey(task.board_id));
    const engine = this.engineRegistry.getEngine(this.wsRepo.getBoardWorkspaceKey(task.board_id));

    let conversationId = task.conversation_id;
    if (conversationId == null) {
      const convResult = db.run("INSERT INTO conversations (task_id) VALUES (?)", [taskId]);
      conversationId = convResult.lastInsertRowid as number;
      db.run("UPDATE tasks SET conversation_id = ? WHERE id = ?", [conversationId, taskId]);
    }

    const fromState = task.workflow_state;
    db.run("UPDATE tasks SET workflow_state = ? WHERE id = ?", [toState, taskId]);

    const column = getColumnConfig(config, task.board_id, toState);

    // Use centralized model resolver with isColumnTransition=true
    const taskWithModel = { ...task, conversation_model: (task as any).conversation_model };
    const effectiveModel = resolveModel(taskWithModel, column?.model, true);

    // Persist column model during transition if (column?.model != null) {
    //   db.run("UPDATE conversations SET model = ? WHERE id = ?", [column.model, conversationId]);
    // }
    // Note: No else-if for effectiveModel - we only update when column.model is defined
    // This preserves user's conversation model when column has no model defined

    if (!column?.on_enter_prompt) {
      appendMessage(db, taskId, conversationId, "transition_event", null, "", { from: fromState, to: toState });
      db.run("UPDATE tasks SET execution_state = 'idle' WHERE id = ?", [taskId]);
      const freshIdleRow = db.query<TaskRow, [number]>(
        `SELECT t.*, c.model AS conversation_model 
         FROM tasks t 
         LEFT JOIN conversations c ON c.id = t.conversation_id 
         WHERE t.id = ?`
      ).get(taskId)!;
      return { task: mapTask(freshIdleRow), executionId: null };
    }

    const resolvedPrompt = column.on_enter_prompt;
    const updatedRow = db.query<TaskRow, [number]>(
      `SELECT t.*, c.model AS conversation_model 
       FROM tasks t 
       LEFT JOIN conversations c ON c.id = t.conversation_id 
       WHERE t.id = ?`
    ).get(taskId)!;
    const workingDirectory = this.workdirResolver.resolve(updatedRow);
    const transitionMetadata = await this.buildTransitionMetadata(
      config.engine.type as "copilot" | "claude",
      fromState,
      toState,
      resolvedPrompt,
      workingDirectory,
    );
    appendMessage(db, taskId, conversationId, "transition_event", null, "", transitionMetadata as unknown as Record<string, unknown>);

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

    const freshTaskRow = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(taskId)!;
    const freshTask = mapTask(freshTaskRow);
    const signal = this.streamProcessor.createSignal(executionId);
    const execParams = {
      ...this.paramsBuilder.build(
        updatedRow,
        conversationId,
        executionId,
        resolvedPrompt,
        buildSystemInstructions(config, task.board_id, toState),
        workingDirectory,
        signal,
        this.streamProcessor.makePersistCallback(taskId, conversationId, executionId),
        undefined,
        effectiveModel ?? undefined,
      ),
      boardTools: this.boardTools,
      onSoftCancel: () => this.streamProcessor.abort(executionId),
      ...(this.onTransitionCallback ? { onTransition: this.onTransitionCallback } : {}),
      ...(this.onHumanTurnCallback ? { onHumanTurn: this.onHumanTurnCallback } : {}),
    };

    this.streamProcessor.runNonNative(taskId, conversationId, executionId, engine, execParams);
    const runningRow = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(taskId)!;
    return { task: mapTask(runningRow), executionId };
  }

  private async buildTransitionMetadata(
    engineType: "copilot" | "claude",
    fromState: string,
    toState: string,
    prompt: string,
    workingDirectory: string,
  ): Promise<TransitionEventMetadata> {
    const sourceKind = prompt.trimStart().startsWith("/") ? "slash" : "inline";
    const displayText = engineType === "copilot"
      ? await resolvePrompt(prompt, workingDirectory)
      : prompt;

    return {
      from: fromState,
      to: toState,
      instructionDetail: {
        displayText,
        sourceText: prompt,
        sourceKind,
        ...(sourceKind === "slash" ? { sourceRef: prompt.trim().split(/\s+/, 1)[0] } : {}),
      },
    };
  }
}
