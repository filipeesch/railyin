import type { DecisionRequestQuestion } from "../../shared/rpc-types.ts";

/**
 * Per-execution accumulator for streaming decision_request questions.
 *
 * The model calls `decision_request` once per question (flat top-level shape);
 * each call appends a `DecisionRequestQuestion` to this buffer. At turn end the
 * engine drains the buffer into a terminal `decision_request` event via
 * `buildDecisionRequestTerminalEvent`.
 *
 * One instance lives per execution on `CommonToolContext.runtime.decisionBuffer`
 * (engines create a fresh buffer before each run — see D2).
 */
export class DecisionQuestionBuffer {
  private readonly items: DecisionRequestQuestion[] = [];

  append(question: DecisionRequestQuestion): void {
    this.items.push(question);
  }

  get all(): DecisionRequestQuestion[] {
    return [...this.items];
  }

  get count(): number {
    return this.items.length;
  }

  clear(): void {
    this.items.length = 0;
  }
}
