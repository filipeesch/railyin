import type { Db } from "../db.ts";
import { getDb } from "../index.ts";
import type { ConversationInjectionStateRow } from "../row-types.ts";

/**
 * The kind of context block being tracked for re-injection. Add new values here
 * as new "inject once, then re-inject after compaction" blocks are introduced.
 */
export type InjectionType = "decisions" | "stage_instructions";

/**
 * Shared re-injection state-machine storage, backed by `conversation_injection_state`
 * (keyed by (conversation_id, injection_type)). Both `DecisionRepository` and
 * `StageInstructionsInjector` delegate to this single implementation instead of each
 * independently tracking "last injected after compaction id" (decision: generalized
 * tracking table + shared repository, not duplicated per injector type).
 */
export class ConversationInjectionStateRepository {
  private readonly db: Db;

  constructor(db?: Db) {
    this.db = db ?? getDb();
  }

  async getLastInjected(conversationId: number, injectionType: InjectionType): Promise<number | null> {
    const row = await this.db.get<Pick<ConversationInjectionStateRow, "last_injected_after_compaction_id">>(
      "SELECT last_injected_after_compaction_id FROM conversation_injection_state WHERE conversation_id = $1 AND injection_type = $2",
      [conversationId, injectionType],
    );
    return row?.last_injected_after_compaction_id ?? null;
  }

  async markInjected(conversationId: number, injectionType: InjectionType, compactionSummaryId: number): Promise<void> {
    await this.db.exec(
      `INSERT INTO conversation_injection_state (conversation_id, injection_type, last_injected_after_compaction_id)
       VALUES ($1, $2, $3)
       ON CONFLICT(conversation_id, injection_type)
       DO UPDATE SET last_injected_after_compaction_id = excluded.last_injected_after_compaction_id`,
      [conversationId, injectionType, compactionSummaryId],
    );
  }
}
