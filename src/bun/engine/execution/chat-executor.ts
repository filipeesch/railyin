import type { ConversationMessage } from "../../../shared/rpc-types.ts";
import type { Attachment } from "../../../shared/rpc-types.ts";
import type { Database } from "bun:sqlite";
import { mapConversationMessage } from "../../db/mappers";
import { appendMessage } from "../../conversation/messages";
import { getDefaultWorkspaceKey, getWorkspaceConfig } from "../../workspace-context";
import { getEffectiveWorkspacePath } from "../../config/path-utils";
import type { EngineRegistry } from "../engine-registry";
import type { ExecutionParamsBuilder } from "./execution-params-builder";
import type { StreamProcessor } from "../stream/stream-processor";
import type { ConversationMessageRow } from "../../db/row-types";


export class ChatExecutor {
  constructor(
    private readonly db: Database,
    private readonly engineRegistry: EngineRegistry,
    private readonly paramsBuilder: ExecutionParamsBuilder,
    private readonly streamProcessor: StreamProcessor,
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
    const engine = this.engineRegistry.getEngine(workspaceKey);

    const msgId = appendMessage(db, null, conversationId, "user", "user", content);

    // Get the model from the conversation
    const conversationModel = db
      .prepare("SELECT model FROM conversations WHERE id = ?")
      .get(conversationId) as { model: string | null } | undefined;
    const modelValue = conversationModel?.model ?? null;

    // Use simplified model resolution for chat sessions
    // Priority: explicit model parameter → conversation model
    // No fallback to workspace/engine defaults after creation
    const effectiveModel = model ?? modelValue ?? "";
    
    // Persist the model to the conversation if it's not already set
    if (effectiveModel && !modelValue) {
      db.run("UPDATE conversations SET model = ? WHERE id = ?", [effectiveModel, conversationId]);
    }
    const workingDirectory = getEffectiveWorkspacePath(config);

    const execResult = db.run(
      `INSERT INTO executions (task_id, conversation_id, from_state, to_state, prompt_id, status, attempt)
       VALUES (NULL, ?, 'chat', 'chat', 'chat-turn', 'running', 1)`,
      [conversationId],
    );
    const executionId = execResult.lastInsertRowid as number;

    db.run("UPDATE chat_sessions SET status = 'running' WHERE conversation_id = ?", [conversationId]);

    const signal = this.streamProcessor.createSignal(executionId);
    
    const execParams = this.paramsBuilder.buildForChat(
      conversationId,
      executionId,
      engineContent ?? content,
      workingDirectory,
      effectiveModel,
      signal,
      this.streamProcessor.makePersistCallback(null, conversationId, executionId),
      enabledMcpTools ?? null,
      attachments,
    );

    this.streamProcessor.runNonNative(null, conversationId, executionId, engine, execParams);

    const msgRow = db
      .query<ConversationMessageRow, [number]>("SELECT * FROM conversation_messages WHERE id = ?")
      .get(msgId)!;
    return { message: mapConversationMessage(msgRow), executionId };
  }
}
