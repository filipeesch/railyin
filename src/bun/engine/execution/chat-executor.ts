import type { ConversationMessage } from "../../../shared/rpc-types.ts";
import type { Attachment } from "../../../shared/rpc-types.ts";
import { getDb } from "../../db/index.ts";
import { mapConversationMessage } from "../../db/mappers.ts";
import { appendMessage } from "../../conversation/messages.ts";
import { getDefaultWorkspaceKey, getWorkspaceConfig } from "../../workspace-context.ts";
import { getEffectiveWorkspacePath } from "../../config/path-utils.ts";
import type { EngineRegistry } from "../engine-registry.ts";
import type { ExecutionParamsBuilder } from "./execution-params-builder.ts";
import type { StreamProcessor } from "../stream/stream-processor.ts";
import type { ConversationMessageRow } from "../../db/row-types.ts";

export class ChatExecutor {
  constructor(
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
    const db = getDb();
    const config = getWorkspaceConfig(workspaceKey);
    const engine = this.engineRegistry.getEngine(workspaceKey);

    const msgId = appendMessage(null, conversationId, "user", "user", content);

    const engineModel = "model" in config.engine ? (config.engine.model ?? "") : "";
    const resolvedModel = model ?? engineModel ?? (config.workspace.default_model ?? "");
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
      resolvedModel,
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
