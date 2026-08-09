/**
 * event-bridge.test.ts — pure EngineEvent → AG-UI BaseEvent translation contract
 * (BRDG-01/02/03). Every emitted event is zod-parsed via EventSchemas from
 * `@ag-ui/core` (Don't Hand-Roll row 4 validation contract).
 */
import { describe, test, expect } from "bun:test";
import { EventSchemas } from "@ag-ui/core";
import type { BaseEvent } from "@ag-ui/client";
import type { EngineEvent } from "../engine/types.ts";
import {
  createTranslateState,
  translateEngineEvent,
  synthesizeMissingToolResults,
  terminalEvent,
  type TranslateState,
} from "./event-bridge.ts";

/** Parse every event with the wire contract; fail on any zod error. */
function assertValid(events: BaseEvent[]): void {
  for (const event of events) {
    const parsed = EventSchemas.safeParse(event);
    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      console.error("Invalid AG-UI event:", JSON.stringify(event), parsed.error.issues);
    }
  }
}

function types(events: BaseEvent[]): string[] {
  return events.map((e) => e.type);
}

describe("event-bridge: token family", () => {
  test("consecutive tokens group into one assistant text block (START/CONTENT/END)", () => {
    const state = createTranslateState("1", "run-1");
    const out: BaseEvent[] = [];
    out.push(...translateEngineEvent({ type: "token", content: "Hel" }, state));
    out.push(...translateEngineEvent({ type: "token", content: "lo" }, state));
    out.push(...translateEngineEvent({ type: "done" }, state));

    assertValid(out);
    expect(types(out)).toEqual([
      "TEXT_MESSAGE_START",
      "TEXT_MESSAGE_CONTENT",
      "TEXT_MESSAGE_CONTENT",
      "TEXT_MESSAGE_END",
    ]);
    expect(out[0]).toMatchObject({ role: "assistant", messageId: "run-1-text-1" });
    expect(out[1]).toMatchObject({ messageId: "run-1-text-1", delta: "Hel" });
    expect(out[2]).toMatchObject({ messageId: "run-1-text-1", delta: "lo" });
  });

  test("token sequence closes the text block at a non-token boundary", () => {
    const state = createTranslateState("1", "run-1");
    const out: BaseEvent[] = [];
    out.push(...translateEngineEvent({ type: "token", content: "a" }, state));
    out.push(...translateEngineEvent({ type: "reasoning", content: "r" }, state));

    assertValid(out);
    expect(types(out)).toEqual([
      "TEXT_MESSAGE_START",
      "TEXT_MESSAGE_CONTENT",
      "TEXT_MESSAGE_END",
      "REASONING_MESSAGE_START",
      "REASONING_MESSAGE_CONTENT",
    ]);
  });

  test("multiple token runs produce incrementing messageIds", () => {
    const state = createTranslateState("1", "run-1");
    const out: BaseEvent[] = [];
    out.push(...translateEngineEvent({ type: "token", content: "a" }, state));
    out.push(...translateEngineEvent({ type: "done" }, state));
    out.push(...translateEngineEvent({ type: "token", content: "b" }, state));
    out.push(...translateEngineEvent({ type: "done" }, state));

    assertValid(out);
    const starts = out.filter((e) => e.type === "TEXT_MESSAGE_START");
    expect(starts.map((e) => e.messageId)).toEqual(["run-1-text-1", "run-1-text-2"]);
  });
});

describe("event-bridge: reasoning family (BRDG-02)", () => {
  test("reasoning deltas → REASONING_MESSAGE_START/CONTENT/END", () => {
    const state = createTranslateState("1", "run-1");
    const out: BaseEvent[] = [];
    out.push(...translateEngineEvent({ type: "reasoning", content: "thin" }, state));
    out.push(...translateEngineEvent({ type: "reasoning", content: "king" }, state));
    out.push(...translateEngineEvent({ type: "done" }, state));

    assertValid(out);
    expect(types(out)).toEqual([
      "REASONING_MESSAGE_START",
      "REASONING_MESSAGE_CONTENT",
      "REASONING_MESSAGE_CONTENT",
      "REASONING_MESSAGE_END",
    ]);
    expect(out[0]).toMatchObject({ role: "reasoning", messageId: "run-1-reasoning-1" });
    expect(out[1]).toMatchObject({ messageId: "run-1-reasoning-1", delta: "thin" });
  });
});

