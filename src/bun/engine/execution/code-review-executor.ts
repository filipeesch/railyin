import type { ConversationMessage, ManualEdit, CodeReviewPayload, CodeReviewHunk, LineComment, HunkDecision } from "../../../shared/rpc-types.ts";
import type { Database } from "bun:sqlite";
import { mapTask, mapConversationMessage } from "../../db/mappers.ts";
import { fetchTaskWithModel } from "../../db/task-queries.ts";
import { appendMessage, ensureTaskConversation } from "../../conversation/messages.ts";
import { getWorkspaceConfig } from "../../workspace-context.ts";
import { getColumnConfig } from "../../workflow/column-config.ts";
import { formatReviewMessageForLLM } from "../../workflow/review.ts";
import { buildDiffCache } from "../git/git-diff-parser.ts";
import type { EngineRegistry } from "../engine-registry.ts";
import type { ExecutionParamsBuilder } from "./execution-params-builder.ts";
import type { IWorkingDirectoryResolver } from "./working-directory-resolver.ts";
import type { StreamProcessor } from "../stream/stream-processor.ts";
import type { OnTaskUpdated, OnNewMessage } from "../types.ts";
import type { TaskRow, ConversationMessageRow, TaskGitContextRow } from "../../db/row-types.ts";
import type { IWorkspaceRepository } from "../../db/workspace-repository.ts";
import type { IBoardToolExecutor } from "../../workflow/tools/board-tool-executor.ts";
import type { ModelSettingsRepository } from "../../db/repositories/model-settings-repository.ts";
import { QualifiedModelId } from "../qualified-model-id";
import { SystemPromptAssembler } from "./system-prompt-assembler.ts";
import { CustomPromptInjector, type PromptFilterContext } from "./custom-prompt-injector.ts";

type DecisionRow = {
  hunk_hash: string;
  file_path: string;
  decision: string;
  comment: string | null;
  original_start: number;
  original_end: number;
  modified_start: number;
  modified_end: number;
};

type LineCommentRow = {
  id: number;
  file_path: string;
  line_start: number;
  line_end: number;
  line_text: string;
  context_lines: string;
  comment: string;
  reviewer_type: string;
};

export class CodeReviewExecutor {
  constructor(
    private readonly db: Database,
    private readonly engineRegistry: EngineRegistry,
    private readonly paramsBuilder: ExecutionParamsBuilder,
    private readonly workdirResolver: IWorkingDirectoryResolver,
    private readonly streamProcessor: StreamProcessor,
    private readonly onTaskUpdated: OnTaskUpdated,
    private readonly onNewMessage: OnNewMessage,
    private readonly wsRepo: IWorkspaceRepository,
    private readonly boardTools: IBoardToolExecutor,
    private readonly customPromptInjector: CustomPromptInjector,
    private readonly modelSettingsRepo?: ModelSettingsRepository,
  ) {}

