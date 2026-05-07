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
import type { BoardToolContext } from "../workflow/tools/types.ts";
import { DECISION_REQUEST_TOOL_DEFINITION } from "./decision-request-tool-definition.ts";
import { LSP_TOOL_DEFINITIONS } from "./lsp-tool-definitions.ts";
import {
  executeLspGoToDefinition,
  executeLspFindReferences,
  executeLspDocumentSymbols,
  executeLspWorkspaceSymbols,
  executeLspHover,
  executeLspRename,
  executeLspIncomingCalls,
  executeLspOutgoingCalls,
  executeLspDiagnostics,
  executeLspTypeDefinition,
} from "../workflow/tools/lsp-tools.ts";
import { validateToolArgs } from "./validate-tool-args.ts";

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
  DECISION_REQUEST_TOOL_DEFINITION,
  // ── decision tools ───────────────────────────────────────────────────────────
  {
    name: "list_decisions",
    description: "List all active decision records for this conversation. Use this to review existing decisions before making new ones, or to find an ID for update_decision.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "record_decision",
    description:
      "Silently record an AI-made decision without user interaction. Use when you've made a choice and want to persist it for future context. For user-interactive decisions, use decision_request instead.\n\n" +
      "ALWAYS call this tool after every decision_request response to record each answered question — never skip or defer.\n" +
      "ALWAYS call list_decisions() first to check whether a record already exists for the question before calling record_decision.\n" +
      "NEVER call record_decision when a record already exists — use update_decision instead to avoid duplicates.",
    parameters: {
      type: "object",
      properties: {
        question: { type: "string", description: "The decision question or context" },
        answer: { type: "string", description: "The chosen answer or approach" },
        weight: { type: "string", enum: ["critical", "medium", "easy"], description: "How hard this decision is to change later" },
        notes: { type: "string", description: "Optional rationale or caveats" },
      },
      required: ["question", "answer"],
    },
  },
  {
    name: "update_decision",
    description: "Revise an existing decision record. Always provide a reason — this prevents loops and documents why the approach changed. The old answer is preserved in revision history.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "number", description: "Decision record ID (get from list_decisions)" },
        answer: { type: "string", description: "The new answer replacing the previous one" },
        reason: { type: "string", description: "Why this decision is being changed — required to prevent loops" },
        notes: { type: "string", description: "Optional updated notes" },
      },
      required: ["id", "answer", "reason"],
    },
  },
  {
    name: "delete_decision",
    description: "Soft-delete a decision record. The record is marked deleted and no longer injected into context. Use when a decision is no longer relevant.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "number", description: "Decision record ID to delete (get from list_decisions)" },
      },
      required: ["id"],
    },
  },
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
  ...LSP_TOOL_DEFINITIONS,
];

export const COMMON_TOOL_NAMES = new Set(COMMON_TOOL_DEFINITIONS.map((t) => t.name));

// ─── Display builder ──────────────────────────────────────────────────────────

import type { ToolCallDisplay } from "../../shared/rpc-types.ts";

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
    case "decision_request":
      return { label: "decision request" };
    case "list_decisions":
      return { label: "list decisions" };
    case "record_decision":
      return { label: "record decision", subject: args.question != null ? String(args.question).slice(0, 60) : undefined };
    case "update_decision":
      return { label: "update decision", subject: args.id != null ? `#${args.id}` : undefined };
    case "delete_decision":
      return { label: "delete decision", subject: args.id != null ? `#${args.id}` : undefined };
    case "create_todo":
    case "edit_todo": {
      const num = args.number != null ? String(args.number) : null;
      const title = args.title != null ? String(args.title) : null;
      const subject = num && title ? `${num}. ${title}` : title ?? num ?? undefined;
      const content = args.description != null ? String(args.description) : undefined;
      return { label: name === "create_todo" ? "create todo" : "edit todo", subject };
    }
    case "list_todos":
      return { label: "todo list" };
    case "reorganize_todos":
      return { label: "todo list" };
    case "update_todo_status":
      return { label: "todo status", subject: args.id != null ? `#${args.id} → ${args.status ?? ""}` : undefined };
    case "get_todo":
      return { label: "get todo", subject: args.id != null ? `#${args.id}` : undefined };
    case "lsp_go_to_definition":
      return { label: "go to definition", subject: args.file_path != null ? String(args.file_path) : undefined };
    case "lsp_find_references":
      return { label: "find references", subject: args.file_path != null ? String(args.file_path) : undefined };
    case "lsp_document_symbols":
      return { label: "document symbols", subject: args.file_path != null ? String(args.file_path) : undefined };
    case "lsp_workspace_symbols":
      return { label: "workspace symbols", subject: args.query != null ? String(args.query) : undefined };
    case "lsp_hover":
      return { label: "hover", subject: args.file_path != null ? String(args.file_path) : undefined };
    case "lsp_rename":
      return { label: "rename symbol", subject: args.new_name != null ? String(args.new_name) : undefined };
    case "lsp_incoming_calls":
      return { label: "incoming calls", subject: args.file_path != null ? String(args.file_path) : undefined };
    case "lsp_outgoing_calls":
      return { label: "outgoing calls", subject: args.file_path != null ? String(args.file_path) : undefined };
    case "lsp_diagnostics":
      return { label: "diagnostics", subject: args.file_path != null ? String(args.file_path) : undefined };
    case "lsp_type_definition":
      return { label: "type definition", subject: args.file_path != null ? String(args.file_path) : undefined };
    default:
      return { label: name };
  }
}



