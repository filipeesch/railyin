/**
 * Common task-management tools shared across all engine implementations.
 *
 * These 8 tools (tasks_read + tasks_write groups) work identically regardless
 * of which AI engine is executing the agent loop. Each engine wraps them in
 * its own native tool registration format:
 *   - Native engine:  handled inside executeTool() in workflow/tools.ts
 *   - Copilot engine: wrapped with defineTool() in engine/copilot/tools.ts
 */

import type { AIToolDefinition } from "../ai/types.ts";
import type { CommonToolContext } from "./types.ts";
import { INTERVIEW_ME_TOOL_DEFINITION } from "./interview-tool-definition.ts";
import { LSP_TOOL_DEFINITION } from "./lsp-tool-definition.ts";
import { executeLspTool } from "../workflow/tools/lsp-tools.ts";
import { validateToolArgs } from "./validate-tool-args.ts";
import {
  execGetTask,
  execGetBoardSummary,
  execListTasks,
  execCreateTask,
  execEditTask,
  execDeleteTask,
  execMoveTask,
  execMessageTask,
} from "../workflow/tools/board-tools.ts";

// ─── Tool definitions (metadata + JSON schema) ────────────────────────────────

export const COMMON_TOOL_DEFINITIONS: AIToolDefinition[] = [
  // ── tasks_read ───────────────────────────────────────────────────────────
  {
    name: "get_task",
    description:
      "Fetch metadata for a specific task by ID.\n\n" +
      "Usage:\n" +
      "- Returns title, description, workflow_state, execution_state, model, branch, worktree path, execution count\n" +
      "- Use include_messages=N for the last N conversation messages in chronological order\n" +
      "- Returns metadata only — use read_file to inspect files in the task's worktree",
    parameters: {
      type: "object",
      properties: {
        task_id: { type: "number", description: "The id of the task to fetch." },
        include_messages: { type: "number", description: "If provided, include the last N conversation messages in chronological order." },
      },
      required: ["task_id"],
    },
  },
  {
    name: "get_board_summary",
    description:
      "Return a high-level summary of task distribution across board columns.\n\n" +
      "Usage:\n" +
      "- Shows total count and breakdown by execution_state (idle, running, completed, failed) per column\n" +
      "- Omit board_id to summarise the current task's board\n" +
      "- Use to get an overview before listing individual tasks",
    parameters: {
      type: "object",
      properties: {
        board_id: { type: "number", description: "The board to summarise. Defaults to the current task's board when omitted." },
      },
      required: [],
    },
  },
  {
    name: "list_tasks",
    description:
      "List tasks on a board with optional filters.\n\n" +
      "Usage:\n" +
      "- Filter by workflow_state, execution_state, project_key\n" +
      "- Use query for case-insensitive text search across title and description\n" +
      "- Omit board_id to search the current task's board; default limit 50 (max 200)",
    parameters: {
      type: "object",
      properties: {
        board_id: { type: "number", description: "Board to list tasks from. Defaults to the current task's board." },
        workflow_state: { type: "string", description: "Filter by exact workflow column id (e.g. 'backlog', 'in-progress')." },
        execution_state: { type: "string", description: "Filter by execution state (e.g. 'idle', 'running', 'failed')." },
        project_key: { type: "string", description: "Filter tasks belonging to a specific project." },
        query: { type: "string", description: "Case-insensitive substring search across title and description." },
        limit: { type: "number", description: "Maximum number of results to return (default 50, max 200)." },
      },
      required: [],
    },
  },
  // ── tasks_write ──────────────────────────────────────────────────────────
  {
    name: "create_task",
    description:
      "Create a new task in the backlog column of a board.\n\n" +
      "Usage:\n" +
      "- Starts in 'idle' execution state; use move_task to start it\n" +
      "- Omit board_id to create on the current task's board\n" +
      "- Use model parameter to override the default model for this task",
    parameters: {
      type: "object",
      properties: {
        project_key: { type: "string", description: "The project this task belongs to." },
        title: { type: "string", description: "The task title." },
        description: { type: "string", description: "The task description." },
        board_id: { type: "number", description: "Board to create the task on. Defaults to the current task's board." },
        model: { type: "string", description: "Optional model override for this task (e.g. 'lmstudio/qwen3-8b')." },
      },
      required: ["project_key", "title", "description"],
    },
  },
  {
    name: "edit_task",
    description:
      "Update the title and/or description of a task.\n\n" +
      "Usage:\n" +
      "- Only allowed before a worktree/branch has been created\n" +
      "- At least one of title or description must be provided",
    parameters: {
      type: "object",
      properties: {
        task_id: { type: "number", description: "The id of the task to edit." },
        title: { type: "string", description: "New title for the task." },
        description: { type: "string", description: "New description for the task." },
      },
      required: ["task_id"],
    },
  },
  {
    name: "delete_task",
    description:
      "Fully delete a task and all its data including conversation history, executions, and worktree.\n\n" +
      "Usage:\n" +
      "- Git branch is preserved; only task data is removed\n" +
      "- Running tasks are cancelled first; this action is permanent and cannot be undone",
    parameters: {
      type: "object",
      properties: {
        task_id: { type: "number", description: "The id of the task to delete." },
      },
      required: ["task_id"],
    },
  },
  {
    name: "move_task",
    description:
      "Move a task to a different workflow column.\n\n" +
      "Usage:\n" +
      "- workflow_state is updated immediately\n" +
      "- If the target column has an on_enter_prompt, it is triggered asynchronously\n" +
      "- Returns immediately without waiting for triggered execution to complete",
    parameters: {
      type: "object",
      properties: {
        task_id: { type: "number", description: "The id of the task to move." },
        workflow_state: { type: "string", description: "The target column id (e.g. 'backlog', 'in-progress', 'done')." },
      },
      required: ["task_id", "workflow_state"],
    },
  },
  {
    name: "message_task",
    description:
      "Append a message to another task's conversation and trigger its AI model.\n\n" +
      "Usage:\n" +
      "- Returns 'delivered' (idle/waiting) or 'queued' (running — delivered when execution finishes)\n" +
      "- Use for inter-task communication: sending results, requesting actions",
    parameters: {
      type: "object",
      properties: {
        task_id: { type: "number", description: "The id of the task to message." },
        message: { type: "string", description: "The message content to send." },
      },
      required: ["task_id", "message"],
    },
  },
  INTERVIEW_ME_TOOL_DEFINITION,
  // ── todo tools ───────────────────────────────────────────────────────────────
  {
    name: "create_todo",
    description:
      "Create a new todo subtask to help track complex multi-step work without losing context across compactions.\n\n" +
      "ALWAYS use create_todo when:\n" +
      "- Starting a task with 3 or more steps that need to be tracked\n" +
      "- Breaking down complex implementations where context might be lost\n" +
      "- Recording task context that must survive conversation compaction\n\n" +
      "NEVER use create_todo when:\n" +
      "- The work can be done in a single step\n" +
      "- You already have todos covering this work (call list_todos first)\n\n" +
      "The `description` field is a rich markdown memory. Write it as if explaining to yourself after a compaction — include WHY, WHAT to do, files involved, constraints, acceptance criteria. Be comprehensive.\n\n" +
      "The optional `phase` field scopes this todo to a specific board column (workflow state id, e.g. 'review', 'in-progress'). Todos scoped to a phase are only injected into the system context when the task is in that column — omit phase to make the todo always active regardless of the current column.",
    parameters: {
      type: "object",
      properties: {
        number: {
          type: "number",
          description: "Execution order (float). Use sparse values like 10, 20, 30 to allow inserting between items later.",
        },
        title: {
          type: "string",
          description: "Short label for the todo item (one line).",
        },
        description: {
          type: "string",
          description: "Rich markdown specification: what to do, why, files involved, constraints, acceptance criteria. This is a context memory — be comprehensive.",
        },
        phase: {
          type: "string",
          description: "Optional. The workflow state id (board column) this todo belongs to (e.g. 'review', 'in-progress'). When set, the todo is only injected into the system context while the task is in that column. Omit to make the todo always active.",
        },
      },
      required: ["number", "title", "description"],
    },
  },
  {
    name: "edit_todo",
    description:
      "Update one or more fields of a todo item by ID (number, title, or description).\n\n" +
      "ALWAYS call get_todo before editing to see the current content.\n" +
      "NEVER call edit_todo without knowing the current todo content — always get_todo first.\n" +
      "NEVER use edit_todo to change status — use update_todo_status instead.\n\n" +
      "At least one field must be provided.\n\n" +
      "The optional `phase` field scopes the todo to a specific board column. Pass null to clear the phase and make the todo always active.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "number", description: "The todo item id." },
        number: { type: "number", description: "New execution order (float)." },
        title: { type: "string", description: "New short label." },
        description: { type: "string", description: "Updated markdown specification." },
        phase: {
          type: "string",
          description: "Optional. New phase (workflow state id). Pass null to clear the phase and make the todo always active.",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "list_todos",
    description:
      "List all active todo items for the current task. Returns id, number, title, status, and phase for each item.\n\n" +
      "ALWAYS call list_todos before creating todos to avoid duplicates.\n" +
      "ALWAYS call list_todos at the start of a session to understand what work remains.\n" +
      "NEVER use list_todos to read descriptions — use get_todo for full content.\n\n" +
      "Note: this tool returns ALL non-deleted todos including those scoped to other phases. The system context only injects phase-active todos automatically.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "get_todo",
    description:
      "Get all fields of a todo item including the full markdown description.\n\n" +
      "ALWAYS call get_todo before editing a todo's description to see its current content.\n" +
      "ALWAYS call get_todo when you need to recall the full specification of a step.\n" +
      "If the todo was deleted, the tool returns a plain-text message telling you to skip it — treat that as a signal to move on, not an error.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "number", description: "The todo item id." },
      },
      required: ["id"],
    },
  },
  {
    name: "reorganize_todos",
    description:
      "Atomically update the execution order of multiple todo items in a single call.\n\n" +
      "ALWAYS use reorganize_todos instead of multiple edit_todo calls when reordering.\n" +
      "Use sparse float numbers (e.g. 10, 20, 30) to leave room for future insertions.\n" +
      "Returns the updated list of all active todos.",
    parameters: {
      type: "object",
      properties: {
        items: {
          type: "array",
          description: "Array of {id, number} pairs to update.",
          items: {
            type: "object",
            properties: {
              id: { type: "number", description: "Todo item id." },
              number: { type: "number", description: "New execution order." },
            },
            required: ["id", "number"],
          },
        },
      },
      required: ["items"],
    },
  },
  {
    name: "update_todo_status",
    description:
      "Update the status of a todo item.\n\n" +
      "ALWAYS use update_todo_status (not edit_todo) when changing status.\n" +
      "ALWAYS set status to 'in-progress' when starting a todo.\n" +
      "ALWAYS set status to 'done' when a todo is complete.\n" +
      "ALWAYS set status to 'blocked' if a todo cannot proceed.\n" +
      "ALWAYS set status to 'deleted' to soft-delete a todo that is no longer relevant or was created in error.\n" +
      "NEVER skip updating status — it is the primary way to track progress.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "number", description: "The todo item id." },
        status: {
          type: "string",
          enum: ["pending", "in-progress", "done", "blocked", "deleted"],
          description: "New status: 'pending', 'in-progress', 'done', 'blocked', or 'deleted' (soft-delete).",
        },
      },
      required: ["id", "status"],
    },
  },
  LSP_TOOL_DEFINITION,
];

