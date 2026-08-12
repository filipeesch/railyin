import { describe, expect, it } from "vitest";
import { DecisionQuestionBuffer } from "../engine/decision-buffer.ts";

describe("DecisionQuestionBuffer", () => {
  it("starts empty", () => {
    const buffer = new DecisionQuestionBuffer();
    expect(buffer.count).toBe(0);
    expect(buffer.all).toEqual([]);
  });

  it("appends entries in call order", () => {
    const buffer = new DecisionQuestionBuffer();
    buffer.append({ question: { question: "Q1", type: "freetext" } });
    buffer.append({ question: { question: "Q2", type: "exclusive" }, context: "ctx for Q2" });
    expect(buffer.count).toBe(2);
    expect(buffer.all.map((e) => e.question.question)).toEqual(["Q1", "Q2"]);
    expect(buffer.all[1].context).toBe("ctx for Q2");
  });

  it("all returns a copy (not the internal array)", () => {
    const buffer = new DecisionQuestionBuffer();
    buffer.append({ question: { question: "Q1", type: "freetext" } });
    const snapshot = buffer.all;
    snapshot.push({ question: { question: "HACK", type: "freetext" } });
    expect(buffer.count).toBe(1);
  });

  it("clear empties the buffer", () => {
    const buffer = new DecisionQuestionBuffer();
    buffer.append({ question: { question: "Q1", type: "freetext" } });
    buffer.clear();
    expect(buffer.count).toBe(0);
    expect(buffer.all).toEqual([]);
  });
});