/**
 * Execute a common task-management tool by name.
 * Returns a plain JSON/text string suitable for sending back to the LLM.
 */
export type ToolExecutionResult =
  | { type: "result"; text: string; writtenFiles?: import("../../shared/rpc-types.ts").FileDiffPayload[]; beforeFiles?: Record<string, string | null> }
  | { type: "suspend"; text: string; payload: string };

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
  if (name === "decision_request") {
    const context = typeof args.context === "string" ? args.context.trim() : "";
    const payload: Record<string, unknown> = { questions: args.questions };
    if (context) payload.context = context;
    return { type: "suspend", text: "", payload: JSON.stringify(payload) };
  }
  if (name === "lsp_rename") {
    if (!ctx.runtime.lspManager) return { type: "result", text: "Error: LSP is not configured. Add lsp.servers to workspace.yaml." };
    if (!ctx.runtime.worktreePath) return { type: "result", text: "Error: worktreePath is not set in tool context" };
    return executeLspRename(args, ctx.runtime.lspManager, ctx.runtime.worktreePath);
  }
  const text = await executeCommonToolText(name, args, ctx);
  return { type: "result", text };
}

async function executeCommonToolText(
  name: string,
  args: Record<string, unknown>,
  ctx: CommonToolContext,
): Promise<string> {
  const boardCtx: BoardToolContext = {
    taskId: ctx.task.id ?? undefined,
    boardId: ctx.task.boardId ?? undefined,
    onTransition: ctx.workflow.onTransition,
    onHumanTurn: ctx.workflow.onHumanTurn,
    onCancel: ctx.workflow.onCancel,
    onTaskUpdated: ctx.workflow.onTaskUpdated,
  };

  switch (name) {
    case "get_task":
      return ctx.repos.boardTools.execGetTask(args, boardCtx);
    case "get_board_summary":
      return ctx.repos.boardTools.execGetBoardSummary(args, boardCtx);
    case "list_tasks":
      return ctx.repos.boardTools.execListTasks(args, boardCtx);
    case "create_task":
      return ctx.repos.boardTools.execCreateTask(args, boardCtx);
    case "edit_task":
      return ctx.repos.boardTools.execEditTask(args, boardCtx);
    case "delete_task":
      return ctx.repos.boardTools.execDeleteTask(args, boardCtx);
    case "move_task":
      return ctx.repos.boardTools.execMoveTask(args, boardCtx);
    case "message_task":
      return ctx.repos.boardTools.execMessageTask(args, boardCtx);

    case "list_decisions": {
      const records = ctx.repos.decisions.listByConversation(ctx.task.conversationId);
      if (records.length === 0) return "No decision records found for this conversation.";
      return JSON.stringify(records.map((r) => ({
        id: r.id,
        question: r.question,
        answer: r.answer,
        weight: r.weight,
        notes: r.notes,
        revisionCount: r.revisionCount,
        isSourceAi: r.isSourceAi,
      })));
    }

    case "record_decision": {
      const question = args.question != null ? (args.question as string).trim() : "";
      if (!question) return "Error: question is required";
      const answer = args.answer != null ? (args.answer as string).trim() : "";
      if (!answer) return "Error: answer is required";
      const weight = args.weight != null ? (args.weight as string) : "medium";
      const notes = args.notes != null ? (args.notes as string) : undefined;
      ctx.repos.decisions.createRecord(ctx.task.conversationId, {
        question,
        answer,
        weight: weight as import("../db/repositories/decision-repository.ts").DecisionWeight,
        notes,
        isSourceAi: true,
      });
      return `Decision recorded: ${question} → ${answer}`;
    }

    case "update_decision": {
      const id = args.id != null ? Number(args.id) : NaN;
      if (!id || isNaN(id)) return "Error: id is required";
      const answer = args.answer != null ? (args.answer as string).trim() : "";
      if (!answer) return "Error: answer is required";
      const reason = args.reason != null ? (args.reason as string).trim() : "";
      if (!reason) return "Error: reason is required";
      const notes = args.notes != null ? (args.notes as string) : undefined;
      const record = ctx.repos.decisions.updateRecord(id, answer, reason, notes);
      return `Decision #${id} updated. Revision #${record.revisionCount}.`;
    }

    case "delete_decision": {
      const id = args.id != null ? Number(args.id) : NaN;
      if (!id || isNaN(id)) return "Error: id is required";
      ctx.repos.decisions.deleteRecord(id);
      return `Decision #${id} deleted.`;
    }

    case "create_todo": {
      const number = args.number != null ? Number(args.number) : NaN;
      if (isNaN(number)) return "Error: number is required";
      const title = args.title != null ? (args.title as string).trim() : "";
      if (!title) return "Error: title is required";
      const description = args.description != null ? (args.description as string).trim() : "";
      if (!description) return "Error: description is required";
      const phase = args.phase != null ? String(args.phase) : undefined;
      const item = ctx.repos.todos.createTodo(ctx.task.id!, number, title, description, phase);
      return JSON.stringify(item);
    }

    case "edit_todo": {
      if (!ctx.task.id) return "Error: edit_todo is only available within a task execution";
      const id = args.id != null ? Number(args.id) : NaN;
      if (!id || isNaN(id)) return "Error: id is required";
      const update: Parameters<typeof ctx.repos.todos.editTodo>[2] = {};
      if (args.number !== undefined) update.number = Number(args.number);
      if (args.title !== undefined) update.title = (args.title as string).trim();
      if (args.description !== undefined) update.description = args.description as string;
      if ("phase" in args) update.phase = args.phase === "null" || args.phase == null ? null : String(args.phase);
      const result = ctx.repos.todos.editTodo(ctx.task.id, id, update);
      if (!result) return `Error: todo ${id} not found`;
      return JSON.stringify(result);
    }

    case "list_todos": {
      if (!ctx.task.id) return "Error: list_todos is only available within a task execution";
      const todos = ctx.repos.todos.listTodos(ctx.task.id);
      return JSON.stringify(todos);
    }

    case "get_todo": {
      if (!ctx.task.id) return "Error: get_todo is only available within a task execution";
      const id = args.id != null ? Number(args.id) : NaN;
      if (!id || isNaN(id)) return "Error: id is required";
      const todo = ctx.repos.todos.getTodo(ctx.task.id, id);
      if (!todo) return `Error: todo ${id} not found`;
      if ("deleted" in todo) return todo.message;
      return JSON.stringify(todo);
    }

    case "reorganize_todos": {
      if (!ctx.task.id) return "Error: reorganize_todos is only available within a task execution";
      const items = args.items as Array<{ id: number; number: number }>;
      const updated = ctx.repos.todos.reprioritizeTodos(ctx.task.id, items);
      return JSON.stringify(updated);
    }

    case "update_todo_status": {
      if (!ctx.task.id) return "Error: update_todo_status is only available within a task execution";
      const id = args.id != null ? Number(args.id) : NaN;
      if (!id || isNaN(id)) return "Error: id is required";
      const status = args.status != null ? (args.status as string).trim() : "";
      if (!status) return "Error: status is required";
      const result = ctx.repos.todos.editTodo(ctx.task.id, id, { status: status as import("../db/todos.ts").TodoStatus });
      if (!result) return `Error: todo ${id} not found`;
      return JSON.stringify(result);
    }

    case "lsp_go_to_definition":
    case "lsp_find_references":
    case "lsp_document_symbols":
    case "lsp_workspace_symbols":
    case "lsp_hover":
    case "lsp_incoming_calls":
    case "lsp_outgoing_calls":
    case "lsp_diagnostics":
    case "lsp_type_definition": {
      if (!ctx.runtime.lspManager) {
        return "Error: LSP is not configured. Add lsp.servers to workspace.yaml.";
      }
      if (!ctx.runtime.worktreePath) {
        return "Error: worktreePath is not set in tool context";
      }
      const lsp = ctx.runtime.lspManager;
      const wtp = ctx.runtime.worktreePath;
      switch (name) {
        case "lsp_go_to_definition": return executeLspGoToDefinition(args, lsp, wtp);
        case "lsp_find_references": return executeLspFindReferences(args, lsp, wtp);
        case "lsp_document_symbols": return executeLspDocumentSymbols(args, lsp, wtp);
        case "lsp_workspace_symbols": return executeLspWorkspaceSymbols(args, lsp, wtp);
        case "lsp_hover": return executeLspHover(args, lsp, wtp);
        case "lsp_incoming_calls": return executeLspIncomingCalls(args, lsp, wtp);
        case "lsp_outgoing_calls": return executeLspOutgoingCalls(args, lsp, wtp);
        case "lsp_diagnostics": return executeLspDiagnostics(args, lsp, wtp);
        default: return executeLspTypeDefinition(args, lsp, wtp);
      }
    }

    default:
      return `Error: unknown common tool "${name}"`;
  }
}
