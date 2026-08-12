import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { cursorAgentIdForConversation, CursorEngine } from "@bun/engine/cursor/engine";
import { MockCursorSdkAdapter, token } from "./mocks";
import { createCursorRpcRuntime } from "@bun/test/support/cursor-rpc-runtime";
import type { SlashCommandDialect, ResolvedPrompt } from "@bun/engine/dialects/slash-command-dialect";
import type { CommandInfo } from "@bun/engine/types";
import { CursorDialect } from "@bun/engine/dialects/cursor-dialect";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { initDb, seedProjectAndTask, setupTestConfig } from "../helpers.ts";
import type { Database } from "bun:sqlite";

describe("CursorEngine — deterministic agentId forwarding (§6.5.1)", () => {
    it("forwards cursorAgentIdForConversation(taskId, conversationId) as runConfig.agentId on every run", async () => {
        const adapter = new MockCursorSdkAdapter()
            .queueTurn({ steps: [token("first")] })
            .queueTurn({ steps: [token("second")] });
        const runtime = createCursorRpcRuntime(adapter);

        try {
            const { taskId, conversationId } = await runtime.createTask();

            const first = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "ping 1" });
            await runtime.recorder.waitForStreamDone(first.executionId);

            const second = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "ping 2" });
            await runtime.recorder.waitForStreamDone(second.executionId);

            const expected = cursorAgentIdForConversation(taskId, conversationId);

            expect(adapter.trace.runConfigs).toHaveLength(2);
            expect(adapter.trace.runConfigs[0]!.agentId).toBe(expected);
            expect(adapter.trace.runConfigs[1]!.agentId).toBe(expected);
        } finally {
            runtime.cleanup();
        }
    });
});

describe("cursorAgentIdForConversation — determinism (§6.5.1 supporting)", () => {
    it("returns the same UUID for the same (taskId, conversationId)", () => {
        const a = cursorAgentIdForConversation(42, 7);
        const b = cursorAgentIdForConversation(42, 7);
        expect(a).toBe(b);
    });

    it("task-scoped ids ignore conversationId — same task with different conversations yields the same UUID", () => {
        const a = cursorAgentIdForConversation(42, 7);
        const b = cursorAgentIdForConversation(42, 99);
        expect(a).toBe(b);
    });

    it("different task ids produce different UUIDs", () => {
        const a = cursorAgentIdForConversation(42, 7);
        const b = cursorAgentIdForConversation(43, 7);
        expect(a).not.toBe(b);
    });

    it("detached conversations key on conversationId — different conversations yield different UUIDs", () => {
        const a = cursorAgentIdForConversation(null, 100);
        const b = cursorAgentIdForConversation(null, 101);
        expect(a).not.toBe(b);
    });

    it("returns a valid RFC 4122 v5 UUID", () => {
        const id = cursorAgentIdForConversation(1, 2);
        expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });

    it("task-scoped id is independent of any detached conversation id", () => {
        const taskScoped = cursorAgentIdForConversation(5, 999);
        const detached = cursorAgentIdForConversation(null, 5);
        expect(taskScoped).not.toBe(detached);
    });
});

/** Spy dialect that records all calls and returns the prompt unchanged. */
class SpyDialect implements SlashCommandDialect {
  resolvePromptCalls: { value: string; worktreePath: string; projectPath?: string }[] = [];
  listCommandsCalls: { worktreePath: string; projectPath?: string }[] = [];
  getSkillPathsCalls: { worktreePath: string; projectPath?: string }[] = [];
  skillPathsResult: string[] = [];
  dialectName = "none";

  getDialectName(): string {
    return this.dialectName;
  }

  async resolvePrompt(value: string, worktreePath: string, projectPath?: string): Promise<ResolvedPrompt> {
    this.resolvePromptCalls.push({ value, worktreePath, projectPath });
    return { content: value, wasSlash: false };
  }

  listCommands(worktreePath: string, projectPath?: string): CommandInfo[] {
    this.listCommandsCalls.push({ worktreePath, projectPath });
    return [];
  }

  getSkillPaths(worktreePath: string, projectPath?: string): string[] {
    this.getSkillPathsCalls.push({ worktreePath, projectPath });
    return this.skillPathsResult;
  }
}

