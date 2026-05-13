import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Database } from "bun:sqlite";
import { initDb, seedProjectAndTask, setupTestConfig } from "./helpers.ts";
import { CrossEngineContextInjector } from "../conversation/cross-engine-context.ts";
import { appendMessage } from "../conversation/messages.ts";
import type { ExecutionEngine, EngineModelInfo } from "../engine/types.ts";

let db: Database;
let cleanup: (() => void) | undefined;
let conversationId: number;
let taskId: number;

function seedConversation(lastEngineType: string | null = null) {
  db.run("UPDATE conversations SET last_engine_type = ? WHERE id = ?", [lastEngineType, conversationId]);
}

function makeModelInfo(contextWindow?: number): EngineModelInfo {
  return { qualifiedId: "claude/claude-sonnet-4-5", displayName: "Claude", contextWindow };
}

function makeSourceEngine(overrides: Partial<ExecutionEngine> = {}): ExecutionEngine {
  return {
    async *execute() { yield { type: "done" as const }; },
    async resume() {},
    cancel() {},
    async listModels() { return []; },
    async listCommands() { return []; },
    ...overrides,
  };
}

beforeEach(() => {
  db = initDb();
  const result = setupTestConfig();
  cleanup = result.cleanup;
  const seeded = seedProjectAndTask(db, "/tmp");
  conversationId = seeded.conversationId;
  taskId = seeded.taskId;
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

describe("CrossEngineContextInjector", () => {
  it("CEC-1: same engine both turns → no injection (undefined)", async () => {
    seedConversation("claude");
    const injector = new CrossEngineContextInjector(db);
    const { historyBlock } = await injector.prepareSwitch(conversationId, "claude", null, undefined, "/tmp", "test-workspace");
    expect(historyBlock).toBeUndefined();
  });

  it("CEC-2: null last_engine_type (first turn) → no injection", async () => {
    seedConversation(null);
    const injector = new CrossEngineContextInjector(db);
    const { historyBlock } = await injector.prepareSwitch(conversationId, "claude", null, undefined, "/tmp", "test-workspace");
    expect(historyBlock).toBeUndefined();
  });

  it("CEC-3: copilot→claude switch → returns context block", async () => {
    seedConversation("copilot");
    appendMessage(db, taskId, conversationId, "user", "user", "Hello from copilot session");
    appendMessage(db, taskId, conversationId, "assistant", null, "Copilot response here");

    const injector = new CrossEngineContextInjector(db);
    const { historyBlock } = await injector.prepareSwitch(conversationId, "claude", null, undefined, "/tmp", "test-workspace");

    expect(historyBlock).toBeDefined();
    expect(historyBlock!).toContain("## Context from previous conversation (engine switch)");
    expect(historyBlock!).toContain("<message_history>");
    expect(historyBlock!).toContain("Hello from copilot session");
  });

  it("CEC-4: only messages AFTER last compaction_summary anchor are included", async () => {
    seedConversation("copilot");
    appendMessage(db, taskId, conversationId, "user", "user", "Old message before compaction");
    appendMessage(db, taskId, conversationId, "compaction_summary", null, "Summary text");
    appendMessage(db, taskId, conversationId, "user", "user", "New message after compaction");

    const injector = new CrossEngineContextInjector(db);
    const { historyBlock } = await injector.prepareSwitch(conversationId, "claude", null, undefined, "/tmp", "test-workspace");

    expect(historyBlock).toBeDefined();
    expect(historyBlock!).toContain("New message after compaction");
    expect(historyBlock!).not.toContain("Old message before compaction");
  });

  it("CEC-5: no contextWindow on target model → compaction skipped, injection proceeds", async () => {
    seedConversation("copilot");
    appendMessage(db, taskId, conversationId, "user", "user", "Some content");

    const compactFn = vi.fn();
    const source = makeSourceEngine({ compact: compactFn } as any);
    const injector = new CrossEngineContextInjector(db);
    const { historyBlock } = await injector.prepareSwitch(
      conversationId, "claude", source, makeModelInfo(undefined), "/tmp", "test-workspace"
    );

    expect(compactFn).not.toHaveBeenCalled();
    expect(historyBlock).toBeDefined();
  });

  it("CEC-6: tokens < 75% → sourceEngine.compact NOT called", async () => {
    seedConversation("copilot");
    appendMessage(db, taskId, conversationId, "user", "user", "small message");

    const compactFn = vi.fn();
    const source = makeSourceEngine({ compact: compactFn } as any);
    // 200_000 token context window — "small message" is far below 75%
    const injector = new CrossEngineContextInjector(db);
    const { historyBlock } = await injector.prepareSwitch(
      conversationId, "claude", source, makeModelInfo(200_000), "/tmp", "test-workspace"
    );

    expect(compactFn).not.toHaveBeenCalled();
    expect(historyBlock).toBeDefined();
  });

  it("CEC-7: tokens > 75%, source has compact() → compact() awaited", async () => {
    seedConversation("copilot");
    // Insert a large block of messages to push token estimate above 75% of a tiny context window
    for (let i = 0; i < 20; i++) {
      appendMessage(db, taskId, conversationId, "user", "user", "A".repeat(500));
      appendMessage(db, taskId, conversationId, "assistant", null, "B".repeat(500));
    }

    const compactFn = vi.fn().mockResolvedValue(undefined);
    const source = makeSourceEngine({ compact: compactFn } as any);
    // 1000 token window → 20 * (500+500) chars ≈ 5000 tokens >> 75%
    const injector = new CrossEngineContextInjector(db);
    await injector.prepareSwitch(
      conversationId, "claude", source, makeModelInfo(1_000), "/tmp", "test-workspace"
    );

    expect(compactFn).toHaveBeenCalledWith(null, conversationId, "/tmp", "test-workspace");
  });

  it("CEC-8: tokens > 75%, source has NO compact (Claude sim) → proceeds without compact", async () => {
    seedConversation("copilot");
    for (let i = 0; i < 20; i++) {
      appendMessage(db, taskId, conversationId, "user", "user", "A".repeat(500));
    }

    // Engine with no compact method
    const source = makeSourceEngine();
    const injector = new CrossEngineContextInjector(db);
    // Should not throw
    const { historyBlock } = await injector.prepareSwitch(
      conversationId, "claude", source, makeModelInfo(1_000), "/tmp", "test-workspace"
    );

    expect(historyBlock).toBeDefined();
  });

  it("CEC-9: messages before last compaction_summary anchor are excluded from block", async () => {
    seedConversation("copilot");
    appendMessage(db, taskId, conversationId, "user", "user", "Very old message");
    appendMessage(db, taskId, conversationId, "assistant", null, "Old assistant reply");
    appendMessage(db, taskId, conversationId, "compaction_summary", null, "Summary of earlier work");
    appendMessage(db, taskId, conversationId, "user", "user", "Recent question");
    appendMessage(db, taskId, conversationId, "assistant", null, "Recent answer");

    const injector = new CrossEngineContextInjector(db);
    const { historyBlock } = await injector.prepareSwitch(conversationId, "claude", null, undefined, "/tmp", "test-workspace");

    expect(historyBlock).toBeDefined();
    expect(historyBlock!).toContain("Recent question");
    expect(historyBlock!).toContain("Recent answer");
    expect(historyBlock!).not.toContain("Very old message");
    expect(historyBlock!).not.toContain("Old assistant reply");
  });

  it("CEC-10: tool_call and tool_result messages are NOT included in history block", async () => {
    seedConversation("copilot");
    appendMessage(db, taskId, conversationId, "user", "user", "User turn");
    appendMessage(db, taskId, conversationId, "tool_call", null, '{"tool":"run_command"}');
    appendMessage(db, taskId, conversationId, "tool_result", null, "command output");
    appendMessage(db, taskId, conversationId, "assistant", null, "Assistant reply");

    const injector = new CrossEngineContextInjector(db);
    const { historyBlock } = await injector.prepareSwitch(conversationId, "claude", null, undefined, "/tmp", "test-workspace");

    expect(historyBlock).toBeDefined();
    expect(historyBlock!).not.toContain('{"tool":"run_command"}');
    expect(historyBlock!).not.toContain("command output");
    expect(historyBlock!).toContain("User turn");
    expect(historyBlock!).toContain("Assistant reply");
  });

  it("CEC-11: prepended block appears before existing systemInstructions", () => {
    // Simulates how transition-executor prepends: `${historyBlock}\n\n${baseInstructions}`
    const baseInstructions = "## Base system instructions";
    const historyBlock =
      "## Context from previous conversation (engine switch)\n" +
      "The following is the conversation history from the previous engine session. Use it to maintain continuity.\n\n" +
      "<message_history>\n<USER>\nhello\n</USER>\n</message_history>";

    const combined = `${historyBlock}\n\n${baseInstructions}`;

    expect(combined.indexOf("## Context from")).toBeLessThan(combined.indexOf("## Base system"));
  });
});
