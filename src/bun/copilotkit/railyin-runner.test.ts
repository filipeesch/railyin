/**
 * railyin-runner.test.ts — RailyinAgentRunner unit tests (RUNR-02/04/05/06/07,
 * Pitfalls 2/4). Covers: the inherited synchronous lock throw, wire-exact
 * JSONL persistence (incl. the runner-patched RUN_STARTED.input), the five
 * replay shapes (missing file / empty file / N completed runs / interrupted
 * last run / errored-run-then-run truncated at the first RUN_ERROR), dangling
 * tool-call synthesis (RUNR-07), and the hot path (super.connect delegation).
 *
 * Thread ids are unique per test so the process-global in-memory store from
 * the base runner cannot bleed a prior test's history into the hot-path probe.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { EventType, type RunAgentInput } from "@ag-ui/core";
import type { AbstractAgent, BaseEvent } from "@ag-ui/client";
import type { AgentRunnerRunRequest } from "@copilotkit/runtime/v2";
import { JsonlStore, threadLogPath } from "./jsonl-store.ts";
import { RailyinAgentRunner } from "./railyin-runner.ts";

function makeTempDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "railyn-test-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function ev(type: string, extra: Record<string, unknown> = {}): BaseEvent {
  return { type, ...extra } as unknown as BaseEvent;
}

function runInput(threadId: string, runId: string, text = "hello"): RunAgentInput {
  return {
    threadId,
    runId,
    state: [],
    tools: [],
    context: [],
    messages: [{ id: "u1", role: "user", content: [{ type: "text", text }] }],
  };
}

/**
 * Fake agent driving `runAgent(input, { onEvent })` like the base runner
 * expects. `emit` receives the raw onEvent pusher.
 */
function fakeAgent(emit: (onEvent: (e: BaseEvent) => void) => void | Promise<void>): AbstractAgent {
  return {
    agentId: "default",
    async runAgent(_input: unknown, params: { onEvent: (e: { event: BaseEvent }) => void }) {
      await emit((e) => params.onEvent({ event: e }));
    },
    abortRun() {},
  } as unknown as AbstractAgent;
}

interface ObsLike<T> {
  subscribe(observer: { next: (v: T) => void; error: (e: unknown) => void; complete: () => void }): unknown;
}

/** Collect an observable's emissions until completion. */
function collect<T>(obs: ObsLike<T>): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const out: T[] = [];
    obs.subscribe({
      next: (v) => out.push(v),
      error: (e) => reject(e),
      complete: () => resolve(out),
    });
  });
}

/** A complete single-run wire sequence (RUN_STARTED without input — the runner patches it). */
function appendCompletedRun(store: JsonlStore, threadId: string, runId: string, delta: string): void {
  store.append(threadId, ev(EventType.RUN_STARTED, { threadId, runId }));
  store.append(threadId, ev(EventType.TEXT_MESSAGE_START, { messageId: `m-${runId}`, role: "assistant" }));
  store.append(threadId, ev(EventType.TEXT_MESSAGE_CONTENT, { messageId: `m-${runId}`, delta }));
  store.append(threadId, ev(EventType.TEXT_MESSAGE_END, { messageId: `m-${runId}` }));
  store.append(threadId, ev(EventType.RUN_FINISHED, { threadId, runId, result: null }));
}

let tmp: { dir: string; cleanup: () => void };
let store: JsonlStore;
let runner: RailyinAgentRunner;

beforeEach(() => {
  tmp = makeTempDir();
  store = new JsonlStore(tmp.dir);
  runner = new RailyinAgentRunner(store);
});

afterEach(() => {
  tmp.cleanup();
});

