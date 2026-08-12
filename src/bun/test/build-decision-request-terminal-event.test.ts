import { describe, expect, it } from "vitest";
import { DecisionQuestionBuffer } from "../engine/decision-buffer.ts";
import { buildDecisionRequestTerminalEvent } from "../engine/decision-request-terminal-event.ts";

describe("buildDecisionRequestTerminalEvent", () => {
  it("returns null for an empty buffer", () => {
    expect(buildDecisionRequestTerminalEvent(new DecisionQuestionBuffer())).toBeNull();
  });

  it("returns a terminal decision_request with all buffered questions", () => {
    const buffer = new DecisionQuestionBuffer();
    buffer.append({ question: { question: "Q1", type: "freetext" } });
    buffer.append({ question: { question: "Q2", type: "exclusive" }, context: "ctx" });

    const event = buildDecisionRequestTerminalEvent(buffer);
    expect(event).not.toBeNull();
    expect(event!.type).toBe("decision_request");

    const parsed = JSON.parse((event as { payload: string }).payload);
    expect(parsed.questions).toHaveLength(2);
    expect(parsed.questions[0].question).toBe("Q1");
    expect(parsed.questions[1].question).toBe("Q2");
  });

  it("folds per-question context into the question object (D7)", () => {
    const buffer = new DecisionQuestionBuffer();
    buffer.append({ question: { question: "Q1", type: "freetext" }, context: "preamble" });

    const event = buildDecisionRequestTerminalEvent(buffer);
    const parsed = JSON.parse((event as { payload: string }).payload);
    expect(parsed.questions[0].context).toBe("preamble");
  });

  it("does not mutate the buffer (caller drains)", () => {
    const buffer = new DecisionQuestionBuffer();
    buffer.append({ question: { question: "Q1", type: "freetext" } });
    buildDecisionRequestTerminalEvent(buffer);
    expect(buffer.count).toBe(1);
  });
});
