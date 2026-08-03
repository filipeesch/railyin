import { describe, it, expect, beforeEach } from "vitest";
import type { Db } from "../db/db.ts";
import { DecisionContextInjector } from "../conversation/decision-context-injector.ts";
import { initDb } from "./helpers.ts";

let db: Db;

async function createConversation(): Promise<number> {
  const row = await db.get<{ id: number }>("INSERT INTO conversations (task_id) VALUES (0) RETURNING id");
  return row!.id;
}

async function insertDecision(conversationId: number): Promise<void> {
  await db.exec(
    "INSERT INTO decision_records (conversation_id, question, answer, weight) VALUES ($1, $2, $3, $4)",
    [conversationId, "Should we use TypeScript?", "Yes", "critical"],
  );
}

async function insertCompaction(conversationId: number): Promise<number> {
  const row = await db.get<{ id: number }>(
    "INSERT INTO conversation_messages (conversation_id, role, content, type) VALUES ($1, 'assistant', 'summary', 'compaction_summary') RETURNING id",
    [conversationId],
  );
  return row!.id;
}

beforeEach(async () => {
  db = await initDb();
});

describe("DecisionContextInjector", () => {
  it("DCI-1: returns undefined when no decisions exist on first turn and marks sentinel 0", async () => {
    const conversationId = await createConversation();
    const injector = new DecisionContextInjector(db);

    const result = await injector.prepare(conversationId);

    expect(result.decisionsBlock).toBeUndefined();

    // Sentinel 0 must be recorded so second call is suppressed
    const row = await db.get<{ last_injected_after_compaction_id: number | null }>(
      "SELECT last_injected_after_compaction_id FROM conversation_injection_state WHERE conversation_id = $1 AND injection_type = 'decisions'",
      [conversationId],
    );
    expect(row?.last_injected_after_compaction_id).toBe(0);
  });

  it("DCI-2: returns decisionsBlock on first call when decisions exist", async () => {
    const conversationId = await createConversation();
    await insertDecision(conversationId);
    const injector = new DecisionContextInjector(db);

    const result = await injector.prepare(conversationId);

    expect(result.decisionsBlock).toBeDefined();
  });

  it("DCI-3: returns undefined on second call (same compaction — already injected)", async () => {
    const conversationId = await createConversation();
    await insertDecision(conversationId);
    const injector = new DecisionContextInjector(db);

    await injector.prepare(conversationId); // first call — injects
    const second = await injector.prepare(conversationId); // second call — should suppress

    expect(second.decisionsBlock).toBeUndefined();
  });

  it("DCI-4: returns decisionsBlock again after a new compaction occurs", async () => {
    const conversationId = await createConversation();
    await insertDecision(conversationId);
    const injector = new DecisionContextInjector(db);

    await injector.prepare(conversationId); // inject at compaction id 0
    await insertCompaction(conversationId); // new compaction_summary message

    const result = await injector.prepare(conversationId);

    expect(result.decisionsBlock).toBeDefined();
  });

  it("DCI-5: sentinel 0 blocks re-injection on first turn even after more decisions are added", async () => {
    const conversationId = await createConversation();
    const injector = new DecisionContextInjector(db);

    await injector.prepare(conversationId); // sentinel recorded, no decisions yet

    await insertDecision(conversationId); // add a decision after first turn (no compaction)

    const result = await injector.prepare(conversationId);

    expect(result.decisionsBlock).toBeUndefined();
  });

  it("DCI-6: returned decisionsBlock starts with '## Decision Records\\n'", async () => {
    const conversationId = await createConversation();
    await insertDecision(conversationId);
    const injector = new DecisionContextInjector(db);

    const { decisionsBlock } = await injector.prepare(conversationId);

    expect(decisionsBlock).toMatch(/^## Decision Records\n/);
  });

  it("DCI-7: returned decisionsBlock contains the <decisions> XML wrapper", async () => {
    const conversationId = await createConversation();
    await insertDecision(conversationId);
    const injector = new DecisionContextInjector(db);

    const { decisionsBlock } = await injector.prepare(conversationId);

    expect(decisionsBlock).toContain("<decisions>");
    expect(decisionsBlock).toContain("</decisions>");
  });
});
