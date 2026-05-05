import { describe, expect, it } from "vitest";
import {
  translatePart,
  translatePermissionAsked,
  translateSessionError,
  translateSessionStatus,
} from "../engine/opencode/event-translator.ts";
import type { Part } from "@opencode-ai/sdk/v2";
import type { EventPermissionAsked, EventSessionError, EventSessionStatus } from "@opencode-ai/sdk/v2";

// Helper to cast partial test fixtures to SDK types
function part(p: Record<string, unknown>): Part {
  return p as unknown as Part;
}

// ── translatePart ────────────────────────────────────────────────────────────

describe("translatePart — TextPart", () => {
  it("maps text content to token event", () => {
    const events = translatePart(part({ type: "text", text: "hello world" }));
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: "token", content: "hello world" });
  });

  it("returns empty array for empty text", () => {
    expect(translatePart(part({ type: "text", text: "" }))).toHaveLength(0);
  });
});

describe("translatePart — ReasoningPart", () => {
  it("maps reasoning text to reasoning event", () => {
    const events = translatePart(part({ type: "reasoning", text: "thinking step" }));
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: "reasoning", content: "thinking step" });
  });

  it("returns empty array for empty reasoning", () => {
    expect(translatePart(part({ type: "reasoning", text: "" }))).toHaveLength(0);
  });
});

describe("translatePart — ToolPart", () => {
  it("maps running state to tool_start event", () => {
    const events = translatePart(part({
      type: "tool",
      tool: "bash",
      callID: "call-abc",
      state: { status: "running", input: { cmd: "ls" }, time: { start: 0 } },
    }));
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: "tool_start",
      name: "bash",
      arguments: JSON.stringify({ cmd: "ls" }),
      callId: "call-abc",
    });
  });

  it("maps completed state to tool_result event", () => {
    const events = translatePart(part({
      type: "tool",
      tool: "read_file",
      callID: "call-xyz",
      state: { status: "completed", input: {}, output: "file contents", title: "", metadata: {}, time: { start: 0, end: 1 } },
    }));
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: "tool_result",
      name: "read_file",
      result: "file contents",
      callId: "call-xyz",
    });
  });

  it("maps error state to tool_result with isError=true", () => {
    const events = translatePart(part({
      type: "tool",
      tool: "write_file",
      callID: "call-err",
      state: { status: "error", input: {}, error: "permission denied", time: { start: 0, end: 1 } },
    }));
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: "tool_result",
      name: "write_file",
      result: "permission denied",
      callId: "call-err",
      isError: true,
    });
  });

  it("returns empty array for unknown tool state", () => {
    const events = translatePart(part({
      type: "tool",
      tool: "noop",
      callID: "call-noop",
      state: { status: "pending", input: {}, raw: "" },
    }));
    expect(events).toHaveLength(0);
  });
});

describe("translatePart — StepFinishPart (usage)", () => {
  it("maps token counts to usage event", () => {
    const events = translatePart(part({
      type: "step-finish",
      tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
      reason: "stop",
      cost: 0,
    }));
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: "usage", inputTokens: 100, outputTokens: 50 });
  });

  it("returns empty array when both token counts are zero", () => {
    const events = translatePart(part({
      type: "step-finish",
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      reason: "stop",
      cost: 0,
    }));
    expect(events).toHaveLength(0);
  });
});

describe("translatePart — unknown type", () => {
  it("returns empty array without throwing", () => {
    const p = part({ type: "unknown-future-type", data: "whatever" });
    expect(() => translatePart(p)).not.toThrow();
    expect(translatePart(p)).toHaveLength(0);
  });
});

// ── translatePermissionAsked ──────────────────────────────────────────────────

describe("translatePermissionAsked", () => {
  it("maps permission.asked with patterns to shell_approval", () => {
    const event = {
      type: "permission.asked",
      properties: {
        id: "p1", sessionID: "s1", permission: "bash",
        patterns: ["rm -rf /", "sudo *"],
        metadata: {}, always: [],
      },
    } as unknown as EventPermissionAsked;

    const result = translatePermissionAsked(event, 42);
    expect(result).toEqual({ type: "shell_approval", command: "rm -rf /, sudo *", executionId: 42 });
  });

  it("falls back to permission field when no patterns", () => {
    const event = {
      type: "permission.asked",
      properties: {
        id: "p2", sessionID: "s1", permission: "network",
        patterns: [],
        metadata: {}, always: [],
      },
    } as unknown as EventPermissionAsked;

    const result = translatePermissionAsked(event, 7);
    expect(result.command).toBe("network");
  });
});

// ── translateSessionError ─────────────────────────────────────────────────────

describe("translateSessionError", () => {
  it("extracts error message from event", () => {
    const event = {
      type: "session.error",
      properties: { error: { message: "rate limit exceeded" } },
    } as unknown as EventSessionError;

    const result = translateSessionError(event);
    expect(result).toEqual({ type: "error", message: "rate limit exceeded", fatal: true });
  });

  it("returns default message for unrecognised error shape", () => {
    const event = {
      type: "session.error",
      properties: { error: null },
    } as unknown as EventSessionError;

    const result = translateSessionError(event);
    expect(result.type).toBe("error");
    expect((result as { message: string }).message).toBeTruthy();
  });
});

// ── translateSessionStatus ────────────────────────────────────────────────────

describe("translateSessionStatus", () => {
  it("maps status field to status event", () => {
    const event = {
      type: "session.status",
      properties: { sessionID: "s1", status: { type: "retry", attempt: 1, message: "retrying", next: 5 } },
    } as unknown as EventSessionStatus;

    const result = translateSessionStatus(event);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("status");
  });

  it("returns null when status property is absent", () => {
    const event = {
      type: "session.status",
      properties: { sessionID: "s1" },
    } as unknown as EventSessionStatus;

    expect(translateSessionStatus(event)).toBeNull();
  });
});
