import type { Database } from "bun:sqlite";
import type { DecisionRecord, DecisionRevision } from "../../shared/rpc-types.ts";
import { DecisionRepository } from "../db/repositories/decision-repository.ts";

export function decisionHandlers(db: Database) {
  return {
    "decisions.list": (params: { conversationId: number }): DecisionRecord[] => {
      const repo = new DecisionRepository(db);
      return repo.listByConversation(params.conversationId) as DecisionRecord[];
    },

    "decisions.getRevisions": (params: { decisionId: number }): DecisionRevision[] => {
      const repo = new DecisionRepository(db);
      return repo.getRevisions(params.decisionId) as DecisionRevision[];
    },
  };
}
