import { BoardRepository } from "../db/board-repository.ts";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Database } from "bun:sqlite";
import { TOOL_GROUPS } from "../workflow/tools.ts";
import { executeCommonTool } from "../engine/common-tools.ts";
import { initDb, seedProjectAndTask, setupTestConfig } from "./helpers.ts";
import type { CommonToolContext } from "../engine/types.ts";
import { TodoRepository } from "../db/todos.ts";
import { DecisionRepository } from "../db/repositories/decision-repository.ts";
import { NoteRepository } from "../db/repositories/note-repository.ts";
import { WorkspaceRepository } from "../db/workspace-repository.ts";
import { BoardToolExecutor } from "../workflow/tools/board-tool-executor.ts";

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
const commonCtx = (overrides?: {
    taskId?: number;
    boardId?: number;
    onTransition?: (taskId: number, toState: string) => void;
    onHumanTurn?: (taskId: number, message: string) => void;
    onCancel?: (executionId: number) => void;
    onTaskUpdated?: (task: import("../../shared/rpc-types.ts").Task) => void;
}): CommonToolContext => ({
    task: {
      id: overrides?.taskId ?? taskId,
      boardId: overrides && "boardId" in overrides ? (overrides.boardId ?? null) : boardId,
      conversationId,
    },
    workspaceKey: "default",
    repos: {
      todos: new TodoRepository(db),
      decisions: new DecisionRepository(db),
      notes: new NoteRepository(db),
      boardTools: new BoardToolExecutor(db, new WorkspaceRepository(db), new BoardRepository(db)),
    },
    workflow: {
      onTransition: overrides?.onTransition ?? noop,
      onHumanTurn: overrides?.onHumanTurn ?? noop,
      onCancel: overrides?.onCancel ?? noop,
      onTaskUpdated: overrides?.onTaskUpdated ?? noop,
    },
    runtime: {},
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
    it("registers cards_read group with the four read tools", () => {
        expect(TOOL_GROUPS.get("cards_read")).toEqual(["list_boards", "get_card", "get_board_summary", "list_cards"]);
    });

    it("registers cards_write group with the five write tools", () => {
        expect(TOOL_GROUPS.get("cards_write")).toEqual([
            "create_card",
            "edit_card",
            "delete_card",
            "move_card",
            "message_card",
        ]);
    });
});

// ─── get_card ─────────────────────────────────────────────────────────────────

