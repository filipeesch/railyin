import { describe, expect, it } from "vitest";
import { executeDecisionRequest } from "../engine/decision-request-executor.ts";
import { DecisionQuestionBuffer } from "../engine/decision-buffer.ts";
import type { CommonToolContext } from "../engine/types.ts";

function makeCtx(): CommonToolContext {
  return {
    task: { id: 1, boardId: 1, conversationId: 1 },
    workspaceKey: "default",
    repos: {} as never,
    workflow: {} as never,
    runtime: { decisionBuffer: new DecisionQuestionBuffer() },
  };
}

describe("executeDecisionRequest", () => {
  it("appends a valid flat question and returns a page result with count + end-turn hint", () => {
    const ctx = makeCtx();
    const result = executeDecisionRequest(
      { question: "Which DB?", type: "exclusive", options: [{ title: "PG", description: "Postgres" }, { title: "SQLite", description: "SQLite embedded" }] },
      ctx,
    );
    expect(result.type).toBe("page");
    expect((result as { text: string }).text).toContain("Question 1 of 1 buffered");
    expect((result as { text: string }).text).toContain("END YOUR TURN");
    expect(ctx.runtime.decisionBuffer!.count).toBe(1);
    const parsed = JSON.parse((result as { payload: string }).payload);
    expect(parsed.question).toBe("Which DB?");
    expect(parsed.type).toBe("exclusive");
  });

  it("returns error for exclusive question with fewer than 2 options (no buffer mutation)", () => {
    const ctx = makeCtx();
    const result = executeDecisionRequest(
      { question: "Which DB?", type: "exclusive", options: [{ title: "PG", description: "Postgres" }] },
      ctx,
    );
    expect(result.type).toBe("result");
    expect((result as { text: string }).text).toMatch(/at least 2 options/);
    expect(ctx.runtime.decisionBuffer!.count).toBe(0);
  });

  it("returns error when missing type (runtime options-count guard still covers non-freetext)", () => {
    const ctx = makeCtx();
    // Schema validation normally catches this first; the executor guard must
    // not crash and should not append.
    const result = executeDecisionRequest({ question: "Pick?" }, ctx);
    expect(result.type).toBe("result");
    expect(ctx.runtime.decisionBuffer!.count).toBe(0);
  });

  it("appends freetext question without options", () => {
    const ctx = makeCtx();
    const result = executeDecisionRequest({ question: "Any constraints?", type: "freetext" }, ctx);
    expect(result.type).toBe("page");
    expect(ctx.runtime.decisionBuffer!.count).toBe(1);
  });

  it("returns error when no buffer is available", () => {
    const ctx = { ...makeCtx(), runtime: {} } as unknown as CommonToolContext;
    const result = executeDecisionRequest({ question: "Q", type: "freetext" }, ctx);
    expect(result.type).toBe("result");
    expect((result as { text: string }).text).toContain("buffer is not available");
  });

  it("returns count reflecting accumulation across calls", () => {
    const ctx = makeCtx();
    executeDecisionRequest({ question: "Q1", type: "freetext" }, ctx);
    const second = executeDecisionRequest({ question: "Q2", type: "freetext" }, ctx);
    expect((second as { text: string }).text).toContain("Question 2 of 2 buffered");
  });

  it("folds per-question context into the page payload", () => {
    const ctx = makeCtx();
    const result = executeDecisionRequest({ context: "Preamble", question: "Q1", type: "freetext" }, ctx);
    expect(result.type).toBe("page");
    const parsed = JSON.parse((result as { payload: string }).payload);
    expect(parsed.context).toBe("Preamble");
  });
});
