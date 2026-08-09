/**
 * jsonl-store.test.ts — JsonlStore persistence + sanitization unit tests
 * (RUNR-02, security V5/V8). Covers: append/read round-trip with exact event
 * order, missing file → null, traversal/absolute-path rejection BEFORE any
 * filesystem use, tolerant read of a truncated trailing line, and threads/
 * dir auto-creation on first append.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "fs";
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

describe("list() — index rebuild from the log (D-04/D-05)", () => {
  test("1: scans valid .jsonl files, skips decoys, sorts by mtime desc with correct metadata", () => {
    // Direct writes (unlike store.append) need the threads dir to exist.
    mkdirSync(join(tmp.dir, "threads"), { recursive: true });
    // Two valid threads with explicit, distinct mtimes.
    writeFileSync(threadLogPath(tmp.dir, "1"), '{"type":"RUN_STARTED"}\n', "utf-8");
    writeFileSync(threadLogPath(tmp.dir, "3"), '{"type":"RUN_STARTED"}\n', "utf-8");
    // Decoys: tmp residue, meta sidecar, non-numeric name.
    writeFileSync(join(tmp.dir, "threads", "7.jsonl.tmp"), "partial", "utf-8");
    writeFileSync(join(tmp.dir, "threads", "8.meta.json"), "{}", "utf-8");
    writeFileSync(join(tmp.dir, "threads", "abc.jsonl"), "{}", "utf-8");

    const older = new Date("2026-01-01T00:00:00Z");
    const newer = new Date("2026-02-01T00:00:00Z");
    utimesSync(threadLogPath(tmp.dir, "1"), older, older);
    utimesSync(threadLogPath(tmp.dir, "3"), newer, newer);

    const list = store.list();
    // Exactly the 2 valid entries, mtime desc.
    expect(list.map((e) => e.threadId)).toEqual(["3", "1"]);
    expect(Math.abs(list[0].mtimeMs - newer.getTime())).toBeLessThan(1000);
    expect(Math.abs(list[1].mtimeMs - older.getTime())).toBeLessThan(1000);
    // Correct metadata on each survivor.
    expect(list[0].size).toBe('{"type":"RUN_STARTED"}\n'.length);
    expect(list[1].size).toBe('{"type":"RUN_STARTED"}\n'.length);
  });

  test("2: missing threads dir → []", () => {
    expect(store.list()).toEqual([]);
  });

  test("3: corrupt/non-conforming dir entries are skipped, never thrown", () => {
    mkdirSync(join(tmp.dir, "threads"), { recursive: true });
    writeFileSync(threadLogPath(tmp.dir, "5"), '{"type":"RUN_STARTED"}\n', "utf-8");
    writeFileSync(join(tmp.dir, "threads", "evil.jsonl"), "{}", "utf-8");
    writeFileSync(join(tmp.dir, "threads", "..jsonl"), "{}", "utf-8");
    const list = store.list();
    expect(list.map((e) => e.threadId)).toEqual(["5"]);
  });

  test("4: crash tolerance — a partial trailing line does not hide the thread from the index, read() still skips it", () => {
    mkdirSync(join(tmp.dir, "threads"), { recursive: true });
    writeFileSync(
      threadLogPath(tmp.dir, "9"),
      '{"type":"RUN_STARTED","threadId":"9"}\n{"type":"RUN_STARTED","th',
      "utf-8",
    );
    // Index half: the thread is listed despite the corrupted tail.
    expect(store.list().map((e) => e.threadId)).toEqual(["9"]);
    // Read half: the partial line is skipped, the complete one survives.
    const events = store.read("9");
    expect(events).not.toBeNull();
    expect(events!.length).toBe(1);
    expect(events![0]).toMatchObject({ type: EventType.RUN_STARTED, threadId: "9" });
  });
});
