/**
 * Engine-level integration tests for instruction loading.
 *
 * These tests drive the real engines against the in-memory DB (initDb +
 * setupTestConfig + seedProjectAndTask) and verify that instruction files are
 * scanned at the monorepo project root (projectPath) and injected into the
 * system prompt / system message.
 *
 * - PiEngine: system prompt captured via a faux-provider session factory.
 * - CopilotEngine: systemMessage captured via the mock SDK adapter.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { initDb, seedProjectAndTask, setupTestConfig } from "../helpers.ts";
import type { Database } from "bun:sqlite";
import { PiEngine } from "../../engine/pi/engine.ts";
import { CopilotDialect } from "../../engine/dialects/copilot-dialect.ts";
import { NullModelSettingsRepository } from "../../db/repositories/model-settings-repository.ts";
import { CopilotEngine } from "../../engine/copilot/engine.ts";
import { MockCopilotSdkAdapter, MockCopilotSession, token, done } from "../support/copilot-sdk-mock.ts";
import type { EngineEvent } from "../../engine/types.ts";
import { registerFauxProvider } from "@earendil-works/pi-ai/compat";
import type { FauxProviderRegistration } from "@earendil-works/pi-ai/compat";
import { fauxAssistantMessage, fauxText } from "@earendil-works/pi-ai/providers/faux";
import { createFauxSessionFactory } from "../support/pi-faux-session.ts";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createInstructionFile(dir: string, filename: string, content: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, filename), content);
}

async function drainEvents(gen: AsyncIterable<EngineEvent>): Promise<EngineEvent[]> {
  const events: EngineEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

// ─── Pi Engine Integration ───────────────────────────────────────────────────

describe("Pi Engine integration — instruction injection into system prompt", () => {
  let db: Database;
  let configCleanup: () => void;
  let projectPath: string;
  let worktreeDir: string;
  let faux: FauxProviderRegistration;

  /** Captured system prompt from the session factory. */
  let capturedSystemPrompt: string | undefined;

  /** Build a real Pi session against the faux provider, capturing the system prompt. */
  async function createCapturingSessionFactory(options: {
    tools: any[];
    systemPrompt: string | undefined;
    conversationId: number;
    model: any;
    cwd: string;
    config: import("../../config/index.ts").PiEngineConfig;
  }) {
    capturedSystemPrompt = options.systemPrompt;
    // Build the shared factory lazily so it captures the per-test faux registration.
    return createFauxSessionFactory(faux)(options as any);
  }

  beforeEach(() => {
    const cfg = setupTestConfig();
    configCleanup = cfg.cleanup;
    db = initDb();
    projectPath = join(cfg.configDir, "workspace", "test-project");
    worktreeDir = mkdtempSync(join(tmpdir(), "pi-wt-"));
    faux = registerFauxProvider();
    capturedSystemPrompt = undefined;
  });

  afterEach(() => {
    faux.unregister();
    configCleanup();
    rmSync(worktreeDir, { recursive: true, force: true });
  });

  it("injects instructions from projectPath (≠ worktree) into the system prompt", async () => {
    // Instruction exists ONLY at the monorepo project root.
    createInstructionFile(
      join(projectPath, ".github", "instructions"),
      "conventions.md",
      "---\ndescription: Project conventions\n---\nContent",
    );

    const seed = seedProjectAndTask(db, projectPath);
    db.run(
      "INSERT INTO task_git_context (task_id, git_root_path, worktree_path, worktree_status) VALUES (?, ?, ?, 'ready')",
      [seed.taskId, projectPath, worktreeDir],
    );

    const config = {
      type: "pi",
      model: `pi/${faux.getModel().provider}/${faux.getModel().id}`,
      providers: {
        [faux.getModel().provider]: { base_url: "http://localhost:1234/v1" },
      },
    } as import("../../config/index.ts").PiEngineConfig;

    const engine = new PiEngine(
      "test-pi",
      config,
      () => {},
      () => {},
      new CopilotDialect(),
      new NullModelSettingsRepository(),
      createCapturingSessionFactory as any,
    );

    faux.setResponses([fauxAssistantMessage(fauxText("Hello from the assistant!"))]);

    const params = {
      executionId: 1,
      taskId: seed.taskId,
      boardId: seed.boardId,
      conversationId: seed.conversationId,
      model: `pi/${faux.getModel().provider}/${faux.getModel().id}`,
      workingDirectory: worktreeDir,
      prompt: "Say hello.",
      signal: new AbortController().signal,
      boardTools: {} as any,
      contextWindowOverride: 128_000,
    } as import("../../engine/types.ts").ExecutionParams;

    await drainEvents(engine.execute(params));

    // The fix (C1): cwd passed to getInstructions must be the projectPath, so
    // the project-root instruction file is scanned even though worktree differs.
    expect(capturedSystemPrompt).toBeDefined();
    expect(capturedSystemPrompt!).toContain("### conventions");
    expect(capturedSystemPrompt!).toContain("**Project conventions**");
  });

  it("leaves the system prompt unchanged when no instructions exist", async () => {
    const seed = seedProjectAndTask(db, projectPath);
    db.run(
      "INSERT INTO task_git_context (task_id, git_root_path, worktree_path, worktree_status) VALUES (?, ?, ?, 'ready')",
      [seed.taskId, projectPath, worktreeDir],
    );

    const config = {
      type: "pi",
      model: `pi/${faux.getModel().provider}/${faux.getModel().id}`,
      providers: {
        [faux.getModel().provider]: { base_url: "http://localhost:1234/v1" },
      },
    } as import("../../config/index.ts").PiEngineConfig;

    const engine = new PiEngine(
      "test-pi",
      config,
      () => {},
      () => {},
      new CopilotDialect(),
      new NullModelSettingsRepository(),
      createCapturingSessionFactory as any,
    );

    faux.setResponses([fauxAssistantMessage(fauxText("Hello!"))]);

    const params = {
      executionId: 1,
      taskId: seed.taskId,
      boardId: seed.boardId,
      conversationId: seed.conversationId,
      model: `pi/${faux.getModel().provider}/${faux.getModel().id}`,
      workingDirectory: worktreeDir,
      prompt: "Say hello.",
      signal: new AbortController().signal,
      boardTools: {} as any,
      contextWindowOverride: 128_000,
    } as import("../../engine/types.ts").ExecutionParams;

    await drainEvents(engine.execute(params));

    // No instructions → no instruction blocks anywhere in the system prompt
    // (capturedSystemPrompt may be undefined when there is no system content).
    expect(capturedSystemPrompt ?? "").not.toContain("### ");
  });
});

