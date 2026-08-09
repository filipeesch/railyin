/**
 * import.ts — on-demand legacy import (IMPR-01, D-06/D-07/D-08).
 *
 * Pure module: `buildThreadLog` maps frozen `conversation_messages` rows to
 * the AG-UI JSONL shape the runner's proven cold-replay pipeline accepts
 * (one synthetic run per user message — Pattern 3), and `runLegacyImport`
 * orchestrates the per-conversation conversion with atomic whole-file writes.
 *
 * - The log IS the idempotency marker: `store.exists(threadId)` skips an
 *   already-imported thread, and that marker is only trustworthy because the
 *   write is atomic (tmp+rename, Pattern 2 — Pitfall 5).
 * - Legacy tables stay frozen (IMPR-02/D-08): only parameterized SELECTs,
 *   never writes, never schema changes, never drops.
 * - A bad row never aborts the per-conversation loop (T-04-06): malformed
 *   tool-call JSON is skipped + counted, one failing conversation is
 *   recorded in `errors` and the import continues.
 * - The imported log never violates AG-UI lifecycle rules (Pitfall 6):
 *   every opened TEXT/REASONING/TOOL block is closed before the run's
 *   RUN_FINISHED, dangling tool calls get synthesized empty results, and
 *   toolCallIds are namespaced per run (`${runId}-${callId}` — Pitfall 4).
 * - Naive-UTC SQLite timestamps are normalized (Pitfall 1) and attached as
 *   optional event timestamps so threads.list can derive createdAt.
 */
import { EventType } from "@ag-ui/core";
import type { BaseEvent } from "@ag-ui/client";
import type { Database } from "bun:sqlite";
import type { ImportSummary } from "../../shared/rpc-types.ts";
import type { ConversationMessageRow } from "../db/row-types.ts";
import type { JsonlStore } from "./jsonl-store.ts";
import { ThreadLogExistsError } from "./jsonl-store.ts";

/** Message types trimmed from the new stack (REQUIREMENTS.md Out of Scope) —
 * skipped entirely, never mapped. */
const TRIMMED_TYPES = new Set([
    "transition_event",
    "compaction_summary",
    "status",
    "file_diff",
    "code_review",
    "ask_user_prompt",
    "decision_request_prompt",
]);

export interface BuildThreadLogResult {
    events: BaseEvent[];
    /** Count of malformed tool-call/tool-result rows skipped defensively (T-04-06). */
    malformed: number;
}

/** Pitfall 1: SQLite `datetime('now')` emits naive-UTC strings; JS Date.parse
 * assumes local time without the `Z`. Normalize before parsing; NaN (defensive)
 * yields undefined → the event carries no timestamp. */
function normalizeTimestamp(createdAt: string): number | undefined {
    const parsed = Date.parse(createdAt.replace(" ", "T") + "Z");
    return Number.isNaN(parsed) ? undefined : parsed;
}

/** TOOL_CALL_RESULT with the REQUIRED messageId convention
 * (`${toolCallId}-result`, role "tool" — event-bridge.ts:63-72). */
function toolResultEvent(toolCallId: string, content: string, timestamp?: number): BaseEvent {
    return {
        type: EventType.TOOL_CALL_RESULT,
        toolCallId,
        messageId: `${toolCallId}-result`,
        content,
        role: "tool",
        ...(timestamp !== undefined ? { timestamp } : {}),
    };
}

/** Defensive parse of legacy tool_call content JSON
 * `{id, function: {name, arguments}}` (WR-05 precedent — skip, never crash). */
function parseToolCall(content: string): { id: string; name: string; arguments: string } | null {
    let raw: unknown = null;
    try {
        raw = JSON.parse(content);
    } catch {
        return null;
    }
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
    const o = raw as { id?: unknown; function?: { name?: unknown; arguments?: unknown } };
    if (typeof o.id !== "string" || o.function === undefined || typeof o.function.name !== "string") {
        return null;
    }
    const args = typeof o.function.arguments === "string" ? o.function.arguments : JSON.stringify(o.function.arguments ?? {});
    return { id: o.id, name: o.function.name, arguments: args };
}

/** Defensive parse of legacy tool_result content JSON `{tool_use_id, content}`. */
function parseToolResult(content: string): { toolUseId: string; content: string } | null {
    let raw: unknown = null;
    try {
        raw = JSON.parse(content);
    } catch {
        return null;
    }
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
    const o = raw as { tool_use_id?: unknown; content?: unknown };
    if (typeof o.tool_use_id !== "string") return null;
    const resultContent = typeof o.content === "string" ? o.content : JSON.stringify(o.content ?? "");
    return { toolUseId: o.tool_use_id, content: resultContent };
}

