import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import type { Database } from "bun:sqlite";
import { TOOL_GROUPS } from "../workflow/tools.ts";
import { executeCommonTool } from "../engine/common-tools.ts";
import { initDb, seedProjectAndTask, setupTestConfig } from "./helpers.ts";
import type { CommonToolContext } from "../engine/types.ts";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

let db: Database;
let cfg: ReturnType<typeof setupTestConfig>;
let taskId: number;
let boardId: number;
let projectKey: string;
let conversationId: number;

/** No-op callbacks (most tests don't need real engine integration) */
const noop = () => { };

/** Build a CommonToolContext wired to the test task.
 *  Pass { boardId: undefined } to explicitly omit boardId (triggers board_id-required errors). */
const commonCtx = (overrides?: { taskId?: number; boardId?: number }): CommonToolContext => ({
    taskId: overrides?.taskId ?? taskId,
    boardId: overrides && "boardId" in overrides ? overrides.boardId : boardId,
    onTransition: noop,
    onHumanTurn: noop,
    onCancel: noop,
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

describe("executeCommonTool / get_task", () => {
    it("returns task metadata for a valid task_id", async () => {
        const result = await executeCommonTool("get_task", { task_id: taskId }, commonCtx());
        const task = JSON.parse(result.text);
        expect(task.id).toBe(taskId);
        expect(task.title).toBe("Test task");
        expect(task.workflowState).toBe("plan");
    });

    it("returns error when task_id is missing", async () => {
        const result = await executeCommonTool("get_task", {}, commonCtx());
        expect(result.text).toContain("Error: field 'task_id' is required");
    });

    it("returns error for a nonexistent task_id", async () => {
        const result = await executeCommonTool("get_task", { task_id: 999999 }, commonCtx());
        expect(result.text).toContain("Error: task 999999 not found");
    });

    it("includes conversation messages when include_messages is set", async () => {
        db.run(
            "INSERT INTO conversation_messages (task_id, conversation_id, type, role, content) VALUES (?, ?, 'user', 'user', 'Hello!')",
            [taskId, conversationId],
        );
        const result = await executeCommonTool(
            "get_task",
            { task_id: taskId, include_messages: 5 },
            commonCtx(),
        );
        const parsed = JSON.parse(result.text);
        expect(parsed.task).toBeDefined();
        expect(parsed.messages).toHaveLength(1);
        expect(parsed.messages[0].content).toBe("Hello!");
    });
});

// ─── get_board_summary ────────────────────────────────────────────────────────

describe("executeCommonTool / get_board_summary", () => {
    it("returns column breakdown using ctx.boardId when no arg given", async () => {
        const result = await executeCommonTool("get_board_summary", {}, commonCtx());
        const summary = JSON.parse(result.text);
        expect(summary.board_id).toBe(boardId);
        expect(summary.columns).toBeDefined();
        // The seeded task is in 'plan' column (idle state)
        expect(summary.columns["plan"]).toBeDefined();
        expect(summary.columns["plan"].total).toBe(1);
    });

    it("returns column breakdown using explicit board_id arg", async () => {
        const result = await executeCommonTool(
            "get_board_summary",
            { board_id: boardId },
            commonCtx({ boardId: undefined }),
        );
        const summary = JSON.parse(result.text);
        expect(summary.board_id).toBe(boardId);
        expect(summary.columns["plan"].total).toBe(1);
    });

    it("returns error when no board_id is available", async () => {
        const result = await executeCommonTool(
            "get_board_summary",
            {},
            commonCtx({ boardId: undefined }),
        );
        expect(result.text).toContain("Error: board_id is required");
    });

    it("returns error for a nonexistent board", async () => {
        const result = await executeCommonTool(
            "get_board_summary",
            { board_id: 999999 },
            commonCtx(),
        );
        expect(result.text).toContain("Error: board 999999 not found");
    });
});

// ─── list_tasks ───────────────────────────────────────────────────────────────

describe("executeCommonTool / list_tasks", () => {
    it("lists all tasks on the board using ctx.boardId", async () => {
        const result = await executeCommonTool("list_tasks", {}, commonCtx());
        const tasks = JSON.parse(result.text) as Array<{ id: number }>;
        expect(tasks.length).toBe(1);
        expect(tasks[0].id).toBe(taskId);
    });

    it("filters by workflow_state", async () => {
        const result = await executeCommonTool(
            "list_tasks",
            { workflow_state: "backlog" },
            commonCtx(),
        );
        const tasks = JSON.parse(result.text) as Array<unknown>;
        expect(tasks.length).toBe(0);
    });

    it("returns the task when workflow_state matches", async () => {
        const result = await executeCommonTool(
            "list_tasks",
            { workflow_state: "plan" },
            commonCtx(),
        );
        const tasks = JSON.parse(result.text) as Array<{ id: number }>;
        expect(tasks.length).toBe(1);
        expect(tasks[0].id).toBe(taskId);
    });

    it("filters by query string (matches title)", async () => {
        const result = await executeCommonTool(
            "list_tasks",
            { query: "Test" },
            commonCtx(),
        );
        const tasks = JSON.parse(result.text) as Array<{ id: number }>;
        expect(tasks.length).toBe(1);
    });

    it("returns empty when query doesn't match anything", async () => {
        const result = await executeCommonTool(
            "list_tasks",
            { query: "zzznomatch" },
            commonCtx(),
        );
        const tasks = JSON.parse(result.text) as Array<unknown>;
        expect(tasks.length).toBe(0);
    });

    it("returns error when no board_id is available", async () => {
        const result = await executeCommonTool(
            "list_tasks",
            {},
            commonCtx({ boardId: undefined }),
        );
        expect(result.text).toContain("Error: board_id is required");
    });
});

// ─── create_task ──────────────────────────────────────────────────────────────

describe("executeCommonTool / create_task", () => {
    it("creates a task and returns it in backlog state", async () => {
        const result = await executeCommonTool(
            "create_task",
            { project_key: projectKey, title: "New task", description: "Do something" },
            commonCtx(),
        );
        const task = JSON.parse(result.text);
        expect(task.id).toBeGreaterThan(0);
        expect(task.title).toBe("New task");
        expect(task.workflowState).toBe("backlog");
        expect(task.executionState).toBe("idle");
    });

    it("creates a task with a model override", async () => {
        const result = await executeCommonTool(
            "create_task",
            { project_key: projectKey, title: "Modeled task", description: "", model: "fake/qwq" },
            commonCtx(),
        );
        const task = JSON.parse(result.text);
        expect(task.model).toBe("fake/qwq");
    });

    it("returns error when project_key is missing", async () => {
        const result = await executeCommonTool(
            "create_task",
            { title: "No project", description: "" },
            commonCtx(),
        );
        expect(result.text).toContain("Error: field 'project_key' is required");
    });

    it("returns error when title is missing", async () => {
        const result = await executeCommonTool(
            "create_task",
            { project_key: projectKey, title: "", description: "" },
            commonCtx(),
        );
        expect(result.text).toContain("Error: title is required");
    });

    it("returns error when board_id is missing from both arg and ctx", async () => {
        const result = await executeCommonTool(
            "create_task",
            { project_key: projectKey, title: "X", description: "" },
            commonCtx({ boardId: undefined }),
        );
        expect(result.text).toContain("Error: board_id is required");
    });

    it("returns error for nonexistent project", async () => {
        const result = await executeCommonTool(
            "create_task",
            { project_key: "nonexistent-proj", title: "X", description: "" },
            commonCtx(),
        );
        expect(result.text).toContain("Error: project nonexistent-proj not found");
    });

    it("inherits the configured engine model when no model arg is given", async () => {
        const result = await executeCommonTool(
            "create_task",
            { project_key: projectKey, title: "Default model task", description: "" },
            commonCtx(),
        );
        const task = JSON.parse(result.text);
        expect(task.model).toBe("copilot/mock-model");
    });

    it("explicit model arg overrides the configured engine model", async () => {
        const result = await executeCommonTool(
            "create_task",
            { project_key: projectKey, title: "Override model task", description: "", model: "copilot/explicit" },
            commonCtx(),
        );
        const task = JSON.parse(result.text);
        expect(task.model).toBe("copilot/explicit");
    });
});

// ─── edit_task ────────────────────────────────────────────────────────────────

describe("executeCommonTool / edit_task", () => {
    it("updates title and description before a branch is created", async () => {
        const result = await executeCommonTool(
            "edit_task",
            { task_id: taskId, title: "Updated", description: "New desc" },
            commonCtx(),
        );
        const task = JSON.parse(result.text);
        expect(task.title).toBe("Updated");
        expect(task.description).toBe("New desc");
    });

    it("returns error if task does not exist", async () => {
        const result = await executeCommonTool(
            "edit_task",
            { task_id: 999999, title: "x" },
            commonCtx(),
        );
        expect(result.text).toContain("Error: task 999999 not found");
    });

    it("rejects edit when a branch has been created (worktree_status != not_created)", async () => {
        db.run(
            "INSERT INTO task_git_context (task_id, git_root_path, branch_name, worktree_status) VALUES (?, '/tmp', 'feat/branch', 'ready')",
            [taskId],
        );
        const result = await executeCommonTool(
            "edit_task",
            { task_id: taskId, title: "Should fail" },
            commonCtx(),
        );
        expect(result.text).toContain("Error: cannot edit task once a branch has been created");
    });

    it("returns error when task_id is missing", async () => {
        const result = await executeCommonTool("edit_task", {}, commonCtx());
        expect(result.text).toContain("Error: field 'task_id' is required");
    });
});

// ─── delete_task ──────────────────────────────────────────────────────────────

describe("executeCommonTool / delete_task", () => {
    it("deletes the task and all cascaded data", async () => {
        const result = await executeCommonTool(
            "delete_task",
            { task_id: taskId },
            commonCtx(),
        );
        const res = JSON.parse(result.text);
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
        const result = await executeCommonTool(
            "delete_task",
            { task_id: 999999 },
            commonCtx(),
        );
        expect(result.text).toContain("Error: task 999999 not found");
    });

    it("returns error when task_id is missing", async () => {
        const result = await executeCommonTool("delete_task", {}, commonCtx());
        expect(result.text).toContain("Error: field 'task_id' is required");
    });

    it("calls onCancel callback when task has a running execution", async () => {
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
        await executeCommonTool(
            "delete_task",
            { task_id: taskId },
            { ...commonCtx(), onCancel: (id) => { cancelledId = id; } },
        );

        expect(cancelledId).toBe(execId);
    });
});

// ─── move_task ────────────────────────────────────────────────────────────────

describe("executeCommonTool / move_task", () => {
    it("moves a task to a valid workflow column", async () => {
        const result = await executeCommonTool(
            "move_task",
            { task_id: taskId, workflow_state: "done" },
            commonCtx(),
        );
        const res = JSON.parse(result.text);
        expect(res.success).toBe(true);
        expect(res.workflow_state).toBe("done");

        const row = db
            .query<{ workflow_state: string }, [number]>("SELECT workflow_state FROM tasks WHERE id = ?")
            .get(taskId);
        expect(row?.workflow_state).toBe("done");
    });

    it("returns error for an invalid workflow column", async () => {
        const result = await executeCommonTool(
            "move_task",
            { task_id: taskId, workflow_state: "nonexistent" },
            commonCtx(),
        );
        expect(result.text).toContain("Error: workflow_state \"nonexistent\" not found in board template");
    });

    it("fires onTransition callback after updating DB", async () => {
        let calledWith: [number, string] | null = null;
        await executeCommonTool(
            "move_task",
            { task_id: taskId, workflow_state: "done" },
            { ...commonCtx(), onTransition: (id, state) => { calledWith = [id, state]; } },
        );
        expect(calledWith).toEqual([taskId, "done"]);
    });

    it("returns error when task does not exist", async () => {
        const result = await executeCommonTool(
            "move_task",
            { task_id: 999999, workflow_state: "done" },
            commonCtx(),
        );
        expect(result.text).toContain("Error: task 999999 not found");
    });

    it("returns error when task_id is missing", async () => {
        const result = await executeCommonTool("move_task", { workflow_state: "done" }, commonCtx());
        expect(result.text).toContain("Error: field 'task_id' is required");
    });

    it("returns error when workflow_state is missing", async () => {
        const result = await executeCommonTool("move_task", { task_id: taskId }, commonCtx());
        expect(result.text).toContain("Error: field 'workflow_state' is required");
    });

    it("sets position to 500 when moving to an empty column", async () => {
        await executeCommonTool("move_task", { task_id: taskId, workflow_state: "done" }, commonCtx());
        const row = db
            .query<{ position: number }, [number]>("SELECT position FROM tasks WHERE id = ?")
            .get(taskId);
        expect(row?.position).toBe(500);
    });
});

// ─── message_task ─────────────────────────────────────────────────────────────

describe("executeCommonTool / message_task", () => {
    it("delivers message (fires onHumanTurn) when task is idle", async () => {
        let deliveredTo: number | null = null;
        let deliveredMsg: string | null = null;
        const result = await executeCommonTool(
            "message_task",
            { task_id: taskId, message: "Please review" },
            { ...commonCtx(), onHumanTurn: (id, msg) => { deliveredTo = id; deliveredMsg = msg; } },
        );
        const res = JSON.parse(result.text);
        expect(res.status).toBe("delivered");
        expect(deliveredTo).toBe(taskId);
        expect(deliveredMsg).toBe("Please review");
    });

    it("queues message (inserts pending_messages row) when task is running", async () => {
        db.run("UPDATE tasks SET execution_state = 'running' WHERE id = ?", [taskId]);

        const result = await executeCommonTool(
            "message_task",
            { task_id: taskId, message: "Queue me" },
            commonCtx(),
        );
        const res = JSON.parse(result.text);
        expect(res.status).toBe("queued");

        const pending = db
            .query<{ content: string }, [number]>(
                "SELECT content FROM pending_messages WHERE task_id = ?",
            )
            .get(taskId);
        expect(pending?.content).toBe("Queue me");
    });

    it("returns error when task does not exist", async () => {
        const result = await executeCommonTool(
            "message_task",
            { task_id: 999999, message: "Hi" },
            commonCtx(),
        );
        expect(result.text).toContain("Error: task 999999 not found");
    });

    it("returns error when message is missing", async () => {
        const result = await executeCommonTool(
            "message_task",
            { task_id: taskId },
            commonCtx(),
        );
        expect(result.text).toContain("Error: field 'message' is required");
    });

    it("returns error when task_id is missing", async () => {
        const result = await executeCommonTool(
            "message_task",
            { message: "Hi" },
            commonCtx(),
        );
        expect(result.text).toContain("Error: field 'task_id' is required");
    });
});

// ─── create_todo ──────────────────────────────────────────────────────────────

describe("executeCommonTool / create_todo", () => {
    it("creates a todo and returns item with phase null by default", async () => {
        const result = await executeCommonTool(
            "create_todo",
            { number: 10, title: "My todo", description: "Do the thing" },
            commonCtx(),
        );
        const item = JSON.parse(result.text);
        expect(item.title).toBe("My todo");
        expect(item.number).toBe(10);
        expect(item.phase).toBeNull();
    });

    it("creates a todo with a phase", async () => {
        const result = await executeCommonTool(
            "create_todo",
            { number: 10, title: "Phased todo", description: "Do the thing", phase: "backlog" },
            commonCtx(),
        );
        const item = JSON.parse(result.text);
        expect(item.phase).toBe("backlog");
    });

    it("returns error when number is missing", async () => {
        const result = await executeCommonTool(
            "create_todo",
            { title: "No number", description: "Oops" },
            commonCtx(),
        );
        expect(result.text).toContain("Error: field 'number' is required");
    });

    it("returns error when title is missing", async () => {
        const result = await executeCommonTool(
            "create_todo",
            { number: 10, description: "No title" },
            commonCtx(),
        );
        expect(result.text).toContain("Error: field 'title' is required");
    });
});

// ─── edit_todo ────────────────────────────────────────────────────────────────

describe("executeCommonTool / edit_todo", () => {
    it("sets phase on an existing todo", async () => {
        const created = JSON.parse((await executeCommonTool(
            "create_todo",
            { number: 10, title: "My todo", description: "Do it" },
            commonCtx(),
        )).text);

        const result = await executeCommonTool(
            "edit_todo",
            { id: created.id, phase: "in-progress" },
            commonCtx(),
        );
        const item = JSON.parse(result.text);
        expect(item.phase).toBe("in-progress");
    });

    it("clears phase when null string is passed", async () => {
        const created = JSON.parse((await executeCommonTool(
            "create_todo",
            { number: 10, title: "My todo", description: "Do it", phase: "backlog" },
            commonCtx(),
        )).text);

        const result = await executeCommonTool(
            "edit_todo",
            { id: created.id, phase: "null" },
            commonCtx(),
        );
        const item = JSON.parse(result.text);
        expect(item.phase).toBeNull();
    });

    it("does not change phase when phase key is absent", async () => {
        const created = JSON.parse((await executeCommonTool(
            "create_todo",
            { number: 10, title: "My todo", description: "Do it", phase: "backlog" },
            commonCtx(),
        )).text);

        const result = await executeCommonTool(
            "edit_todo",
            { id: created.id, title: "Updated title" },
            commonCtx(),
        );
        const item = JSON.parse(result.text);
        expect(item.phase).toBe("backlog");
    });
});

// ─── list_todos ───────────────────────────────────────────────────────────────

describe("executeCommonTool / list_todos", () => {
    it("returns all todos including phase field", async () => {
        await executeCommonTool(
            "create_todo",
            { number: 10, title: "No phase", description: "Always active" },
            commonCtx(),
        );
        await executeCommonTool(
            "create_todo",
            { number: 20, title: "Backlog only", description: "Scoped", phase: "backlog" },
            commonCtx(),
        );

        const result = await executeCommonTool("list_todos", {}, commonCtx());
        const items = JSON.parse(result.text);
        expect(items).toHaveLength(2);
        expect(items.find((t: { title: string }) => t.title === "No phase").phase).toBeNull();
        expect(items.find((t: { title: string }) => t.title === "Backlog only").phase).toBe("backlog");
    });
});
