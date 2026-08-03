import { describe, it, expect, beforeEach } from "vitest";
import type { Db } from "../db/db.ts";
import { ConversationInjectionStateRepository, type InjectionType } from "../db/repositories/conversation-injection-state-repository.ts";
import { initDb } from "./helpers.ts";

let db: Db;
let repo: ConversationInjectionStateRepository;
let conversationId: number;

async function createConversation(): Promise<number> {
  const row = await db.get<{ id: number }>("INSERT INTO conversations (task_id) VALUES (0) RETURNING id");
  return row!.id;
}

beforeEach(async () => {
  db = await initDb();
  repo = new ConversationInjectionStateRepository(db);
  conversationId = await createConversation();
});

// Exercised across both injection_type values to prove one shared implementation
// rather than two independently-maintained copies (decision #1653/#1654).
const injectionTypes: InjectionType[] = ["decisions", "stage_instructions"];

describe("ConversationInjectionStateRepository", () => {
  for (const injectionType of injectionTypes) {
    describe(`injection_type = '${injectionType}'`, () => {
      it("CISR-1: getLastInjected returns null when never injected", async () => {
        expect(await repo.getLastInjected(conversationId, injectionType)).toBeNull();
      });

      it("CISR-2: markInjected stores the compactionSummaryId and getLastInjected returns it", async () => {
        await repo.markInjected(conversationId, injectionType, 42);
        expect(await repo.getLastInjected(conversationId, injectionType)).toBe(42);
      });

      it("CISR-3: markInjected can store sentinel value 0", async () => {
        await repo.markInjected(conversationId, injectionType, 0);
        expect(await repo.getLastInjected(conversationId, injectionType)).toBe(0);
      });

      it("CISR-4: markInjected called twice updates (upserts) the stored value", async () => {
        await repo.markInjected(conversationId, injectionType, 5);
        await repo.markInjected(conversationId, injectionType, 10);
        expect(await repo.getLastInjected(conversationId, injectionType)).toBe(10);
      });
    });
  }

  it("CISR-5: tracking for 'decisions' and 'stage_instructions' is independent per conversation", async () => {
    await repo.markInjected(conversationId, "decisions", 7);
    await repo.markInjected(conversationId, "stage_instructions", 99);

    expect(await repo.getLastInjected(conversationId, "decisions")).toBe(7);
    expect(await repo.getLastInjected(conversationId, "stage_instructions")).toBe(99);
  });

  it("CISR-6: same state-machine logic applies uniformly — equivalent inputs produce equivalent outcomes across injection types", async () => {
    const otherConversationId = await createConversation();

    await repo.markInjected(conversationId, "decisions", 3);
    await repo.markInjected(otherConversationId, "stage_instructions", 3);

    expect(await repo.getLastInjected(conversationId, "decisions")).toBe(
      await repo.getLastInjected(otherConversationId, "stage_instructions"),
    );
  });

  it("CISR-7: tracking is independent per conversation for the same injection_type", async () => {
    const otherConversationId = await createConversation();

    await repo.markInjected(conversationId, "decisions", 1);
    await repo.markInjected(otherConversationId, "decisions", 2);

    expect(await repo.getLastInjected(conversationId, "decisions")).toBe(1);
    expect(await repo.getLastInjected(otherConversationId, "decisions")).toBe(2);
  });
});
