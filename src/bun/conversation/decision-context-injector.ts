import type { Database } from "bun:sqlite";
import { DecisionRepository } from "../db/repositories/decision-repository.ts";
import { resolveConversationMessageStore } from "./message-store-resolver.ts";

export interface DecisionPrepareResult {
  decisionsBlock: string | undefined;
}

export class DecisionContextInjector {
  private readonly decisionRepo: DecisionRepository;

  constructor(private readonly db: Database) {
    this.decisionRepo = new DecisionRepository(db);
  }

  async prepare(conversationId: number): Promise<DecisionPrepareResult> {
    const lastInjected = this.decisionRepo.getLastInjectedCompactionId(conversationId);

    const store = resolveConversationMessageStore(this.db, conversationId);
    const lastCompaction = await store.getLastByType("compaction_summary");

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
