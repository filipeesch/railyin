/**
 * import.test.ts — legacy import unit suite (IMPR-01, D-06/D-07/D-08).
 *
 * Pins the message→event mapping matrix (all MessageType branches), per-run
 * tool-call id namespacing (Pitfall 4), dangling-tool synthesis (Pitfall 6),
 * defensive tool-call JSON parsing (T-04-06), trimmed-type skipping, naive-UTC
 * timestamp normalization (Pitfall 1), idempotency + atomic-write honesty
 * (D-07, Pitfall 5), and AG-UI lifecycle validity of every built log
 * (T-04-10) — the proven cold-replay pipeline is the consumer contract.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { Database } from "bun:sqlite";
import { EventType } from "@ag-ui/core";
import type { BaseEvent } from "@ag-ui/client";
import { initDb, makeTempDir } from "../test/helpers.ts";
import { JsonlStore, threadLogPath } from "./jsonl-store.ts";
import { buildThreadLog, runLegacyImport } from "./import.ts";
import type { ConversationMessageRow } from "../db/row-types.ts";

const FIXED_TS = "2026-08-09 08:00:00";
const FIXED_TS_PARSED = Date.parse("2026-08-09T08:00:00Z");

let rowSeq = 0;
/** Pure row-helper for buildThreadLog tests — no DB involved. */
function row(partial: Partial<ConversationMessageRow>): ConversationMessageRow {
    rowSeq += 1;
    return {
        id: rowSeq,
        task_id: null,
        conversation_id: 7,
        type: "user",
        role: "user",
        content: "hello",
        metadata: null,
        created_at: FIXED_TS,
        ...partial,
    };
}

function toolCallContent(id: string, name = "shell", args = "{}"): string {
    return JSON.stringify({ id, function: { name, arguments: args } });
}

function toolResultContent(toolUseId: string, content: string): string {
    return JSON.stringify({ tool_use_id: toolUseId, content });
}

/**
 * Lifecycle scan (Pitfall 6 / T-04-10): every run has exactly one terminal;
 * every opened TEXT/REASONING/TOOL block is closed before that terminal;
 * every started tool call is both ended and resolved before the terminal.
 */
function assertLifecycleValid(events: BaseEvent[]) {
    const runs = new Map<
        string,
        {
            started: number;
            finished: number;
            openText: string[];
            openReasoning: string[];
            startedTools: string[];
            endedTools: Set<string>;
            resultTools: Set<string>;
        }
    >();
    let current: (typeof runs extends Map<string, infer V> ? V : never) | null = null;
    for (const event of events) {
        const e = event as BaseEvent & { runId?: string; messageId?: string; toolCallId?: string };
        switch (e.type) {
            case EventType.RUN_STARTED: {
                expect(runs.has(e.runId!)).toBe(false); // no duplicate run ids
                current = {
                    started: 1,
                    finished: 0,
                    openText: [],
                    openReasoning: [],
                    startedTools: [],
                    endedTools: new Set(),
                    resultTools: new Set(),
                };
                runs.set(e.runId!, current);
                break;
            }
            case EventType.RUN_FINISHED: {
                const run = runs.get(e.runId!);
                expect(run).toBeDefined();
                expect(run!.finished).toBe(0); // exactly one terminal per run
                run!.finished = 1;
                expect(run!.openText).toHaveLength(0); // no open TEXT block
                expect(run!.openReasoning).toHaveLength(0); // no open REASONING block
                expect(run!.endedTools.size).toBe(run!.startedTools.length); // every tool ENDed
                expect(run!.resultTools.size).toBe(run!.startedTools.length); // every tool RESULTed
                break;
            }
            case EventType.TEXT_MESSAGE_START: {
                current?.openText.push(e.messageId!);
                break;
            }
            case EventType.TEXT_MESSAGE_END: {
                const idx = current?.openText.lastIndexOf(e.messageId!) ?? -1;
                expect(idx).not.toBe(-1); // END only for an open block
                current?.openText.splice(idx, 1);
                break;
            }
            case EventType.REASONING_MESSAGE_START: {
                current?.openReasoning.push(e.messageId!);
                break;
            }
            case EventType.REASONING_MESSAGE_END: {
                const idx = current?.openReasoning.lastIndexOf(e.messageId!) ?? -1;
                expect(idx).not.toBe(-1);
                current?.openReasoning.splice(idx, 1);
                break;
            }
            case EventType.TOOL_CALL_START: {
                current?.startedTools.push(e.toolCallId!);
                break;
            }
            case EventType.TOOL_CALL_END: {
                current?.endedTools.add(e.toolCallId!);
                break;
            }
            case EventType.TOOL_CALL_RESULT: {
                current?.resultTools.add(e.toolCallId!);
                break;
            }
            default:
                break;
        }
    }
    expect(runs.size).toBeGreaterThan(0);
    for (const run of runs.values()) {
        expect(run.started).toBe(1);
        expect(run.finished).toBe(1);
    }
}

