/**
 * Multi-engine execution routing integration tests.
 *
 * Verifies that the Orchestrator routes executions to the correct engine
 * based on the task's qualified model ID, and that listModels() aggregates
 * from all engines in the registry (with optional allowed_engines filtering).
 *
 * Uses an in-memory DB and ScriptedEngine-like CapturingEngine — no real AI calls.
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
import type { Task, ConversationMessage } from "../../shared/rpc-types.ts";
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

function makeConfig(engineIds: string[], allowedEngineIds?: string[]): LoadedConfig {
  const base = getWorkspaceConfig("default");
  return {
    ...base,
    engines: engineIds.map((id) => ({ id, config: { type: id } })),
    allowedEngineIds: allowedEngineIds ?? null,
  } as LoadedConfig;
}

function makeMultiEngineRegistry(
  engines: Record<string, CapturingEngine>,
  engineIds: string[],
  allowedEngineIds?: string[],
): EngineRegistry {
  const config = makeConfig(engineIds, allowedEngineIds);
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
let claudeEngine: CapturingEngine;
let opencodeEngine: CapturingEngine;

beforeEach(() => {
  db = initDb();
  gitDir = mkdtempSync(join(tmpdir(), "railyn-multi-engine-"));
  execSync("git init", { cwd: gitDir });
  execSync('git config user.email "t@t.com"', { cwd: gitDir });
  execSync('git config user.name "T"', { cwd: gitDir });
  writeFileSync(join(gitDir, "index.ts"), "export const a = 1;\n");

  copilotEngine = new CapturingEngine([
    { qualifiedId: "copilot/gpt-4.1", displayName: "GPT-4.1" },
  ]);
  claudeEngine = new CapturingEngine([
    { qualifiedId: "claude/claude-sonnet-4-5", displayName: "Claude Sonnet 4.5" },
  ]);
  opencodeEngine = new CapturingEngine([
    { qualifiedId: "opencode/anthropic/claude-sonnet-4-5", displayName: "Claude Sonnet 4.5 (OpenCode)" },
  ]);

  const cfg = setupTestConfig("", gitDir);
  configCleanup = cfg.cleanup;
});

afterEach(() => {
  rmSync(gitDir, { recursive: true, force: true });
  configCleanup?.();
});

// ─── ME-1..2: execution routing to correct engine ────────────────────────────

describe("ME-1..2: execution routing to correct engine", () => {
  it("only copilot engine receives the execution", async () => {
    const registry = makeMultiEngineRegistry(
      { copilot: copilotEngine, claude: claudeEngine },
      ["copilot", "claude"],
    );
    const orchestrator = makeOrchestrator(db, registry);

    const { taskId, conversationId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE conversations SET model = 'copilot/gpt-4.1' WHERE id = ?", [conversationId]);

    await orchestrator.executeHumanTurn(taskId, "Hello from copilot model");

    expect(copilotEngine.executedParams.length).toBe(1);
    expect(claudeEngine.executedParams.length).toBe(0);
  });

  it("only claude engine receives the execution", async () => {
    const registry = makeMultiEngineRegistry(
      { copilot: copilotEngine, claude: claudeEngine },
      ["copilot", "claude"],
    );
    const orchestrator = makeOrchestrator(db, registry);

    const { taskId, conversationId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE conversations SET model = 'claude/claude-sonnet-4-5' WHERE id = ?", [conversationId]);

    await orchestrator.executeHumanTurn(taskId, "Hello from claude model");

    expect(claudeEngine.executedParams.length).toBe(1);
    expect(copilotEngine.executedParams.length).toBe(0);
  });

  it("opencode engine receives execution for 3-part qualified ID", async () => {
    const registry = makeMultiEngineRegistry(
      { copilot: copilotEngine, opencode: opencodeEngine },
      ["copilot", "opencode"],
    );
    const orchestrator = makeOrchestrator(db, registry);

    const { taskId, conversationId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE conversations SET model = 'opencode/anthropic/claude-sonnet-4-5' WHERE id = ?", [conversationId]);

    await orchestrator.executeHumanTurn(taskId, "Hello from opencode model");

    expect(opencodeEngine.executedParams.length).toBe(1);
    expect(copilotEngine.executedParams.length).toBe(0);
  });

  it("copilot task and claude task each execute on their engine", async () => {
    const registry = makeMultiEngineRegistry(
      { copilot: copilotEngine, claude: claudeEngine },
      ["copilot", "claude"],
    );
    const orchestrator = makeOrchestrator(db, registry);

    const { taskId: task1, conversationId: conv1 } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE conversations SET model = 'copilot/gpt-4.1' WHERE id = ?", [conv1]);

    const { taskId: task2, conversationId: conv2 } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE conversations SET model = 'claude/claude-sonnet-4-5' WHERE id = ?", [conv2]);

    await orchestrator.executeHumanTurn(task1, "copilot turn");
    await orchestrator.executeHumanTurn(task2, "claude turn");

    expect(copilotEngine.executedParams.length).toBe(1);
    expect(claudeEngine.executedParams.length).toBe(1);
  });
});

// ─── ME-6: default engine selection ──────────────────────────────────────────

describe("ME-6: default engine selection", () => {
  it("uses the first engine in the registry when model is null", async () => {
    const registry = makeMultiEngineRegistry(
      { copilot: copilotEngine, claude: claudeEngine },
      ["copilot", "claude"],
    );
    const orchestrator = makeOrchestrator(db, registry);

    const { taskId, conversationId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE conversations SET model = NULL WHERE id = ?", [conversationId]);

    await orchestrator.executeHumanTurn(taskId, "No model set");

    expect(copilotEngine.executedParams.length).toBe(1);
    expect(claudeEngine.executedParams.length).toBe(0);
  });
});

// ─── ME-7: listModels() ──────────────────────────────────────────────────────

describe("ME-7: listModels() aggregates from all engines", () => {
  it("returns combined model list from copilot + claude engines", async () => {
    const registry = makeMultiEngineRegistry(
      { copilot: copilotEngine, claude: claudeEngine },
      ["copilot", "claude"],
    );
    const orchestrator = makeOrchestrator(db, registry);

    const models = await orchestrator.listModels();
    const ids = models.map((m) => m.qualifiedId);

    expect(ids).toContain("copilot/gpt-4.1");
    expect(ids).toContain("claude/claude-sonnet-4-5");
  });
});

// ─── ME-8: listModels() respects allowed_engines filter ──────────────────────

describe("ME-8: listModels() respects allowed_engines filter", () => {
  it("only returns models from allowed engines when filter is set", async () => {
    const registry = makeMultiEngineRegistry(
      { copilot: copilotEngine, claude: claudeEngine },
      ["copilot", "claude"],
      ["claude"],
    );
    const orchestrator = makeOrchestrator(db, registry);

    const models = await orchestrator.listModels();
    const ids = models.map((m) => m.qualifiedId);

    expect(ids).toContain("claude/claude-sonnet-4-5");
    expect(ids).not.toContain("copilot/gpt-4.1");
  });
});

// ─── ME-WK-1..3: workspaceKey propagation through multi-engine ──────────────

describe("ME-WK-1..3: workspaceKey propagation through multi-engine", () => {
  it("ME-WK-1: copilot engine receives correct workspaceKey from params", async () => {
    const registry = makeMultiEngineRegistry(
      { copilot: copilotEngine, claude: claudeEngine },
      ["copilot", "claude"],
      ["copilot"],
    );
    const orchestrator = makeOrchestrator(db, registry);

    const { taskId, conversationId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE conversations SET model = 'copilot/gpt-4.1' WHERE id = ?", [conversationId]);

    await orchestrator.executeHumanTurn(taskId, "test message");

    expect(copilotEngine.executedParams[0]?.workspaceKey).toBe("default");
  });

  it("ME-WK-2: claude engine receives correct workspaceKey from params", async () => {
    const registry = makeMultiEngineRegistry(
      { copilot: copilotEngine, claude: claudeEngine },
      ["copilot", "claude"],
      ["claude"],
    );
    const orchestrator = makeOrchestrator(db, registry);

    const { taskId, conversationId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE conversations SET model = 'claude/claude-sonnet-4-5' WHERE id = ?", [conversationId]);

    await orchestrator.executeHumanTurn(taskId, "test message");

    expect(claudeEngine.executedParams[0]?.workspaceKey).toBe("default");
  });

  it("ME-WK-3: opencode engine receives correct workspaceKey from params", async () => {
    const opencodeEngine = new CapturingEngine([{ qualifiedId: "opencode/test", displayName: "test" }]);
    const registry = makeMultiEngineRegistry(
      { copilot: copilotEngine, claude: claudeEngine, opencode: opencodeEngine },
      ["copilot", "claude", "opencode"],
      ["opencode"],
    );
    const orchestrator = makeOrchestrator(db, registry);

    const { taskId, conversationId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE conversations SET model = 'opencode/anthropic/claude-sonnet-4-5' WHERE id = ?", [conversationId]);

    await orchestrator.executeHumanTurn(taskId, "test message");

    expect(opencodeEngine.executedParams[0]?.workspaceKey).toBe("default");
  });
});