export const COMMON_TOOL_NAMES = new Set(COMMON_TOOL_DEFINITIONS.map((t) => t.name));

// ─── Display builder ──────────────────────────────────────────────────────────

import type { ToolCallDisplay } from "./types.ts";

export function buildCommonToolDisplay(name: string, args: Record<string, unknown>): ToolCallDisplay {
  const str = (v: unknown): string => (v != null ? String(v) : "");
  switch (name) {
    case "get_task":
      return { label: "get task", subject: args.task_id != null ? `#${args.task_id}` : undefined };
    case "list_tasks":
      return { label: "list tasks", subject: str(args.workflow_state || args.query) || undefined };
    case "get_board_summary":
      return { label: "board summary" };
    case "create_task":
      return { label: "create task", subject: str(args.title) || undefined };
    case "edit_task":
      return { label: "edit task", subject: args.task_id != null ? `#${args.task_id}` : undefined };
    case "delete_task":
      return { label: "delete task", subject: args.task_id != null ? `#${args.task_id}` : undefined };
    case "move_task": {
      const id = args.task_id != null ? `#${args.task_id}` : null;
      const to = str(args.workflow_state) || null;
      return { label: "move task", subject: id && to ? `${id} → ${to}` : id ?? to ?? undefined };
    }
    case "message_task":
      return { label: "message task", subject: args.task_id != null ? `#${args.task_id}` : undefined };
    case "interview_me":
      return { label: "interview me" };
    case "create_todo":
    case "edit_todo": {
      const num = args.number != null ? String(args.number) : null;
      const title = args.title != null ? String(args.title) : null;
      const subject = num && title ? `${num}. ${title}` : title ?? num ?? undefined;
      const content = args.description != null ? String(args.description) : undefined;
      return { label: name === "create_todo" ? "create todo" : "edit todo", subject, content };
    }
    case "list_todos":
      return { label: "todo list" };
    case "reorganize_todos":
      return { label: "todo list" };
    case "update_todo_status":
      return { label: "todo status", subject: args.id != null ? `#${args.id} → ${args.status ?? ""}` : undefined };
    case "get_todo":
      return { label: "get todo", subject: args.id != null ? `#${args.id}` : undefined };
    default:
      return { label: name };
  }
}



