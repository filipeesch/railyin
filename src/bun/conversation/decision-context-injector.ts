import type { Database } from "bun:sqlite";
import { DecisionRepository } from "../db/repositories/decision-repository.ts";

export interface DecisionPrepareResult {
  decisionsBlock: string | undefined;
}

export class DecisionContextInjector {
  private readonly decisionRepo: DecisionRepository;

  constructor(private readonly db: Database) {
    this.decisionRepo = new DecisionRepository(db);
  }

  prepare(conversationId: number): DecisionPrepareResult {
    const lastInjected = this.decisionRepo.getLastInjectedCompactionId(conversationId);

    const lastCompaction = this.db
      .query<{ id: number }, [number]>(
        "SELECT id FROM conversation_messages WHERE conversation_id = ? AND type = 'compaction_summary' ORDER BY id DESC LIMIT 1",
      )
      .get(conversationId);

    const currentCompactionId = lastCompaction?.id ?? 0;

    // NULL = never injected; 0 = injected before first compaction (sentinel)
    // Inject when: never injected (null) OR a new compaction has occurred since last injection
    if (lastInjected !== null && lastInjected === currentCompactionId) {
      return { decisionsBlock: undefined };
    }

    const block = this.decisionRepo.buildContextBlock(conversationId);
    if (!block) {
      // No decisions yet — still mark as injected (sentinel) so we don't keep checking
      this.decisionRepo.markDecisionsInjected(conversationId, currentCompactionId);
      return { decisionsBlock: undefined };
    }

    this.decisionRepo.markDecisionsInjected(conversationId, currentCompactionId);

    const decisionsBlock =
      "## Decision Records\n" +
      "These decisions were made for this task. Honor them unless explicitly asked to reconsider.\n" +
      "Use list_decisions() to review all details. Use update_decision(id, answer, reason) to revise.\n\n" +
      block;

    return { decisionsBlock };
  }
}
