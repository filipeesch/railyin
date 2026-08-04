import type { Db } from "../db/db.ts";
import { DecisionRepository } from "../db/repositories/decision-repository.ts";

export interface DecisionPrepareResult {
  decisionsBlock: string | undefined;
}

export class DecisionContextInjector {
  private readonly decisionRepo: DecisionRepository;

  constructor(private readonly db: Db) {
    this.decisionRepo = new DecisionRepository(db);
  }

  async prepare(conversationId: number): Promise<DecisionPrepareResult> {
    const lastInjected = await this.decisionRepo.getLastInjectedCompactionId(conversationId);

    const lastCompaction = await this.db
      .get<{ id: number }>(
        "SELECT id FROM conversation_messages WHERE conversation_id = $1 AND type = 'compaction_summary' ORDER BY id DESC LIMIT 1",
        [conversationId],
      );

    const currentCompactionId = lastCompaction?.id ?? 0;

    // NULL = never injected; 0 = injected before first compaction (sentinel)
    // Inject when: never injected (null) OR a new compaction has occurred since last injection
    if (lastInjected !== null && lastInjected === currentCompactionId) {
      return { decisionsBlock: undefined };
    }

    const block = await this.decisionRepo.buildContextBlock(conversationId);
    if (!block) {
      // No decisions yet — still mark as injected (sentinel) so we don't keep checking
      await this.decisionRepo.markDecisionsInjected(conversationId, currentCompactionId);
      return { decisionsBlock: undefined };
    }

    await this.decisionRepo.markDecisionsInjected(conversationId, currentCompactionId);

    const decisionsBlock =
      "## Decision Records\n" +
      "These decisions were made for this task. Honor them unless explicitly asked to reconsider.\n" +
      "Use list_decisions() to review all details. Use update_decision(id, answer, reason) to revise.\n\n" +
      block;

    return { decisionsBlock };
  }
}
