import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import type { Database } from "bun:sqlite";
import { executeTool, TOOL_GROUPS } from "../workflow/tools.ts";
import { initDb, seedProjectAndTask, setupTestConfig } from "./helpers.ts";
import type { TaskToolCallbacks } from "../workflow/tools.ts";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

let db: Database;
let cfg: ReturnType<typeof setupTestConfig>;
let taskId: number;
let boardId: number;
let projectKey: string;
let conversationId: number;

/** No-op callbacks (most tests don't need real engine integration) */
const noop = () => { };
const callbacks: TaskToolCallbacks = {
    handleTransition: noop,
    handleHumanTurn: noop,
    cancelExecution: noop,
};

/** Build a ToolContext wired to the test task */
const ctx = (overrides: { taskId?: number; boardId?: number; callbacks?: TaskToolCallbacks } = {}) => ({
    worktreePath: "",
    taskId: overrides.taskId ?? taskId,
    boardId: overrides.boardId ?? boardId,
    taskCallbacks: overrides.callbacks ?? callbacks,
});

beforeEach(() => {
    cfg = setupTestConfig();
    db = initDb();
    ({ projectKey, boardId, taskId, conversationId } = seedProjectAndTask(db, "/tmp/test-git"));
});

afterEach(() => {
    cfg.cleanup();
});

// ─── TOOL_GROUPS registration ─────────────────────────────────────────────────

describe("TOOL_GROUPS", () => {
    it("registers tasks_read group with the three read tools", () => {
        expect(TOOL_GROUPS.get("tasks_read")).toEqual(["get_task", "get_board_summary", "list_tasks"]);
    });

    it("registers tasks_write group with the five write tools", () => {
        expect(TOOL_GROUPS.get("tasks_write")).toEqual([
            "create_task",
            "edit_task",
            "delete_task",
            "move_task",
            "message_task",
        ]);
    });
});

// ─── get_task ─────────────────────────────────────────────────────────────────

describe("executeTool / get_task", () => {
    it("returns task metadata for a valid task_id", async () => {
        const result = await executeTool("get_task", JSON.stringify({ task_id: taskId }), ctx());
        const task = JSON.parse(result as string);
        expect(task.id).toBe(taskId);
        expect(task.title).toBe("Test task");
        expect(task.workflowState).toBe("plan");
    });

    it("returns error when task_id is missing", async () => {
        const result = await executeTool("get_task", JSON.stringify({}), ctx());
        expect(result).toContain("Error: task_id is required");
    });

    it("returns error for a nonexistent task_id", async () => {
        const result = await executeTool("get_task", JSON.stringify({ task_id: 999999 }), ctx());
        expect(result).toContain("Error: task 999999 not found");
    });

    it("includes conversation messages when include_messages is set", async () => {
        db.run(
            "INSERT INTO conversation_messages (task_id, conversation_id, type, role, content) VALUES (?, ?, 'user', 'user', 'Hello!')",
            [taskId, conversationId],
        );
        const result = await executeTool(
            "get_task",
            JSON.stringify({ task_id: taskId, include_messages: 5 }),
            ctx(),
        );
        const parsed = JSON.parse(result as string);
        expect(parsed.task).toBeDefined();
        expect(parsed.messages).toHaveLength(1);
        expect(parsed.messages[0].content).toBe("Hello!");
    });
});

// ─── get_board_summary ────────────────────────────────────────────────────────

describe("executeTool / get_board_summary", () => {
    it("returns column breakdown using ctx.boardId when no arg given", async () => {
        const result = await executeTool("get_board_summary", JSON.stringify({}), ctx());
        const summary = JSON.parse(result as string);
        expect(summary.board_id).toBe(boardId);
        expect(summary.columns).toBeDefined();
        // The seeded task is in 'plan' column (idle state)
        expect(summary.columns["plan"]).toBeDefined();
        expect(summary.columns["plan"].total).toBe(1);
    });

    it("returns column breakdown using explicit board_id arg", async () => {
        const result = await executeTool(
            "get_board_summary",
            JSON.stringify({ board_id: boardId }),
            ctx({ boardId: undefined }),
        );
        const summary = JSON.parse(result as string);
        expect(summary.board_id).toBe(boardId);
        expect(summary.columns["plan"].total).toBe(1);
    });

    it("returns error when no board_id is available", async () => {
        const result = await executeTool(
            "get_board_summary",
            JSON.stringify({}),
            { worktreePath: "" }, // no boardId in ctx
        );
        expect(result).toContain("Error: board_id is required");
    });

    it("returns error for a nonexistent board", async () => {
        const result = await executeTool(
            "get_board_summary",
            JSON.stringify({ board_id: 999999 }),
            ctx(),
        );
        expect(result).toContain("Error: board 999999 not found");
    });
});

