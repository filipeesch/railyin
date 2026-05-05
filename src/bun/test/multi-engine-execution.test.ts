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
    engine: { type: engineIds[0] ?? "copilot" },
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
  const cfg = setupTestConfig();
  configCleanup = cfg.cleanup;
  db = initDb();

  gitDir = mkdtempSync(join(tmpdir(), "railyn-me-"));
  execSync("git init", { cwd: gitDir });
  execSync('git config user.email "t@t.com"', { cwd: gitDir });
  execSync('git config user.name "T"', { cwd: gitDir });
  writeFileSync(join(gitDir, "index.ts"), "export const a = 1;");
  execSync("git add . && git commit -m init", { cwd: gitDir });

  copilotEngine = new CapturingEngine([
    { qualifiedId: "copilot/gpt-4.1", displayName: "GPT-4.1", contextWindow: 128_000 },
  ]);
  claudeEngine = new CapturingEngine([
    { qualifiedId: "claude/claude-sonnet-4-5", displayName: "Claude Sonnet 4.5", contextWindow: 200_000 },
  ]);
  opencodeEngine = new CapturingEngine([
    { qualifiedId: "opencode/anthropic/claude-sonnet-4-5", displayName: "OpenCode Sonnet", contextWindow: 200_000 },
  ]);
});

afterEach(() => {
  rmSync(gitDir, { recursive: true, force: true });
  configCleanup();
});

// ─── ME-1: copilot model → copilot engine ────────────────────────────────────

describe("ME-1: copilot model routes to copilot engine", () => {
  it("only copilot engine receives the execution", async () => {
    const registry = makeMultiEngineRegistry(
      { copilot: copilotEngine, claude: claudeEngine },
      ["copilot", "claude"],
    );
    const orchestrator = makeOrchestrator(db, registry);
    const { taskId, conversationId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE conversations SET model = 'copilot/gpt-4.1' WHERE id = ?", [conversationId]);

    await orchestrator.executeHumanTurn(taskId, "Hello from copilot model");

    expect(copilotEngine.executedParams).toHaveLength(1);
    expect(claudeEngine.executedParams).toHaveLength(0);
  });
});

// ─── ME-2: claude model → claude engine ──────────────────────────────────────

describe("ME-2: claude model routes to claude engine", () => {
  it("only claude engine receives the execution", async () => {
    const registry = makeMultiEngineRegistry(
      { copilot: copilotEngine, claude: claudeEngine },
      ["copilot", "claude"],
    );
    const orchestrator = makeOrchestrator(db, registry);
    const { taskId, conversationId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE conversations SET model = 'claude/claude-sonnet-4-5' WHERE id = ?", [conversationId]);

    await orchestrator.executeHumanTurn(taskId, "Hello from claude model");

    expect(claudeEngine.executedParams).toHaveLength(1);
    expect(copilotEngine.executedParams).toHaveLength(0);
  });
});

// ─── ME-3: 3-part opencode model → opencode engine ───────────────────────────

describe("ME-3: opencode/provider/model (3-part) routes to opencode engine", () => {
  it("opencode engine receives execution for 3-part qualified ID", async () => {
    const registry = makeMultiEngineRegistry(
      { copilot: copilotEngine, opencode: opencodeEngine },
      ["copilot", "opencode"],
    );
    const orchestrator = makeOrchestrator(db, registry);
    const { taskId, conversationId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE conversations SET model = 'opencode/anthropic/claude-sonnet-4-5' WHERE id = ?", [conversationId]);

    await orchestrator.executeHumanTurn(taskId, "Hello from opencode model");

    expect(opencodeEngine.executedParams).toHaveLength(1);
    expect(copilotEngine.executedParams).toHaveLength(0);
  });
});

// ─── ME-4: two tasks with different models route to different engines ─────────

describe("ME-4: two tasks with different engines execute via their respective engines", () => {
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

    await orchestrator.executeHumanTurn(task1, "Copilot task");
    await orchestrator.executeHumanTurn(task2, "Claude task");

    expect(copilotEngine.executedParams).toHaveLength(1);
    expect(claudeEngine.executedParams).toHaveLength(1);
  });
});

// ─── ME-5: null model → default (first) engine ───────────────────────────────

describe("ME-5: null model falls back to default engine", () => {
  it("uses the first engine in the registry when model is null", async () => {
    const registry = makeMultiEngineRegistry(
      { copilot: copilotEngine, claude: claudeEngine },
      ["copilot", "claude"],
    );
    const orchestrator = makeOrchestrator(db, registry);
    const { taskId, conversationId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE conversations SET model = NULL WHERE id = ?", [conversationId]);

    await orchestrator.executeHumanTurn(taskId, "No model set");

    expect(copilotEngine.executedParams).toHaveLength(1);
    expect(claudeEngine.executedParams).toHaveLength(0);
  });
});

// ─── ME-6: listModels() aggregates from all engines ──────────────────────────

describe("ME-6: listModels() aggregates models from all engines", () => {
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

// ─── ME-7: listModels() respects allowed_engines filter ──────────────────────

describe("ME-7: listModels() respects allowed_engines filter", () => {
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