describe("CursorEngine dialect injection", () => {
  it("dialect passed to constructor is stored and used", () => {
    const spy = new SpyDialect();
    const engine = new CursorEngine(() => {}, () => {}, new MockCursorSdkAdapter(), spy);
    expect((engine as any).dialect).toBe(spy);
  });

  it("default dialect is CursorDialect when none provided", () => {
    const engine = new CursorEngine(() => {}, () => {}, new MockCursorSdkAdapter());
    expect((engine as any).dialect).toBeInstanceOf(CursorDialect);
  });

  it("pre-aborted execution does NOT call dialect.resolvePrompt", async () => {
    const spy = new SpyDialect();
    const adapter = new MockCursorSdkAdapter();
    const engine = new CursorEngine(() => {}, () => {}, adapter, spy);

    const controller = new AbortController();
    controller.abort();

    const gen = engine.execute({
      executionId: 1,
      taskId: null,
      boardId: undefined,
      conversationId: 101,
      model: "cursor/mock-model",
      workingDirectory: process.cwd(),
      prompt: "/some-command",
      signal: controller.signal,
      boardTools: {} as any,
    });
    for await (const _ of gen) { /* drain */ }

    // The engine no longer calls dialect.resolvePrompt itself (resolution happens
    // upstream via SlashCommandResolver). This test verifies the adapter run was
    // never invoked for a pre-aborted execution.
    expect(adapter.trace.runCalls).toBe(0);
  });

  it("slash-looking prompt is forwarded unchanged (resolution now happens upstream via SlashCommandResolver)", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "cursor-engine-test-"));
    try {
      const cmdDir = join(tmpDir, ".cursor", "commands");
      mkdirSync(cmdDir, { recursive: true });
      writeFileSync(join(cmdDir, "my-cmd.md"), "Resolved body for $input", "utf-8");

      const spy = new SpyDialect();
      const adapter = new MockCursorSdkAdapter().queueTurn({ steps: [token("done")] });
      const engine = new CursorEngine(() => {}, () => {}, adapter, spy);

      const gen = engine.execute({
        executionId: 1,
        taskId: null,
        boardId: undefined,
        conversationId: 101,
        model: "cursor/mock-model",
        workingDirectory: tmpDir,
        prompt: "/my-cmd my-arg",
        signal: new AbortController().signal,
        boardTools: {} as any,
      });
      const events: string[] = [];
      for await (const e of gen) events.push(e.type);

      // CursorEngine no longer resolves slash commands itself — the executor layer's
      // SlashCommandResolver does this before `prompt` reaches the engine. The engine
      // must forward whatever it receives unchanged.
      expect(spy.resolvePromptCalls).toHaveLength(0);
      const sentPrompt = adapter.trace.runConfigs[0]!.prompt;
      expect(sentPrompt).toContain("/my-cmd my-arg");
      expect(sentPrompt).not.toContain("Resolved body for my-arg");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("plain prompt is forwarded unchanged (dialect no longer consulted internally)", async () => {
    const spy = new SpyDialect();
    const adapter = new MockCursorSdkAdapter().queueTurn({ steps: [token("done")] });
    const engine = new CursorEngine(() => {}, () => {}, adapter, spy);

    const gen = engine.execute({
      executionId: 1,
      taskId: null,
      boardId: undefined,
      conversationId: 101,
      model: "cursor/mock-model",
      workingDirectory: process.cwd(),
      prompt: "plain text prompt",
      signal: new AbortController().signal,
      boardTools: {} as any,
    });
    for await (const _ of gen) {}

    expect(spy.resolvePromptCalls).toHaveLength(0);
    const sentPrompt = adapter.trace.runConfigs[0]!.prompt;
    expect(sentPrompt).toContain("plain text prompt");
  });

  it("injects a compact <available_skills> listing and registers the skill tool", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "cursor-engine-skills-"));
    try {
      const skillDir = join(tmpDir, ".cursor", "skills", "my-skill");
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, "SKILL.md"),
        "---\ndescription: My awesome skill\n---\n# My Skill\n\nDo amazing things.",
        "utf-8",
      );

      const adapter = new MockCursorSdkAdapter().queueTurn({ steps: [token("done")] });
      const engine = new CursorEngine(() => {}, () => {}, adapter);

      const gen = engine.execute({
        executionId: 1,
        taskId: null,
        boardId: undefined,
        conversationId: 101,
        model: "cursor/mock-model",
        workingDirectory: tmpDir,
        prompt: "do something",
        signal: new AbortController().signal,
        boardTools: {} as any,
      });
      for await (const _ of gen) {}

      const sentPrompt = adapter.trace.runConfigs[0]!.prompt;
      // Listing (name + description) is present, body content is NOT inlined.
      expect(sentPrompt).toContain("## Available Skills");
      expect(sentPrompt).toContain("<available_skills>");
      expect(sentPrompt).toContain("my-skill");
      expect(sentPrompt).toContain("My awesome skill");
      expect(sentPrompt).not.toContain("# My Skill");
      expect(sentPrompt.indexOf("## Available Skills")).toBeLessThan(sentPrompt.indexOf("do something"));

      // The lazy skill tool is registered alongside the common tools.
      const customTools = adapter.trace.runConfigs[0]!.customTools ?? {};
      expect(customTools.skill).toBeDefined();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("skill tool resolves SKILL.md content on demand and reports unknown skills", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "cursor-engine-skills-"));
    try {
      const skillDir = join(tmpDir, ".cursor", "skills", "my-skill");
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, "SKILL.md"), "# My Skill\n\nDo amazing things.", "utf-8");

      const adapter = new MockCursorSdkAdapter().queueTurn({ steps: [token("done")] });
      const engine = new CursorEngine(() => {}, () => {}, adapter);

      const gen = engine.execute({
        executionId: 1,
        taskId: null,
        boardId: undefined,
        conversationId: 101,
        model: "cursor/mock-model",
        workingDirectory: tmpDir,
        prompt: "do something",
        signal: new AbortController().signal,
        boardTools: {} as any,
      });
      for await (const _ of gen) {}

      const skillTool = adapter.trace.runConfigs[0]!.customTools!.skill!;
      const loaded = await skillTool.execute({ name: "my-skill" }, {});
      expect(loaded).toContain("# My Skill");

      const missing = await skillTool.execute({ name: "nope" }, {});
      expect(String(missing)).toContain("Skill 'nope' not found");
      expect(String(missing)).toContain("my-skill");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("empty getSkillPaths leaves prompt prefix unchanged", async () => {
    const spy = new SpyDialect();
    spy.skillPathsResult = []; // empty
    const adapter = new MockCursorSdkAdapter().queueTurn({ steps: [token("done")] });
    const engine = new CursorEngine(() => {}, () => {}, adapter, spy);

    const gen = engine.execute({
      executionId: 1,
      taskId: null,
      boardId: undefined,
      conversationId: 101,
      model: "cursor/mock-model",
      workingDirectory: process.cwd(),
      prompt: "hello world",
      signal: new AbortController().signal,
      boardTools: {} as any,
    });
    for await (const _ of gen) {}

    const sentPrompt = adapter.trace.runConfigs[0]!.prompt;
    expect(sentPrompt).not.toContain("## Skill:");
    expect(sentPrompt).toContain("hello world");
  });
});

