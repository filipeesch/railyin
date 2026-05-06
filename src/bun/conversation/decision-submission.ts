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

export function buildDecisionSubmission(answers: DecisionAnswer[]): DecisionSubmission {
  const lines: string[] = [];

  for (const a of answers) {
    const weight = a.weight ?? "medium";
    lines.push(`**Q [${weight.toUpperCase()}]:** ${a.question}`);
    lines.push(`**A:** ${a.answer}`);
    if (a.notes) {
      lines.push(`*Notes: ${a.notes}*`);
    }
    lines.push("");
  }

  const userContent = lines.join("\n").trimEnd();
  const engineContent = userContent + HIDDEN_INSTRUCTION;

  return { userContent, engineContent };
}