describe("event-bridge: tool family (BRDG-03)", () => {
  test("tool_start → TOOL_CALL_START/ARGS/END; tool_result → TOOL_CALL_RESULT with messageId (Pitfall 5)", () => {
    const state = createTranslateState("1", "run-1");
    const out: BaseEvent[] = [];
    out.push(...translateEngineEvent({
      type: "tool_start", name: "read_file", callId: "call_1", arguments: '{"path":"a.txt"}',
    }, state));
    out.push(...translateEngineEvent({
      type: "tool_result", name: "read_file", callId: "call_1", result: "file contents",
    }, state));

    assertValid(out);
    expect(types(out)).toEqual([
      "TOOL_CALL_START",
      "TOOL_CALL_ARGS",
      "TOOL_CALL_END",
      "TOOL_CALL_RESULT",
    ]);
    const start = out[0] as unknown as { toolCallId: string; toolCallName: string };
    const args = out[1] as unknown as { toolCallId: string; delta: string };
    const result = out[3] as unknown as { messageId: string; toolCallId: string; content: string; role: string };
    expect(start.toolCallId).toBe("call_1");
    expect(start.toolCallName).toBe("read_file");
    expect(args.delta).toBe('{"path":"a.txt"}');
    expect(result.toolCallId).toBe("call_1");
    expect(result.messageId).toBe("call_1-result"); // Pitfall 5: messageId REQUIRED
    expect(result.content).toBe("file contents");
    expect(result.role).toBe("tool");
  });

  test("child/internal tool calls get namespaced ids (Pitfall 6)", () => {
    const state = createTranslateState("1", "run-1");
    const out: BaseEvent[] = [];
    out.push(...translateEngineEvent({
      type: "tool_start", name: "bash", callId: "call_0", parentCallId: "parent-1",
      arguments: "{}", isInternal: true,
    }, state));
    out.push(...translateEngineEvent({
      type: "tool_result", name: "bash", callId: "call_0", parentCallId: "parent-1",
      result: "out", isInternal: true,
    }, state));

    assertValid(out);
    const start = out[0] as unknown as { toolCallId: string };
    const result = out[3] as unknown as { toolCallId: string };
    expect(start.toolCallId).toBe("parent-1::call_0::1");
    expect(result.toolCallId).toBe("parent-1::call_0::1"); // result resolves the namespaced id
  });

  test("sequential child calls reusing the same raw callId get distinct namespaced ids (Pitfall 6)", () => {
    const state = createTranslateState("1", "run-1");
    const childStart = (): BaseEvent[] => translateEngineEvent({
      type: "tool_start", name: "bash", callId: "call_0", parentCallId: "parent-1",
      arguments: "{}", isInternal: true,
    }, state);
    const childResult = (): BaseEvent[] => translateEngineEvent({
      type: "tool_result", name: "bash", callId: "call_0", parentCallId: "parent-1",
      result: "out", isInternal: true,
    }, state);

    const first: BaseEvent[] = [...childStart(), ...childResult()];
    const second: BaseEvent[] = [...childStart(), ...childResult()];
    assertValid([...first, ...second]);

    const firstId = (first[0] as unknown as { toolCallId: string }).toolCallId;
    const secondId = (second[0] as unknown as { toolCallId: string }).toolCallId;
    expect(firstId).toBe("parent-1::call_0::1");
    expect(secondId).toBe("parent-1::call_0::2");
    // Each call's lifecycle (START/ARGS/END/RESULT) shares one id; the two calls differ.
    expect(firstId).not.toBe(secondId);
  });

  test("tool_start without callId gets a generated id", () => {
    const state = createTranslateState("1", "run-1");
    const out = translateEngineEvent({ type: "tool_start", name: "bash", arguments: "{}" }, state);
    assertValid(out);
    const start = out[0] as unknown as { toolCallId: string };
    expect(start.toolCallId).toMatch(/^call_/);
  });

  test("subagent_start/subagent_stop map to a tool-call pair with namespaced ids", () => {
    const state = createTranslateState("1", "run-1");
    const out: BaseEvent[] = [];
    out.push(...translateEngineEvent({ type: "subagent_start", callId: "sa-1", intent: "inspect", prompt: "do x" }, state));
    out.push(...translateEngineEvent({ type: "subagent_stop", callId: "sa-1" }, state));

    assertValid(out);
    expect(types(out)).toEqual([
      "TOOL_CALL_START",
      "TOOL_CALL_ARGS",
      "TOOL_CALL_END",
      "TOOL_CALL_RESULT",
    ]);
    const start = out[0] as unknown as { toolCallName: string };
    expect(start.toolCallName).toBe("subagent");
    const args = out[1] as unknown as { delta: string };
    expect(JSON.parse(args.delta)).toEqual({ intent: "inspect", prompt: "do x" });
    const result = out[3] as unknown as { content: string; messageId: string };
    expect(result.content).toBe("");
    expect(result.messageId).toBe(`${(out[0] as unknown as { toolCallId: string }).toolCallId}-result`);
  });

  test("subagent with an interleaved child tool call — subagent id resolves back to its START (CR-01)", () => {
    const state = createTranslateState("1", "run-1");
    const out: BaseEvent[] = [];
    out.push(...translateEngineEvent({ type: "subagent_start", callId: "sa-1", intent: "inspect", prompt: "do x" }, state));
    // Child events interleave between subagent_start and subagent_stop — the
    // normal subagent-with-tools flow (copilot/events.ts emits parentCallId).
    out.push(...translateEngineEvent({
      type: "tool_start", name: "bash", callId: "c0", parentCallId: "sa-1",
      arguments: "{}", isInternal: true,
    }, state));
    out.push(...translateEngineEvent({
      type: "tool_result", name: "bash", callId: "c0", parentCallId: "sa-1",
      result: "out", isInternal: true,
    }, state));
    out.push(...translateEngineEvent({ type: "subagent_stop", callId: "sa-1" }, state));

    assertValid(out);
    expect(types(out)).toEqual([
      "TOOL_CALL_START",
      "TOOL_CALL_ARGS",
      "TOOL_CALL_END",
      "TOOL_CALL_START",
      "TOOL_CALL_ARGS",
      "TOOL_CALL_END",
      "TOOL_CALL_RESULT",
      "TOOL_CALL_RESULT",
    ]);
    const subStart = out[0] as unknown as { toolCallId: string };
    const childStart = out[3] as unknown as { toolCallId: string };
    const childResult = out[6] as unknown as { toolCallId: string };
    const subResult = out[7] as unknown as { toolCallId: string };
    expect(subStart.toolCallId).toBe("sa-1::1");
    expect(childStart.toolCallId).toBe("sa-1::c0::2");
    expect(childResult.toolCallId).toBe("sa-1::c0::2");
    // CR-01: the stop resolves to the id the client saw STARTed — no
    // phantom id that was never started, and the started id is not left
    // dangling for a synthesized second result.
    expect(subResult.toolCallId).toBe("sa-1::1");
    expect(subResult.toolCallId).toBe(subStart.toolCallId);
  });

  test("two parallel children with interleaved results resolve to their OWN ids (CR-01)", () => {
    const state = createTranslateState("1", "run-1");
    const out: BaseEvent[] = [];
    out.push(...translateEngineEvent({
      type: "tool_start", name: "bash", callId: "A", parentCallId: "p1",
      arguments: "{}", isInternal: true,
    }, state));
    out.push(...translateEngineEvent({
      type: "tool_start", name: "bash", callId: "B", parentCallId: "p1",
      arguments: "{}", isInternal: true,
    }, state));
    // Results arrive in the OPPOSITE order of the starts.
    out.push(...translateEngineEvent({
      type: "tool_result", name: "bash", callId: "A", parentCallId: "p1",
      result: "a", isInternal: true,
    }, state));
    out.push(...translateEngineEvent({
      type: "tool_result", name: "bash", callId: "B", parentCallId: "p1",
      result: "b", isInternal: true,
    }, state));

    assertValid(out);
    const aStart = out[0] as unknown as { toolCallId: string };
    const bStart = out[3] as unknown as { toolCallId: string };
    const aResult = out[6] as unknown as { toolCallId: string };
    const bResult = out[7] as unknown as { toolCallId: string };
    expect(aStart.toolCallId).toBe("p1::A::1");
    expect(bStart.toolCallId).toBe("p1::B::2");
    expect(aResult.toolCallId).toBe("p1::A::1");
    expect(bResult.toolCallId).toBe("p1::B::2");
  });

  test("nested subagents (subagent inside subagent) resolve independently (CR-01)", () => {
    const state = createTranslateState("1", "run-1");
    const out: BaseEvent[] = [];
    out.push(...translateEngineEvent({ type: "subagent_start", callId: "outer", intent: "a", prompt: "p" }, state));
    out.push(...translateEngineEvent({ type: "subagent_start", callId: "inner", intent: "b", prompt: "q" }, state));
    out.push(...translateEngineEvent({ type: "subagent_stop", callId: "inner" }, state));
    out.push(...translateEngineEvent({ type: "subagent_stop", callId: "outer" }, state));

    assertValid(out);
    const outerStart = out[0] as unknown as { toolCallId: string };
    const innerStart = out[3] as unknown as { toolCallId: string };
    const innerResult = out[6] as unknown as { toolCallId: string };
    const outerResult = out[7] as unknown as { toolCallId: string };
    expect(outerStart.toolCallId).toBe("outer::1");
    expect(innerStart.toolCallId).toBe("inner::2");
    expect(innerResult.toolCallId).toBe("inner::2");
    expect(outerResult.toolCallId).toBe("outer::1");
  });
});