describe("buildThreadLog — message→event mapping (IMPR-01, Pattern 3)", () => {
    beforeEach(() => {
        rowSeq = 0;
    });

    test("1: full type matrix — user/assistant/reasoning/tool_call/tool_result map to the exact event sequences", () => {
        const rows: ConversationMessageRow[] = [
            row({ id: 1, type: "user", role: "user", content: "first turn" }),
            row({ id: 2, type: "assistant", role: "assistant", content: "Hello!" }),
            row({ id: 3, type: "reasoning", role: "assistant", content: "thinking…" }),
            row({ id: 4, type: "tool_call", role: "assistant", content: toolCallContent("call_1", "shell", '{"cmd":"ls"}') }),
            row({ id: 5, type: "tool_result", role: "tool", content: toolResultContent("call_1", "file list") }),
            row({ id: 6, type: "user", role: "user", content: "second turn" }),
        ];
        const { events, malformed } = buildThreadLog("7", rows);
        expect(malformed).toBe(0);

        expect(events.map((e) => e.type)).toEqual([
            EventType.RUN_STARTED,
            EventType.TEXT_MESSAGE_START,
            EventType.TEXT_MESSAGE_CONTENT,
            EventType.TEXT_MESSAGE_END,
            EventType.REASONING_MESSAGE_START,
            EventType.REASONING_MESSAGE_CONTENT,
            EventType.REASONING_MESSAGE_END,
            EventType.TOOL_CALL_START,
            EventType.TOOL_CALL_ARGS,
            EventType.TOOL_CALL_END,
            EventType.TOOL_CALL_RESULT,
            EventType.RUN_FINISHED,
            EventType.RUN_STARTED,
            EventType.RUN_FINISHED,
        ]);

        // Run 1 boundaries: RUN_STARTED with the user input first, RUN_FINISHED last.
        const run1Start = events[0] as unknown as { runId: string; input: { messages: { id: string; role: string; content: string }[] } };
        expect(run1Start.runId).toBe("import-7-1");
        expect(run1Start.input.messages).toEqual([{ id: "legacy-1", role: "user", content: "first turn" }]);
        expect(events[11]).toMatchObject({ type: EventType.RUN_FINISHED, runId: "import-7-1", result: null });

        // Assistant text block.
        expect(events[1]).toMatchObject({ type: EventType.TEXT_MESSAGE_START, messageId: "import-7-1-text-1", role: "assistant" });
        expect(events[2]).toMatchObject({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: "import-7-1-text-1", delta: "Hello!" });
        expect(events[3]).toMatchObject({ type: EventType.TEXT_MESSAGE_END, messageId: "import-7-1-text-1" });

        // Reasoning block (role "reasoning").
        expect(events[4]).toMatchObject({ type: EventType.REASONING_MESSAGE_START, messageId: "import-7-1-reasoning-1", role: "reasoning" });
        expect(events[5]).toMatchObject({ type: EventType.REASONING_MESSAGE_CONTENT, messageId: "import-7-1-reasoning-1", delta: "thinking…" });
        expect(events[6]).toMatchObject({ type: EventType.REASONING_MESSAGE_END, messageId: "import-7-1-reasoning-1" });

        // Tool call trio + result (messageId convention `${toolCallId}-result`, role tool).
        expect(events[7]).toMatchObject({ type: EventType.TOOL_CALL_START, toolCallId: "import-7-1-call_1", toolCallName: "shell" });
        expect(events[8]).toMatchObject({ type: EventType.TOOL_CALL_ARGS, toolCallId: "import-7-1-call_1", delta: '{"cmd":"ls"}' });
        expect(events[9]).toMatchObject({ type: EventType.TOOL_CALL_END, toolCallId: "import-7-1-call_1" });
        expect(events[10]).toMatchObject({
            type: EventType.TOOL_CALL_RESULT,
            toolCallId: "import-7-1-call_1",
            messageId: "import-7-1-call_1-result",
            content: "file list",
            role: "tool",
        });

        // Run 2: second user turn only.
        const run2Start = events[12] as unknown as {
            runId: string;
            input: { messages: { id: string; role: string; content: string }[] };
        };
        expect(run2Start.runId).toBe("import-7-2");
        expect(run2Start.input.messages).toEqual([{ id: "legacy-6", role: "user", content: "second turn" }]);
        expect(events[13]).toMatchObject({ type: EventType.RUN_FINISHED, runId: "import-7-2", result: null });
    });

    test("2: a system row before the first user attaches to the FIRST run's input only", () => {
        const rows = [
            row({ id: 1, type: "system", role: "system", content: "task description seed" }),
            row({ id: 2, type: "user", role: "user", content: "go" }),
            row({ id: 3, type: "assistant", role: "assistant", content: "ok" }),
            row({ id: 4, type: "user", role: "user", content: "again" }),
        ];
        const { events } = buildThreadLog("7", rows);
        const starts = events.filter((e) => e.type === EventType.RUN_STARTED) as unknown as {
            input: { messages: { id: string; role: string; content: string }[] };
        }[];
        expect(starts).toHaveLength(2);
        expect(starts[0].input.messages).toEqual([
            { id: "legacy-1", role: "system", content: "task description seed" },
            { id: "legacy-2", role: "user", content: "go" },
        ]);
        // The second run does NOT inherit the system row.
        expect(starts[1].input.messages).toEqual([{ id: "legacy-4", role: "user", content: "again" }]);
    });

    test("3: empty assistant content emits no TEXT block; the 7 trimmed types are skipped entirely", () => {
        const rows = [
            row({ id: 1, type: "user", role: "user", content: "go" }),
            row({ id: 2, type: "assistant", role: "assistant", content: "" }),
            row({ id: 3, type: "transition_event", role: null, content: "{}" }),
            row({ id: 4, type: "compaction_summary", role: null, content: "{}" }),
            row({ id: 5, type: "status", role: null, content: "{}" }),
            row({ id: 6, type: "file_diff", role: null, content: "{}" }),
            row({ id: 7, type: "code_review", role: null, content: "{}" }),
            row({ id: 8, type: "ask_user_prompt", role: null, content: "{}" }),
            row({ id: 9, type: "decision_request_prompt", role: null, content: "{}" }),
            row({ id: 10, type: "assistant", role: "assistant", content: "real reply" }),
        ];
        const { events } = buildThreadLog("7", rows);
        // Only RUN_STARTED, ONE TEXT block (the non-empty assistant row), RUN_FINISHED.
        expect(events.map((e) => e.type)).toEqual([
            EventType.RUN_STARTED,
            EventType.TEXT_MESSAGE_START,
            EventType.TEXT_MESSAGE_CONTENT,
            EventType.TEXT_MESSAGE_END,
            EventType.RUN_FINISHED,
        ]);
        expect(events[2]).toMatchObject({ type: EventType.TEXT_MESSAGE_CONTENT, delta: "real reply" });
    });

    test("4: per-run namespacing — reused raw call ids cannot collide across runs (Pitfall 4)", () => {
        const rows = [
            row({ id: 1, type: "user", role: "user", content: "turn 1" }),
            row({ id: 2, type: "tool_call", role: "assistant", content: toolCallContent("call_0") }),
            row({ id: 3, type: "tool_result", role: "tool", content: toolResultContent("call_0", "r1") }),
            row({ id: 4, type: "user", role: "user", content: "turn 2" }),
            row({ id: 5, type: "tool_call", role: "assistant", content: toolCallContent("call_0") }),
            row({ id: 6, type: "tool_result", role: "tool", content: toolResultContent("call_0", "r2") }),
        ];
        const { events } = buildThreadLog("7", rows);
        const calls = events.filter((e) => e.type === EventType.TOOL_CALL_START) as unknown as { toolCallId: string }[];
        expect(calls.map((c) => c.toolCallId)).toEqual(["import-7-1-call_0", "import-7-2-call_0"]);
        const results = events.filter((e) => e.type === EventType.TOOL_CALL_RESULT) as unknown as { toolCallId: string; messageId: string }[];
        expect(results.map((r) => r.toolCallId)).toEqual(["import-7-1-call_0", "import-7-2-call_0"]);
        // The run-2 RESULT resolves to run 2's namespaced id (messageId convention).
        expect(results[1].messageId).toBe("import-7-2-call_0-result");
    });

    test("5: a dangling tool_call (no following tool_result) gets a synthesized empty TOOL_CALL_RESULT before that run's RUN_FINISHED (Pitfall 6)", () => {
        const rows = [
            row({ id: 1, type: "user", role: "user", content: "go" }),
            row({ id: 2, type: "tool_call", role: "assistant", content: toolCallContent("call_9") }),
            row({ id: 3, type: "user", role: "user", content: "next turn" }),
        ];
        const { events } = buildThreadLog("7", rows);
        const finish1 = events.findIndex((e) => e.type === EventType.RUN_FINISHED);
        expect(finish1).not.toBe(-1);
        // The synthesized result sits IMMEDIATELY before run 1's terminal.
        expect(events[finish1 - 1]).toMatchObject({
            type: EventType.TOOL_CALL_RESULT,
            toolCallId: "import-7-1-call_9",
            messageId: "import-7-1-call_9-result",
            content: "",
        });
        // Run 2 stays clean.
        expect(events[events.length - 1]).toMatchObject({ type: EventType.RUN_FINISHED, runId: "import-7-2" });
    });

    test("6: malformed tool-call JSON is skipped + counted, never thrown; other rows still convert (T-04-06)", () => {
        const rows = [
            row({ id: 1, type: "user", role: "user", content: "go" }),
            row({ id: 2, type: "assistant", role: "assistant", content: "fine" }),
            row({ id: 3, type: "tool_call", role: "assistant", content: "not-json" }),
            row({ id: 4, type: "tool_call", role: "assistant", content: JSON.stringify({ id: 123, function: { name: "shell" } }) }), // id not a string
            row({ id: 5, type: "tool_call", role: "assistant", content: JSON.stringify({ id: "c1" }) }), // missing function
            row({ id: 6, type: "tool_result", role: "tool", content: JSON.stringify({ content: "x" }) }), // missing tool_use_id
            row({ id: 7, type: "user", role: "user", content: "again" }),
        ];
        const { events, malformed } = buildThreadLog("7", rows);
        expect(malformed).toBe(4);
        // The assistant text block still converts; no TOOL_CALL events at all.
        expect(events.some((e) => e.type === EventType.TEXT_MESSAGE_CONTENT && e.delta === "fine")).toBe(true);
        expect(events.some((e) => e.type === EventType.TOOL_CALL_START)).toBe(false);
        // Both runs still close cleanly.
        expect(events.filter((e) => e.type === EventType.RUN_FINISHED)).toHaveLength(2);
    });

    test("7: naive-UTC created_at normalizes to an epoch timestamp on the events (Pitfall 1)", () => {
        const rows = [row({ id: 1, type: "user", role: "user", content: "go", created_at: FIXED_TS })];
        const { events } = buildThreadLog("7", rows);
        expect(events[0]).toMatchObject({ type: EventType.RUN_STARTED, timestamp: FIXED_TS_PARSED });
        expect(events[events.length - 1]).toMatchObject({ type: EventType.RUN_FINISHED, timestamp: FIXED_TS_PARSED });
    });

    test("8: every built log is lifecycle-valid — one terminal per run, every opened block closed before it (T-04-10)", () => {
        const rows = [
            row({ id: 1, type: "user", role: "user", content: "turn 1" }),
            row({ id: 2, type: "assistant", role: "assistant", content: "hello" }),
            row({ id: 3, type: "reasoning", role: "assistant", content: "hmm" }),
            row({ id: 4, type: "tool_call", role: "assistant", content: toolCallContent("call_1") }),
            row({ id: 5, type: "tool_call", role: "assistant", content: toolCallContent("call_2", "bash") }),
            row({ id: 6, type: "tool_result", role: "tool", content: toolResultContent("call_1", "r1") }),
            // call_2 dangles across the user boundary → synthesized in run 1
            row({ id: 7, type: "user", role: "user", content: "turn 2" }),
            row({ id: 8, type: "assistant", role: "assistant", content: "again" }),
        ];
        const { events } = buildThreadLog("7", rows);
        assertLifecycleValid(events);
    });
});

