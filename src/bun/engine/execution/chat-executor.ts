import type { ConversationMessage } from "../../../shared/rpc-types.ts";
import type { Attachment } from "../../../shared/rpc-types.ts";
import type { Database } from "bun:sqlite";
import { mapConversationMessage } from "../../db/mappers";
import { appendMessage } from "../../conversation/messages";
import { getDefaultWorkspaceKey, getWorkspaceConfig } from "../../workspace-context";
import { getEffectiveWorkspacePath } from "../../config/path-utils";
import type { EngineRegistry } from "../engine-registry";
import type { ExecutionParamsBuilder } from "./execution-params-builder";
import type { IWorkingDirectoryResolver } from "./working-directory-resolver";
import type { StreamProcessor } from "../stream/stream-processor";
import type { ConversationMessageRow, TaskRow } from "../../db/row-types";
import { QualifiedModelId } from "../qualified-model-id";
import { CustomPromptInjector, type PromptFilterContext } from "./custom-prompt-injector.ts";


export class ChatExecutor {
  constructor(
    private readonly db: Database,
    private readonly engineRegistry: EngineRegistry,
    private readonly paramsBuilder: ExecutionParamsBuilder,
    private readonly streamProcessor: StreamProcessor,
    private readonly workdirResolver: IWorkingDirectoryResolver,
    private readonly customPromptInjector: CustomPromptInjector,
  ) {}

  async execute(
    sessionId: number,
    conversationId: number,
    content: string,
    model?: string,
    enabledMcpTools?: string[] | null,
    workspaceKey = getDefaultWorkspaceKey(),
    attachments?: Attachment[],
    engineContent?: string,
  ): Promise<{ message: ConversationMessage; executionId: number }> {
    const db = this.db;
    const config = getWorkspaceConfig(workspaceKey);

    const msgId = appendMessage(db, null, conversationId, "user", "user", content);

    const conversationRow = db
      .prepare(`
        SELECT c.model, t.id as task_id, t.title, t.description,
               t.project_key, t.board_id, t.conversation_id as task_conv_id,
               t.execution_state, t.created_at
        FROM conversations c
        LEFT JOIN tasks t ON t.id = c.task_id
        WHERE c.id = ?
      `)
      .get(conversationId) as {
        model: string | null;
        task_id: number | null;
        title: string | null;
        description: string | null;
        project_key: string | null;
      } & Partial<TaskRow> | undefined;

    const conversationModel = conversationRow;
    const taskContext = conversationRow?.title
      ? {
          title: conversationRow.title,
          ...(conversationRow.description?.trim() ? { description: conversationRow.description.trim() } : {}),
        }
      : undefined;
    const modelValue = conversationModel?.model ?? null;

    const effectiveModel = model ?? modelValue ?? "";

    if (effectiveModel && !modelValue) {
      db.run("UPDATE conversations SET model = ? WHERE id = ?", [effectiveModel, conversationId]);
    }

    // For task-linked conversations, resolve the task's worktree path so write tools
    // operate in the correct directory. Fall back to workspace root for pure chat sessions.
    let workingDirectory = getEffectiveWorkspacePath(config);
    if (conversationRow?.task_id && this.workdirResolver) {
      try {
        workingDirectory = this.workdirResolver.resolve(conversationRow as unknown as TaskRow);
      } catch {
        // worktree not ready yet — workspace root is acceptable fallback
      }
    }
    const engine = this.engineRegistry.resolveEngineForModel(workspaceKey, effectiveModel);

    // Resolve custom prompts for chat execution
    const engineId = QualifiedModelId.tryParse(effectiveModel)?.engineId ?? config.engines[0]?.id ?? "copilot";
    const promptFilter: PromptFilterContext = {
      modelId: effectiveModel,
      engineId,
      executionType: "chat",
      projectPath: workingDirectory,
    };
    const customSystemInstructions = this.customPromptInjector.resolve(promptFilter);

    const execResult = db.run(
      `INSERT INTO executions (task_id, conversation_id, from_state, to_state, prompt_id, status, attempt)
       VALUES (NULL, ?, 'chat', 'chat', 'chat-turn', 'running', 1)`,
      [conversationId],
    );
    const executionId = execResult.lastInsertRowid as number;

    db.run("UPDATE chat_sessions SET status = 'running' WHERE conversation_id = ?", [conversationId]);

    const signal = this.streamProcessor.createSignal(executionId);

    const execParams = {
      ...this.paramsBuilder.buildForChat(
        conversationId,
        executionId,
        engineContent ?? content,
        workingDirectory,
        effectiveModel,
        signal,
        this.streamProcessor.makePersistCallback(null, conversationId, executionId),
        enabledMcpTools ?? null,
        attachments,
        taskContext,
      ),
      ...(customSystemInstructions ? { systemInstructions: customSystemInstructions } : {}),
      onSoftCancel: () => this.streamProcessor.abort(executionId),
    };

    this.streamProcessor.runNonNative(null, conversationId, executionId, engine, execParams);

    const msgRow = db
      .query<ConversationMessageRow, [number]>("SELECT * FROM conversation_messages WHERE id = ?")
      .get(msgId)!;
    return { message: mapConversationMessage(msgRow), executionId };
  }
}