describe("RailyinAgentRunner", () => {
  test("1: concurrent run throws 'Thread already running' synchronously (RUNR-04, Pitfall 2)", () => {
    const request: AgentRunnerRunRequest = {
      threadId: "101",
      agent: fakeAgent(() => new Promise(() => {})), // never settles — run stays active
      input: runInput("101", "lock-1"),
    };
    runner.run(request).subscribe({ next: () => {}, error: () => {}, complete: () => {} });
    // The THROW is the contract (not an SSE status — Pitfall 2); the SSE
    // 200+empty-body surface is asserted in the e2e suite.
    expect(() => runner.run(request)).toThrow("Thread already running");
  });

  test("2: JSONL persists EXACTLY the wire events incl. the runner-patched RUN_STARTED.input (RUNR-02)", async () => {
    const request: AgentRunnerRunRequest = {
      threadId: "102",
      agent: fakeAgent((onEvent) => {
        // RUN_STARTED WITHOUT input — the base runner patches input in.
        onEvent(ev(EventType.RUN_STARTED, { threadId: "102", runId: "wire-1" }));
        onEvent(ev(EventType.TEXT_MESSAGE_START, { messageId: "m1", role: "assistant" }));
        onEvent(ev(EventType.TEXT_MESSAGE_CONTENT, { messageId: "m1", delta: "hi" }));
        onEvent(ev(EventType.TEXT_MESSAGE_END, { messageId: "m1" }));
        onEvent(ev(EventType.RUN_FINISHED, { threadId: "102", runId: "wire-1", result: null }));
      }),
      input: runInput("102", "wire-1", "hello"),
    };

    const streamEvents = await collect<BaseEvent>(runner.run(request));
    const fileEvents = store.read("102");
    expect(fileEvents).not.toBeNull();
    // Wire-exact: the log contains exactly what the client received.
    expect(fileEvents).toEqual(streamEvents);

    const started = fileEvents![0] as unknown as { type: string; input?: { messages: { id: string }[] } };
    expect(started.type).toBe(EventType.RUN_STARTED);
    // The runner patched input into the event the agent emitted without it.
    expect(started.input).toBeDefined();
    expect(started.input!.messages.some((m) => m.id === "u1")).toBe(true);
    expect(fileEvents![fileEvents!.length - 1].type).toBe(EventType.RUN_FINISHED);
  });

  test("3a: missing file → connect completes empty (RUNR-06)", async () => {
    const events = await collect<BaseEvent>(runner.connect({ threadId: "9001" }));
    expect(events).toEqual([]);
  });

  test("3b: empty file → connect completes empty", async () => {
    mkdirSync(join(tmp.dir, "threads"), { recursive: true });
    writeFileSync(threadLogPath(tmp.dir, "9002"), "", "utf-8");
    const events = await collect<BaseEvent>(runner.connect({ threadId: "9002" }));
    expect(events).toEqual([]);
  });

  test("3c: N completed runs → replayed in per-run boundaries (RUN_STARTED..RUN_FINISHED × 2)", async () => {
    appendCompletedRun(store, "9003", "r1", "one");
    appendCompletedRun(store, "9003", "r2", "two");

    const events = await collect<BaseEvent>(runner.connect({ threadId: "9003" }));
    const types = events.map((e) => e.type);
    // Per-run boundary order preserved through compaction.
    const boundaries = types.filter((t) => t === EventType.RUN_STARTED || t === EventType.RUN_FINISHED);
    expect(boundaries).toEqual([
      EventType.RUN_STARTED,
      EventType.RUN_FINISHED,
      EventType.RUN_STARTED,
      EventType.RUN_FINISHED,
    ]);
    // Both runs' content survived.
    expect(events.some((e) => (e as { delta?: string }).delta === "one")).toBe(true);
    expect(events.some((e) => (e as { delta?: string }).delta === "two")).toBe(true);
  });

  test("3d: interrupted last run (no terminal) → completed with finalizeRunEvents", async () => {
    store.append("9004", ev(EventType.RUN_STARTED, { threadId: "9004", runId: "crash-1" }));
    store.append("9004", ev(EventType.TEXT_MESSAGE_START, { messageId: "m1", role: "assistant" }));
    store.append("9004", ev(EventType.TEXT_MESSAGE_CONTENT, { messageId: "m1", delta: "mid" }));
    store.append("9004", ev(EventType.TOOL_CALL_START, { toolCallId: "call_1", toolCallName: "read_file" }));
    store.append("9004", ev(EventType.TOOL_CALL_ARGS, { toolCallId: "call_1", delta: "{}" }));
    // crash — no END/RESULT/terminal in the log

    const events = await collect<BaseEvent>(runner.connect({ threadId: "9004" }));
    expect(events.length).toBeGreaterThan(0);
    // finalizeRunEvents appends the INCOMPLETE_STREAM terminal.
    expect(events[events.length - 1].type).toBe(EventType.RUN_ERROR);
    // No stale running tool card: the dangling call got a synthesized RESULT.
    const types = events.map((e) => e.type);
    expect(types).toContain(EventType.TOOL_CALL_RESULT);
    expect((events.find((e) => e.type === "TOOL_CALL_RESULT") as { toolCallId?: string }).toolCallId).toBe("call_1");
  });

  test("3e: errored run then later run → replay truncated at the first RUN_ERROR (Pitfall 4)", async () => {
    store.append("9005", ev(EventType.RUN_STARTED, { threadId: "9005", runId: "bad-1" }));
    store.append("9005", ev(EventType.TEXT_MESSAGE_START, { messageId: "m1", role: "assistant" }));
    store.append("9005", ev(EventType.TEXT_MESSAGE_CONTENT, { messageId: "m1", delta: "bad" }));
    store.append("9005", ev(EventType.TEXT_MESSAGE_END, { messageId: "m1" }));
    store.append("9005", ev(EventType.RUN_ERROR, { message: "scripted failure", code: "ENGINE_ERROR" }));
    appendCompletedRun(store, "9005", "good-2", "good");

    const events = await collect<BaseEvent>(runner.connect({ threadId: "9005" }));
    const types = events.map((e) => e.type);
    // The later run's events are dropped entirely — nothing hydrates past a RUN_ERROR.
    expect(events.some((e) => (e as { delta?: string }).delta === "good")).toBe(false);
    // The truncated tail is re-completed: exactly one terminal, at the END.
    const errorIdx = types.indexOf(EventType.RUN_ERROR);
    expect(errorIdx).toBeGreaterThan(-1);
    expect(errorIdx).toBe(types.length - 1);
  });

  test("4: completed log with dangling tool call → synthetic TOOL_CALL_RESULT before the terminal (RUNR-07)", async () => {
    store.append("9006", ev(EventType.RUN_STARTED, { threadId: "9006", runId: "dangle-1" }));
    store.append("9006", ev(EventType.TOOL_CALL_START, { toolCallId: "call_9", toolCallName: "read_file" }));
    store.append("9006", ev(EventType.TOOL_CALL_ARGS, { toolCallId: "call_9", delta: "{}" }));
    store.append("9006", ev(EventType.TOOL_CALL_END, { toolCallId: "call_9" }));
    store.append("9006", ev(EventType.RUN_FINISHED, { threadId: "9006", runId: "dangle-1", result: null }));

    const events = await collect<BaseEvent>(runner.connect({ threadId: "9006" }));
    const types = events.map((e) => e.type);
    expect(types).toContain(EventType.TOOL_CALL_RESULT);
    const result = events.find((e) => e.type === "TOOL_CALL_RESULT") as {
      toolCallId?: string;
      messageId?: string;
      content?: string;
    };
    expect(result.toolCallId).toBe("call_9");
    expect(result.messageId).toBe("call_9-result");
    expect(result.content).toBe("");
    // The synthetic RESULT precedes the terminal — no stale running card.
    expect(types.indexOf(EventType.TOOL_CALL_RESULT)).toBeLessThan(types.indexOf(EventType.RUN_FINISHED));
  });

  test("5: hot path — after a run in this process, connect replays from the in-memory store (super.connect)", async () => {
    const request: AgentRunnerRunRequest = {
      threadId: "103",
      agent: fakeAgent((onEvent) => {
        onEvent(ev(EventType.RUN_STARTED, { threadId: "103", runId: "hot-1" }));
        onEvent(ev(EventType.TEXT_MESSAGE_START, { messageId: "m1", role: "assistant" }));
        onEvent(ev(EventType.TEXT_MESSAGE_CONTENT, { messageId: "m1", delta: "hot" }));
        onEvent(ev(EventType.TEXT_MESSAGE_END, { messageId: "m1" }));
        onEvent(ev(EventType.RUN_FINISHED, { threadId: "103", runId: "hot-1", result: null }));
      }),
      input: runInput("103", "hot-1"),
    };
    const runEvents = await collect<BaseEvent>(runner.run(request));
    expect(runEvents.length).toBeGreaterThan(0);

    const connected = await collect<BaseEvent>(runner.connect({ threadId: "103" }));
    const types = connected.map((e) => e.type);
    expect(types[0]).toBe(EventType.RUN_STARTED);
    expect(types[types.length - 1]).toBe(EventType.RUN_FINISHED);
    expect(connected.some((e) => (e as { delta?: string }).delta === "hot")).toBe(true);
  });
});
