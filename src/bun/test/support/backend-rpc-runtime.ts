import type { Db } from "../../db/db.ts";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";
import type { ConversationMessage, StreamEvent, Task } from "../../../shared/rpc-types.ts";
import { taskHandlers } from "../../handlers/tasks.ts";
import { WorkspaceRepository } from "../../db/workspace-repository.ts";
import { taskGitHandlers } from "../../handlers/task-git.ts";
import { codeReviewHandlers } from "../../handlers/code-review.ts";
import { todoHandlers } from "../../handlers/todos.ts";
import { modelHandlers } from "../../handlers/models.ts";
import { engineHandlers } from "../../handlers/engine.ts";
import { Orchestrator } from "../../engine/orchestrator.ts";
import { EngineRegistry } from "../../engine/engine-registry.ts";
import type { ExecutionEngine } from "../../engine/types.ts";
import { StreamEventEnricher } from "../../pipeline/stream-event-enricher.ts";
import { WriteBuffer } from "../../pipeline/write-buffer.ts";
import { appendStreamEventBatch, type PersistedStreamEvent } from "../../db/stream-events.ts";
import { initDb, seedProjectAndTask, setupTestConfig } from "../helpers.ts";
import { CallbackRecorder } from "./callback-recorder.ts";
import { WorktreeManager } from "../../git/WorktreeManager.ts";
import { GitRepositoryManager } from "../../git/GitRepositoryManager.ts";
import { TaskGitContextRepository } from "../../db/repositories/TaskGitContextRepository.ts";
import type { IProjectResolver } from "../../git/IProjectResolver.ts";
import { getWorkspaceConfig, getDefaultWorkspaceKey } from "../../workspace-context.ts";

/** Minimal project resolver for tests — no real config lookup needed */
const TEST_PROJECT_RESOLVER: IProjectResolver = {
    getDefaultBranch: () => "main",
    getWorktreeBasePath: (_wsKey, _projectKey, gitRootPath) => `${gitRootPath}/../worktrees`,
};

type AllHandlersMap = ReturnType<typeof taskHandlers> &
    ReturnType<typeof taskGitHandlers> &
    ReturnType<typeof codeReviewHandlers> &
    ReturnType<typeof todoHandlers> &
    ReturnType<typeof modelHandlers> &
    ReturnType<typeof engineHandlers>;

interface EngineFactoryCallbacks {
    onTaskUpdated: (task: Task) => void;
    onNewMessage: (message: ConversationMessage) => void;
}

export interface BackendRpcRuntime {
    db: Db;
    handlers: AllHandlersMap;
    recorder: CallbackRecorder;
    gitDir: string;
    cleanup: () => void;
    createTask: (model?: string) => Promise<{ taskId: number; conversationId: number }>;
    getMessages: (taskId: number) => Promise<Array<{ type: string; role: string | null; content: string }>>;
    getTaskState: (taskId: number) => Promise<string | null>;
    getExecutionStatus: (executionId: number) => Promise<string | null>;
    waitForExecutionStatus: (executionId: number, status: string, timeoutMs?: number) => Promise<void>;
    waitForTaskState: (taskId: number, state: string, timeoutMs?: number) => Promise<void>;
    /** All StreamEvents delivered to IPC immediately (all types). */
    getIpcEvents: (executionId: number) => StreamEvent[];
    /** StreamEvents written to DB (persisted types only, after WriteBuffer flush). */
    getDbStreamEvents: (executionId: number) => Promise<PersistedStreamEvent[]>;
    /** Wait until a persisted event of `type` appears in DB for this execution. */
    waitForDbStreamEvent: (executionId: number, type: string, timeoutMs?: number) => Promise<PersistedStreamEvent>;
    /** Poll until predicate returns true (useful for asserting async side-effects after cancellation). */
    waitFor: (predicate: () => boolean, description?: string, timeoutMs?: number) => Promise<void>;
}

