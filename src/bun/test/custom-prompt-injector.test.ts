import { describe, expect, it } from "vitest";
import { CustomPromptInjector } from "../engine/execution/custom-prompt-injector.ts";

describe("CustomPromptInjector", () => {
  it("resolveList resolves correctly when no prompts exist", () => {
    const injector = new CustomPromptInjector();
    const result = injector.resolveList({ modelId: "x", engineId: "any", executionType: "task" });
    expect(result).toHaveLength(0);
  });

  it("resolve returns undefined when no prompts exist", () => {
    const injector = new CustomPromptInjector();
    const result = injector.resolve({ modelId: "x", engineId: "any", executionType: "task" });
    expect(result).toBe(undefined);
  });
});
