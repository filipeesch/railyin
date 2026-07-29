import type { Database } from "bun:sqlite";
import { ConversationInjectionStateRepository } from "../db/repositories/conversation-injection-state-repository.ts";

export interface StageInstructionsPrepareResult {
  stageInstructionsBlock: string | undefined;
}

/**
 * Delivers column-specific stage_instructions via userContent instead of
 * systemInstructions, so systemInstructions stays byte-stable across column
 * transitions (required for vLLM/SGLang prefix caching and Anthropic
 * prompt-caching to keep working). Mirrors DecisionContextInjector's
 * transition-then-post-compaction re-injection policy.
 */
export class StageInstructionsInjector {
  private readonly injectionStateRepo: ConversationInjectionStateRepository;

  constructor(private readonly db: Database) {
    this.injectionStateRepo = new ConversationInjectionStateRepository(db);
  }

  /**
   * @param stageInstructions - the raw stage_instructions text configured for the
   *   current column, or undefined if the column defines none.
   * @param forceInject - true on column-transition calls, which always (re-)inject
   *   the new column's stage_instructions regardless of compaction state. false on
   *   ordinary turns (human turn / retry / code review), which only re-inject when a
   *   compaction has occurred on the conversation since the last injection.
   */
  prepare(conversationId: number, stageInstructions: string | undefined, forceInject: boolean): StageInstructionsPrepareResult {
    if (!stageInstructions) {
      // Column-absence is structural/config-driven, not "data not yet available" —
      // unlike DecisionContextInjector's empty-decisions case, don't mark a sentinel.
      return { stageInstructionsBlock: undefined };
    }

    const lastInjected = this.injectionStateRepo.getLastInjected(conversationId, "stage_instructions");

    const lastCompaction = this.db
      .query<{ id: number }, [number]>(
        "SELECT id FROM conversation_messages WHERE conversation_id = ? AND type = 'compaction_summary' ORDER BY id DESC LIMIT 1",
      )
      .get(conversationId);
    const currentCompactionId = lastCompaction?.id ?? 0;

    // NULL = never injected; otherwise injected up to currentCompactionId already.
    if (!forceInject && lastInjected !== null && lastInjected === currentCompactionId) {
      return { stageInstructionsBlock: undefined };
    }

    this.injectionStateRepo.markInjected(conversationId, "stage_instructions", currentCompactionId);
    return { stageInstructionsBlock: stageInstructions };
  }
}
