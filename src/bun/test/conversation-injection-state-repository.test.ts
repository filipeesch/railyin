import { describe, it, expect, beforeEach } from "vitest";
import type { Database } from "bun:sqlite";
import { ConversationInjectionStateRepository, type InjectionType } from "../db/repositories/conversation-injection-state-repository.ts";
import { initDb } from "./helpers.ts";

let db: Database;
let repo: ConversationInjectionStateRepository;
let conversationId: number;

function createConversation(): number {
  db.run("INSERT INTO conversations (task_id) VALUES (0)");
  const row = db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!;
  return row.id;
}

beforeEach(() => {
  db = initDb();
  repo = new ConversationInjectionStateRepository(db);
  conversationId = createConversation();
});

// Exercised across both injection_type values to prove one shared implementation
// rather than two independently-maintained copies (decision #1653/#1654).
const injectionTypes: InjectionType[] = ["decisions", "stage_instructions"];

describe("ConversationInjectionStateRepository", () => {
  for (const injectionType of injectionTypes) {
    describe(`injection_type = '${injectionType}'`, () => {
      it("CISR-1: getLastInjected returns null when never injected", () => {
        expect(repo.getLastInjected(conversationId, injectionType)).toBeNull();
      });

      it("CISR-2: markInjected stores the compactionSummaryId and getLastInjected returns it", () => {
        repo.markInjected(conversationId, injectionType, 42);
        expect(repo.getLastInjected(conversationId, injectionType)).toBe(42);
      });

      it("CISR-3: markInjected can store sentinel value 0", () => {
        repo.markInjected(conversationId, injectionType, 0);
        expect(repo.getLastInjected(conversationId, injectionType)).toBe(0);
      });

      it("CISR-4: markInjected called twice updates (upserts) the stored value", () => {
        repo.markInjected(conversationId, injectionType, 5);
        repo.markInjected(conversationId, injectionType, 10);
        expect(repo.getLastInjected(conversationId, injectionType)).toBe(10);
      });
    });
  }

  it("CISR-5: tracking for 'decisions' and 'stage_instructions' is independent per conversation", () => {
    repo.markInjected(conversationId, "decisions", 7);
    repo.markInjected(conversationId, "stage_instructions", 99);

    expect(repo.getLastInjected(conversationId, "decisions")).toBe(7);
    expect(repo.getLastInjected(conversationId, "stage_instructions")).toBe(99);
  });

  it("CISR-6: same state-machine logic applies uniformly — equivalent inputs produce equivalent outcomes across injection types", () => {
    const otherConversationId = createConversation();

    repo.markInjected(conversationId, "decisions", 3);
    repo.markInjected(otherConversationId, "stage_instructions", 3);

    expect(repo.getLastInjected(conversationId, "decisions")).toBe(
      repo.getLastInjected(otherConversationId, "stage_instructions"),
    );
  });

  it("CISR-7: tracking is independent per conversation for the same injection_type", () => {
    const otherConversationId = createConversation();

    repo.markInjected(conversationId, "decisions", 1);
    repo.markInjected(otherConversationId, "decisions", 2);

    expect(repo.getLastInjected(conversationId, "decisions")).toBe(1);
    expect(repo.getLastInjected(otherConversationId, "decisions")).toBe(2);
  });
});