// ─── CursorEngine getSkillPaths projectPath bug fix ──────────────────────────

describe("CursorEngine getSkillPaths — projectPath resolution (§5.1-5.2)", () => {
  let db: Database;
  let configCleanup: () => void;
  let worktreeDir: string;

  beforeEach(() => {
    const cfg = setupTestConfig();
    configCleanup = cfg.cleanup;
    db = initDb();
    worktreeDir = mkdtempSync(join(tmpdir(), "cursor-wt-"));
  });

  afterEach(() => {
    configCleanup();
    rmSync(worktreeDir, { recursive: true, force: true });
  });

  it("resolves projectPath from DB and passes it to getSkillPaths (monorepo)", async () => {
    // Seed a task whose project (registered by setupTestConfig at
    // <configDir>/workspace/test-project) differs from the worktree path.
    const seed = seedProjectAndTask(db, "/test-git");
    db.run(
      "INSERT INTO task_git_context (task_id, git_root_path, worktree_path, worktree_status) VALUES (?, ?, ?, 'ready')",
      [seed.taskId, "/test-git", worktreeDir],
    );

    const spy = new SpyDialect();
    const adapter = new MockCursorSdkAdapter().queueTurn({ steps: [token("done")] });
    const engine = new CursorEngine(() => {}, () => {}, adapter, spy);

    const gen = engine.execute({
      executionId: 1,
      taskId: seed.taskId,
      boardId: seed.boardId,
      conversationId: seed.conversationId,
      model: "cursor/mock-model",
      workingDirectory: worktreeDir,
      prompt: "do something",
      signal: new AbortController().signal,
      boardTools: {} as any,
    });
    for await (const _ of gen) {}

    // The fix must resolve the projectPath and pass it as the 2nd argument.
    expect(spy.getSkillPathsCalls.length).toBeGreaterThan(0);
    const call = spy.getSkillPathsCalls[0];
    expect(call.worktreePath).toBe(worktreeDir);
    expect(call.projectPath).toBeDefined();
    expect(call.projectPath).not.toBe(worktreeDir);
    // The configured project lives at <configDir>/workspace/test-project.
    expect(call.projectPath!.endsWith("test-project")).toBe(true);
  });

  it("passes the DB-derived worktree path to getSkillPaths when it differs from workingDirectory", async () => {
    // The engine's `workingDirectory` param may point anywhere (monorepo subdir,
    // project root pre-worktree); skill lookup must use task_git_context.worktree_path.
    const dbWorktreeDir = mkdtempSync(join(tmpdir(), "cursor-db-wt-"));
    try {
      const seed = seedProjectAndTask(db, "/test-git");
      db.run(
        "INSERT INTO task_git_context (task_id, git_root_path, worktree_path, worktree_status) VALUES (?, ?, ?, 'ready')",
        [seed.taskId, "/test-git", dbWorktreeDir],
      );

      const spy = new SpyDialect();
      const adapter = new MockCursorSdkAdapter().queueTurn({ steps: [token("done")] });
      const engine = new CursorEngine(() => {}, () => {}, adapter, spy);

      const gen = engine.execute({
        executionId: 1,
        taskId: seed.taskId,
        boardId: seed.boardId,
        conversationId: seed.conversationId,
        model: "cursor/mock-model",
        workingDirectory: worktreeDir, // deliberately different from the DB worktree_path
        prompt: "do something",
        signal: new AbortController().signal,
        boardTools: {} as any,
      });
      for await (const _ of gen) {}

      expect(spy.getSkillPathsCalls.length).toBeGreaterThan(0);
      const call = spy.getSkillPathsCalls[0];
      expect(call.worktreePath).toBe(dbWorktreeDir);
      expect(call.worktreePath).not.toBe(worktreeDir);
    } finally {
      rmSync(dbWorktreeDir, { recursive: true, force: true });
    }
  });

  it("calls getSkillPaths with undefined projectPath when no task project configured", async () => {
    const spy = new SpyDialect();
    const adapter = new MockCursorSdkAdapter().queueTurn({ steps: [token("done")] });
    const engine = new CursorEngine(() => {}, () => {}, adapter, spy);

    const gen = engine.execute({
      executionId: 1,
      taskId: null,
      boardId: undefined,
      conversationId: 101,
      model: "cursor/mock-model",
      workingDirectory: worktreeDir,
      prompt: "do something",
      signal: new AbortController().signal,
      boardTools: {} as any,
    });
    for await (const _ of gen) {}

    expect(spy.getSkillPathsCalls.length).toBeGreaterThan(0);
    const call = spy.getSkillPathsCalls[0];
    expect(call.worktreePath).toBe(worktreeDir);
    expect(call.projectPath).toBeUndefined();
  });
});

describe("CursorEngine — compaction wiring (§7 compaction)", () => {
    it("listModels reports supportsManualCompact: true and forwards contextWindow", async () => {
        const adapter = new MockCursorSdkAdapter().setModels([{
            value: "claude-opus-4-8",
            displayName: "Claude Opus 4.8",
            contextWindow: 300_000,
        }]);
        const engine = new CursorEngine(() => {}, () => {}, adapter);

        const models = await engine.listModels();
        expect(models[0]).toMatchObject({
            qualifiedId: "cursor/claude-opus-4-8",
            contextWindow: 300_000,
            supportsManualCompact: true,
        });
    });

    it("compact(taskId=null) rejects chat-session compaction as unsupported", async () => {
        const adapter = new MockCursorSdkAdapter();
        const engine = new CursorEngine(() => {}, () => {}, adapter);

        await expect(
            engine.compact(null, 1234, "/tmp", "workspace"),
        ).rejects.toThrow("does not currently support chat-session compaction");
    });
});
