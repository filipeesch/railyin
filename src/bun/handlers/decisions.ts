import type { Db } from "../db/db.ts";
import type { DecisionRecord, DecisionRevision } from "../../shared/rpc-types.ts";
import { DecisionRepository } from "../db/repositories/decision-repository.ts";

export function decisionHandlers(db: Db) {
  return {
    "decisions.list": async (params: { conversationId: number }): Promise<DecisionRecord[]> => {
      const repo = new DecisionRepository(db);
      return (await repo.listByConversation(params.conversationId)) as DecisionRecord[];
    },

    "decisions.getRevisions": async (params: { decisionId: number }): Promise<DecisionRevision[]> => {
      const repo = new DecisionRepository(db);
      return (await repo.getRevisions(params.decisionId)) as DecisionRevision[];
    },
  };
}
