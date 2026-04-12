import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";
import type { ConversationMessage, Task } from "../../../shared/rpc-types.ts";
import { taskHandlers } from "../../handlers/tasks.ts";
import { Orchestrator } from "../../engine/orchestrator.ts";
import type { ExecutionEngine } from "../../engine/types.ts";
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
    const engine = options.createEngine({
        onTaskUpdated: recorder.recordTaskUpdate,
        onNewMessage: recorder.recordNewMessage,
    });
    const coordinator = new Orchestrator(
        engine,
        recorder.recordToken,
        recorder.recordError,
        recorder.recordTaskUpdate,
        recorder.recordNewMessage,
    );
    coordinator.setOnStreamEvent(recorder.recordStreamEvent);
    const handlers = taskHandlers(coordinator, recorder.recordTaskUpdate, recorder.recordNewMessage);

    return {
        db,
        handlers,
        recorder,
        gitDir,
        cleanup: () => {
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
                "INSERT OR IGNORE INTO enabled_models (workspace_id, qualified_model_id) VALUES (1, ?)",
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
    };
}
