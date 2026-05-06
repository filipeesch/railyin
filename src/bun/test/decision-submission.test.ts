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
});
