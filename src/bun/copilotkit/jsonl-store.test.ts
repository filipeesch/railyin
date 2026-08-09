/**
 * jsonl-store.test.ts — JsonlStore persistence + sanitization unit tests
 * (RUNR-02, security V5/V8). Covers: append/read round-trip with exact event
 * order, missing file → null, traversal/absolute-path rejection BEFORE any
 * filesystem use, tolerant read of a truncated trailing line, and threads/
 * dir auto-creation on first append.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { BaseEvent } from "@ag-ui/client";
import { EventType } from "@ag-ui/core";
import { JsonlStore, threadLogPath } from "./jsonl-store.ts";

function makeTempDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "railyn-test-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function ev(type: string, extra: Record<string, unknown> = {}): BaseEvent {
  return { type, ...extra } as unknown as BaseEvent;
}

let tmp: { dir: string; cleanup: () => void };
let store: JsonlStore;

beforeEach(() => {
  tmp = makeTempDir();
  store = new JsonlStore(tmp.dir);
});

afterEach(() => {
  tmp.cleanup();
});

describe("JsonlStore", () => {
  test("1: append then read returns the exact events in order (one JSON object per line, verbatim)", () => {
    const events = [
      ev(EventType.RUN_STARTED, {
        threadId: "1",
        runId: "r1",
        input: { messages: [{ id: "u1", role: "user", content: [{ type: "text", text: "hello" }] }] },
      }),
      ev(EventType.TEXT_MESSAGE_START, { messageId: "m1", role: "assistant" }),
      ev(EventType.TEXT_MESSAGE_CONTENT, { messageId: "m1", delta: "hi" }),
      ev(EventType.TEXT_MESSAGE_END, { messageId: "m1" }),
      ev(EventType.RUN_FINISHED, { threadId: "1", runId: "r1", result: null }),
    ];
    for (const e of events) store.append("1", e);

    expect(store.read("1")).toEqual(events);
    // One JSON object per line.
    const raw = readFileSync(threadLogPath(tmp.dir, "1"), "utf-8");
    expect(raw.split("\n").filter(Boolean)).toHaveLength(5);
  });

  test("2: missing file → read returns null, exists is false", () => {
    expect(store.exists("999")).toBe(false);
    expect(store.read("999")).toBeNull();
  });

  test("3: traversal and absolute threadIds throw BEFORE any filesystem use", () => {
    for (const bad of ["../evil", "a/../../x", "/absolute/path"]) {
      expect(() => store.append(bad, ev(EventType.RUN_STARTED, { threadId: "1", runId: "r1" }))).toThrow(/Invalid threadId/);
      expect(() => store.read(bad)).toThrow(/Invalid threadId/);
      expect(() => store.exists(bad)).toThrow(/Invalid threadId/);
      expect(() => store.endRun(bad)).toThrow(/Invalid threadId/);
    }
    // No filesystem side effect from any rejected id — the threads dir never appears.
    expect(existsSync(join(tmp.dir, "threads"))).toBe(false);
    expect(existsSync(join(tmp.dir, "..", "evil.jsonl"))).toBe(false);
  });

  test("4: tolerant read — a truncated trailing line is skipped, complete lines still read", () => {
    store.append("7", ev(EventType.RUN_STARTED, { threadId: "7", runId: "r1" }));
    // Crash mid-append: one complete line + a partial trailing JSON line.
    writeFileSync(
      threadLogPath(tmp.dir, "7"),
      JSON.stringify(ev(EventType.RUN_STARTED, { threadId: "7", runId: "r1" })) + '\n{"type":"RUN_STARTED"',
      "utf-8",
    );
    const events = store.read("7");
    expect(events).not.toBeNull();
    expect(events!.length).toBe(1);
    expect(events![0]).toMatchObject({ type: EventType.RUN_STARTED, threadId: "7" });
  });

  test("5: append creates the threads dir when missing", () => {
    store.append("42", ev(EventType.RUN_STARTED, { threadId: "42", runId: "r1" }));
    expect(store.exists("42")).toBe(true);
    expect(existsSync(join(tmp.dir, "threads", "42.jsonl"))).toBe(true);
  });
});
