import type { Database } from "bun:sqlite";
import type { EngineModelInfo } from "../engine/types.ts";
import type { ConversationMessageRow } from "../db/row-types.ts";
import type { EngineRegistry } from "../engine/engine-registry.ts";
import { ContextEstimator } from "./context-estimator.ts";
import { resolveConversationMessageStore } from "./message-store-resolver.ts";

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

    let messages = await this.fetchMessagesSinceAnchor(conversationId, excludeBeforeMsgId);

    if (
      targetModelInfo?.contextWindow != null &&
      sourceEngine != null &&
      "compact" in sourceEngine &&
      typeof sourceEngine.compact === "function"
    ) {
      const est = await new ContextEstimator(this.db).estimate(
        conversationId,
        targetModelInfo.contextWindow,
      );
      if (est.fraction > 0.75) {
        await sourceEngine.compact(null, conversationId, workingDirectory, workspaceKey);
        messages = await this.fetchMessagesSinceAnchor(conversationId, excludeBeforeMsgId);
      }
    }

    const historyBlock = this.formatHistoryBlock(messages);
    return { historyBlock };
  }

  private async fetchMessagesSinceAnchor(
    conversationId: number,
    excludeBeforeMsgId?: number,
  ): Promise<ConversationMessageRow[]> {
    const store = resolveConversationMessageStore(this.db, conversationId);
    const anchor = await store.getLastByType("compaction_summary");
    const anchorId = anchor?.id ?? 0;

    return store.getRange(anchorId, {
      limit: 200,
      ...(excludeBeforeMsgId != null ? { excludeFromId: excludeBeforeMsgId } : {}),
    });
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