describe("event-bridge: ignored families (BRDG-01 — no double-broadcast)", () => {
  test("board-only and control events produce no AG-UI events", () => {
    const state = createTranslateState("1", "run-1");
    const ignored: EngineEvent[] = [
      { type: "status", message: "working" },
      { type: "usage", inputTokens: 1, outputTokens: 2 },
      { type: "task_updated", task: { id: 1 } as never },
      { type: "new_message", message: { id: 1 } as never },
      { type: "compaction_start" },
      { type: "compaction_done", summary: "s" },
      { type: "ask_user", payload: "{}" },
      { type: "shell_approval", command: "ls", executionId: 1 },
      { type: "decision_request", payload: "{}" },
    ];
    for (const event of ignored) {
      expect(translateEngineEvent(event, state)).toEqual([]);
    }
  });
});

describe("event-bridge: terminal paths (Pitfall 3 — exactly one terminal)", () => {
  test("done → RUN_FINISHED; error → RUN_ERROR", () => {
    const done = terminalEvent("1", "run-1", "done");
    const err = terminalEvent("1", "run-1", "error", { message: "boom", code: "E1" });
    const aborted = terminalEvent("1", "run-1", "aborted");
    const decision = terminalEvent("1", "run-1", "decision");

    assertValid([done, err, aborted, decision]);
    expect(done).toMatchObject({ type: "RUN_FINISHED", threadId: "1", runId: "run-1", result: null });
    expect(err).toMatchObject({ type: "RUN_ERROR", message: "boom", code: "E1" });
    expect(aborted).toMatchObject({ type: "RUN_FINISHED", threadId: "1", runId: "run-1" });
    expect(decision).toMatchObject({ type: "RUN_FINISHED", threadId: "1", runId: "run-1" });
  });

  test("done/error/aborted each produce exactly one terminal", () => {
    for (const outcome of ["done", "error", "aborted", "decision"] as const) {
      const state = createTranslateState("1", "run-1");
      const mapped: BaseEvent[] = [];
      mapped.push(...translateEngineEvent({ type: "token", content: "x" }, state));
      mapped.push(...translateEngineEvent({ type: "done" }, state));
      const terminal = terminalEvent("1", "run-1", outcome, outcome === "error" ? { message: "boom" } : undefined);
      const finals = [...mapped, terminal].filter((e) => e.type === "RUN_FINISHED" || e.type === "RUN_ERROR");
      expect(finals).toHaveLength(1);
    }
  });
});