// ─── list_tasks ───────────────────────────────────────────────────────────────

describe("executeTool / list_tasks", () => {
    it("lists all tasks on the board using ctx.boardId", async () => {
        const result = await executeTool("list_tasks", JSON.stringify({}), ctx());
        const tasks = JSON.parse(result as string) as Array<{ id: number }>;
        expect(tasks.length).toBe(1);
        expect(tasks[0].id).toBe(taskId);
    });

    it("filters by workflow_state", async () => {
        const result = await executeTool(
            "list_tasks",
            JSON.stringify({ workflow_state: "backlog" }),
            ctx(),
        );
        const tasks = JSON.parse(result as string) as Array<unknown>;
        expect(tasks.length).toBe(0);
    });

    it("returns the task when workflow_state matches", async () => {
        const result = await executeTool(
            "list_tasks",
            JSON.stringify({ workflow_state: "plan" }),
            ctx(),
        );
        const tasks = JSON.parse(result as string) as Array<{ id: number }>;
        expect(tasks.length).toBe(1);
        expect(tasks[0].id).toBe(taskId);
    });

    it("filters by query string (matches title)", async () => {
        const result = await executeTool(
            "list_tasks",
            JSON.stringify({ query: "Test" }),
            ctx(),
        );
        const tasks = JSON.parse(result as string) as Array<{ id: number }>;
        expect(tasks.length).toBe(1);
    });

    it("returns empty when query doesn't match anything", async () => {
        const result = await executeTool(
            "list_tasks",
            JSON.stringify({ query: "zzznomatch" }),
            ctx(),
        );
        const tasks = JSON.parse(result as string) as Array<unknown>;
        expect(tasks.length).toBe(0);
    });

    it("returns error when no board_id is available", async () => {
        const result = await executeTool(
            "list_tasks",
            JSON.stringify({}),
            { worktreePath: "" },
        );
        expect(result).toContain("Error: board_id is required");
    });
});

// ─── create_task ──────────────────────────────────────────────────────────────

describe("executeTool / create_task", () => {
    it("creates a task and returns it in backlog state", async () => {
        const result = await executeTool(
            "create_task",
            JSON.stringify({ project_key: projectKey, title: "New task", description: "Do something" }),
            ctx(),
        );
        const task = JSON.parse(result as string);
        expect(task.id).toBeGreaterThan(0);
        expect(task.title).toBe("New task");
        expect(task.workflowState).toBe("backlog");
        expect(task.executionState).toBe("idle");
    });

    it("creates a task with a model override", async () => {
        const result = await executeTool(
            "create_task",
            JSON.stringify({ project_key: projectKey, title: "Modeled task", description: "", model: "fake/qwq" }),
            ctx(),
        );
        const task = JSON.parse(result as string);
        expect(task.model).toBe("fake/qwq");
    });

    it("returns error when project_key is missing", async () => {
        const result = await executeTool(
            "create_task",
            JSON.stringify({ title: "No project", description: "" }),
            ctx(),
        );
        expect(result).toContain("Error: project_key is required");
    });

    it("returns error when title is missing", async () => {
        const result = await executeTool(
            "create_task",
            JSON.stringify({ project_key: projectKey, title: "", description: "" }),
            ctx(),
        );
        expect(result).toContain("Error: title is required");
    });

    it("returns error when board_id is missing from both arg and ctx", async () => {
        const result = await executeTool(
            "create_task",
            JSON.stringify({ project_key: projectKey, title: "X", description: "" }),
            { worktreePath: "" },
        );
        expect(result).toContain("Error: board_id is required");
    });

    it("returns error for nonexistent project", async () => {
        const result = await executeTool(
            "create_task",
            JSON.stringify({ project_key: "nonexistent-proj", title: "X", description: "" }),
            ctx(),
        );
        expect(result).toContain("Error: project nonexistent-proj not found");
    });

    it("inherits workspace default_model when no model arg is given", async () => {
        cfg.cleanup();
        cfg = setupTestConfig("default_model: fake/workspace-default");
        const result = await executeTool(
            "create_task",
            JSON.stringify({ project_key: projectKey, title: "Default model task", description: "" }),
            ctx(),
        );
        const task = JSON.parse(result as string);
        expect(task.model).toBe("fake/workspace-default");
    });

    it("explicit model arg overrides workspace default_model", async () => {
        cfg.cleanup();
        cfg = setupTestConfig("default_model: fake/workspace-default");
        const result = await executeTool(
            "create_task",
            JSON.stringify({ project_key: projectKey, title: "Override model task", description: "", model: "fake/explicit" }),
            ctx(),
        );
        const task = JSON.parse(result as string);
        expect(task.model).toBe("fake/explicit");
    });

    it("model is null when no model arg and no workspace default_model", async () => {
        const result = await executeTool(
            "create_task",
            JSON.stringify({ project_key: projectKey, title: "No model task", description: "" }),
            ctx(),
        );
        const task = JSON.parse(result as string);
        expect(task.model).toBeNull();
    });
});

