import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SystemPromptAssembler } from "../engine/execution/system-prompt-assembler.ts";

describe("SystemPromptAssembler", () => {
  let injector: any;

  beforeEach(() => {
    injector = { resolveList: vi.fn() };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fromConfig factory loads workflow+stage as parts", () => {
    const assembler = new SystemPromptAssembler();
    assembler.addPart("workflow", 100, "workflow");
    assembler.addPart("stage", 200, "stage");
    assembler.addPart("custom", 10, "custom");
    expect(assembler.assemble()).toBe("custom\n\nworkflow\n\nstage");
  });

  it("assemble returns undefined when empty", () => {
    const assembler = new SystemPromptAssembler();
    expect(assembler.assemble()).toBe(undefined);
  });

  it("assemble joins parts sorted by order", () => {
    const assembler = new SystemPromptAssembler();
    assembler.addPart("z", 99, "custom");
    assembler.addPart("a", 1, "custom");
    expect(assembler.assemble()).toBe("a\n\nz");
  });

  it("addCustomPrompts adds injector output sorted by priority", () => {
    injector.resolveList.mockReturnValue([
      { content: "high", priority: 10, description: "x" },
      { content: "low", priority: 50, description: "y" },
    ]);
    const assembler = new SystemPromptAssembler();
    assembler.addPart("workflow", 100, "workflow");
    assembler.addCustomPrompts(injector, { modelId: "x", engineId: "any", executionType: "task" });
    expect(assembler.assemble()).toBe("high\n\nlow\n\nworkflow");
  });

  it("addCustomPrompts skipped when injector returns empty list", () => {
    injector.resolveList.mockReturnValue([]);
    const assembler = new SystemPromptAssembler();
    assembler.addPart("stage", 200, "stage");
    assembler.addCustomPrompts(injector, { modelId: "x", engineId: "any", executionType: "task" });
    expect(assembler.assemble()).toBe("stage");
  });

  it("fromConfig yields identical output to workflow instructions only", () => {
    const assembler = new SystemPromptAssembler();
    assembler.addPart("workflow", 100, "workflow");
    assembler.addPart("stage", 200, "stage");
    expect(assembler.assemble()).toBe("workflow\n\nstage");
  });

  it("fromConfig returns only workflow_instructions when stage is absent", () => {
    const assembler = new SystemPromptAssembler();
    assembler.addPart("workflow", 100, "workflow");
    expect(assembler.assemble()).toBe("workflow");
  });

  it("addCustomPrompts adds before workflow+stage (precedence)", () => {
    injector.resolveList.mockReturnValue([{ content: "custom", priority: 50 }]);
    const assembler = new SystemPromptAssembler();
    assembler.addPart("workflow", 100, "workflow");
    assembler.addPart("stage", 200, "stage");
    assembler.addCustomPrompts(injector, { modelId: "x", engineId: "any", executionType: "task" });
    expect(assembler.assemble()).toBe("custom\n\nworkflow\n\nstage");
  });
});
