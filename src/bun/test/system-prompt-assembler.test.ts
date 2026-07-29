import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "bun:sqlite";
import { resetConfig } from "../config/index.ts";
import { getWorkspaceConfig } from "../workspace-context.ts";
import { SystemPromptAssembler } from "../engine/execution/system-prompt-assembler.ts";
import { initDb, seedProjectAndTask, setupTestConfig } from "./helpers.ts";

describe("SystemPromptAssembler", () => {
  let injector: any;

  beforeEach(() => {
    injector = { resolveList: vi.fn() };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fromConfig factory loads workflow as parts (stage_instructions no longer included)", () => {
    const assembler = new SystemPromptAssembler();
    assembler.addPart("workflow", 100, "workflow");
    assembler.addPart("custom", 10, "custom");
    expect(assembler.assemble()).toBe("custom\n\nworkflow");
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

  it("addPart('workflow')+addPart('stage') yields workflow+stage joined (direct addPart usage still supported)", () => {
    const assembler = new SystemPromptAssembler();
    assembler.addPart("workflow", 100, "workflow");
    assembler.addPart("stage", 200, "stage");
    expect(assembler.assemble()).toBe("workflow\n\nstage");
  });

  it("addPart('workflow') only yields workflow when stage is absent", () => {
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

describe("SystemPromptAssembler.fromConfig / getStageInstructions (real config)", () => {
  let db: Database;
  let configCleanup: () => void;

  beforeEach(() => {
    db = initDb();
  });

  afterEach(() => {
    configCleanup?.();
    resetConfig();
  });

  it("fromConfig().assemble() never includes stage_instructions content", () => {
    const cfg = setupTestConfig("", undefined, [
      `id: spa-workflow
name: SpaWorkflow
workflow_instructions: "Workflow context."
columns:
  - id: backlog
    label: Backlog
    is_backlog: true
  - id: plan
    label: Plan
    stage_instructions: "Column context."
`,
    ]);
    configCleanup = cfg.cleanup;
    const { boardId } = seedProjectAndTask(db, "");
    db.run("UPDATE boards SET workflow_template_id = 'spa-workflow' WHERE id = ?", [boardId]);
    const config = getWorkspaceConfig("default");

    const assembler = SystemPromptAssembler.fromConfig(config, boardId, "plan");
    expect(assembler.assemble()).toBe("Workflow context.");
  });

  it("getStageInstructions() returns the column's raw stage_instructions text", () => {
    const cfg = setupTestConfig("", undefined, [
      `id: spa-workflow-2
name: SpaWorkflow2
columns:
  - id: backlog
    label: Backlog
    is_backlog: true
  - id: plan
    label: Plan
    stage_instructions: "Column context."
`,
    ]);
    configCleanup = cfg.cleanup;
    const { boardId } = seedProjectAndTask(db, "");
    db.run("UPDATE boards SET workflow_template_id = 'spa-workflow-2' WHERE id = ?", [boardId]);
    const config = getWorkspaceConfig("default");

    expect(SystemPromptAssembler.getStageInstructions(config, boardId, "plan")).toBe("Column context.");
  });

  it("getStageInstructions() returns undefined when the column defines no stage_instructions", () => {
    const cfg = setupTestConfig("", undefined, [
      `id: spa-workflow-3
name: SpaWorkflow3
columns:
  - id: backlog
    label: Backlog
    is_backlog: true
  - id: plan
    label: Plan
`,
    ]);
    configCleanup = cfg.cleanup;
    const { boardId } = seedProjectAndTask(db, "");
    db.run("UPDATE boards SET workflow_template_id = 'spa-workflow-3' WHERE id = ?", [boardId]);
    const config = getWorkspaceConfig("default");

    expect(SystemPromptAssembler.getStageInstructions(config, boardId, "plan")).toBeUndefined();
  });
});
