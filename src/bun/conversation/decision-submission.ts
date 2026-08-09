import type { DecisionAnswer } from "../../shared/rpc-types.ts";

export interface DecisionSubmission {
  userContent: string;
  engineContent: string;
}

const HIDDEN_INSTRUCTION =
  "\n\nIMPORTANT: For each answer above, you MUST:\n" +
  "1. Call list_decisions() to check if a record already exists for that question.\n" +
  "2. If a record exists → call update_decision(id, newAnswer, \"user re-answered via decision_request\") to update it.\n" +
  "3. If no record exists → call record_decision(question, answer, weight, notes?) to create one.\n" +
  "NEVER call record_decision when a record already exists — this creates duplicate records.";
const NO_RECORD_INSTRUCTION =
  "\n\nIMPORTANT: These are questions, not decisions. Do NOT call record_decision or update_decision for any of them.";

const ANSWERS_OPEN = "<decision_answers>";
const ANSWERS_CLOSE = "</decision_answers>";

/**
 * WR-06: sanitize client-controlled decision text before it reaches the
 * engine prompt. Answers/notes/generalNotes are untrusted input that ends up
 * adjacent to the hidden record_decision instruction in the engine's user
 * turn — escaping the angle brackets prevents a crafted answer from closing
 * the <decision_answers> container early and injecting instructions that sit
 * next to (or override) the hidden one. The escaped form reads as literal
 * text to the engine.
 */
function sanitizeDecisionText(text: string): string {
  return text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function buildDecisionSubmission(answers: DecisionAnswer[], generalNotes?: string, recordAsDecisions = true): DecisionSubmission {
  const lines: string[] = [];

  for (const a of answers) {
    const weight = a.weight ?? "medium";
    lines.push(`**Q [${weight.toUpperCase()}]:** ${sanitizeDecisionText(a.question)}`);
    lines.push(`**A:** ${sanitizeDecisionText(a.answer)}`);
    if (a.notes) {
      lines.push(`*Notes: ${sanitizeDecisionText(a.notes)}*`);
    }
    lines.push("");
  }

  if (generalNotes?.trim()) {
    lines.push("---");
    lines.push(`**General notes:** ${sanitizeDecisionText(generalNotes.trim())}`);
    lines.push("");
  }

  // WR-06: wrap the Q/A block in a structured container so the engine can
  // distinguish user-provided data from the record_decision instruction that
  // follows; with the escaped delimiters the answers cannot break out of the
  // container and sit adjacent to the hidden instruction.
  const body = lines.join("\n").trimEnd();
  const userContent = [ANSWERS_OPEN, body, ANSWERS_CLOSE].filter(Boolean).join("\n");
  const hiddenInstruction = recordAsDecisions ? HIDDEN_INSTRUCTION : NO_RECORD_INSTRUCTION;
  const engineContent = userContent + hiddenInstruction;

  return { userContent, engineContent };
}