describe("event-bridge: D-09 synthesis (no dangling tool calls before terminal)", () => {
  test("open TOOL_CALL_START gets synthetic TOOL_CALL_END + TOOL_CALL_RESULT before terminal", () => {
    const state = createTranslateState("1", "run-1");
    const mapped: BaseEvent[] = [];
    mapped.push(...translateEngineEvent({
      type: "tool_start", name: "read_file", callId: "call_1", arguments: "{}",
    }, state));
    // No tool_result arrives — the run ends.

    const finalized = synthesizeMissingToolResults(state, mapped);
    assertValid(finalized);
    expect(types(finalized)).toEqual([
      "TOOL_CALL_START",
      "TOOL_CALL_ARGS",
      "TOOL_CALL_END",
      "TOOL_CALL_RESULT",
    ]);
    const result = finalized[3] as unknown as { messageId: string; toolCallId: string; content: string };
    expect(result.toolCallId).toBe("call_1");
    expect(result.messageId).toBe("call_1-result");
    expect(result.content).toBe("");
    // State is drained — a second pass appends nothing new.
    const secondPass = synthesizeMissingToolResults(state, finalized);
    expect(secondPass).toEqual(finalized);
  });

  test("synthesis skips completed tool calls", () => {
    const state = createTranslateState("1", "run-1");
    const mapped: BaseEvent[] = [];
    mapped.push(...translateEngineEvent({
      type: "tool_start", name: "read_file", callId: "call_1", arguments: "{}",
    }, state));
    mapped.push(...translateEngineEvent({
      type: "tool_result", name: "read_file", callId: "call_1", result: "x",
    }, state));

    // Nothing open → returned unchanged, nothing appended.
    expect(synthesizeMissingToolResults(state, mapped)).toEqual(mapped);
  });

  test("dangling child tool calls are synthesized with their namespaced ids", () => {
    const state = createTranslateState("1", "run-1");
    const mapped: BaseEvent[] = [];
    mapped.push(...translateEngineEvent({
      type: "tool_start", name: "bash", callId: "call_0", parentCallId: "parent-1",
      arguments: "{}", isInternal: true,
    }, state));

    const finalized = synthesizeMissingToolResults(state, mapped);
    assertValid(finalized);
    const result = finalized[finalized.length - 1] as unknown as unknown as { toolCallId: string };
    expect(result.toolCallId).toBe("parent-1::call_0::1");
  });
});

describe("event-bridge: state isolation", () => {
  test("two runs with separate states never share messageIds", () => {
    const s1 = createTranslateState("1", "run-a");
    const s2 = createTranslateState("2", "run-b");
    const a = translateEngineEvent({ type: "token", content: "x" }, s1);
    const b = translateEngineEvent({ type: "token", content: "y" }, s2);
    expect(a[0]).toMatchObject({ messageId: "run-a-text-1" });
    expect(b[0]).toMatchObject({ messageId: "run-b-text-1" });
  });
});
