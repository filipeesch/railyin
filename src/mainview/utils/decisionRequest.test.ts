import { describe, it, expect } from "vitest";
import type { DecisionRequestQuestion } from "../../shared/rpc-types";
import {
  canSubmitDecisionRequest,
  buildDecisionAnswerParts,
  buildDecisionAnswers,
  buildSubmissionText,
  isOptionSelected,
  buildResumePayload,
  buildCancelResumePayload,
  type DecisionRequestState,
} from "./decisionRequest";

const exclusiveQuestion: DecisionRequestQuestion = {
  question: "Which database?",
  type: "exclusive",
  weight: "critical",
  options: [{ title: "PostgreSQL", description: "Relational" }, { title: "SQLite", description: "Embedded" }],
};

const nonExclusiveQuestion: DecisionRequestQuestion = {
  question: "Which features?",
  type: "non_exclusive",
  weight: "medium",
  options: [{ title: "Auth", description: "Auth support" }, { title: "Realtime", description: "WebSocket" }],
};

const freetextQuestion: DecisionRequestQuestion = {
  question: "Describe your use case",
  type: "freetext",
  weight: "easy",
};

function makeState(overrides: Partial<DecisionRequestState> = {}): DecisionRequestState {
  return {
    singleSelected: [],
    multiSelected: [],
    otherValues: [],
    freetextValues: [],
    notesValues: [],
    ...overrides,
  };
}

describe("canSubmitDecisionRequest", () => {
  it("DRU-1: exclusive question requires single selection; false when empty, true when selected", () => {
    const stateEmpty = makeState({ singleSelected: [""] });
    expect(canSubmitDecisionRequest([exclusiveQuestion], stateEmpty)).toBe(false);

    const stateSelected = makeState({ singleSelected: ["PostgreSQL"] });
    expect(canSubmitDecisionRequest([exclusiveQuestion], stateSelected)).toBe(true);
  });

  it("DRU-2: exclusive question with __other__ selected requires other text filled", () => {
    const stateNoText = makeState({ singleSelected: ["__other__"], otherValues: [""] });
    expect(canSubmitDecisionRequest([exclusiveQuestion], stateNoText)).toBe(false);

    const stateWithText = makeState({ singleSelected: ["__other__"], otherValues: ["Custom answer"] });
    expect(canSubmitDecisionRequest([exclusiveQuestion], stateWithText)).toBe(true);
  });

  it("DRU-3: non_exclusive requires at least one selection; empty returns false", () => {
    const stateEmpty = makeState({ multiSelected: [[]] });
    expect(canSubmitDecisionRequest([nonExclusiveQuestion], stateEmpty)).toBe(false);

    const stateSelected = makeState({ multiSelected: [["Auth"]] });
    expect(canSubmitDecisionRequest([nonExclusiveQuestion], stateSelected)).toBe(true);
  });

  it("DRU-4: non_exclusive with __other__ selected requires other text filled", () => {
    const stateNoText = makeState({ multiSelected: [["Auth", "__other__"]], otherValues: [""] });
    expect(canSubmitDecisionRequest([nonExclusiveQuestion], stateNoText)).toBe(false);

    const stateWithText = makeState({ multiSelected: [["Auth", "__other__"]], otherValues: ["Custom"] });
    expect(canSubmitDecisionRequest([nonExclusiveQuestion], stateWithText)).toBe(true);
  });

  it("DRU-5: freetext requires non-empty trimmed text", () => {
    const stateEmpty = makeState({ freetextValues: [""] });
    expect(canSubmitDecisionRequest([freetextQuestion], stateEmpty)).toBe(false);

    const stateSpaces = makeState({ freetextValues: ["   "] });
    expect(canSubmitDecisionRequest([freetextQuestion], stateSpaces)).toBe(false);

    const stateText = makeState({ freetextValues: ["Building a CLI"] });
    expect(canSubmitDecisionRequest([freetextQuestion], stateText)).toBe(true);
  });

  it("DRU-6: multi-question batch requires ALL questions answered", () => {
    const questions = [exclusiveQuestion, freetextQuestion];
    const statePartial = makeState({
      singleSelected: ["PostgreSQL", ""],
      freetextValues: ["", ""],
    });
    expect(canSubmitDecisionRequest(questions, statePartial)).toBe(false);

    const stateAll = makeState({
      singleSelected: ["PostgreSQL", ""],
      freetextValues: ["", "My use case"],
    });
    expect(canSubmitDecisionRequest(questions, stateAll)).toBe(true);
  });
});

describe("buildDecisionAnswerParts", () => {
  it("DRU-7: formats exclusive answer as Q:/A: text", () => {
    const state = makeState({ singleSelected: ["PostgreSQL"] });
    const parts = buildDecisionAnswerParts([exclusiveQuestion], state);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toBe("Q: Which database?\nA: PostgreSQL");
  });

  it("DRU-8: formats non_exclusive multi-select as comma-joined answer; __other__ replaced with other text", () => {
    const state = makeState({
      multiSelected: [["Auth", "__other__"]],
      otherValues: ["Custom feature"],
    });
    const parts = buildDecisionAnswerParts([nonExclusiveQuestion], state);
    expect(parts[0]).toBe("Q: Which features?\nA: Auth, Custom feature");
  });

  it("DRU-9: formats freetext answer", () => {
    const state = makeState({ freetextValues: ["Building a CLI"] });
    const parts = buildDecisionAnswerParts([freetextQuestion], state);
    expect(parts[0]).toBe("Q: Describe your use case\nA: Building a CLI");
  });
});