// ─── Copilot Engine Integration ──────────────────────────────────────────────

describe("Copilot Engine integration — instruction injection into systemMessage", () => {
  let db: Database;
  let configCleanup: () => void;
  let projectPath: string;
  let worktreeDir: string;

  beforeEach(() => {
    const cfg = setupTestConfig();
    configCleanup = cfg.cleanup;
    db = initDb();
    projectPath = join(cfg.configDir, "workspace", "test-project");
    worktreeDir = mkdtempSync(join(tmpdir(), "copilot-wt-"));
  });

  afterEach(() => {
    configCleanup();
    rmSync(worktreeDir, { recursive: true, force: true });
  });

  it("injects instructions from projectPath (≠ worktree) into systemMessage", async () => {
    createInstructionFile(
      join(projectPath, ".github", "instructions"),
      "conventions.md",
      "---\ndescription: Project conventions\n---\nContent",
    );

    const seed = seedProjectAndTask(db, projectPath);
    db.run(
      "INSERT INTO task_git_context (task_id, git_root_path, worktree_path, worktree_status) VALUES (?, ?, ?, 'ready')",
      [seed.taskId, projectPath, worktreeDir],
    );

    const adapter = new MockCopilotSdkAdapter()
      .queueResumeFailure(new Error("missing session"))
      .queueCreateSuccess(new MockCopilotSession().queueTurn({ steps: [token("Done."), done()] }));

    const engine = new CopilotEngine(() => {}, () => {}, adapter);

    const params = {
      executionId: 1,
      taskId: seed.taskId,
      boardId: seed.boardId,
      conversationId: seed.conversationId,
      model: "copilot/mock-model",
      workingDirectory: worktreeDir,
      prompt: "Hello",
      signal: new AbortController().signal,
      boardTools: {} as any,
      workspaceKey: "default",
      mcpRegistry: null,
      enabledMcpTools: [],
      attachments: [],
      modelParams: [],
    } as import("../../engine/types.ts").ExecutionParams;

    await drainEvents(engine.execute(params));

    const createCall = adapter.trace.createCalls[0];
    expect(createCall).toBeDefined();
    expect(createCall.config.systemMessage?.content).toContain("### conventions");
    expect(createCall.config.systemMessage?.content).toContain("**Project conventions**");
  });

  it("omits instruction blocks when no instructions exist", async () => {
    const seed = seedProjectAndTask(db, projectPath);
    db.run(
      "INSERT INTO task_git_context (task_id, git_root_path, worktree_path, worktree_status) VALUES (?, ?, ?, 'ready')",
      [seed.taskId, projectPath, worktreeDir],
    );

    const adapter = new MockCopilotSdkAdapter()
      .queueResumeFailure(new Error("missing session"))
      .queueCreateSuccess(new MockCopilotSession().queueTurn({ steps: [token("Done."), done()] }));

    const engine = new CopilotEngine(() => {}, () => {}, adapter);

    const params = {
      executionId: 1,
      taskId: seed.taskId,
      boardId: seed.boardId,
      conversationId: seed.conversationId,
      model: "copilot/mock-model",
      workingDirectory: worktreeDir,
      prompt: "Hello",
      signal: new AbortController().signal,
      boardTools: {} as any,
      workspaceKey: "default",
      mcpRegistry: null,
      enabledMcpTools: [],
      attachments: [],
      modelParams: [],
    } as import("../../engine/types.ts").ExecutionParams;

    await drainEvents(engine.execute(params));

    const createCall = adapter.trace.createCalls[0];
    expect(createCall).toBeDefined();
    expect(createCall.config.systemMessage?.content ?? "").not.toContain("### ");
  });
});