describe("executeCommonTool / get_card", () => {
    it("returns task metadata for a valid task_id", async () => {
        const result = await executeCommonTool("get_card", { task_id: taskId }, commonCtx());
        const task = JSON.parse(result.text);
        expect(task.id).toBe(taskId);
        expect(task.title).toBe("Test task");
        expect(task.workflowState).toBe("plan");
    });

    it("returns error when task_id is missing", async () => {
        const result = await executeCommonTool("get_card", {}, commonCtx());
        expect(result.text).toContain("Error: field 'task_id' is required");
    });

    it("returns error for a nonexistent task_id", async () => {
        const result = await executeCommonTool("get_card", { task_id: 999999 }, commonCtx());
        expect(result.text).toContain("Error: task 999999 not found");
    });

    it("includes conversation messages when include_messages is set", async () => {
        db.run(
            "INSERT INTO conversation_messages (task_id, conversation_id, type, role, content) VALUES (?, ?, 'user', 'user', 'Hello!')",
            [taskId, conversationId],
        );
        const result = await executeCommonTool(
            "get_card",
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

// ─── list_cards ───────────────────────────────────────────────────────────────

describe("executeCommonTool / list_cards", () => {
    it("lists all tasks on the board using ctx.boardId", async () => {
        const result = await executeCommonTool("list_cards", {}, commonCtx());
        const tasks = JSON.parse(result.text) as Array<{ id: number }>;
        expect(tasks.length).toBe(1);
        expect(tasks[0].id).toBe(taskId);
    });

    it("filters by workflow_state", async () => {
        const result = await executeCommonTool(
            "list_cards",
            { workflow_state: "backlog" },
            commonCtx(),
        );
        const tasks = JSON.parse(result.text) as Array<unknown>;
        expect(tasks.length).toBe(0);
    });

    it("returns the task when workflow_state matches", async () => {
        const result = await executeCommonTool(
            "list_cards",
            { workflow_state: "plan" },
            commonCtx(),
        );
        const tasks = JSON.parse(result.text) as Array<{ id: number }>;
        expect(tasks.length).toBe(1);
        expect(tasks[0].id).toBe(taskId);
    });

    it("filters by query string (matches title)", async () => {
        const result = await executeCommonTool(
            "list_cards",
            { query: "Test" },
            commonCtx(),
        );
        const tasks = JSON.parse(result.text) as Array<{ id: number }>;
        expect(tasks.length).toBe(1);
    });

    it("returns empty when query doesn't match anything", async () => {
        const result = await executeCommonTool(
            "list_cards",
            { query: "zzznomatch" },
            commonCtx(),
        );
        const tasks = JSON.parse(result.text) as Array<unknown>;
        expect(tasks.length).toBe(0);
    });

    it("returns error when no board_id is available", async () => {
        const result = await executeCommonTool(
            "list_cards",
            {},
            commonCtx({ boardId: undefined }),
        );
        expect(result.text).toContain("Error: board_id is required");
    });
});

// ─── create_card ──────────────────────────────────────────────────────────────

describe("executeCommonTool / create_card", () => {
    it("creates a task and returns it in backlog state", async () => {
        const result = await executeCommonTool(
            "create_card",
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
            "create_card",
            { project_key: projectKey, title: "Modeled task", description: "", model: "fake/qwq" },
            commonCtx(),
        );
        const task = JSON.parse(result.text);
        expect(task.model).toBe("fake/qwq");
    });

    it("returns error when project_key is missing", async () => {
        const result = await executeCommonTool(
            "create_card",
            { title: "No project", description: "" },
            commonCtx(),
        );
        expect(result.text).toContain("Error: field 'project_key' is required");
    });

    it("returns error when title is missing", async () => {
        const result = await executeCommonTool(
            "create_card",
            { project_key: projectKey, title: "", description: "" },
            commonCtx(),
        );
        expect(result.text).toContain("Error: title is required");
    });

    it("returns error when board_id is missing from both arg and ctx", async () => {
        const result = await executeCommonTool(
            "create_card",
            { project_key: projectKey, title: "X", description: "" },
            commonCtx({ boardId: undefined }),
        );
        expect(result.text).toContain("Error: board_id is required");
    });

    it("returns error for nonexistent project", async () => {
        const result = await executeCommonTool(
            "create_card",
            { project_key: "nonexistent-proj", title: "X", description: "" },
            commonCtx(),
        );
        expect(result.text).toContain("Error: project nonexistent-proj not found");
    });

    it("creates task without model when no model arg is given", async () => {
        const result = await executeCommonTool(
            "create_card",
            { project_key: projectKey, title: "No model task", description: "" },
            commonCtx(),
        );
        const task = JSON.parse(result.text);
        expect(task.model).toBeNull(); // No automatic model assignment
    });

    it("uses explicit model arg when provided", async () => {
        const result = await executeCommonTool(
            "create_card",
            { project_key: projectKey, title: "Explicit model task", description: "", model: "copilot/explicit" },
            commonCtx(),
        );
        const task = JSON.parse(result.text);
        expect(task.model).toBe("copilot/explicit");
    });
});

// ─── edit_card ────────────────────────────────────────────────────────────────

describe("executeCommonTool / edit_card", () => {
    it("updates title and description before a branch is created", async () => {
        const result = await executeCommonTool(
            "edit_card",
            { task_id: taskId, title: "Updated", description: "New desc" },
            commonCtx(),
        );
        const task = JSON.parse(result.text);
        expect(task.title).toBe("Updated");
        expect(task.description).toBe("New desc");
    });

    it("returns error if task does not exist", async () => {
        const result = await executeCommonTool(
            "edit_card",
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
            "edit_card",
            { task_id: taskId, title: "Should fail" },
            commonCtx(),
        );
        expect(result.text).toContain("Error: cannot edit task once a branch has been created");
    });

    it("returns error when task_id is missing", async () => {
        const result = await executeCommonTool("edit_card", {}, commonCtx());
        expect(result.text).toContain("Error: field 'task_id' is required");
    });
});

// ─── delete_card ──────────────────────────────────────────────────────────────

describe("executeCommonTool / delete_card", () => {
    it("deletes the task and all cascaded data", async () => {
        const result = await executeCommonTool(
            "delete_card",
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
            "delete_card",
            { task_id: 999999 },
            commonCtx(),
        );
        expect(result.text).toContain("Error: task 999999 not found");
    });

    it("returns error when task_id is missing", async () => {
        const result = await executeCommonTool("delete_card", {}, commonCtx());
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
            "delete_card",
            { task_id: taskId },
            commonCtx({ onCancel: (id) => { cancelledId = id; } }),
        );

        expect(cancelledId).toBe(execId);
    });
});

// ─── move_card ────────────────────────────────────────────────────────────────

describe("executeCommonTool / move_card", () => {
    it("moves a task to a valid workflow column", async () => {
        const result = await executeCommonTool(
            "move_card",
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
            "move_card",
            { task_id: taskId, workflow_state: "nonexistent" },
            commonCtx(),
        );
        expect(result.text).toContain("Error: workflow_state \"nonexistent\" not found in board template");
    });

    it("fires onTransition (Case B) for idle other task moving to prompt column", async () => {
        // Seed a second idle task that is NOT the calling task
        db.run(
            "INSERT INTO tasks (board_id, project_key, title, workflow_state, execution_state) VALUES (?, ?, 'Other task', 'backlog', 'idle')",
            [boardId, projectKey],
        );
        const otherTaskId = (db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!).id;

        let calledWith: [number, string] | null = null;
        await executeCommonTool(
            "move_card",
            { task_id: otherTaskId, workflow_state: "plan" },
            commonCtx({ onTransition: (id, state) => { calledWith = [id, state]; } }),
        );
        expect(calledWith).toEqual([otherTaskId, "plan"]);
    });

    it("defers column prompt (Case A) when task moves itself to prompt column", async () => {
        let calledWith: [number, string] | null = null;
        // ctx.taskId === task_id (self-move), target column "plan" has on_enter_prompt
        await executeCommonTool(
            "move_card",
            { task_id: taskId, workflow_state: "plan" },
            { ...commonCtx({ taskId }), workflow: { ...commonCtx({ taskId }).workflow, onTransition: (id: number, state: string) => { calledWith = [id, state]; } } },
        );
        // onTransition should NOT be called immediately — deferred via needs_column_prompt flag
        expect(calledWith).toBeNull();
        const row = db
            .query<{ needs_column_prompt: number }, [number]>("SELECT needs_column_prompt FROM tasks WHERE id = ?")
            .get(taskId);
        expect(row?.needs_column_prompt).toBe(1);
    });

    it("does not fire onTransition (Case C) when target column has no prompt", async () => {
        let calledWith: [number, string] | null = null;
        await executeCommonTool(
            "move_card",
            { task_id: taskId, workflow_state: "done" },
            commonCtx({ onTransition: (id, state) => { calledWith = [id, state]; } }),
        );
        expect(calledWith).toBeNull();
        const row = db
            .query<{ workflow_state: string }, [number]>("SELECT workflow_state FROM tasks WHERE id = ?")
            .get(taskId);
        expect(row?.workflow_state).toBe("done");
    });

    it("defers column prompt (Case A2) when moving a running other task to prompt column", async () => {
        // Seed another task and mark it as running
        db.run(
            "INSERT INTO tasks (board_id, project_key, title, workflow_state, execution_state) VALUES (?, ?, 'Running task', 'backlog', 'running')",
            [boardId, projectKey],
        );
        const runningTaskId = (db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!).id;

        let calledWith: [number, string] | null = null;
        await executeCommonTool(
            "move_card",
            { task_id: runningTaskId, workflow_state: "plan" },
            commonCtx({ onTransition: (id, state) => { calledWith = [id, state]; } }),
        );
        expect(calledWith).toBeNull();
        const row = db
            .query<{ needs_column_prompt: number }, [number]>("SELECT needs_column_prompt FROM tasks WHERE id = ?")
            .get(runningTaskId);
        expect(row?.needs_column_prompt).toBe(1);
    });

    it("returns error when task 999999 does not exist", async () => {
        const result = await executeCommonTool(
            "move_card",
            { task_id: 999999, workflow_state: "done" },
            commonCtx(),
        );
        expect(result.text).toContain("Error: task 999999 not found");
    });

    it("returns error when task_id is missing", async () => {
        const result = await executeCommonTool("move_card", { workflow_state: "done" }, commonCtx());
        expect(result.text).toContain("Error: field 'task_id' is required");
    });

    it("returns error when workflow_state is missing", async () => {
        const result = await executeCommonTool("move_card", { task_id: taskId }, commonCtx());
        expect(result.text).toContain("Error: field 'workflow_state' is required");
    });

    it("sets position to 500 when moving to an empty column", async () => {
        await executeCommonTool("move_card", { task_id: taskId, workflow_state: "done" }, commonCtx());
        const row = db
            .query<{ position: number }, [number]>("SELECT position FROM tasks WHERE id = ?")
            .get(taskId);
        expect(row?.position).toBe(500);
    });
});

// ─── message_card ─────────────────────────────────────────────────────────────

describe("executeCommonTool / message_card", () => {
    it("delivers message (fires onHumanTurn) when task is idle", async () => {
        let deliveredTo: number | null = null;
        let deliveredMsg: string | null = null;
        const result = await executeCommonTool(
            "message_card",
            { task_id: taskId, message: "Please review" },
            commonCtx({ onHumanTurn: (id, msg) => { deliveredTo = id; deliveredMsg = msg; } }),
        );
        const res = JSON.parse(result.text);
        expect(res.status).toBe("delivered");
        expect(deliveredTo).toBe(taskId);
        expect(deliveredMsg).toBe("Please review");
    });

    it("queues message (inserts pending_messages row) when task is running", async () => {
        db.run("UPDATE tasks SET execution_state = 'running' WHERE id = ?", [taskId]);

        const result = await executeCommonTool(
            "message_card",
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
            "message_card",
            { task_id: 999999, message: "Hi" },
            commonCtx(),
        );
        expect(result.text).toContain("Error: task 999999 not found");
    });

    it("returns error when message is missing", async () => {
        const result = await executeCommonTool(
            "message_card",
            { task_id: taskId },
            commonCtx(),
        );
        expect(result.text).toContain("Error: field 'message' is required");
    });

    it("returns error when task_id is missing", async () => {
        const result = await executeCommonTool(
            "message_card",
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
        const item = JSON.parse(result.text).data;
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
        const item = JSON.parse(result.text).data;
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
        )).text).data;

        const result = await executeCommonTool(
            "edit_todo",
            { id: created.id, phase: "in-progress" },
            commonCtx(),
        );
        const item = JSON.parse(result.text).data;
        expect(item.phase).toBe("in-progress");
    });

    it("clears phase when null string is passed", async () => {
        const created = JSON.parse((await executeCommonTool(
            "create_todo",
            { number: 10, title: "My todo", description: "Do it", phase: "backlog" },
            commonCtx(),
        )).text).data;

        const result = await executeCommonTool(
            "edit_todo",
            { id: created.id, phase: "null" },
            commonCtx(),
        );
        const item = JSON.parse(result.text).data;
        expect(item.phase).toBeNull();
    });

    it("does not change phase when phase key is absent", async () => {
        const created = JSON.parse((await executeCommonTool(
            "create_todo",
            { number: 10, title: "My todo", description: "Do it", phase: "backlog" },
            commonCtx(),
        )).text).data;

        const result = await executeCommonTool(
            "edit_todo",
            { id: created.id, title: "Updated title" },
            commonCtx(),
        );
        const item = JSON.parse(result.text).data;
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
        const items = JSON.parse(result.text).data;
        expect(items).toHaveLength(2);
        expect(items.find((t: { title: string }) => t.title === "No phase").phase).toBeNull();
        expect(items.find((t: { title: string }) => t.title === "Backlog only").phase).toBe("backlog");
    });
});// ─── list_boards ──────────────────────────────────────────────────────────────

describe("executeCommonTool / list_boards", () => {
    it("returns board id and name for seeded boards", async () => {
        const result = await executeCommonTool("list_boards", {}, commonCtx());
        const boards = JSON.parse(result.text) as Array<{ id: number; name: string }>;
        expect(boards.length).toBe(1);
        expect(boards[0].id).toBe(boardId);
        expect(boards[0].name).toBe("test-board");
    });

    it("returns empty array when no boards exist", async () => {
        db.run("DELETE FROM tasks; DELETE FROM boards");
        const result = await executeCommonTool("list_boards", {}, commonCtx());
        const boards = JSON.parse(result.text) as Array<unknown>;
        expect(boards.length).toBe(0);
    });

    it("is included in cards_read group", () => {
        expect(TOOL_GROUPS.get("cards_read")).toContain("list_boards");
    });
});

// ─── Chat context board tools ─────────────────────────────────────────────────

describe("executeCommonTool / chat context board tools", () => {
    it("list_cards succeeds with explicit board_id in chat context", async () => {
        const result = await executeCommonTool(
            "list_cards",
            { board_id: boardId },
            commonCtx({ boardId: undefined }),
        );
        const cards = JSON.parse(result.text) as Array<{ id: number }>;
        expect(cards.length).toBe(1);
        expect(cards[0].id).toBe(taskId);
    });

    it("create_card succeeds with explicit board_id in chat context", async () => {
        const result = await executeCommonTool(
            "create_card",
            { board_id: boardId, project_key: projectKey, title: "Chat card", description: "Created from chat" },
            commonCtx({ boardId: undefined }),
        );
        const card = JSON.parse(result.text);
        expect(card.id).toBeGreaterThan(0);
        expect(card.title).toBe("Chat card");
    });

    it("get_board_summary succeeds with explicit board_id in chat context", async () => {
        const result = await executeCommonTool(
            "get_board_summary",
            { board_id: boardId },
            commonCtx({ boardId: undefined }),
        );
        const summary = JSON.parse(result.text);
        expect(summary.board_id).toBe(boardId);
    });

    it("create_card error includes board list when board_id missing in chat context", async () => {
        const result = await executeCommonTool(
            "create_card",
            { project_key: projectKey, title: "X", description: "" },
            commonCtx({ boardId: undefined }),
        );
        expect(result.text).toContain("Available boards:");
    });

    it("list_cards error includes board list when board_id missing in chat context", async () => {
        const result = await executeCommonTool(
            "list_cards",
            {},
            commonCtx({ boardId: undefined }),
        );
        expect(result.text).toContain("Available boards:");
    });
});

// ─── Display labels ───────────────────────────────────────────────────────────

import { buildCommonToolDisplay } from "../engine/common-tools.ts";

describe("buildCommonToolDisplay / card tools", () => {
    it("create_card display label is 'create card'", () => {
        const result = buildCommonToolDisplay("create_card", { title: "Test" });
        expect(result.label).toBe("create card");
        expect(result.subject).toBe("Test");
    });

    it("get_card display label is 'get card'", () => {
        const result = buildCommonToolDisplay("get_card", { task_id: 1 });
        expect(result.label).toBe("get card");
        expect(result.subject).toBe("#1");
    });

    it("list_boards display label is 'list boards'", () => {
        const result = buildCommonToolDisplay("list_boards", {});
        expect(result.label).toBe("list boards");
    });
});
