import { describe, it, expect, beforeEach } from "vitest";
import type { Database } from "bun:sqlite";
import { DecisionContextInjector } from "../conversation/decision-context-injector.ts";
import { initDb } from "./helpers.ts";

let db: Database;

function createConversation(): number {
  db.run("INSERT INTO conversations (task_id) VALUES (0)");
  const row = db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!;
  return row.id;
}

function insertDecision(conversationId: number): void {
  db.run(
    "INSERT INTO decision_records (conversation_id, question, answer, weight) VALUES (?, ?, ?, ?)",
    [conversationId, "Should we use TypeScript?", "Yes", "critical"],
  );
}

function insertCompaction(conversationId: number): number {
  db.run(
    "INSERT INTO conversation_messages (conversation_id, role, content, type) VALUES (?, 'assistant', 'summary', 'compaction_summary')",
    [conversationId],
  );
  const row = db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!;
  return row.id;
}

beforeEach(() => {
  db = initDb();
});

describe("DecisionContextInjector", () => {
  it("DCI-1: returns undefined when no decisions exist on first turn and marks sentinel 0", () => {
    const conversationId = createConversation();
    const injector = new DecisionContextInjector(db);

    const result = injector.prepare(conversationId);

    expect(result.decisionsBlock).toBeUndefined();

    // Sentinel 0 must be recorded so second call is suppressed
    const row = db
      .query<{ decisions_injected_after_compaction_id: number | null }, [number]>(
        "SELECT decisions_injected_after_compaction_id FROM conversations WHERE id = ?",
      )
      .get(conversationId);
    expect(row?.decisions_injected_after_compaction_id).toBe(0);
  });

  it("DCI-2: returns decisionsBlock on first call when decisions exist", () => {
    const conversationId = createConversation();
    insertDecision(conversationId);
    const injector = new DecisionContextInjector(db);

    const result = injector.prepare(conversationId);

    expect(result.decisionsBlock).toBeDefined();
  });

  it("DCI-3: returns undefined on second call (same compaction — already injected)", () => {
    const conversationId = createConversation();
    insertDecision(conversationId);
    const injector = new DecisionContextInjector(db);

    injector.prepare(conversationId); // first call — injects
    const second = injector.prepare(conversationId); // second call — should suppress

    expect(second.decisionsBlock).toBeUndefined();
  });

  it("DCI-4: returns decisionsBlock again after a new compaction occurs", () => {
    const conversationId = createConversation();
    insertDecision(conversationId);
    const injector = new DecisionContextInjector(db);

    injector.prepare(conversationId); // inject at compaction id 0
    insertCompaction(conversationId); // new compaction_summary message

    const result = injector.prepare(conversationId);

    expect(result.decisionsBlock).toBeDefined();
  });

  it("DCI-5: sentinel 0 blocks re-injection on first turn even after more decisions are added", () => {
    const conversationId = createConversation();
    const injector = new DecisionContextInjector(db);

    injector.prepare(conversationId); // sentinel recorded, no decisions yet

    insertDecision(conversationId); // add a decision after first turn (no compaction)

    const result = injector.prepare(conversationId);

    expect(result.decisionsBlock).toBeUndefined();
  });

  it("DCI-6: returned decisionsBlock starts with '## Decision Records\\n'", () => {
    const conversationId = createConversation();
    insertDecision(conversationId);
    const injector = new DecisionContextInjector(db);

    const { decisionsBlock } = injector.prepare(conversationId);

    expect(decisionsBlock).toMatch(/^## Decision Records\n/);
  });

  it("DCI-7: returned decisionsBlock contains the <decisions> XML wrapper", () => {
    const conversationId = createConversation();
    insertDecision(conversationId);
    const injector = new DecisionContextInjector(db);

    const { decisionsBlock } = injector.prepare(conversationId);

    expect(decisionsBlock).toContain("<decisions>");
    expect(decisionsBlock).toContain("</decisions>");
  });
});
