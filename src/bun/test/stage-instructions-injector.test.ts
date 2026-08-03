import { describe, it, expect, beforeEach } from "vitest";
import type { Db } from "../db/db.ts";
import { StageInstructionsInjector } from "../conversation/stage-instructions-injector.ts";
import { initDb } from "./helpers.ts";

let db: Db;

async function createConversation(): Promise<number> {
  const row = await db.get<{ id: number }>("INSERT INTO conversations (task_id) VALUES (0) RETURNING id");
  return row!.id;
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

describe("StageInstructionsInjector", () => {
  const REAL_SUFFIX =
    "This directive is currently in force. Follow it in every response until it is replaced by a new active_directive or the user explicitly asks you to override it.";
  const CANCELLATION_BODY =
    "None. Any previously active directive is no longer in force. Follow only the user's current instructions and general guidance until a new active_directive is issued.";

  it("SI-1: sends an explicit cancellation (and marks tracking) on first call when stage_instructions is absent", async () => {
    const conversationId = await createConversation();
    const injector = new StageInstructionsInjector(db);

    const result = await injector.prepare(conversationId, undefined, false);

    expect(result.stageInstructionsBlock).toBe(`<active_directive>\n${CANCELLATION_BODY}\n</active_directive>`);

    const row = await db
      .get<{ last_injected_after_compaction_id: number | null }>(
        "SELECT last_injected_after_compaction_id FROM conversation_injection_state WHERE conversation_id = $1 AND injection_type = 'stage_instructions'",
        [conversationId],
      ) ?? null;
    expect(row).not.toBeNull();
  });

  it("SI-1b: does NOT resend the cancellation on the very next ordinary turn (no compaction since last injection)", async () => {
    const conversationId = await createConversation();
    const injector = new StageInstructionsInjector(db);

    await injector.prepare(conversationId, undefined, false); // sends cancellation, marks tracking
    const second = await injector.prepare(conversationId, undefined, false); // ordinary turn — not due

    expect(second.stageInstructionsBlock).toBeUndefined();
  });

  it("SI-2: wraps stage_instructions in the fixed <active_directive> template on first call", async () => {
    const conversationId = await createConversation();
    const injector = new StageInstructionsInjector(db);

    const result = await injector.prepare(conversationId, "Column guardrails.", false);

    expect(result.stageInstructionsBlock).toBe(`<active_directive>\nColumn guardrails.\n\n${REAL_SUFFIX}\n</active_directive>`);
  });

  it("SI-3: returns undefined on second call in the same column (same compaction — already injected)", async () => {
    const conversationId = await createConversation();
    const injector = new StageInstructionsInjector(db);

    await injector.prepare(conversationId, "Column guardrails.", false); // first call — injects
    const second = await injector.prepare(conversationId, "Column guardrails.", false); // second call — should suppress

    expect(second.stageInstructionsBlock).toBeUndefined();
  });

  it("SI-4: returns stageInstructionsBlock again after a new compaction occurs", async () => {
    const conversationId = await createConversation();
    const injector = new StageInstructionsInjector(db);

    await injector.prepare(conversationId, "Column guardrails.", false); // inject at compaction id 0
    await insertCompaction(conversationId); // new compaction_summary message

    const result = await injector.prepare(conversationId, "Column guardrails.", false);

    expect(result.stageInstructionsBlock).toContain("Column guardrails.");
  });

  it("SI-5: forceInject (transition) always injects regardless of prior injection state", async () => {
    const conversationId = await createConversation();
    const injector = new StageInstructionsInjector(db);

    await injector.prepare(conversationId, "Column guardrails.", false); // injected already
    const second = await injector.prepare(conversationId, "Column guardrails.", true); // forced — e.g. column transition

    expect(second.stageInstructionsBlock).toContain("Column guardrails.");
  });

  it("SI-6: forceInject with no stage_instructions sends the cancellation and marks tracking", async () => {
    const conversationId = await createConversation();
    const injector = new StageInstructionsInjector(db);

    const result = await injector.prepare(conversationId, undefined, true);

    expect(result.stageInstructionsBlock).toBe(`<active_directive>\n${CANCELLATION_BODY}\n</active_directive>`);
    const row = await db
      .get<{ last_injected_after_compaction_id: number | null }>(
        "SELECT last_injected_after_compaction_id FROM conversation_injection_state WHERE conversation_id = $1 AND injection_type = 'stage_instructions'",
        [conversationId],
      ) ?? null;
    expect(row).not.toBeNull();
  });

  it("SI-6b: forceInject cancellation fires even when a real directive was previously injected (column transitioned away)", async () => {
    const conversationId = await createConversation();
    const injector = new StageInstructionsInjector(db);

    await injector.prepare(conversationId, "Plan column guardrails.", true); // transition into plan column
    const result = await injector.prepare(conversationId, undefined, true); // transition into a column with no stage_instructions

    expect(result.stageInstructionsBlock).toBe(`<active_directive>\n${CANCELLATION_BODY}\n</active_directive>`);
  });

  it("SI-6c: resends the cancellation after a new compaction even though the column is unchanged", async () => {
    const conversationId = await createConversation();
    const injector = new StageInstructionsInjector(db);

    await injector.prepare(conversationId, undefined, true); // transition into no-instructions column — sends cancellation
    await insertCompaction(conversationId);

    const result = await injector.prepare(conversationId, undefined, false); // ordinary turn, but compaction happened

    expect(result.stageInstructionsBlock).toBe(`<active_directive>\n${CANCELLATION_BODY}\n</active_directive>`);
  });

  it("SI-7: stage_instructions tracking is independent from decisions tracking for the same conversation", async () => {
    const conversationId = await createConversation();
    const injector = new StageInstructionsInjector(db);

    await injector.prepare(conversationId, "Column guardrails.", false);

    const decisionsRow = await db
      .get<{ last_injected_after_compaction_id: number | null }>(
        "SELECT last_injected_after_compaction_id FROM conversation_injection_state WHERE conversation_id = $1 AND injection_type = 'decisions'",
        [conversationId],
      ) ?? null;
    expect(decisionsRow).toBeNull();
  });
});
