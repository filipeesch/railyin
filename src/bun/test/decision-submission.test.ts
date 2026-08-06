import { describe, it, expect } from "vitest";
import { buildDecisionSubmission } from "../conversation/decision-submission.ts";

describe("buildDecisionSubmission", () => {
  it("DS-1: single answer uses default weight MEDIUM in userContent", () => {
    const result = buildDecisionSubmission([{ question: "Pick one?", answer: "A" }]);
    expect(result.userContent).toContain("**Q [MEDIUM]:**");
  });

  it("DS-2: single answer includes formatted answer line in userContent", () => {
    const result = buildDecisionSubmission([{ question: "Pick one?", answer: "Option B" }]);
    expect(result.userContent).toContain("**A:** Option B");
  });

  it("DS-3: critical weight is uppercased in userContent", () => {
    const result = buildDecisionSubmission([{ question: "Architecture?", answer: "Monolith", weight: "critical" }]);
    expect(result.userContent).toContain("**Q [CRITICAL]:**");
  });

  it("DS-4: answer with notes includes Notes line in userContent", () => {
    const result = buildDecisionSubmission([{ question: "DB?", answer: "SQLite", notes: "Chosen for simplicity" }]);
    expect(result.userContent).toContain("*Notes: Chosen for simplicity*");
  });

  it("DS-5: answer without notes does not include Notes line", () => {
    const result = buildDecisionSubmission([{ question: "DB?", answer: "SQLite" }]);
    expect(result.userContent).not.toContain("*Notes:");
  });

  it("DS-6: engineContent starts with the same content as userContent", () => {
    const result = buildDecisionSubmission([{ question: "Style?", answer: "Tabs" }]);
    expect(result.engineContent.startsWith(result.userContent)).toBe(true);
  });

  it("DS-7: engineContent contains the hidden list_decisions() instruction", () => {
    const result = buildDecisionSubmission([{ question: "Style?", answer: "Spaces" }]);
    expect(result.engineContent).toContain("list_decisions()");
  });

  it("DS-8: engineContent explains both update_decision and record_decision paths", () => {
    const result = buildDecisionSubmission([{ question: "Cache?", answer: "Redis" }]);
    expect(result.engineContent).toContain("update_decision");
    expect(result.engineContent).toContain("record_decision");
  });

  it("DS-9: generalNotes is appended as a separate section after answers", () => {
    const result = buildDecisionSubmission(
      [{ question: "DB?", answer: "SQLite" }],
      "These choices are temporary"
    );
    expect(result.userContent).toContain("**General notes:** These choices are temporary");
  });

  it("DS-10: empty generalNotes does not add a general notes section", () => {
    const result = buildDecisionSubmission([{ question: "DB?", answer: "SQLite" }], "");
    expect(result.userContent).not.toContain("General notes");
  });

  it("DS-11: whitespace-only generalNotes does not add a general notes section", () => {
    const result = buildDecisionSubmission([{ question: "DB?", answer: "SQLite" }], "   ");
    expect(result.userContent).not.toContain("General notes");
  });

  it("DS-12: generalNotes appears after answer sections (separator line present)", () => {
    const result = buildDecisionSubmission(
      [{ question: "DB?", answer: "SQLite" }],
      "Extra context"
    );
    expect(result.userContent).toContain("---");
  });

  it("DS-13: recordAsDecisions=false → engineContent contains NO_RECORD_INSTRUCTION", () => {
    const result = buildDecisionSubmission([{ question: "Q?", answer: "A" }], undefined, false);
    expect(result.engineContent).toContain("Do NOT call record_decision");
  });

  it("DS-14: recordAsDecisions=false → engineContent does NOT contain list_decisions()", () => {
    const result = buildDecisionSubmission([{ question: "Q?", answer: "A" }], undefined, false);
    expect(result.engineContent).not.toContain("list_decisions()");
  });

  it("DS-15: recordAsDecisions=false → engineContent does NOT contain the HIDDEN_INSTRUCTION update_decision instruction", () => {
    const result = buildDecisionSubmission([{ question: "Q?", answer: "A" }], undefined, false);
    expect(result.engineContent).not.toContain("call update_decision");
  });

  it("DS-16: recordAsDecisions=false → userContent is identical to recordAsDecisions=true", () => {
    const withRecord = buildDecisionSubmission([{ question: "Q?", answer: "A", weight: "critical" }]);
    const withoutRecord = buildDecisionSubmission([{ question: "Q?", answer: "A", weight: "critical" }], undefined, false);
    expect(withoutRecord.userContent).toBe(withRecord.userContent);
  });

  it("DS-17: recordAsDecisions=false → NO_RECORD_INSTRUCTION NOT in userContent", () => {
    const result = buildDecisionSubmission([{ question: "Q?", answer: "A" }], undefined, false);
    expect(result.userContent).not.toContain("Do NOT call record_decision");
  });

  it("DS-18: recordAsDecisions=false with generalNotes → NO_RECORD_INSTRUCTION still appended", () => {
    const result = buildDecisionSubmission(
      [{ question: "DB?", answer: "SQLite" }],
      "Extra context",
      false
    );
    expect(result.engineContent).toContain("Do NOT call record_decision");
    expect(result.userContent).toContain("**General notes:** Extra context");
  });

  it("DS-19: default recordAsDecisions=true keeps existing behavior (list_decisions present)", () => {
    const result = buildDecisionSubmission([{ question: "Style?", answer: "Tabs" }]);
    expect(result.engineContent).toContain("list_decisions()");
    expect(result.engineContent).toContain("record_decision");
  });
});