// ─── edit_task ────────────────────────────────────────────────────────────────

describe("executeTool / edit_task", () => {
    it("updates title and description before a branch is created", async () => {
        const result = await executeTool(
            "edit_task",
            JSON.stringify({ task_id: taskId, title: "Updated", description: "New desc" }),
            ctx(),
        );
        const task = JSON.parse(result as string);
        expect(task.title).toBe("Updated");
        expect(task.description).toBe("New desc");
    });

    it("returns error if task does not exist", async () => {
        const result = await executeTool(
            "edit_task",
            JSON.stringify({ task_id: 999999, title: "x" }),
            ctx(),
        );
        expect(result).toContain("Error: task 999999 not found");
    });

    it("rejects edit when a branch has been created (worktree_status != not_created)", async () => {
        db.run(
            "INSERT INTO task_git_context (task_id, git_root_path, branch_name, worktree_status) VALUES (?, '/tmp', 'feat/branch', 'ready')",
            [taskId],
        );
        const result = await executeTool(
            "edit_task",
            JSON.stringify({ task_id: taskId, title: "Should fail" }),
            ctx(),
        );
        expect(result).toContain("Error: cannot edit task once a branch has been created");
    });

    it("returns error when task_id is missing", async () => {
        const result = await executeTool("edit_task", JSON.stringify({}), ctx());
        expect(result).toContain("Error: task_id is required");
    });
});

// ─── delete_task ──────────────────────────────────────────────────────────────

describe("executeTool / delete_task", () => {
    it("deletes the task and all cascaded data", async () => {
        const result = await executeTool(
            "delete_task",
            JSON.stringify({ task_id: taskId }),
            ctx(),
        );
        const res = JSON.parse(result as string);
        expect(res.success).toBe(true);
        expect(res.deleted_task_id).toBe(taskId);

        // Task should no longer exist
        const row = db.query<{ id: number }, [number]>("SELECT id FROM tasks WHERE id = ?").get(taskId);
        expect(row).toBeNull();

        // Conversation should be deleted too
        const conv = db
            .query<{ id: number }, [number]>("SELECT id FROM conversations WHERE id = ?")
            .get(conversationId);
        expect(conv).toBeNull();
    });

    it("returns error for a nonexistent task", async () => {
        const result = await executeTool(
            "delete_task",
            JSON.stringify({ task_id: 999999 }),
            ctx(),
        );
        expect(result).toContain("Error: task 999999 not found");
    });

    it("returns error when task_id is missing", async () => {
        const result = await executeTool("delete_task", JSON.stringify({}), ctx());
        expect(result).toContain("Error: task_id is required");
    });

    it("calls cancelExecution callback when task has a running execution", async () => {
        // Seed an in-progress execution
        db.run(
            "INSERT INTO executions (task_id, from_state, to_state, status) VALUES (?, 'backlog', 'plan', 'running')",
            [taskId],
        );
        const execId = (db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!).id;
        db.run("UPDATE tasks SET current_execution_id = ?, execution_state = 'running' WHERE id = ?", [
            execId,
            taskId,
        ]);

        let cancelledId: number | null = null;
        const trackingCallbacks: TaskToolCallbacks = {
            ...callbacks,
            cancelExecution: (id) => { cancelledId = id; },
        };

        await executeTool(
            "delete_task",
            JSON.stringify({ task_id: taskId }),
            ctx({ callbacks: trackingCallbacks }),
        );

        expect(cancelledId).toBe(execId);
    });
});