describe("runLegacyImport — idempotency + atomicity (D-07, Pitfall 5)", () => {
    let db: Database;
    let tmp: { dir: string; cleanup: () => void };
    let store: JsonlStore;

    beforeEach(() => {
        db = initDb();
        tmp = makeTempDir();
        store = new JsonlStore(tmp.dir);
    });

    afterEach(() => {
        tmp.cleanup();
    });

    test("9: second run imports 0 and skips all; a simulated crash artifact (.tmp) is ignored and never breaks the marker", async () => {
        const conv = db.query("INSERT INTO conversations (task_id) VALUES (NULL)").run();
        const convId = String(conv.lastInsertRowid);
        db.query("INSERT INTO conversation_messages (conversation_id, type, role, content, metadata, created_at) VALUES (?, 'user', 'user', 'go', NULL, ?)").run(
            Number(convId),
            FIXED_TS,
        );
        db.query("INSERT INTO conversation_messages (conversation_id, type, role, content, metadata, created_at) VALUES (?, 'assistant', 'assistant', 'ok', NULL, ?)").run(
            Number(convId),
            FIXED_TS,
        );

        const first = await runLegacyImport(db, store);
        expect(first).toEqual({ total: 1, imported: 1, skipped: 0, failed: 0, errors: [] });
        expect(store.exists(convId)).toBe(true);

        // Simulated crash artifact: a leftover partial .tmp file.
        writeFileSync(threadLogPath(tmp.dir, convId) + ".tmp", '{"type":"RUN_STARTED"', "utf-8");

        // list() ignores the .tmp; exists() still reports the REAL thread.
        expect(store.list().map((e) => e.threadId)).toEqual([convId]);
        expect(store.exists(convId)).toBe(true);

        // Re-import: the marker holds — nothing duplicated, nothing failed.
        const second = await runLegacyImport(db, store);
        expect(second).toEqual({ total: 1, imported: 0, skipped: 1, failed: 0, errors: [] });
    });

    test("10: the import path never writes to the legacy tables — row counts identical (IMPR-02, D-08)", async () => {
        const conv = db.query("INSERT INTO conversations (task_id) VALUES (NULL)").run();
        const convId = String(conv.lastInsertRowid);
        db.query("INSERT INTO conversation_messages (conversation_id, type, role, content, metadata, created_at) VALUES (?, 'user', 'user', 'go', NULL, ?)").run(
            Number(convId),
            FIXED_TS,
        );
        db.query("INSERT INTO conversation_messages (conversation_id, type, role, content, metadata, created_at) VALUES (?, 'assistant', 'assistant', 'ok', NULL, ?)").run(
            Number(convId),
            FIXED_TS,
        );

        const messagesBefore = (db.query("SELECT COUNT(*) AS n FROM conversation_messages").get() as { n: number }).n;
        const conversationsBefore = (db.query("SELECT COUNT(*) AS n FROM conversations").get() as { n: number }).n;

        await runLegacyImport(db, store);

        const messagesAfter = (db.query("SELECT COUNT(*) AS n FROM conversation_messages").get() as { n: number }).n;
        const conversationsAfter = (db.query("SELECT COUNT(*) AS n FROM conversations").get() as { n: number }).n;
        expect(messagesAfter).toBe(messagesBefore);
        expect(conversationsAfter).toBe(conversationsBefore);
    });
});
