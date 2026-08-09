import { describe, expect, it } from "vitest";
import { claudeSessionIdForConversation, claudeSessionIdForTask } from "../engine/claude/adapter.ts";

describe("Claude adapter session-id helpers", () => {
  it("CA-1: claudeSessionIdForTask returns a stable deterministic UUID for a task", () => {
    const id = claudeSessionIdForTask(42);
    // Version-5-style UUID (deterministic from the task id)
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(claudeSessionIdForTask(42)).toBe(id);
    expect(claudeSessionIdForTask(43)).not.toBe(id);
  });

  it("CA-2: claudeSessionIdForConversation is stable and task-bound (conversationId ignored for task sessions)", () => {
    const id = claudeSessionIdForConversation(7, 100);
    expect(claudeSessionIdForConversation(7, 100)).toBe(id);
    // Task-bound sessions key on taskId only — different conversationIds share the session.
    expect(claudeSessionIdForConversation(7, 101)).toBe(id);
    // A different task gets a different session.
    expect(claudeSessionIdForConversation(8, 100)).not.toBe(id);
  });

  it("CA-3: chat conversations (null task) use their own stable namespace", () => {
    const id = claudeSessionIdForConversation(null, 200);
    expect(claudeSessionIdForConversation(null, 200)).toBe(id);
    // Same conversationId with a task differs from the chat-only session.
    expect(claudeSessionIdForConversation(3, 200)).not.toBe(id);
  });
});
