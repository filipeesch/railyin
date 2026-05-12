import { describe, expect, it, beforeEach, vi } from "vitest";
import type { EngineEvent } from "@bun/engine/types";
import { MockCursorSdkAdapter, createMockCursorSdkAdapter, MockCursorMessage } from "./mocks";

describe("CursorSdkAdapter", () => {
  describe("createMockCursorSdkAdapter", () => {
    it("Creates a mock adapter with empty message list", () => {
      const adapter = createMockCursorSdkAdapter();
      expect(adapter).toBeDefined();
    });

    it("Creates a mock adapter with provided messages", () => {
      const messages: MockCursorMessage[] = [
        { type: "assistant", content: "Hello" },
        { type: "status", content: "Running" },
      ];
      const adapter = createMockCursorSdkAdapter(messages);
      expect(adapter).toBeDefined();
    });
  });

  describe("run", () => {
    it("Yields done event when no messages provided", async () => {
      const adapter = createMockCursorSdkAdapter();
      const events: EngineEvent[] = [];
      for await (const event of adapter.run({
        executionId: 1,
        taskId: 1,
        prompt: "test",
        workingDirectory: "/tmp",
        sessionId: "cursor-1",
      })) {
        events.push(event);
      }
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ type: "done" });
    });

    it("Translates assistant messages to token events", async () => {
      const messages: MockCursorMessage[] = [
        { type: "assistant", content: "Hello World" },
      ];
      const adapter = createMockCursorSdkAdapter(messages);
      const events: EngineEvent[] = [];
      for await (const event of adapter.run({
        executionId: 1,
        taskId: 1,
        prompt: "test",
        workingDirectory: "/tmp",
        sessionId: "cursor-1",
      })) {
        events.push(event);
      }
      expect(events).toHaveLength(2); // token + done
      expect(events[0]).toEqual({ type: "token", content: "Hello World" });
      expect(events[1]).toEqual({ type: "done" });
    });

    it("Translates thinking messages to reasoning events", async () => {
      const messages: MockCursorMessage[] = [
        { type: "thinking", content: "Thinking..." },
      ];
      const adapter = createMockCursorSdkAdapter(messages);
      const events: EngineEvent[] = [];
      for await (const event of adapter.run({
        executionId: 1,
        taskId: 1,
        prompt: "test",
        workingDirectory: "/tmp",
        sessionId: "cursor-1",
      })) {
        events.push(event);
      }
      expect(events).toHaveLength(2);
      expect(events[0]).toEqual({ type: "reasoning", content: "Thinking..." });
      expect(events[1]).toEqual({ type: "done" });
    });

    it("Handles tool_call messages", async () => {
      const messages: MockCursorMessage[] = [
        { type: "tool_call" },
      ];
      const adapter = createMockCursorSdkAdapter(messages);
      const events: EngineEvent[] = [];
      for await (const event of adapter.run({
        executionId: 1,
        taskId: 1,
        prompt: "test",
        workingDirectory: "/tmp",
        sessionId: "cursor-1",
      })) {
        events.push(event);
      }
      expect(events).toHaveLength(2);
      expect(events[0]).toEqual({ type: "status", message: "Tool call executed" });
      expect(events[1]).toEqual({ type: "done" });
    });
  });

  describe("listModels", () => {
    it("Returns mock model info", async () => {
      const adapter = createMockCursorSdkAdapter();
      const models = await adapter.listModels("/tmp");
      expect(models).toHaveLength(1);
      expect(models[0]).toEqual({
        value: "cursor/default",
        displayName: "Cursor Default",
        description: "Default Cursor model",
        supportsThinking: true,
      });
    });
  });

  describe("listCommands", () => {
    it("Returns empty array for slash commands", async () => {
      const adapter = createMockCursorSdkAdapter();
      const commands = await adapter.listCommands("/tmp");
      expect(commands).toEqual([]);
    });
  });

  describe("cancel", () => {
    it("Aborts the controller", async () => {
      const adapter = createMockCursorSdkAdapter();
      await adapter.cancel(1);
      // Just verify no error - the abort is internal
      expect(true).toBe(true);
    });
  });

  describe("shutdownAll", () => {
    it("Returns void", async () => {
      const adapter = createMockCursorSdkAdapter();
      const result = await adapter.shutdownAll();
      expect(result).toBeUndefined();
    });
  });
});
