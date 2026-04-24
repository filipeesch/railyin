import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";
import type { ConversationMessage, StreamEvent, Task } from "../../../shared/rpc-types.ts";
import { taskHandlers } from "../../handlers/tasks.ts";
import { Orchestrator } from "../../engine/orchestrator.ts";
import type { ExecutionEngine } from "../../engine/types.ts";
import { StreamBatcher } from "../../pipeline/batcher.ts";
import { appendStreamEventBatch } from "../../db/stream-events.ts";
import type { PersistedStreamEvent } from "../../db/stream-events.ts";
import { initDb, seedProjectAndTask, setupTestConfig } from "../helpers.ts";
import { CallbackRecorder } from "./callback-recorder.ts";

type TaskHandlersMap = ReturnType<typeof taskHandlers>;

interface EngineFactoryCallbacks {
    onTaskUpdated: (task: Task) => void;
    onNewMessage: (message: ConversationMessage) => void;
}

export interface BackendRpcRuntime {
    db: Database;
    handlers: TaskHandlersMap;
    recorder: CallbackRecorder;
    gitDir: string;
    cleanup: () => void;
    createTask: (model?: string) => Promise<{ taskId: number; conversationId: number }>;
    getMessages: (taskId: number) => Array<{ type: string; role: string | null; content: string }>;
    getTaskState: (taskId: number) => string | null;
    getExecutionStatus: (executionId: number) => string | null;
    waitForExecutionStatus: (executionId: number, status: string, timeoutMs?: number) => Promise<void>;
    waitForTaskState: (taskId: number, state: string, timeoutMs?: number) => Promise<void>;
    /** All StreamEvents delivered to IPC immediately (all types). */
    getIpcEvents: (executionId: number) => StreamEvent[];
    /** StreamEvents written to DB (persisted types only, after batcher flush). */
    getDbStreamEvents: (executionId: number) => PersistedStreamEvent[];
    /** Wait until a persisted event of `type` appears in DB for this execution. */
    waitForDbStreamEvent: (executionId: number, type: string, timeoutMs?: number) => Promise<PersistedStreamEvent>;
    /** Poll until predicate returns true (useful for asserting async side-effects after cancellation). */
    waitFor: (predicate: () => boolean, description?: string, timeoutMs?: number) => Promise<void>;
}

