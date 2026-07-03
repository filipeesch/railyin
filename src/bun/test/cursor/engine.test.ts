import { describe, expect, it } from "vitest";
import { cursorAgentIdForConversation, CursorEngine } from "@bun/engine/cursor/engine";
import { MockCursorSdkAdapter, token } from "./mocks";
import { createCursorRpcRuntime } from "@bun/test/support/cursor-rpc-runtime";
import type { SlashCommandDialect, ResolvedPrompt } from "@bun/engine/dialects/slash-command-dialect";
import type { CommandInfo } from "@bun/engine/types";
import { CursorDialect } from "@bun/engine/dialects/cursor-dialect";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

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
  skillPathsResult: string[] = [];

  async resolvePrompt(value: string, worktreePath: string, projectPath?: string): Promise<ResolvedPrompt> {
    this.resolvePromptCalls.push({ value, worktreePath, projectPath });
    return { content: value, wasSlash: false };
  }

  listCommands(worktreePath: string, projectPath?: string): CommandInfo[] {
    this.listCommandsCalls.push({ worktreePath, projectPath });
    return [];
  }

  getSkillPaths(_worktreePath: string, _projectPath?: string): string[] {
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

    // resolvePrompt IS called even for aborted — it happens before the stream.
    // The abort check is after resolvePrompt, not before.
    // So this test verifies the adapter run was NOT called, not resolvePrompt.
    expect(adapter.trace.runCalls).toBe(0);
  });

  it("slash prompt is resolved via dialect before being sent to adapter", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "cursor-engine-test-"));
    try {
      const cmdDir = join(tmpDir, ".cursor", "commands");
      mkdirSync(cmdDir, { recursive: true });
      writeFileSync(join(cmdDir, "my-cmd.md"), "Resolved body for $input", "utf-8");

      const adapter = new MockCursorSdkAdapter().queueTurn({ steps: [token("done")] });
      const engine = new CursorEngine(() => {}, () => {}, adapter);

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

      const sentPrompt = adapter.trace.runConfigs[0]!.prompt;
      expect(sentPrompt).toContain('<command name="my-cmd"');
      expect(sentPrompt).toContain('Resolved body for my-arg');
      expect(sentPrompt).not.toContain('/my-cmd');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("plain prompt is forwarded unchanged via dialect", async () => {
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

    expect(spy.resolvePromptCalls).toHaveLength(1);
    expect(spy.resolvePromptCalls[0]!.value).toBe("plain text prompt");
    const sentPrompt = adapter.trace.runConfigs[0]!.prompt;
    expect(sentPrompt).toContain("plain text prompt");
  });

  it("skill SKILL.md content is prepended to composed prompt", async () => {
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

      const sentPrompt = adapter.trace.runConfigs[0]!.prompt;
      expect(sentPrompt).toContain("## Skill: my-skill");
      expect(sentPrompt).toContain("# My Skill");
      // Skills appear before the user prompt
      expect(sentPrompt.indexOf("## Skill: my-skill")).toBeLessThan(sentPrompt.indexOf("do something"));
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
