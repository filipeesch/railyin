import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { CursorEngine } from "@bun/engine/cursor/engine.ts";
import { createCursorRpcRuntime } from "@bun/test/support/cursor-rpc-runtime.ts";

describe("CursorEngine — integration scenarios", () => {
  let runtime: any;

  beforeAll(async () => {
    // Create runtime with the cursor engine
    runtime = createCursorRpcRuntime();
  });

  afterAll(async () => {
    if (runtime) {
      runtime.cleanup();
    }
  });

  it("Executes a single-turn chat with CursorEngine", async () => {
    const { taskId } = await runtime.createTask();
    const result = await runtime.handlers["tasks.sendMessage"]({ 
      taskId, 
      content: "Hello from integration test" 
    });

    await runtime.recorder.waitForStreamDone(result.executionId);
    await runtime.waitForExecutionStatus(result.executionId, "completed");

    const messages = runtime.getMessages(taskId);
    // Should have user message and at least one assistant/system response
    expect(messages.length).toBeGreaterThan(1);
  });

  it("Handles token streaming", async () => {
    const { taskId } = await runtime.createTask();
    const result = await runtime.handlers["tasks.sendMessage"]({ 
      taskId, 
      content: "Test streaming" 
    });

    await runtime.recorder.waitForStreamDone(result.executionId);
    await runtime.waitForExecutionStatus(result.executionId, "completed");

    // Check that events were recorded
    const ipcEvents = runtime.getIpcEvents(result.executionId);
    // The mock should produce at least token + done events
    expect(ipcEvents.length).toBeGreaterThan(0);
  });

  it("Handles ask_user scenario", async () => {
    const { taskId } = await runtime.createTask();
    const result = await runtime.handlers["tasks.sendMessage"]({ 
      taskId, 
      content: "Ask for user input" 
    });

    // Wait for either completion or waiting_user state
    await runtime.recorder.waitForStreamDone(result.executionId);
    await runtime.waitForExecutionStatus(result.executionId, "completed");

    // Verify task got a message
    const messages = runtime.getMessages(taskId);
    expect(messages.length).toBeGreaterThan(0);
  });
});
