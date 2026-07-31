import type { Database } from "bun:sqlite";
import { ConversationInjectionStateRepository } from "../db/repositories/conversation-injection-state-repository.ts";

export interface StageInstructionsPrepareResult {
  stageInstructionsBlock: string | undefined;
}

/**
 * Fixed, invariant sentence appended after the real column instruction text —
 * never reworded per column. Asserts the directive's binding, standing-rule
 * authority so the model doesn't treat it as a one-time nudge.
 */
const ACTIVE_DIRECTIVE_SUFFIX =
  "This directive is currently in force. Follow it in every response until it is replaced by a new active_directive or the user explicitly asks you to override it.";

/**
 * Fixed cancellation body sent when the current column defines no
 * stage_instructions, so the "follow until replaced" promise above is never
 * left to silent inference — a prior column's directive must be explicitly
 * revoked, not just omitted.
 */
const ACTIVE_DIRECTIVE_CANCELLATION =
  "None. Any previously active directive is no longer in force. Follow only the user's current instructions and general guidance until a new active_directive is issued.";

function wrapActiveDirective(body: string): string {
  return `<active_directive>\n${body}\n</active_directive>`;
}

/**
 * Delivers column-specific stage_instructions via userContent instead of
 * systemInstructions, so systemInstructions stays byte-stable across column
 * transitions (required for vLLM/SGLang prefix caching and Anthropic
 * prompt-caching to keep working). Mirrors DecisionContextInjector's
 * transition-then-post-compaction re-injection policy.
 *
 * The delivered block is always wrapped in a fixed `<active_directive>` tag —
 * either the real column instruction (plus the invariant "in force" sentence)
 * or, when the column defines no stage_instructions, an explicit cancellation
 * of any previously active directive. Silence is never used to mean
 * "cancelled" because the wording explicitly promises to stay in force "until
 * replaced" — a promise that must be honored with an explicit replacement.
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
   *   regardless of compaction state. false on ordinary turns (human turn / retry /
   *   code review), which only re-inject when a compaction has occurred on the
   *   conversation since the last injection. Applies identically whether the column
   *   currently has real stage_instructions or none (cancellation is re-sent on the
   *   same schedule as the real directive, not on every ordinary turn).
   */
  prepare(conversationId: number, stageInstructions: string | undefined, forceInject: boolean): StageInstructionsPrepareResult {
    const lastInjected = this.injectionStateRepo.getLastInjected(conversationId, "stage_instructions");

    const lastCompaction = this.db
      .query<{ id: number }, [number]>(
        "SELECT id FROM conversation_messages WHERE conversation_id = ? AND type = 'compaction_summary' ORDER BY id DESC LIMIT 1",
      )
      .get(conversationId);
    const currentCompactionId = lastCompaction?.id ?? 0;

    // NULL = never injected; otherwise injected up to currentCompactionId already.
    const injectionDue = forceInject || lastInjected === null || lastInjected !== currentCompactionId;
    if (!injectionDue) {
      return { stageInstructionsBlock: undefined };
    }

    this.injectionStateRepo.markInjected(conversationId, "stage_instructions", currentCompactionId);

    if (!stageInstructions) {
      return { stageInstructionsBlock: wrapActiveDirective(ACTIVE_DIRECTIVE_CANCELLATION) };
    }

    return { stageInstructionsBlock: wrapActiveDirective(`${stageInstructions}\n\n${ACTIVE_DIRECTIVE_SUFFIX}`) };
  }
}