/**
 * Map legacy message rows to AG-UI events (Pattern 3): one synthetic run per
 * user message (`runId = import-${threadId}-${n}`), system rows attached to
 * a run's input — leading rows to the FIRST run's input, rows arriving while
 * a run is open to the NEXT run's input, and rows still pending when the
 * last run closes (trailing "execution failed"-style markers) to THAT run's
 * input (WR-04 — never silently dropped). RUN_STARTED-with-input first and
 * RUN_FINISHED {result: null} last per run. A conversation with only system
 * rows (no user message) forms no run and is skipped by the caller. Pure —
 * no DB, no fs, no I/O.
 */
export function buildThreadLog(threadId: string, rows: ConversationMessageRow[]): BuildThreadLogResult {
    const events: BaseEvent[] = [];
    let malformed = 0;

    let runIndex = 0;
    let textSeq = 0;
    let reasoningSeq = 0;
    let openToolCallIds = new Set<string>();
    // System rows awaiting attachment: leading rows (before any user message)
    // attach to run 1's input; rows arriving while a run is open attach to the
    // NEXT run's input (they precede that run's user turn chronologically);
    // rows still pending when the last run closes (trailing markers) attach to
    // that run's input (WR-04).
    const pendingSystem: Array<{ id: string; content: string }> = [];
    let lastTimestamp: number | undefined;

    // The run currently being built. Its body events are buffered and the
    // whole run is emitted by closeRun(), so RUN_STARTED's input can include
    // system rows that arrive before the run closes (WR-04).
    let openRun: {
        runId: string;
        inputSystems: Array<{ id: string; role: "system"; content: string }>;
        userMessage: { id: string; role: "user"; content: string };
        body: BaseEvent[];
        timestamp?: number;
    } | null = null;

    /** Close the current run: fold any still-pending system rows into its
     * input when this is the final close (WR-04), synthesize dangling tool
     * results (Pitfall 6), then the single terminal. */
    function closeRun(final = false): void {
        if (!openRun) return;
        if (final && pendingSystem.length > 0) {
            // Trailing system rows — there is no next run to inherit them, so
            // attach them to THIS run's input instead of dropping them.
            for (const s of pendingSystem) {
                openRun.inputSystems.push({ id: s.id, role: "system", content: s.content });
            }
            pendingSystem.length = 0;
        }
        for (const toolCallId of [...openToolCallIds]) {
            openRun.body.push(toolResultEvent(toolCallId, "", lastTimestamp));
        }
        openToolCallIds.clear();
        events.push({
            type: EventType.RUN_STARTED,
            threadId,
            runId: openRun.runId,
            input: { threadId, runId: openRun.runId, state: null, messages: [...openRun.inputSystems, openRun.userMessage] },
            ...(openRun.timestamp !== undefined ? { timestamp: openRun.timestamp } : {}),
        });
        events.push(...openRun.body);
        events.push({
            type: EventType.RUN_FINISHED,
            threadId,
            runId: openRun.runId,
            result: null,
            ...(lastTimestamp !== undefined ? { timestamp: lastTimestamp } : {}),
        });
        openRun = null;
    }

    for (const row of rows) {
        const timestamp = normalizeTimestamp(row.created_at);
        if (timestamp !== undefined) lastTimestamp = timestamp;

        switch (row.type) {
            case "user": {
                closeRun();
                runIndex += 1;
                textSeq = 0;
                reasoningSeq = 0;
                // Snapshot the system rows seen so far into THIS run's input;
                // rows arriving while this run is open attach to the next
                // run's input instead (they precede its user turn).
                const inputSystems: Array<{ id: string; role: "system"; content: string }> = [];
                for (const s of pendingSystem) {
                    inputSystems.push({ id: s.id, role: "system", content: s.content });
                }
                pendingSystem.length = 0;
                openRun = {
                    runId: `import-${threadId}-${runIndex}`,
                    inputSystems,
                    userMessage: { id: `legacy-${row.id}`, role: "user", content: row.content },
                    body: [],
                    ...(timestamp !== undefined ? { timestamp } : {}),
                };
                break;
            }

            case "system": {
                // Leading rows → run 1's input; rows while a run is open →
                // the NEXT run's input; rows pending at the final closeRun →
                // the last run's input (WR-04 — never silently dropped).
                pendingSystem.push({ id: `legacy-${row.id}`, content: row.content });
                break;
            }

            case "assistant": {
                if (!openRun || !row.content) break; // no open run / empty content → no TEXT block
                textSeq += 1;
                const messageId = `${openRun.runId}-text-${textSeq}`;
                openRun.body.push(
                    { type: EventType.TEXT_MESSAGE_START, messageId, role: "assistant", ...(timestamp !== undefined ? { timestamp } : {}) },
                    { type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: row.content, ...(timestamp !== undefined ? { timestamp } : {}) },
                    { type: EventType.TEXT_MESSAGE_END, messageId, ...(timestamp !== undefined ? { timestamp } : {}) },
                );
                break;
            }

            case "reasoning": {
                if (!openRun || !row.content) break;
                reasoningSeq += 1;
                const messageId = `${openRun.runId}-reasoning-${reasoningSeq}`;
                openRun.body.push(
                    { type: EventType.REASONING_MESSAGE_START, messageId, role: "reasoning", ...(timestamp !== undefined ? { timestamp } : {}) },
                    { type: EventType.REASONING_MESSAGE_CONTENT, messageId, delta: row.content, ...(timestamp !== undefined ? { timestamp } : {}) },
                    { type: EventType.REASONING_MESSAGE_END, messageId, ...(timestamp !== undefined ? { timestamp } : {}) },
                );
                break;
            }

            case "tool_call": {
                if (!openRun) break;
                const parsed = parseToolCall(row.content);
                if (!parsed) {
                    malformed += 1; // T-04-06: skip + count, never crash the loop
                    break;
                }
                const toolCallId = `${openRun.runId}-${parsed.id}`; // Pitfall 4: per-run namespacing
                openToolCallIds.add(toolCallId);
                openRun.body.push(
                    { type: EventType.TOOL_CALL_START, toolCallId, toolCallName: parsed.name, ...(timestamp !== undefined ? { timestamp } : {}) },
                    { type: EventType.TOOL_CALL_ARGS, toolCallId, delta: parsed.arguments, ...(timestamp !== undefined ? { timestamp } : {}) },
                    { type: EventType.TOOL_CALL_END, toolCallId, ...(timestamp !== undefined ? { timestamp } : {}) },
                );
                break;
            }

            case "tool_result": {
                if (!openRun) break;
                const parsed = parseToolResult(row.content);
                if (!parsed) {
                    malformed += 1;
                    break;
                }
                const toolCallId = `${openRun.runId}-${parsed.toolUseId}`;
                if (!openToolCallIds.has(toolCallId)) break; // orphan (no START this run) — skip defensively
                openToolCallIds.delete(toolCallId);
                openRun.body.push(toolResultEvent(toolCallId, parsed.content, timestamp));
                break;
            }

            default: {
                if (TRIMMED_TYPES.has(row.type)) break; // feature-trimmed types: skipped entirely
                break; // unknown types: skip defensively (T-04-06)
            }
        }
    }
    closeRun(true); // final: trailing system rows attach to the last run (WR-04)
    return { events, malformed };
}