// ─── move_task ────────────────────────────────────────────────────────────────

describe("executeTool / move_task", () => {
    it("moves a task to a valid workflow column", async () => {
        const result = await executeTool(
            "move_task",
            JSON.stringify({ task_id: taskId, workflow_state: "done" }),
            ctx(),
        );
        const res = JSON.parse(result as string);
        expect(res.success).toBe(true);
        expect(res.workflow_state).toBe("done");

        const row = db
            .query<{ workflow_state: string }, [number]>("SELECT workflow_state FROM tasks WHERE id = ?")
            .get(taskId);
        expect(row?.workflow_state).toBe("done");
    });

    it("returns error for an invalid workflow column", async () => {
        const result = await executeTool(
            "move_task",
            JSON.stringify({ task_id: taskId, workflow_state: "nonexistent" }),
            ctx(),
        );
        expect(result).toContain("Error: workflow_state \"nonexistent\" not found in board template");
    });

    it("fires handleTransition callback after updating DB", async () => {
        let calledWith: [number, string] | null = null;
        const trackingCallbacks: TaskToolCallbacks = {
            ...callbacks,
            handleTransition: (id, state) => { calledWith = [id, state]; },
        };

        await executeTool(
            "move_task",
            JSON.stringify({ task_id: taskId, workflow_state: "done" }),
            ctx({ callbacks: trackingCallbacks }),
        );

        expect(calledWith).toEqual([taskId, "done"]);
    });

    it("returns error when task does not exist", async () => {
        const result = await executeTool(
            "move_task",
            JSON.stringify({ task_id: 999999, workflow_state: "done" }),
            ctx(),
        );
        expect(result).toContain("Error: task 999999 not found");
    });

    it("returns error when task_id is missing", async () => {
        const result = await executeTool("move_task", JSON.stringify({ workflow_state: "done" }), ctx());
        expect(result).toContain("Error: task_id is required");
    });

    it("returns error when workflow_state is missing", async () => {
        const result = await executeTool(
            "move_task",
            JSON.stringify({ task_id: taskId }),
            ctx(),
        );
        expect(result).toContain("Error: workflow_state is required");
    });
});

// ─── message_task ─────────────────────────────────────────────────────────────

describe("executeTool / message_task", () => {
    it("delivers message (fires handleHumanTurn) when task is idle", async () => {
        let deliveredTo: number | null = null;
        let deliveredMsg: string | null = null;
        const trackingCallbacks: TaskToolCallbacks = {
            ...callbacks,
            handleHumanTurn: (id, msg) => { deliveredTo = id; deliveredMsg = msg; },
        };

        const result = await executeTool(
            "message_task",
            JSON.stringify({ task_id: taskId, message: "Please review" }),
            ctx({ callbacks: trackingCallbacks }),
        );
        const res = JSON.parse(result as string);
        expect(res.status).toBe("delivered");
        expect(deliveredTo).toBe(taskId);
        expect(deliveredMsg).toBe("Please review");
    });

    it("queues message (inserts pending_messages row) when task is running", async () => {
        db.run("UPDATE tasks SET execution_state = 'running' WHERE id = ?", [taskId]);

        const result = await executeTool(
            "message_task",
            JSON.stringify({ task_id: taskId, message: "Queue me" }),
            ctx(),
        );
        const res = JSON.parse(result as string);
        expect(res.status).toBe("queued");

        const pending = db
            .query<{ content: string }, [number]>(
                "SELECT content FROM pending_messages WHERE task_id = ?",
            )
            .get(taskId);
        expect(pending?.content).toBe("Queue me");
    });

    it("returns error when task does not exist", async () => {
        const result = await executeTool(
            "message_task",
            JSON.stringify({ task_id: 999999, message: "Hi" }),
            ctx(),
        );
        expect(result).toContain("Error: task 999999 not found");
    });

    it("returns error when message is missing", async () => {
        const result = await executeTool(
            "message_task",
            JSON.stringify({ task_id: taskId }),
            ctx(),
        );
        expect(result).toContain("Error: message is required");
    });

    it("returns error when task_id is missing", async () => {
        const result = await executeTool(
            "message_task",
            JSON.stringify({ message: "Hi" }),
            ctx(),
        );
        expect(result).toContain("Error: task_id is required");
    });
});
