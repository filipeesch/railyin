import { describe, it, expect, beforeEach } from "vitest";
import type { Database } from "bun:sqlite";
import { StageInstructionsInjector } from "../conversation/stage-instructions-injector.ts";
import { initDb } from "./helpers.ts";

let db: Database;

function createConversation(): number {
  db.run("INSERT INTO conversations (task_id) VALUES (0)");
  const row = db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!;
  return row.id;
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

describe("StageInstructionsInjector", () => {
  it("SI-1: returns undefined and does NOT touch tracking state when stage_instructions is absent for the column", () => {
    const conversationId = createConversation();
    const injector = new StageInstructionsInjector(db);

    const result = injector.prepare(conversationId, undefined, false);

    expect(result.stageInstructionsBlock).toBeUndefined();

    // Unlike DecisionContextInjector, column-absence is structural — no sentinel is recorded.
    const row = db
      .query<{ last_injected_after_compaction_id: number | null }, [number]>(
        "SELECT last_injected_after_compaction_id FROM conversation_injection_state WHERE conversation_id = ? AND injection_type = 'stage_instructions'",
      )
      .get(conversationId);
    expect(row).toBeNull();
  });

  it("SI-2: returns stageInstructionsBlock on first call when stage_instructions is defined", () => {
    const conversationId = createConversation();
    const injector = new StageInstructionsInjector(db);

    const result = injector.prepare(conversationId, "Column guardrails.", false);

    expect(result.stageInstructionsBlock).toBe("Column guardrails.");
  });

  it("SI-3: returns undefined on second call in the same column (same compaction — already injected)", () => {
    const conversationId = createConversation();
    const injector = new StageInstructionsInjector(db);

    injector.prepare(conversationId, "Column guardrails.", false); // first call — injects
    const second = injector.prepare(conversationId, "Column guardrails.", false); // second call — should suppress

    expect(second.stageInstructionsBlock).toBeUndefined();
  });

  it("SI-4: returns stageInstructionsBlock again after a new compaction occurs", () => {
    const conversationId = createConversation();
    const injector = new StageInstructionsInjector(db);

    injector.prepare(conversationId, "Column guardrails.", false); // inject at compaction id 0
    insertCompaction(conversationId); // new compaction_summary message

    const result = injector.prepare(conversationId, "Column guardrails.", false);

    expect(result.stageInstructionsBlock).toBe("Column guardrails.");
  });

  it("SI-5: forceInject (transition) always injects regardless of prior injection state", () => {
    const conversationId = createConversation();
    const injector = new StageInstructionsInjector(db);

    injector.prepare(conversationId, "Column guardrails.", false); // injected already
    const second = injector.prepare(conversationId, "Column guardrails.", true); // forced — e.g. column transition

    expect(second.stageInstructionsBlock).toBe("Column guardrails.");
  });

  it("SI-6: forceInject with no stage_instructions still yields undefined and skips tracking", () => {
    const conversationId = createConversation();
    const injector = new StageInstructionsInjector(db);

    const result = injector.prepare(conversationId, undefined, true);

    expect(result.stageInstructionsBlock).toBeUndefined();
    const row = db
      .query<{ last_injected_after_compaction_id: number | null }, [number]>(
        "SELECT last_injected_after_compaction_id FROM conversation_injection_state WHERE conversation_id = ? AND injection_type = 'stage_instructions'",
      )
      .get(conversationId);
    expect(row).toBeNull();
  });

  it("SI-7: stage_instructions tracking is independent from decisions tracking for the same conversation", () => {
    const conversationId = createConversation();
    const injector = new StageInstructionsInjector(db);

    injector.prepare(conversationId, "Column guardrails.", false);

    const decisionsRow = db
      .query<{ last_injected_after_compaction_id: number | null }, [number]>(
        "SELECT last_injected_after_compaction_id FROM conversation_injection_state WHERE conversation_id = ? AND injection_type = 'decisions'",
      )
      .get(conversationId);
    expect(decisionsRow).toBeNull();
  });
});