async function waitUntil(predicate: () => boolean, description: string, timeoutMs = 5_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Timed out waiting for ${description}`);
}

export function createBackendRpcRuntime(options: {
    createEngine: (callbacks: EngineFactoryCallbacks) => ExecutionEngine;
    taskModel?: string;
}): BackendRpcRuntime {
    const db = initDb();
    const cfg = setupTestConfig();
    const gitDir = mkdtempSync(join(tmpdir(), "railyn-backend-"));
    execSync("git init", { cwd: gitDir });
    execSync('git config user.email "t@t.com"', { cwd: gitDir });
    execSync('git config user.name "T"', { cwd: gitDir });
    writeFileSync(join(gitDir, "README.md"), "hello\n");
    execSync("git add . && git commit -m init", { cwd: gitDir });

    const recorder = new CallbackRecorder();

    // ── Two-channel IPC simulation ──────────────────────────────────────────
    // ipcEvents: every event delivered immediately (mirrors what frontend receives in real-time)
    // DB:        persisted events written by batcher.flush() (500ms or forced)
    const ipcEvents: StreamEvent[] = [];
    const batchers = new Map<number, StreamBatcher>();

    function getOrCreateBatcher(conversationId: number, executionId: number): StreamBatcher {
        const existing = batchers.get(executionId);
        if (existing) return existing;
        const batcher = new StreamBatcher(conversationId, executionId, (events) => {
            // DB write only — no IPC here (IPC is done immediately in onStreamEvent)
            const persisted = events.filter((e) =>
                ["user", "assistant", "reasoning", "tool_call", "tool_result", "file_diff", "system"].includes(e.type),
            );
            if (persisted.length > 0) {
                appendStreamEventBatch(persisted.map((e) => ({
                    conversationId: e.conversationId,
                    executionId: e.executionId,
                    seq: e.seq,
                    blockId: e.blockId,
                    type: e.type,
                    content: e.content,
                    metadata: e.metadata,
                    parentBlockId: e.parentBlockId,
                    subagentId: e.subagentId,
                })));
            }
        });
        batcher.start();
        batchers.set(executionId, batcher);
        return batcher;
    }

    const engine = options.createEngine({
        onTaskUpdated: recorder.recordTaskUpdate,
        onNewMessage: recorder.recordNewMessage,
    });

    const coordinator = new Orchestrator(
        engine,
        recorder.recordError,
        recorder.recordTaskUpdate,
        recorder.recordNewMessage,
    );

    coordinator.setOnStreamEvent((event: StreamEvent) => {
        recorder.recordStreamEvent(event);
        // ALL events go to IPC immediately
        ipcEvents.push(event);
        // ALL events also go to batcher (for DB writes)
        const batcher = getOrCreateBatcher(event.conversationId, event.executionId);
        batcher.push({
            type: event.type,
            content: event.content,
            metadata: event.metadata,
            parentBlockId: event.parentBlockId,
            subagentId: event.subagentId,
            done: event.done,
            blockId: event.blockId,
        });
        if (event.done) {
            batchers.delete(event.executionId);
        }
    });

    const handlers = taskHandlers(coordinator, recorder.recordTaskUpdate, recorder.recordNewMessage);

    return {
        db,
        handlers,
        recorder,
        gitDir,
        cleanup: () => {
            for (const batcher of batchers.values()) batcher.stop();
            batchers.clear();
            rmSync(gitDir, { recursive: true, force: true });
            cfg.cleanup();
        },
        createTask: async (model = options.taskModel ?? "copilot/mock-model") => {
            const { taskId, conversationId } = seedProjectAndTask(db, gitDir);
            db.run("DELETE FROM task_git_context WHERE task_id = ?", [taskId]);
            db.run(
                `INSERT INTO task_git_context (task_id, git_root_path, worktree_path, worktree_status, branch_name)
         VALUES (?, ?, ?, 'ready', 'test-branch')`,
                [taskId, gitDir, gitDir],
            );
            db.run("UPDATE tasks SET model = ?, workflow_state = 'plan', execution_state = 'idle' WHERE id = ?", [model, taskId]);
            db.run(
                "INSERT OR IGNORE INTO enabled_models (workspace_key, qualified_model_id) VALUES ('default', ?)",
                [model],
            );
            return { taskId, conversationId };
        },
        getMessages: (taskId: number) => db
            .query<{ type: string; role: string | null; content: string }, [number]>(
                "SELECT type, role, content FROM conversation_messages WHERE task_id = ? ORDER BY id ASC",
            )
            .all(taskId),
        getTaskState: (taskId: number) => db
            .query<{ execution_state: string | null }, [number]>("SELECT execution_state FROM tasks WHERE id = ?")
            .get(taskId)?.execution_state ?? null,
        getExecutionStatus: (executionId: number) => db
            .query<{ status: string | null }, [number]>("SELECT status FROM executions WHERE id = ?")
            .get(executionId)?.status ?? null,
        waitForExecutionStatus: async (executionId: number, status: string, timeoutMs = 5_000) => {
            await waitUntil(
                () => db.query<{ status: string | null }, [number]>("SELECT status FROM executions WHERE id = ?").get(executionId)?.status === status,
                `execution ${executionId} status ${status}`,
                timeoutMs,
            );
        },
        waitForTaskState: async (taskId: number, state: string, timeoutMs = 5_000) => {
            await waitUntil(
                () => db.query<{ execution_state: string | null }, [number]>("SELECT execution_state FROM tasks WHERE id = ?").get(taskId)?.execution_state === state,
                `task ${taskId} state ${state}`,
                timeoutMs,
            );
        },
        getIpcEvents: (executionId: number) =>
            ipcEvents.filter((e) => e.executionId === executionId),
        getDbStreamEvents: (executionId: number) =>
            db.query<{
                id: number; task_id: number | null; conversation_id: number; execution_id: number; seq: number;
                block_id: string; type: string; content: string;
                metadata: string | null; parent_block_id: string | null; subagent_id: string | null; created_at: string;
            }, [number]>(
                "SELECT * FROM stream_events WHERE execution_id = ? ORDER BY seq ASC",
            ).all(executionId).map((r) => ({
                id: r.id,
                taskId: r.task_id,
                conversationId: r.conversation_id,
                executionId: r.execution_id,
                seq: r.seq,
                blockId: r.block_id,
                type: r.type,
                content: r.content,
                metadata: r.metadata,
                parentBlockId: r.parent_block_id,
                subagentId: r.subagent_id,
                createdAt: r.created_at,
            })),
        waitForDbStreamEvent: async (executionId: number, type: string, timeoutMs = 5_000) => {
            await waitUntil(
                () => db.query<{ type: string }, [number, string]>(
                    "SELECT type FROM stream_events WHERE execution_id = ? AND type = ? LIMIT 1",
                ).get(executionId, type) !== null,
                `DB stream_event type="${type}" for execution ${executionId}`,
                timeoutMs,
            );
            return db.query<{
                id: number; task_id: number; execution_id: number; seq: number;
                block_id: string; type: string; content: string;
                metadata: string | null; subagent_id: string | null; created_at: string;
            }, [number, string]>(
                "SELECT * FROM stream_events WHERE execution_id = ? AND type = ? ORDER BY seq ASC LIMIT 1",
            ).get(executionId, type)!;
        },
        waitFor: async (predicate: () => boolean, description = "condition", timeoutMs = 5_000) => {
            await waitUntil(predicate, description, timeoutMs);
        },
    };
}
