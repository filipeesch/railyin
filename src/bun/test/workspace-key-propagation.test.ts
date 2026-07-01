/**
 * Integration tests for workspaceKey propagation through the full execution pipeline.
 *
 * Verifies that workspaceKey flows correctly from task execution through
 * executors to engines, ensuring `list_projects` and `list_workflows` tools
 * operate on the correct workspace.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";
import { initDb, seedProjectAndTask, setupTestConfig } from "./helpers.ts";
import { EngineRegistry } from "../engine/engine-registry.ts";
import { Orchestrator } from "../engine/orchestrator.ts";
import { WorkspaceRepository } from "../db/workspace-repository.ts";
import { getWorkspaceConfig } from "../workspace-context.ts";
import type { Database } from "bun:sqlite";
import type { ExecutionEngine, ExecutionParams, EngineEvent, EngineResumeInput, EngineModelInfo } from "../engine/types.ts";
import type { LoadedConfig } from "../config/index.ts";

// ─── CapturingEngine ─────────────────────────────────────────────────────────

class CapturingEngine implements ExecutionEngine {
  readonly executedParams: ExecutionParams[] = [];
  readonly modelInfos: EngineModelInfo[];

  constructor(modelInfos: EngineModelInfo[] = []) {
    this.modelInfos = modelInfos;
  }

  async *execute(params: ExecutionParams): AsyncIterable<EngineEvent> {
    this.executedParams.push(params);
    yield { type: "done" };
  }

  async resume(_executionId: number, _input: EngineResumeInput): Promise<void> {}
  cancel(_executionId: number): void {}

  async listModels(): Promise<EngineModelInfo[]> {
    return this.modelInfos;
  }

  async listCommands() { return []; }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeMultiEngineRegistry(
  engines: Record<string, CapturingEngine>,
  engineIds: string[],
  allowedEngineIds?: string[],
): EngineRegistry {
  const base = getWorkspaceConfig("default");
  const config = {
    ...base,
    engines: engineIds.map((id) => ({ id, config: { type: id } })),
    allowedEngineIds: allowedEngineIds ?? null,
  } as LoadedConfig;
  return new EngineRegistry(new Map(Object.entries(engines)), () => config);
}

function makeOrchestrator(
  db: Database,
  registry: EngineRegistry,
): Orchestrator {
  return new Orchestrator(
    db,
    registry,
    () => {},
    () => {},
    () => {},
    new WorkspaceRepository(db),
  );
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

let db: Database;
let gitDir: string;
let configCleanup: () => void;
let copilotEngine: CapturingEngine;

beforeEach(() => {
  db = initDb();
  gitDir = mkdtempSync(join(tmpdir(), "railyn-wk-prop-"));
  execSync("git init", { cwd: gitDir });
  execSync('git config user.email "t@t.com"', { cwd: gitDir });
  execSync('git config user.name "T"', { cwd: gitDir });
  writeFileSync(join(gitDir, "index.ts"), "export const a = 1;\n");

  copilotEngine = new CapturingEngine([
    { qualifiedId: "copilot/gpt-4.1", displayName: "GPT-4.1" },
  ]);

  const cfg = setupTestConfig("", gitDir);
  configCleanup = cfg.cleanup;
});

afterEach(() => {
  rmSync(gitDir, { recursive: true, force: true });
  configCleanup?.();
});

// ─── WP-1..3: Full pipeline workspaceKey propagation ─────────────────────────

describe("WP-1..3: Full pipeline workspaceKey propagation", () => {
  it("WP-1: human-turn execution propagates workspaceKey from task to engine", async () => {
    const registry = makeMultiEngineRegistry(
      { copilot: copilotEngine },
      ["copilot"],
      ["copilot"],
    );
    const orchestrator = makeOrchestrator(db, registry);

    const { taskId, conversationId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE conversations SET model = 'copilot/gpt-4.1' WHERE id = ?", [conversationId]);

    await orchestrator.executeHumanTurn(taskId, "Hello from user");

    // Verify the engine received the correct workspaceKey
    expect(copilotEngine.executedParams.length).toBe(1);
    expect(copilotEngine.executedParams[0]?.workspaceKey).toBe("default");
  });

  it("WP-2: transition execution propagates workspaceKey from task board to engine", async () => {
    const registry = makeMultiEngineRegistry(
      { copilot: copilotEngine },
      ["copilot"],
      ["copilot"],
    );
    const orchestrator = makeOrchestrator(db, registry);

    const { taskId, conversationId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE conversations SET model = 'copilot/gpt-4.1' WHERE id = ?", [conversationId]);
    db.run("UPDATE tasks SET workflow_state = 'backlog', execution_state = 'idle' WHERE id = ?", [taskId]);

    // Execute a transition (backlog → plan)
    const result = await orchestrator.executeTransition(taskId, "plan");

    expect(result.executionId).not.toBeNull();

    // The engine should have been called with the correct workspaceKey
    expect(copilotEngine.executedParams.length).toBe(1);
    expect(copilotEngine.executedParams[0]?.workspaceKey).toBe("default");
  });

  it("WP-3: retry execution propagates workspaceKey from task board to engine", async () => {
    const registry = makeMultiEngineRegistry(
      { copilot: copilotEngine },
      ["copilot"],
      ["copilot"],
    );
    const orchestrator = makeOrchestrator(db, registry);

    const { taskId, conversationId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE conversations SET model = 'copilot/gpt-4.1' WHERE id = ?", [conversationId]);
    db.run("UPDATE tasks SET workflow_state = 'plan', execution_state = 'failed' WHERE id = ?", [taskId]);

    // Execute a retry
    const result = await orchestrator.executeRetry(taskId);

    expect(result.executionId).not.toBeNull();

    // The engine should have been called with the correct workspaceKey
    expect(copilotEngine.executedParams.length).toBe(1);
    expect(copilotEngine.executedParams[0]?.workspaceKey).toBe("default");
  });
});