async function waitUntil(predicate: () => boolean | Promise<boolean>, description: string, timeoutMs = 5_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Timed out waiting for ${description}`);
}

export async function createBackendRpcRuntime(options: {
    createEngine: (callbacks: EngineFactoryCallbacks) => ExecutionEngine;
    taskModel?: string;
}): Promise<BackendRpcRuntime> {
    const db = await initDb();
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
    // DB:        persisted events written by stream event buffer
    const ipcEvents: StreamEvent[] = [];
    const enrichers = new Map<number, StreamEventEnricher>();
    const PERSISTED_TYPES = new Set(["user", "assistant", "reasoning", "tool_call", "tool_result", "file_diff", "system"]);
    const streamEventBuffer = new WriteBuffer<PersistedStreamEvent>({
        maxBatch: 100,
        intervalMs: 500,
        flushFn: (events) => { void appendStreamEventBatch(db, events).catch(() => {}); },
    });
    streamEventBuffer.start();

    const engine = options.createEngine({
        onTaskUpdated: recorder.recordTaskUpdate,
        onNewMessage: recorder.recordNewMessage,
    });

    const coordinator = new Orchestrator(
        db,
        new EngineRegistry(
          new Map([[getWorkspaceConfig(getDefaultWorkspaceKey()).engines[0]?.id ?? "copilot", engine]]),
          getWorkspaceConfig,
        ),
        recorder.recordError,
        recorder.recordTaskUpdate,
        recorder.recordNewMessage,
        new WorkspaceRepository(db),
    );

    coordinator.setOnStreamEvent((event: StreamEvent) => {
        recorder.recordStreamEvent(event);
        let enricher = enrichers.get(event.executionId);
        if (!enricher) {
            enricher = new StreamEventEnricher(event.executionId);
            enrichers.set(event.executionId, enricher);
        }
        const { seq, blockId } = enricher.enrich(event.type, event.blockId || undefined);
        const enrichedEvent = { ...event, seq, blockId };
        ipcEvents.push(enrichedEvent);
        if (PERSISTED_TYPES.has(event.type)) {
            streamEventBuffer.enqueue({
                conversationId: enrichedEvent.conversationId,
                executionId: enrichedEvent.executionId,
                seq: enrichedEvent.seq,
                blockId: enrichedEvent.blockId,
                type: enrichedEvent.type,
                content: enrichedEvent.content,
                metadata: typeof enrichedEvent.metadata === "string" ? enrichedEvent.metadata : (enrichedEvent.metadata ? JSON.stringify(enrichedEvent.metadata) : null),
                parentBlockId: enrichedEvent.parentBlockId ?? null,
                subagentId: enrichedEvent.subagentId ?? null,
            });
        }
        if (event.done) {
            streamEventBuffer.flush();
            enrichers.delete(event.executionId);
        }
    });

    const wsRepo = new WorkspaceRepository(db);
    const worktreeManager = new WorktreeManager(
        db,
        wsRepo,
        TEST_PROJECT_RESOLVER,
        new GitRepositoryManager(),
        new TaskGitContextRepository(db),
    );

    const handlers = {
        ...taskHandlers(db, wsRepo, coordinator, recorder.recordTaskUpdate, worktreeManager),
        ...taskGitHandlers(db, recorder.recordTaskUpdate, worktreeManager, new GitRepositoryManager()),
        ...codeReviewHandlers(db),
        ...todoHandlers(db),
        ...modelHandlers(db, coordinator),
        ...engineHandlers(coordinator),
    } as AllHandlersMap;

    return {
        db,
        handlers,
        recorder,
        gitDir,
        cleanup: () => {
            streamEventBuffer.stop();
            enrichers.clear();
            rmSync(gitDir, { recursive: true, force: true });
            cfg.cleanup();
        },
        createTask: async (model = options.taskModel ?? "copilot/mock-model", { workspaceKey = "default" }: { workspaceKey?: string } = {}) => {
            const { taskId, conversationId } = await seedProjectAndTask(db, gitDir, { workspaceKey });
            await db.exec("DELETE FROM task_git_context WHERE task_id = $1", [taskId]);
            await db.exec(
                `INSERT INTO task_git_context (task_id, git_root_path, worktree_path, worktree_status, branch_name)
         VALUES ($1, $2, $3, 'ready', 'test-branch')`,
                [taskId, gitDir, gitDir],
            );
            await db.exec("UPDATE conversations SET model = $1 WHERE id = (SELECT conversation_id FROM tasks WHERE id = $2)", [model, taskId]);
            await db.exec("UPDATE tasks SET workflow_state = 'plan', execution_state = 'idle' WHERE id = $1", [taskId]);
            await db.exec(
                "INSERT OR IGNORE INTO enabled_models (workspace_key, qualified_model_id) VALUES ('default', $1)",
                [model],
            );
            return { taskId, conversationId };
        },
        getMessages: (taskId: number) => db
            .rows<{ type: string; role: string | null; content: string }>(
                "SELECT type, role, content FROM conversation_messages WHERE task_id = $1 ORDER BY id ASC",
                [taskId],
            ),
        getTaskState: async (taskId: number) =>
            (await db.get<{ execution_state: string | null }>("SELECT execution_state FROM tasks WHERE id = $1", [taskId]))?.execution_state ?? null,
        getExecutionStatus: async (executionId: number) =>
            (await db.get<{ status: string | null }>("SELECT status FROM executions WHERE id = $1", [executionId]))?.status ?? null,
        waitForExecutionStatus: async (executionId: number, status: string, timeoutMs = 5_000) => {
            await waitUntil(
                async () => (await db.get<{ status: string | null }>("SELECT status FROM executions WHERE id = $1", [executionId]))?.status === status,
                `execution ${executionId} status ${status}`,
                timeoutMs,
            );
        },
        waitForTaskState: async (taskId: number, state: string, timeoutMs = 5_000) => {
            await waitUntil(
                async () => (await db.get<{ execution_state: string | null }>("SELECT execution_state FROM tasks WHERE id = $1", [taskId]))?.execution_state === state,
                `task ${taskId} state ${state}`,
                timeoutMs,
            );
        },
        getIpcEvents: (executionId: number) =>
            ipcEvents.filter((e) => e.executionId === executionId),
        getDbStreamEvents: async (executionId: number) =>
            (await db.rows<{
                id: number; task_id: number | null; conversation_id: number; execution_id: number; seq: number;
                block_id: string; type: string; content: string;
                metadata: string | null; parent_block_id: string | null; subagent_id: string | null; created_at: string;
            }>(
                "SELECT * FROM stream_events WHERE execution_id = $1 ORDER BY seq ASC",
                [executionId],
            )).map((r) => ({
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
                async () => (await db.get<{ type: string }>(
                    "SELECT type FROM stream_events WHERE execution_id = $1 AND type = $2 LIMIT 1",
                    [executionId, type],
                )) !== undefined,
                `DB stream_event type="${type}" for execution ${executionId}`,
                timeoutMs,
            );
            const row = (await db.get<{
                id: number; task_id: number; execution_id: number; seq: number;
                block_id: string; type: string; content: string;
                metadata: string | null; subagent_id: string | null; created_at: string;
                conversation_id: number; parent_block_id: string | null;
            }>(
                "SELECT * FROM stream_events WHERE execution_id = $1 AND type = $2 ORDER BY seq ASC LIMIT 1",
                [executionId, type],
            ))!;
            return {
                id: row.id,
                conversationId: row.conversation_id,
                executionId: row.execution_id,
                seq: row.seq,
                blockId: row.block_id,
                type: row.type,
                content: row.content,
                metadata: row.metadata,
                parentBlockId: row.parent_block_id,
                subagentId: row.subagent_id,
                createdAt: row.created_at,
            };
        },
        waitFor: async (predicate: () => boolean, description = "condition", timeoutMs = 5_000) => {
            await waitUntil(predicate, description, timeoutMs);
        },
    };
}
