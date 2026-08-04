import { describe, it, expect, beforeEach } from "vitest";
import type { Db } from "../db/db.ts";
import { DecisionRepository } from "../db/repositories/decision-repository.ts";
import { initDb } from "./helpers.ts";

let db: Db;
let repo: DecisionRepository;
let conversationId: number;

beforeEach(async () => {
  db = await initDb();
  repo = new DecisionRepository(db);
  const conv = await db.get<{ id: number }>("INSERT INTO conversations (task_id) VALUES (0) RETURNING id");
  conversationId = conv!.id;
});

// DR-1
describe("buildContextBlock", () => {
  it("DR-1: returns empty string when no records exist", async () => {
    expect(await repo.buildContextBlock(conversationId)).toBe("");
  });

  // DR-2
  it("DR-2: includes weight label [CRITICAL] for critical records", async () => {
    await repo.createRecord(conversationId, {
      question: "Architecture choice?",
      answer: "Monolith",
      weight: "critical",
    });
    const block = await repo.buildContextBlock(conversationId);
    expect(block).toContain("[CRITICAL]");
    expect(block).toContain("Architecture choice?");
    expect(block).toContain("→ Monolith");
  });

  // DR-3
  it("DR-3: includes [AI-recorded] suffix for isSourceAi=true records", async () => {
    await repo.createRecord(conversationId, {
      question: "AI decision?",
      answer: "Yes",
      isSourceAi: true,
    });
    const block = await repo.buildContextBlock(conversationId);
    expect(block).toContain("[AI-recorded]");
  });

  // DR-4
  it("DR-4: does not include [AI-recorded] for human-recorded records", async () => {
    await repo.createRecord(conversationId, {
      question: "Human decision?",
      answer: "Yes",
      isSourceAi: false,
    });
    const block = await repo.buildContextBlock(conversationId);
    expect(block).not.toContain("[AI-recorded]");
  });

  // DR-5
  it("DR-5: includes Notes: when record has notes", async () => {
    await repo.createRecord(conversationId, {
      question: "DB choice?",
      answer: "SQLite",
      notes: "Chosen for simplicity",
    });
    const block = await repo.buildContextBlock(conversationId);
    expect(block).toContain("Notes: Chosen for simplicity");
  });

  // DR-6
  it("DR-6: includes revision info when record has been revised", async () => {
    const record = await repo.createRecord(conversationId, {
      question: "Framework?",
      answer: "React",
    });
    await repo.updateRecord(record.id, "Vue", "Better DX");
    const block = await repo.buildContextBlock(conversationId);
    expect(block).toContain('revised 1x');
    expect(block).toContain('last reason: "Better DX"');
  });

  // DR-7
  it("DR-7: orders records by weight — critical first, then medium, then easy", async () => {
    await repo.createRecord(conversationId, { question: "Easy Q", answer: "A", weight: "easy" });
    await repo.createRecord(conversationId, { question: "Medium Q", answer: "B", weight: "medium" });
    await repo.createRecord(conversationId, { question: "Critical Q", answer: "C", weight: "critical" });
    const block = await repo.buildContextBlock(conversationId);
    const criticalPos = block.indexOf("[CRITICAL]");
    const mediumPos = block.indexOf("[MEDIUM]");
    const easyPos = block.indexOf("[EASY]");
    expect(criticalPos).toBeLessThan(mediumPos);
    expect(mediumPos).toBeLessThan(easyPos);
  });

  // DR-8
  it("DR-8: adds blank line between different weight groups", async () => {
    await repo.createRecord(conversationId, { question: "Critical Q", answer: "A", weight: "critical" });
    await repo.createRecord(conversationId, { question: "Easy Q", answer: "B", weight: "easy" });
    const block = await repo.buildContextBlock(conversationId);
    // A blank line between groups means two consecutive newlines appear between them
    expect(block).toContain("\n\n");
  });
});

// DR-9
describe("markDecisionsInjected / getLastInjectedCompactionId", () => {
  it("DR-9: getLastInjectedCompactionId returns null when not yet set", async () => {
    expect(await repo.getLastInjectedCompactionId(conversationId)).toBeNull();
  });

  // DR-10
  it("DR-10: markDecisionsInjected stores the compactionSummaryId and getLastInjectedCompactionId returns it", async () => {
    await repo.markDecisionsInjected(conversationId, 42);
    expect(await repo.getLastInjectedCompactionId(conversationId)).toBe(42);
  });

  it("DR-10b: markDecisionsInjected can store sentinel value 0", async () => {
    await repo.markDecisionsInjected(conversationId, 0);
    expect(await repo.getLastInjectedCompactionId(conversationId)).toBe(0);
  });
});