/**
 * Convert every conversation that has messages into a JSONL thread
 * (threadId = conversations.id), skipping already-imported ones via the
 * store's existence marker (D-07). SELECT-only w.r.t. legacy tables (D-08);
 * one failing conversation never aborts the loop (T-04-06).
 */
export async function runLegacyImport(db: Database, store: JsonlStore): Promise<ImportSummary> {
    const convs = db.query<{ id: number }, []>(
        `SELECT DISTINCT c.id FROM conversations c
         JOIN conversation_messages m ON m.conversation_id = c.id
         ORDER BY c.id ASC`, // frozen-table reads only (IMPR-02, D-08)
    ).all();
    const summary: ImportSummary = { total: convs.length, imported: 0, skipped: 0, failed: 0, errors: [] };

    for (const conv of convs) {
        const threadId = String(conv.id);
        try {
            if (store.exists(threadId)) {
                summary.skipped += 1; // D-07 marker (trustworthy only because writes are atomic)
                continue;
            }
            const rows = db.query<ConversationMessageRow, [number]>(
                "SELECT * FROM conversation_messages WHERE conversation_id = ? ORDER BY id ASC", // parameterized (T-04-08)
            ).all(conv.id);
            const { events } = buildThreadLog(threadId, rows);
            if (events.length === 0) {
                summary.skipped += 1;
                continue;
            }
            store.importLog(threadId, events); // atomic no-clobber publish (Pattern 2, WR-02)
            summary.imported += 1;
        } catch (err) {
            if (err instanceof ThreadLogExistsError) {
                // WR-02: the log appeared between our exists() check and the
                // publish (live-runner append / concurrent import) — the D-07
                // marker now exists, so this is a skip, never a failure.
                summary.skipped += 1;
                continue;
            }
            summary.failed += 1;
            summary.errors.push(`${threadId}: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    return summary;
}
