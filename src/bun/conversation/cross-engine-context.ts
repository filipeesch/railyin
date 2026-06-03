import type { Database } from "bun:sqlite";
import type { EngineModelInfo } from "../engine/types.ts";
import type { ConversationMessageRow } from "../db/row-types.ts";
import type { EngineRegistry } from "../engine/engine-registry.ts";
import { ContextEstimator } from "./context-estimator.ts";

export interface PrepareResult {
  historyBlock: string | undefined;
}

export class CrossEngineContextInjector {
  constructor(
    private readonly db: Database,
    private readonly engineRegistry?: EngineRegistry,
  ) {}

  async prepareSwitch(
    conversationId: number,
    targetEngineId: string,
    targetModelInfo: EngineModelInfo | undefined,
    workingDirectory: string,
    workspaceKey: string,
    excludeBeforeMsgId?: number,
  ): Promise<PrepareResult> {
    const conv = this.db
      .query<{ last_engine_type: string | null }, [number]>(
        "SELECT last_engine_type FROM conversations WHERE id = ?",
      )
      .get(conversationId);

    if (conv == null || conv.last_engine_type == null) {
      return { historyBlock: undefined };
    }

    if (conv.last_engine_type === targetEngineId) {
      return { historyBlock: undefined };
    }

    const sourceEngine = this.engineRegistry?.getEngineById(conv.last_engine_type) ?? null;

    let messages = this.fetchMessagesSinceAnchor(conversationId, excludeBeforeMsgId);

    if (
      targetModelInfo?.contextWindow != null &&
      sourceEngine != null &&
      "compact" in sourceEngine &&
      typeof sourceEngine.compact === "function"
    ) {
      const est = new ContextEstimator(this.db).estimate(
        conversationId,
        targetModelInfo.contextWindow,
      );
      if (est.fraction > 0.75) {
        await sourceEngine.compact(null, conversationId, workingDirectory, workspaceKey);
        messages = this.fetchMessagesSinceAnchor(conversationId, excludeBeforeMsgId);
      }
    }

    const historyBlock = this.formatHistoryBlock(messages);
    return { historyBlock };
  }

  private fetchMessagesSinceAnchor(
    conversationId: number,
    excludeBeforeMsgId?: number,
  ): ConversationMessageRow[] {
    const anchor = this.db
      .query<{ id: number }, [number]>(
        "SELECT id FROM conversation_messages WHERE conversation_id = ? AND type = 'compaction_summary' ORDER BY id DESC LIMIT 1",
      )
      .get(conversationId);

    const anchorId = anchor?.id ?? 0;

    if (excludeBeforeMsgId != null) {
      return this.db
        .query<ConversationMessageRow, [number, number, number]>(
          "SELECT * FROM conversation_messages WHERE conversation_id = ? AND id >= ? AND id < ? ORDER BY id ASC LIMIT 200",
        )
        .all(conversationId, anchorId, excludeBeforeMsgId);
    }

    return this.db
      .query<ConversationMessageRow, [number, number]>(
        "SELECT * FROM conversation_messages WHERE conversation_id = ? AND id >= ? ORDER BY id ASC LIMIT 200",
      )
      .all(conversationId, anchorId);
  }

  private formatHistoryBlock(messages: ConversationMessageRow[]): string {
    const relevant = messages.filter(
      (m) => m.type === "user" || m.type === "assistant" || m.type === "compaction_summary",
    );

    const parts: string[] = [];
    for (const msg of relevant) {
      if (msg.type === "compaction_summary") {
        parts.push(`<SUMMARY>\n${msg.content}\n</SUMMARY>`);
      } else if (msg.type === "user") {
        parts.push(`<USER>\n${msg.content}\n</USER>`);
      } else if (msg.type === "assistant") {
        parts.push(`<ASSISTANT>\n${msg.content}\n</ASSISTANT>`);
      }
    }

    const inner = parts.join("\n");
    return (
      "## Context from previous conversation (engine switch)\n" +
      "The following is the conversation history from the previous engine session. Use it to maintain continuity.\n\n" +
      `<message_history>\n${inner}\n</message_history>`
    );
  }
}
