import type { DecisionRequestQuestion } from "../../shared/rpc-types.ts";

/** A single buffered interview question plus its per-question context preamble. */
export interface BufferedDecisionQuestion {
  context?: string;
  question: DecisionRequestQuestion;
}

/**
 * Per-execution accumulator for streaming decision_request questions.
 *
 * The model calls `decision_request` once per question; each call appends to
 * this buffer. At turn end the engine drains the buffer into a terminal
 * `decision_request` event via `buildDecisionRequestTerminalEvent`.
 *
 * One instance lives per execution on `CommonToolContext.runtime.decisionBuffer`
 * (engines create a fresh buffer before each run — see D2).
 */
export class DecisionQuestionBuffer {
  private readonly items: BufferedDecisionQuestion[] = [];

  append(entry: BufferedDecisionQuestion): void {
    this.items.push(entry);
  }

  get all(): BufferedDecisionQuestion[] {
    return [...this.items];
  }

  get count(): number {
    return this.items.length;
  }

  clear(): void {
    this.items.length = 0;
  }
}
