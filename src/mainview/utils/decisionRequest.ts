/**
 * decisionRequest.ts — Pure, testable helpers for the DecisionRequest interview form.
 *
 * These functions are extracted from DecisionRequest.vue so the validation and
 * answer-formatting logic can be unit-tested without a Vue component harness.
 * They take plain data in and return plain data out — no DOM, no Vue reactivity.
 */
import type { DecisionRequestQuestion } from "@shared/rpc-types";

/** Per-question form state for a decision request. */
export interface DecisionRequestState {
  /** Selection strings for `exclusive` questions (indexed by question index). */
  singleSelected: string[];
  /** Selection arrays for `non_exclusive` questions (indexed by question index). */
  multiSelected: string[][];
  /** Free-text answers for the "__other__" option (indexed by question index). */
  otherValues: string[];
  /** Answers for `freetext` questions (indexed by question index). */
  freetextValues: string[];
  /** Optional notes for each question (indexed by question index). */
  notesValues: string[];
}

/** Threshold: whether the submit button may be enabled for the full form. */
export function canSubmitDecisionRequest(questions: DecisionRequestQuestion[], state: DecisionRequestState): boolean {
  return questions.every((q, qi) => {
    if (q.type === "freetext") return (state.freetextValues[qi] ?? "").trim().length > 0;
    if (q.type === "exclusive") {
      const sel = state.singleSelected[qi];
      if (!sel) return false;
      if (sel === "__other__") return (state.otherValues[qi] ?? "").trim().length > 0;
      return true;
    }
    // non_exclusive
    const sel = state.multiSelected[qi] ?? [];
    if (sel.length === 0) return false;
    if (sel.includes("__other__")) return (state.otherValues[qi] ?? "").trim().length > 0;
    return true;
  });
}

/** Whether a given option title is selected for a question. */
export function isOptionSelected(q: DecisionRequestQuestion, title: string, state: DecisionRequestState, qi: number): boolean {
  if (q.type === "exclusive") return state.singleSelected[qi] === title;
  return state.multiSelected[qi]?.includes(title) ?? false;
}

/** Build the per-question `Q:` / `A:` text lines (used for the `text` payload). */
export function buildDecisionAnswerParts(questions: DecisionRequestQuestion[], state: DecisionRequestState): string[] {
  return questions.map((q, qi) => {
    const answer = answerTextForQuestion(q, state, qi);
    const notes = q.type !== "freetext" && !isOptionSelected(q, "__other__", state, qi)
      ? (state.notesValues[qi] ?? "").trim()
      : "";

    let part = `Q: ${q.question}\nA: ${answer}`;
    if (notes) part += `\nNotes: ${notes}`;
    return part;
  });
}

/** Build the structured `{ question, answer, weight, notes }` entries (used for the `decisions` payload). */
export function buildDecisionAnswers(questions: DecisionRequestQuestion[], state: DecisionRequestState): Array<{ question: string; answer: string; weight: string; notes?: string }> {
  return questions.map((q, qi) => {
    const answer = answerTextForQuestion(q, state, qi);
    const notes = q.type !== "freetext" && !isOptionSelected(q, "__other__", state, qi)
      ? (state.notesValues[qi] ?? "").trim() || undefined
      : undefined;
    return { question: q.question, answer, weight: q.weight ?? "medium", notes };
  });
}

/** Compose the final submission text (parts joined, plus optional general notes). */
export function buildSubmissionText(questions: DecisionRequestQuestion[], state: DecisionRequestState, generalNotes: string): string {
  const parts = buildDecisionAnswerParts(questions, state);
  let text = parts.join("\n\n");
  const trimmedNotes = generalNotes?.trim() ?? "";
  if (trimmedNotes) text += `\n\n---\n\nGeneral notes: ${trimmedNotes}`;
  return text;
}

/** Resolve the user's answer text for a single question. */
function answerTextForQuestion(q: DecisionRequestQuestion, state: DecisionRequestState, qi: number): string {
  if (q.type === "freetext") {
    return state.freetextValues[qi].trim();
  }
  if (q.type === "exclusive") {
    const sel = state.singleSelected[qi];
    return sel === "__other__" ? state.otherValues[qi].trim() : sel;
  }
  // non_exclusive
  const sel = state.multiSelected[qi].map((v) =>
    v === "__other__" ? state.otherValues[qi].trim() : v,
  );
  return sel.join(", ");
}

/**
 * The Phase 5 resume-payload contract (event-bridge.ts:380-422 — SINGLE
 * SOURCE OF TRUTH): a RESOLVED resume MUST carry non-empty `answers` else the
 * server rejects with INVALID_PAYLOAD. This mapper builds the approved payload
 * from the interview form state; gating (all required questions answered) is
 * `canSubmitDecisionRequest`'s job — the mapper never blocks.
 */
export function buildResumePayload(
  questions: DecisionRequestQuestion[],
  state: DecisionRequestState,
  generalNotes: string,
  recordAsDecisions: boolean,
): { decision: "approved"; answers: Array<{ question: string; answer: string; weight: string; notes?: string }>; generalNotes?: string; recordAsDecisions: boolean } {
  return {
    decision: "approved",
    answers: buildDecisionAnswers(questions, state),
    generalNotes: generalNotes?.trim() || undefined,
    recordAsDecisions,
  };
}

/** Cancelled variant — the rejection/dismissal path (Phase 3 D-02): nothing reaches the engine. */
export function buildCancelResumePayload(): { status: "cancelled" } {
  return { status: "cancelled" };
}
