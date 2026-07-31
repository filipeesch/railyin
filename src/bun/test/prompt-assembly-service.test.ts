import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "bun:sqlite";
import { resetConfig } from "../config/index.ts";
import { getWorkspaceConfig } from "../workspace-context.ts";
import { PromptAssemblyService } from "../engine/execution/prompt-assembly-service.ts";
import { initDb, seedProjectAndTask, setupTestConfig } from "./helpers.ts";

let db: Database;
let configCleanup: () => void;

beforeEach(() => {
  db = initDb();
});

afterEach(() => {
  configCleanup?.();
  resetConfig();
});

// Mirrors system-prompt-assembler.test.ts's mocked-injector pattern: real config/board
// lookups (required since SystemPromptAssembler.fromConfig/getStageInstructions read
// column config via getDb()), but the CustomPromptInjector and StageInstructionsInjector
// collaborators are mocked to isolate PromptAssemblyService's own assembly/ordering logic.
describe("PromptAssemblyService", () => {
  it("PAS-1: systemInstructions never contains stage_instructions content", () => {
    const cfg = setupTestConfig("", undefined, [
      `id: pas-workflow
name: PasWorkflow
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
    db.run("UPDATE boards SET workflow_template_id = 'pas-workflow' WHERE id = ?", [boardId]);
    const config = getWorkspaceConfig("default");

    const customPromptInjector = { resolveList: vi.fn().mockReturnValue([]) };
    const stageInstructionsInjector = { prepare: vi.fn().mockReturnValue({ stageInstructionsBlock: "Column context." }) };
    const service = new PromptAssemblyService(customPromptInjector as any, stageInstructionsInjector as any);

    const result = service.assemble({
      config,
      boardId,
      columnId: "plan",
      conversationId: 1,
      promptFilter: { modelId: "x", engineId: "copilot", executionType: "task" },
      isTransition: false,
    });

    expect(result.systemInstructions).toBe("Workflow context.");
    expect(result.systemInstructions).not.toContain("Column context.");
  });

  it("PAS-2: custom-prompt/workflow-instruction ordering is preserved (custom prompts first)", () => {
    const cfg = setupTestConfig("", undefined, [
      `id: pas-workflow-2
name: PasWorkflow2
workflow_instructions: "Workflow context."
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
    db.run("UPDATE boards SET workflow_template_id = 'pas-workflow-2' WHERE id = ?", [boardId]);
    const config = getWorkspaceConfig("default");

    const customPromptInjector = {
      resolveList: vi.fn().mockReturnValue([{ content: "Custom prompt.", priority: 10 }]),
    };
    const stageInstructionsInjector = { prepare: vi.fn().mockReturnValue({ stageInstructionsBlock: undefined }) };
    const service = new PromptAssemblyService(customPromptInjector as any, stageInstructionsInjector as any);

    const result = service.assemble({
      config,
      boardId,
      columnId: "plan",
      conversationId: 1,
      promptFilter: { modelId: "x", engineId: "copilot", executionType: "task" },
      isTransition: false,
    });

    expect(result.systemInstructions).toBe("Custom prompt.\n\nWorkflow context.");
  });

  it("PAS-3: stageInstructionsBlock passes through the value returned by the stage-instructions injector", () => {
    const cfg = setupTestConfig("", undefined, [
      `id: pas-workflow-3
name: PasWorkflow3
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
    db.run("UPDATE boards SET workflow_template_id = 'pas-workflow-3' WHERE id = ?", [boardId]);
    const config = getWorkspaceConfig("default");

    const customPromptInjector = { resolveList: vi.fn().mockReturnValue([]) };
    const stageInstructionsInjector = {
      prepare: vi.fn().mockReturnValue({ stageInstructionsBlock: "Column context." }),
    };
    const service = new PromptAssemblyService(customPromptInjector as any, stageInstructionsInjector as any);

    const result = service.assemble({
      config,
      boardId,
      columnId: "plan",
      conversationId: 42,
      promptFilter: { modelId: "x", engineId: "copilot", executionType: "task" },
      isTransition: true,
    });

    expect(result.stageInstructionsBlock).toBe("Column context.");
    expect(stageInstructionsInjector.prepare).toHaveBeenCalledWith(42, "Column context.", true);
  });

  it("PAS-4: forwards isTransition through to the stage-instructions injector's forceInject parameter", () => {
    const cfg = setupTestConfig("", undefined, [
      `id: pas-workflow-4
name: PasWorkflow4
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
    db.run("UPDATE boards SET workflow_template_id = 'pas-workflow-4' WHERE id = ?", [boardId]);
    const config = getWorkspaceConfig("default");

    const customPromptInjector = { resolveList: vi.fn().mockReturnValue([]) };
    const stageInstructionsInjector = { prepare: vi.fn().mockReturnValue({ stageInstructionsBlock: undefined }) };
    const service = new PromptAssemblyService(customPromptInjector as any, stageInstructionsInjector as any);

    service.assemble({
      config,
      boardId,
      columnId: "plan",
      conversationId: 7,
      promptFilter: { modelId: "x", engineId: "copilot", executionType: "task" },
      isTransition: false,
    });

    expect(stageInstructionsInjector.prepare).toHaveBeenCalledWith(7, undefined, false);
  });
});