/**
 * Execute a common task-management tool by name.
 * Returns a plain JSON/text string suitable for sending back to the LLM.
 */
export type ToolExecutionResult =
  | { type: "result"; text: string }
  | { type: "suspend"; payload: string };

/**
 * Execute a common tool and return a typed result.
 * Tools marked with `suspendLoop: true` on their definition return `{ type: "suspend" }`
 * — the engine is responsible for stopping the agent loop and emitting the event.
 */
export async function executeCommonTool(
  name: string,
  args: Record<string, unknown>,
  ctx: CommonToolContext,
): Promise<ToolExecutionResult> {
  const def = COMMON_TOOL_DEFINITIONS.find((d) => d.name === name);
  if (def) {
    const err = validateToolArgs(def, args);
    if (err) return { type: "result", text: err };
  }
  if (name === "interview_me") {
    const context = typeof args.context === "string" ? args.context.trim() : "";
    const payload: Record<string, unknown> = { questions: args.questions };
    if (context) payload.context = context;
    return { type: "suspend", payload: JSON.stringify(payload) };
  }
  const text = await executeCommonToolText(name, args, ctx);
  return { type: "result", text };
}

async function executeCommonToolText(
  name: string,
  args: Record<string, unknown>,
  ctx: CommonToolContext,
): Promise<string> {
  switch (name) {
    case "get_task":
      return execGetTask(args, ctx);
    case "get_board_summary":
      return execGetBoardSummary(args, ctx);
    case "list_tasks":
      return execListTasks(args, ctx);
    case "create_task":
      return execCreateTask(args, ctx);
    case "edit_task":
      return execEditTask(args, ctx);
    case "delete_task":
      return execDeleteTask(args, ctx);
    case "move_task":
      return execMoveTask(args, ctx);
    case "message_task":
      return execMessageTask(args, ctx);

    case "create_todo": {
      const number = args.number != null ? Number(args.number) : NaN;
      if (isNaN(number)) return "Error: number is required";
      const title = args.title != null ? (args.title as string).trim() : "";
      if (!title) return "Error: title is required";
      const description = args.description != null ? (args.description as string).trim() : "";
      if (!description) return "Error: description is required";
      const phase = args.phase != null ? String(args.phase) : undefined;
      const item = ctx.todoRepo.createTodo(ctx.taskId, number, title, description, phase);
      return JSON.stringify(item);
    }

    case "edit_todo": {
      if (!ctx.taskId) return "Error: edit_todo is only available within a task execution";
      const id = args.id != null ? Number(args.id) : NaN;
      if (!id || isNaN(id)) return "Error: id is required";
      const update: Parameters<typeof ctx.todoRepo.editTodo>[2] = {};
      if (args.number !== undefined) update.number = Number(args.number);
      if (args.title !== undefined) update.title = (args.title as string).trim();
      if (args.description !== undefined) update.description = args.description as string;
      if ("phase" in args) update.phase = args.phase === "null" || args.phase == null ? null : String(args.phase);
      const result = ctx.todoRepo.editTodo(ctx.taskId, id, update);
      if (!result) return `Error: todo ${id} not found`;
      return JSON.stringify(result);
    }

    case "list_todos": {
      if (!ctx.taskId) return "Error: list_todos is only available within a task execution";
      const todos = ctx.todoRepo.listTodos(ctx.taskId);
      return JSON.stringify(todos);
    }

    case "get_todo": {
      if (!ctx.taskId) return "Error: get_todo is only available within a task execution";
      const id = args.id != null ? Number(args.id) : NaN;
      if (!id || isNaN(id)) return "Error: id is required";
      const todo = ctx.todoRepo.getTodo(ctx.taskId, id);
      if (!todo) return `Error: todo ${id} not found`;
      if ("deleted" in todo) return todo.message;
      return JSON.stringify(todo);
    }

    case "reorganize_todos": {
      if (!ctx.taskId) return "Error: reorganize_todos is only available within a task execution";
      const items = args.items as Array<{ id: number; number: number }>;
      const updated = ctx.todoRepo.reprioritizeTodos(ctx.taskId, items);
      return JSON.stringify(updated);
    }

    case "update_todo_status": {
      if (!ctx.taskId) return "Error: update_todo_status is only available within a task execution";
      const id = args.id != null ? Number(args.id) : NaN;
      if (!id || isNaN(id)) return "Error: id is required";
      const status = args.status != null ? (args.status as string).trim() : "";
      if (!status) return "Error: status is required";
      const result = ctx.todoRepo.editTodo(ctx.taskId, id, { status: status as import("../db/todos.ts").TodoStatus });
      if (!result) return `Error: todo ${id} not found`;
      return JSON.stringify(result);
    }

    case "lsp": {
      if (!ctx.lspManager) {
        return "Error: LSP is not configured. Add lsp.servers to workspace.yaml.";
      }
      if (!ctx.worktreePath) {
        return "Error: worktreePath is not set in tool context";
      }
      return executeLspTool(args, ctx.lspManager, ctx.worktreePath);
    }

    default:
      return `Error: unknown common tool "${name}"`;
  }
}