  async execute(
    taskId: number,
    manualEdits?: ManualEdit[],
  ): Promise<{ message: ConversationMessage; executionId: number }> {
    const db = this.db;
    const task = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    const workspaceKey = this.wsRepo.getTaskWorkspaceKey(taskId);
    const config = getWorkspaceConfig(workspaceKey);
    const conversationModel = task.conversation_id
      ? (db.prepare("SELECT model FROM conversations WHERE id = ?").get(task.conversation_id) as { model: string | null } | undefined)?.model
      : null;
    const engine = this.engineRegistry.resolveEngineForModel(workspaceKey, conversationModel);

    const decisions = db
      .query<DecisionRow, [number]>(
        `SELECT hunk_hash, file_path, decision, comment, original_start, original_end, modified_start, modified_end
          FROM task_hunk_decisions
          WHERE task_id = ? AND reviewer_id = 'user' AND sent = 0
          ORDER BY file_path, modified_start`,
      )
      .all(taskId);
    const lineComments = db
      .query<LineCommentRow, [number]>(
        `SELECT id, file_path, line_start, line_end, line_text, context_lines, comment, reviewer_type
         FROM task_line_comments
         WHERE task_id = ? AND sent = 0
         ORDER BY file_path, line_start`,
      )
      .all(taskId);

    const gitRow = db
      .query<Pick<TaskGitContextRow, "worktree_path" | "worktree_status">, [number]>(
        "SELECT worktree_path, worktree_status FROM task_git_context WHERE task_id = ?",
      )
      .get(taskId);
    const worktreePath = gitRow?.worktree_status === "ready" ? (gitRow.worktree_path ?? "") : "";

    const uniqueFiles = [...new Set(decisions.map((row) => row.file_path))];
    const diffCache = await buildDiffCache(worktreePath, uniqueFiles);

    const fileMap = new Map<string, { hunks: CodeReviewHunk[]; lineComments: LineComment[] }>();
    for (const row of decisions) {
      if (!fileMap.has(row.file_path)) fileMap.set(row.file_path, { hunks: [], lineComments: [] });
      const hunkLines = diffCache.get(row.file_path)?.get(row.hunk_hash) ?? { originalLines: [], modifiedLines: [] };
      fileMap.get(row.file_path)!.hunks.push({
        hunkIndex: 0,
        originalRange: [row.original_start, row.original_end],
        modifiedRange: [row.modified_start, row.modified_end],
        decision: row.decision as HunkDecision,
        comment: row.comment,
        originalLines: hunkLines.originalLines,
        modifiedLines: hunkLines.modifiedLines,
      });
    }
    for (const row of lineComments) {
      if (!fileMap.has(row.file_path)) fileMap.set(row.file_path, { hunks: [], lineComments: [] });
      fileMap.get(row.file_path)!.lineComments.push({
        id: row.id,
        filePath: row.file_path,
        lineStart: row.line_start,
        lineEnd: row.line_end,
        colStart: 0,
        colEnd: 0,
        lineText: JSON.parse(row.line_text),
        contextLines: JSON.parse(row.context_lines),
        comment: row.comment,
        reviewerType: row.reviewer_type as "human" | "ai",
      });
    }

    const payload: CodeReviewPayload = {
      taskId,
      files: Array.from(fileMap.entries()).map(([path, data]) => ({ path, hunks: data.hunks, lineComments: data.lineComments })),
      manualEdits,
    };
    const reviewText = formatReviewMessageForLLM(payload);

    db.run(
      `UPDATE task_hunk_decisions SET sent = 1 WHERE task_id = ? AND reviewer_id = 'user' AND sent = 0`,
      [taskId],
    );
    db.run(`UPDATE task_line_comments SET sent = 1 WHERE task_id = ? AND sent = 0`, [taskId]);

    const conversationId = ensureTaskConversation(db, taskId, task.conversation_id);

    const reviewMsgId = appendMessage(db, taskId, conversationId, "code_review", "user", JSON.stringify(payload));
    appendMessage(db, taskId, conversationId, "user", "user", reviewText);

    const column = getColumnConfig(config, task.board_id, task.workflow_state);
    const execResult = db.run(
      `INSERT INTO executions (task_id, conversation_id, from_state, to_state, prompt_id, status, attempt)
       VALUES (?, ?, ?, ?, 'code-review', 'running', ?)`,
      [taskId, conversationId, task.workflow_state, task.workflow_state, task.retry_count + 1],
    );
    const executionId = execResult.lastInsertRowid as number;
    db.run(
      "UPDATE tasks SET execution_state = 'running', current_execution_id = ? WHERE id = ?",
      [executionId, taskId],
    );
    this.onTaskUpdated(fetchTaskWithModel(db, taskId)!);

    const reviewMsgRow = db
      .query<ConversationMessageRow, [number]>("SELECT * FROM conversation_messages WHERE id = ?")
      .get(reviewMsgId)!;
    this.onNewMessage(mapConversationMessage(reviewMsgRow));

    const signal = this.streamProcessor.createSignal(executionId);

    // Build system instructions with custom prompt injection
    const assembler = SystemPromptAssembler.fromConfig(config, task.board_id, task.workflow_state);
    const promptFilter: PromptFilterContext = {
      modelId: conversationModel ?? "",
      engineId: QualifiedModelId.tryParse(conversationModel)?.engineId ?? config.engines[0]?.id ?? "copilot",
      executionType: "task",
      projectPath: this.workdirResolver.resolve(task),
    };
    assembler.addCustomPrompts(this.customPromptInjector, promptFilter);
    const systemInstructions = assembler.assemble();

    const execParams = {
      ...this.paramsBuilder.build(
        task,
        conversationId,
        executionId,
        reviewText,
        systemInstructions,
        this.workdirResolver.resolve(task),
        signal,
        this.streamProcessor.makePersistCallback(taskId, conversationId, executionId),
        undefined,
        undefined,
        config.projects.find((p) => p.key === task.project_key)?.projectPath,
      ),
      boardTools: this.boardTools,
      onSoftCancel: () => this.streamProcessor.abort(executionId),
      ...(this.modelSettingsRepo && conversationModel ? { contextWindowOverride: this.modelSettingsRepo.getContextWindow(workspaceKey, conversationModel) ?? undefined } : {}),
    };
    this.streamProcessor.runNonNative(taskId, conversationId, executionId, engine, execParams);

    return { message: mapConversationMessage(reviewMsgRow), executionId };
  }
}
