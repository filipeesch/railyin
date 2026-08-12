import type { CommonToolContext } from "./types.ts";
import type { ToolExecutionResult } from "./common-tools.ts";
import type { DecisionRequestQuestion } from "../../shared/rpc-types.ts";

/**
 * Executes a single streaming `decision_request` tool call.
 *
 * The tool accepts ONE question per call with a FLAT, top-level shape (D1):
 * `{ context?, question: string, type, weight?, model_lean?, options? }`.
 * A valid call:
 *   - validates the flat question strictly (schema + runtime options-count)
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
  const context = typeof args.context === "string" ? args.context.trim() : "";

  // Runtime options-count check for choice questions (schema minItems: 2 also
  // guards this, but explicit messaging helps the model self-correct).
  const type = typeof args.type === "string" ? args.type : "";
  if (type !== "freetext") {
    const options = args.options;
    if (!Array.isArray(options) || options.length < 2) {
      return {
        type: "result",
        text:
          `Error: '${type || "(missing type)"}' questions require at least 2 options in the 'options' array. ` +
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

  // Assemble the UI-facing question object from the flat tool arguments.
  const question: DecisionRequestQuestion = {
    question: typeof args.question === "string" ? args.question : "",
    type: (type as DecisionRequestQuestion["type"]) || "freetext",
  };
  if (typeof args.weight === "string") question.weight = args.weight as DecisionRequestQuestion["weight"];
  if (typeof args.model_lean === "string") question.model_lean = args.model_lean;
  if (typeof args.model_lean_reason === "string") question.model_lean_reason = args.model_lean_reason;
  if (typeof args.answers_affect_followup === "boolean") question.answers_affect_followup = args.answers_affect_followup;
  if (Array.isArray(args.options) && args.options.length > 0) {
    question.options = args.options as DecisionRequestQuestion["options"];
  }
  if (context) question.context = context;

  buffer.append(question);

  const text =
    `Question ${buffer.count} of ${buffer.count} buffered. ` +
    `Call decision_request again to add more questions, or END YOUR TURN now to present the interview to the user.`;

  return {
    type: "page",
    text,
    payload: JSON.stringify(question),
  };
}