describe("buildDecisionAnswers", () => {
  it("DRU-10: returns DecisionAnswer[] with question, answer, weight, notes", () => {
    const state = makeState({
      singleSelected: ["PostgreSQL"],
      notesValues: ["Chosen for reliability"],
    });
    const answers = buildDecisionAnswers([exclusiveQuestion], state);
    expect(answers).toHaveLength(1);
    expect(answers[0]).toEqual({
      question: "Which database?",
      answer: "PostgreSQL",
      weight: "critical",
      notes: "Chosen for reliability",
    });
  });

  it("DRU-11: notes omitted from DecisionAnswer when empty", () => {
    const state = makeState({ singleSelected: ["PostgreSQL"] });
    const answers = buildDecisionAnswers([exclusiveQuestion], state);
    expect(answers[0].notes).toBeUndefined();
  });

  it("DRU-11b: notes omitted when __other__ selected", () => {
    const state = makeState({
      singleSelected: ["__other__"],
      otherValues: ["Custom choice"],
      notesValues: ["Should be ignored"],
    });
    const answers = buildDecisionAnswers([exclusiveQuestion], state);
    expect(answers[0].answer).toBe("Custom choice");
    expect(answers[0].notes).toBeUndefined();
  });
});

describe("buildSubmissionText", () => {
  it("DRU-12: joins parts with double newline and appends general notes with --- separator", () => {
    const questions = [exclusiveQuestion, freetextQuestion];
    const state = makeState({
      singleSelected: ["PostgreSQL", ""],
      freetextValues: ["", "Use case"],
    });
    const text = buildSubmissionText(questions, state, "Overall context");
    expect(text).toContain("Q: Which database?");
    expect(text).toContain("Q: Describe your use case");
    expect(text).toContain("\n\n---\n\nGeneral notes: Overall context");
  });

  it("DRU-12b: no general notes section when generalNotes empty", () => {
    const state = makeState({ singleSelected: ["PostgreSQL"] });
    const text = buildSubmissionText([exclusiveQuestion], state, "");
    expect(text).not.toContain("General notes");
  });
});

describe("isOptionSelected", () => {
  it("DRU-13: true for selected exclusive option, false for unselected", () => {
    const state = makeState({ singleSelected: [""] });
    expect(isOptionSelected(exclusiveQuestion, "PostgreSQL", state, 0)).toBe(false);

    const stateSelected = makeState({ singleSelected: ["PostgreSQL"] });
    expect(isOptionSelected(exclusiveQuestion, "PostgreSQL", stateSelected, 0)).toBe(true);
  });

  it("DRU-13b: true for selected non_exclusive option", () => {
    const state = makeState({ multiSelected: [["Auth", "Realtime"]] });
    expect(isOptionSelected(nonExclusiveQuestion, "Auth", state, 0)).toBe(true);
    expect(isOptionSelected(nonExclusiveQuestion, "Realtime", state, 0)).toBe(true);
    expect(isOptionSelected(nonExclusiveQuestion, "__other__", state, 0)).toBe(false);
  });

  it("DRU-13c: __other__ detection works for exclusive and non_exclusive", () => {
    const stateExc = makeState({ singleSelected: ["__other__"] });
    expect(isOptionSelected(exclusiveQuestion, "__other__", stateExc, 0)).toBe(true);

    const stateNon = makeState({ multiSelected: [["__other__"]] });
    expect(isOptionSelected(nonExclusiveQuestion, "__other__", stateNon, 0)).toBe(true);
  });
});

describe("buildResumePayload", () => {
  it("DRU-14: approved shape carries decision, answers, notes and toggle", () => {
    const state = makeState({ singleSelected: ["PostgreSQL"] });
    const payload = buildResumePayload([exclusiveQuestion], state, "General context", true);
    expect(payload).toEqual({
      decision: "approved",
      answers: [{ question: "Which database?", answer: "PostgreSQL", weight: "critical", notes: undefined }],
      generalNotes: "General context",
      recordAsDecisions: true,
    });
  });

  it("DRU-15: resolved payload always produces one answer entry per question (INVALID_PAYLOAD contract — gating stays in canSubmitDecisionRequest)", () => {
    const state = makeState({ singleSelected: ["PostgreSQL", ""], freetextValues: ["", ""] });
    const payload = buildResumePayload([exclusiveQuestion, freetextQuestion], state, "", true);
    expect(payload.answers).toHaveLength(2);
    // The answered question yields a non-empty answer; the mapper does NOT gate
    // unanswered questions — canSubmitDecisionRequest owns that.
    expect(payload.answers![0].answer).toBe("PostgreSQL");
    expect(payload.answers![1].answer).toBe("");
  });

  it("DRU-16: empty generalNotes is omitted; recordAsDecisions passes through", () => {
    const state = makeState({ singleSelected: ["PostgreSQL"] });
    const noNotes = buildResumePayload([exclusiveQuestion], state, "", false);
    expect(noNotes.generalNotes).toBeUndefined();
    expect(noNotes.recordAsDecisions).toBe(false);
  });

  it("DRU-17: notes + __other__ answers pass through from buildDecisionAnswers", () => {
    const state = makeState({
      singleSelected: ["__other__"],
      otherValues: ["Custom choice"],
      notesValues: ["Ignored for other"],
    });
    const payload = buildResumePayload([exclusiveQuestion], state, "", true);
    expect(payload.answers![0]).toEqual({
      question: "Which database?",
      answer: "Custom choice",
      weight: "critical",
      notes: undefined,
    });
  });

  it("DRU-18: cancelled variant maps to { status: 'cancelled' } (Phase 3 D-02 rejection)", () => {
    expect(buildCancelResumePayload()).toEqual({ status: "cancelled" });
  });
});
