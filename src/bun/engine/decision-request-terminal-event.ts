import type { EngineEvent } from "./types.ts";
import type { DecisionQuestionBuffer } from "./decision-buffer.ts";

/**
 * Pure, IO-free turn-end flush helper (D10).
 *
 * Returns the terminal `decision_request` EngineEvent carrying every buffered
 * question when the buffer is non-empty, or `null` when empty. Engines call
 * this immediately before emitting `done` and yield the returned event instead
 * when non-null, so buffered questions are never silently lost.
 *
 * @param buffer The per-execution DecisionQuestionBuffer to drain.
 * @returns The terminal EngineEvent to emit in place of `done`, or `null`.
 */
export function buildDecisionRequestTerminalEvent(
  buffer: DecisionQuestionBuffer,
): EngineEvent | null {
  if (buffer.count === 0) return null;
  return {
    type: "decision_request",
    payload: JSON.stringify({ questions: buffer.all }),
  };
}
