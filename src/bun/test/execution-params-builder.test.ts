import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ExecutionParamsBuilder } from "../engine/execution/execution-params-builder.ts";
import type { TaskRow } from "../db/row-types.ts";

const builder = new ExecutionParamsBuilder();
const noop = () => {};

function makeTask(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id: 1,
    board_id: 10,
    project_key: "test-project",
    title: "My Task",
    description: "A description",
    workflow_state: "plan",
    execution_state: "idle",
    conversation_id: null,
    current_execution_id: null,
    retry_count: 0,
    created_from_task_id: null,
    created_from_execution_id: null,
    created_at: new Date().toISOString(),
    model: "fake/model",
    shell_auto_approve: 0,
    approved_commands: "[]",
    position: 0,
    enabled_mcp_tools: null,
    ...overrides,
  };
}

describe("ExecutionParamsBuilder.build", () => {
  it("passes the provided AbortSignal through to params.signal", () => {
    const controller = new AbortController();
    const params = builder.build(
      makeTask(),
      5,
      42,
      "do work",
      undefined,
      "/workspace",
      controller.signal,
      noop,
    );

    expect(params.signal).toBe(controller.signal);
  });

  it("populates taskId and boardId from the task row", () => {
    const task = makeTask({ id: 7, board_id: 99 });
    const params = builder.build(task, 1, 1, "prompt", undefined, "/w", new AbortController().signal, noop);

    expect(params.taskId).toBe(7);
    expect(params.boardId).toBe(99);
  });

  it("populates taskContext title and description from the task row", () => {
    const task = makeTask({ title: "Hello", description: "World" });
    const params = builder.build(task, 1, 1, "prompt", undefined, "/w", new AbortController().signal, noop);

    expect(params.taskContext?.title).toBe("Hello");
    expect(params.taskContext?.description).toBe("World");
  });

  it("omits description from taskContext when description is blank", () => {
    const task = makeTask({ description: "   " });
    const params = builder.build(task, 1, 1, "prompt", undefined, "/w", new AbortController().signal, noop);

    expect(params.taskContext?.description).toBeUndefined();
  });

  it("parses enabled_mcp_tools JSON into an array", () => {
    const task = makeTask({ enabled_mcp_tools: '["tool-a","tool-b"]' });
    const params = builder.build(task, 1, 1, "prompt", undefined, "/w", new AbortController().signal, noop);

    expect(params.enabledMcpTools).toEqual(["tool-a", "tool-b"]);
  });

  it("sets enabledMcpTools to null when enabled_mcp_tools is null", () => {
    const task = makeTask({ enabled_mcp_tools: null });
    const params = builder.build(task, 1, 1, "prompt", undefined, "/w", new AbortController().signal, noop);

    expect(params.enabledMcpTools).toBeNull();
  });

  it("sets enabledMcpTools to null when enabled_mcp_tools is invalid JSON", () => {
    const task = makeTask({ enabled_mcp_tools: "not-json" });
    const params = builder.build(task, 1, 1, "prompt", undefined, "/w", new AbortController().signal, noop);

    expect(params.enabledMcpTools).toBeNull();
  });
});

describe("ExecutionParamsBuilder.buildForChat", () => {
  it("sets taskId to null", () => {
    const params = builder.buildForChat(
      5, 42, "hello", "/workspace", "fake/model",
      new AbortController().signal, noop, null,
    );

    expect(params.taskId).toBeNull();
  });

  it("has no boardId property", () => {
    const params = builder.buildForChat(
      5, 42, "hello", "/workspace", "fake/model",
      new AbortController().signal, noop, null,
    );

    expect("boardId" in params).toBe(false);
  });

  it("passes enabled_mcp_tools array through", () => {
    const tools = ["tool-x", "tool-y"];
    const params = builder.buildForChat(
      5, 42, "hello", "/workspace", "fake/model",
      new AbortController().signal, noop, tools,
    );

    expect(params.enabledMcpTools).toEqual(tools);
  });

  it("passes the AbortSignal through", () => {
    const controller = new AbortController();
    const params = builder.buildForChat(
      5, 42, "hello", "/workspace", "fake/model",
      controller.signal, noop, null,
    );

    expect(params.signal).toBe(controller.signal);
  });
});
