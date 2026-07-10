import { Database } from "bun:sqlite";
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
import { resolveConversationMessageStore } from "../../conversation/message-store-resolver.ts";
import { mapConversationMessage } from "../../db/mappers.ts";
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
    db: Database;
    handlers: AllHandlersMap;
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
    /** Durable conversation messages persisted for this execution's conversation, ascending id order. */
    getDurableMessages: (executionId: number) => Promise<ConversationMessage[]>;
    /** Wait until a durable message of `type` appears for this execution's conversation. */
    waitForDurableMessage: (executionId: number, type: string, timeoutMs?: number) => Promise<ConversationMessage>;
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

    // ── Two-channel simulation ──────────────────────────────────────────────
    // ipcEvents: every event delivered immediately (mirrors what frontend receives in real-time)
    // Durable messages: persisted via the ConversationMessageStore (see stream-processor.ts)
    const ipcEvents: StreamEvent[] = [];
    const enrichers = new Map<number, StreamEventEnricher>();

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
        if (event.done) {
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
            enrichers.clear();
            rmSync(gitDir, { recursive: true, force: true });
            cfg.cleanup();
        },
        createTask: async (model = options.taskModel ?? "copilot/mock-model", { workspaceKey = "default" }: { workspaceKey?: string } = {}) => {
            const { taskId, conversationId } = seedProjectAndTask(db, gitDir, { workspaceKey });
            db.run("DELETE FROM task_git_context WHERE task_id = ?", [taskId]);
            db.run(
                `INSERT INTO task_git_context (task_id, git_root_path, worktree_path, worktree_status, branch_name)
         VALUES (?, ?, ?, 'ready', 'test-branch')`,
                [taskId, gitDir, gitDir],
            );
            db.run("UPDATE conversations SET model = ? WHERE id = (SELECT conversation_id FROM tasks WHERE id = ?)", [model, taskId]);
            db.run("UPDATE tasks SET workflow_state = 'plan', execution_state = 'idle' WHERE id = ?", [taskId]);
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
        getDurableMessages: async (executionId: number) => {
            const conversationId = db
                .query<{ conversation_id: number }, [number]>("SELECT conversation_id FROM executions WHERE id = ?")
                .get(executionId)?.conversation_id;
            if (conversationId == null) return [];
            const store = resolveConversationMessageStore(db, conversationId);
            const rows = await store.getAll();
            return rows.map(mapConversationMessage);
        },
        waitForDurableMessage: async (executionId: number, type: string, timeoutMs = 5_000) => {
            const conversationId = db
                .query<{ conversation_id: number }, [number]>("SELECT conversation_id FROM executions WHERE id = ?")
                .get(executionId)?.conversation_id;
            if (conversationId == null) throw new Error(`No conversation found for execution ${executionId}`);
            const store = resolveConversationMessageStore(db, conversationId);

            const deadline = Date.now() + timeoutMs;
            let found: ConversationMessage | undefined;
            while (Date.now() < deadline) {
                const rows = await store.getAll({ types: [type as ConversationMessage["type"]] });
                if (rows.length > 0) {
                    found = mapConversationMessage(rows[0]!);
                    break;
                }
                await new Promise((resolve) => setTimeout(resolve, 10));
            }
            if (!found) {
                throw new Error(`Timed out waiting for durable message type="${type}" for execution ${executionId}`);
            }
            return found;
        },
        waitFor: async (predicate: () => boolean, description = "condition", timeoutMs = 5_000) => {
            await waitUntil(predicate, description, timeoutMs);
        },
    };
}
