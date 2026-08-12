import type { CommonToolContext } from "./types.ts";
import type { ToolExecutionResult } from "./common-tools.ts";
import type { DecisionRequestQuestion } from "../../shared/rpc-types.ts";

/**
 * Executes a single streaming `decision_request` tool call.
 *
 * The tool accepts ONE question per call (D1). A valid call:
 *   - validates the single question strictly (schema + runtime options-count)
 *   - appends it to the per-execution decision buffer
 *   - returns `{ type: "page", text, payload }` so the agent loop continues
 *     and the engine can stream a `decision_request_page` event to the UI
 *
 * An invalid call returns `{ type: "result", text: <instructive error> }`,
 * emits no page, and leaves previously buffered questions intact
 * (keep-buffer; reject only the bad call — D3).
 */
export function executeDecisionRequest(
  args: Record<string, unknown>,
  ctx: CommonToolContext,
): ToolExecutionResult {
  const buffer = ctx.runtime.decisionBuffer;
  const question = (args.question ?? {}) as Record<string, unknown>;
  const context = typeof args.context === "string" ? args.context.trim() : "";

  // Runtime options-count check for choice questions (schema minItems: 2 also
  // guards this, but explicit messaging helps the model self-correct).
  if (question.type !== "freetext") {
    const options = question.options;
    if (!Array.isArray(options) || options.length < 2) {
      return {
        type: "result",
        text:
          `Error: '${String(question.type ?? "(missing type)")}' questions require at least 2 options in the 'options' array. ` +
          `Do NOT embed choices or alternatives in the 'question' text — list them as separate entries in 'options'.`,
      };
    }
  }

  if (!buffer) {
    return {
      type: "result",
      text: "Error: decision_request buffer is not available for this execution.",
    };
  }

  buffer.append({ context: context || undefined, question: question as unknown as DecisionRequestQuestion });

  const text =
    `Question ${buffer.count} of ${buffer.count} buffered. ` +
    `Call decision_request again to add more questions, or END YOUR TURN now to present the interview to the user.`;

  return {
    type: "page",
    text,
    payload: JSON.stringify(context ? { ...question, context } : question),
  };
}
