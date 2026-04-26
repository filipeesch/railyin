import type { AIToolDefinition } from "../../ai/types.ts";
import { INTERVIEW_ME_TOOL_DEFINITION } from "../../engine/interview-tool-definition.ts";
import { LSP_TOOL_DEFINITION } from "../../engine/lsp-tool-definition.ts";

export const TOOL_DEFINITIONS: AIToolDefinition[] = [
  {
    name: "ask_me",
    description:
      "Pause execution and ask one or more questions with structured options.\n\n" +
      "Usage:\n" +
      "- Each question needs: question text, selection_mode ('single'/'multi'), and options array\n" +
      "- Options support: label (required), description, recommended, preview (markdown)\n" +
      "- ALWAYS batch related decisions into the same call to minimize interruptions\n" +
      "- NEVER use for confirmation on routine operations",
    parameters: {
      type: "object",
      properties: {
        questions: {
          type: "array",
          description: "One or more questions to ask. Batch related decisions into the same call.",
          items: {
            type: "object",
            properties: {
              question: { type: "string", description: "The question text." },
              selection_mode: {
                type: "string",
                enum: ["single", "multi"],
                description: "'single' for one selection, 'multi' for multiple.",
              },
              options: {
                type: "array",
                description: "Options to present. Must contain at least one.",
                items: {
                  type: "object",
                  properties: {
                    label: { type: "string", description: "Option text." },
                    description: { type: "string", description: "Secondary explanation." },
                    recommended: { type: "boolean", description: "Highlight as default." },
                    preview: { type: "string", description: "Markdown preview pane content." },
                  },
                  required: ["label"],
                },
              },
            },
            required: ["question", "selection_mode", "options"],
          },
        },
      },
      required: ["questions"],
    },
  },
  INTERVIEW_ME_TOOL_DEFINITION,
  {
    name: "spawn_agent",
    description:
      "Spawn one or more parallel sub-agents that execute independently in the same worktree.\n\n" +
      "Usage:\n" +
      "- Each child gets its own instructions, tools, and conversation with full parent context\n" +
      "- Returns a JSON array of result strings (one per child) in input order\n" +
      "- Use for parallelising independent tasks (reviewing files, searching, implementing unrelated changes)\n" +
      "- Provide complete instructions for each child including file paths, context, and constraints",
    parameters: {
      type: "object",
      properties: {
        children: {
          type: "array",
          description: "Sub-agents to spawn.",
          items: {
            type: "object",
            properties: {
              instructions: {
                type: "string",
                description: "Complete self-contained task description. Include all context — file paths, background, constraints, action. Sub-agent has no conversation history.",
              },
              tools: {
                type: "array",
                items: { type: "string" },
                description: "Tool group names or individual tool names for this sub-agent.",
              },
              scope: {
                type: "string",
                description: "Optional hint about which paths this agent should touch.",
              },
            },
            required: ["instructions", "tools"],
          },
        },
      },
      required: ["children"],
    },
  },
  // ── web group ──────────────────────────────────────────────────────────────
  {
    name: "fetch_url",
    description:
      "Fetch a public URL and return its text content.\n\n" +
      "Usage:\n" +
      "- HTML pages are stripped to readable text\n" +
      "- No authentication — only publicly accessible URLs work\n" +
      "- Large responses may be truncated; prefer specific pages over tables of contents",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The URL to fetch.",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "search_internet",
    description:
      "Search the web and return ranked results with title, URL, and snippet.\n\n" +
      "Usage:\n" +
      "- Returns up to 10 results; follow up with fetch_url for full content\n" +
      "- Use for finding documentation, researching APIs, looking up error messages",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query.",
        },
      },
      required: ["query"],
    },
  },
  // ── tasks_read group ───────────────────────────────────────────────────────
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
        task_id: {
          type: "number",
          description: "The id of the task to fetch.",
        },
        include_messages: {
          type: "number",
          description: "If provided, include the last N conversation messages in chronological order.",
        },
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
        board_id: {
          type: "number",
          description: "The board to summarise. Defaults to the current task's board when omitted.",
        },
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
        board_id: {
          type: "number",
          description: "Board to list tasks from. Defaults to the current task's board.",
        },
        workflow_state: {
          type: "string",
          description: "Filter by exact workflow column id (e.g. 'backlog', 'in-progress').",
        },
        execution_state: {
          type: "string",
          description: "Filter by execution state (e.g. 'idle', 'running', 'failed').",
        },
        project_key: {
          type: "string",
          description: "Filter tasks belonging to a specific project.",
        },
        query: {
          type: "string",
          description: "Case-insensitive substring search across title and description.",
        },
        limit: {
          type: "number",
          description: "Maximum number of results to return (default 50, max 200).",
        },
      },
      required: [],
    },
  },
  // ── tasks_write group ──────────────────────────────────────────────────────
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
        project_key: {
          type: "string",
          description: "The project this task belongs to.",
        },
        title: {
          type: "string",
          description: "The task title.",
        },
        description: {
          type: "string",
          description: "The task description.",
        },
        board_id: {
          type: "number",
          description: "Board to create the task on. Defaults to the current task's board.",
        },
        model: {
          type: "string",
          description: "Optional model override for this task (e.g. 'lmstudio/qwen3-8b').",
        },
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
        task_id: {
          type: "number",
          description: "The id of the task to edit.",
        },
        title: {
          type: "string",
          description: "New title for the task.",
        },
        description: {
          type: "string",
          description: "New description for the task.",
        },
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
        task_id: {
          type: "number",
          description: "The id of the task to delete.",
        },
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
        task_id: {
          type: "number",
          description: "The id of the task to move.",
        },
        workflow_state: {
          type: "string",
          description: "The target column id (e.g. 'backlog', 'in-progress', 'done').",
        },
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
        task_id: {
          type: "number",
          description: "The id of the task to message.",
        },
        message: {
          type: "string",
          description: "The message content to send.",
        },
      },
      required: ["task_id", "message"],
    },
  },
  // ── todos group ────────────────────────────────────────────────────────────
  {
    name: "create_todo",
    description:
      "Create a new todo subtask to help track complex multi-step work without losing context across compactions.\n\n" +
      "ALWAYS use create_todo when starting a task with 3 or more steps that need tracking.\n" +
      "NEVER use create_todo when the work can be done in a single step or todos already cover it (call list_todos first).\n\n" +
      "The `description` field is a rich markdown memory — include WHY, WHAT to do, files involved, constraints, acceptance criteria.\n" +
      "The optional `phase` field scopes this todo to a specific board column; omit to make it always active.",
    parameters: {
      type: "object",
      properties: {
        number: { type: "number", description: "Execution order (float). Use sparse values like 10, 20, 30." },
        title: { type: "string", description: "Short label for the todo item (one line)." },
        description: { type: "string", description: "Rich markdown specification: what to do, why, files involved, constraints, acceptance criteria." },
        phase: { type: "string", description: "Optional. Workflow state id (board column). Omit to make the todo always active." },
      },
      required: ["number", "title", "description"],
    },
  },
  {
    name: "edit_todo",
    description:
      "Update one or more fields of a todo item by ID (number, title, or description).\n\n" +
      "ALWAYS call get_todo before editing to see current content.\n" +
      "NEVER use edit_todo to change status — use update_todo_status instead.\n\n" +
      "At least one field must be provided.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "number", description: "The todo item id." },
        number: { type: "number", description: "New execution order (float)." },
        title: { type: "string", description: "New short label." },
        description: { type: "string", description: "Updated markdown specification." },
        phase: { type: "string", description: "Optional. New phase (workflow state id). Pass null to clear." },
      },
      required: ["id"],
    },
  },
  {
    name: "list_todos",
    description:
      "List all active todo items for the current task. Returns id, number, title, status, and phase.\n\n" +
      "ALWAYS call list_todos before creating todos to avoid duplicates.\n" +
      "ALWAYS call list_todos at the start of a session to understand what work remains.",
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
      "ALWAYS call get_todo before editing a todo's description to see its current content.",
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
      "ALWAYS use reorganize_todos instead of multiple edit_todo calls when reordering.",
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
      "Valid statuses: 'pending', 'in-progress', 'done', 'blocked', 'deleted' (soft-delete).",
    parameters: {
      type: "object",
      properties: {
        id: { type: "number", description: "The todo item id." },
        status: { type: "string", description: "New status: 'pending', 'in-progress', 'done', 'blocked', or 'deleted'." },
      },
      required: ["id", "status"],
    },
  },
  // ── lsp group ──────────────────────────────────────────────────────────────
  LSP_TOOL_DEFINITION,
];

/** Built-in tool groups. A column's `tools` array may use group names, individual
 * tool names, or a mix. Groups are expanded by resolveToolsForColumn. */
export const TOOL_GROUPS: Map<string, string[]> = new Map([
  ["interactions", ["ask_me", "interview_me"]],
  ["agents", ["spawn_agent"]],
  ["web", ["fetch_url", "search_internet"]],
  ["tasks_read", ["get_task", "get_board_summary", "list_tasks"]],
  ["tasks_write", ["create_task", "edit_task", "delete_task", "move_task", "message_task"]],
  ["todos", ["create_todo", "edit_todo", "list_todos", "get_todo", "reorganize_todos", "update_todo_status"]],
  ["lsp", ["lsp"]],
]);

/** Default tool names used when a column has no explicit 'tools' config. */
export const DEFAULT_TOOL_NAMES = ["tasks_read", "tasks_write"];

/** One-line natural-language description for each tool, used in the worktree context block. */
const TOOL_DESCRIPTIONS: Map<string, string> = new Map([
  ["ask_me", "ask_me(questions): pause and ask questions with structured options (label, description?, recommended?, preview?). Batch related decisions into one call."],
  ["interview_me", "interview_me(questions, context?): ALWAYS use instead of prose for architectural decisions, technology choices, or any high-stakes direction. Each option has a rich markdown description explaining tradeoffs. Supports exclusive, non_exclusive, and freetext question types."],
  ["spawn_agent", "spawn_agent(children): run parallel sub-agents. Each child needs self-contained instructions and tools array — no access to parent conversation. Returns JSON array of results."],
  ["fetch_url", "fetch_url(url): fetch a public URL and return its text content (HTML stripped to readable text). Use for documentation, API references, web pages."],
  ["search_internet", "search_internet(query): search the web for ranked results (title, URL, snippet). Requires search config in workspace.yaml. Follow up with fetch_url for full content."],
  ["get_task", "get_task(task_id, include_messages?): get task metadata (title, description, state, model, branch). Use include_messages=N for last N conversation messages."],
  ["get_board_summary", "get_board_summary(board_id?): overview of task distribution across board columns with execution_state breakdown. Omit board_id for current board."],
  ["list_tasks", "list_tasks(board_id?, state?, query?, limit?): list tasks with filters. Use query for case-insensitive text search across title and description."],
  ["create_task", "create_task(title, description?, board_id?, state?): create a new task in backlog. Use move_task to start it."],
  ["edit_task", "edit_task(task_id, title?, description?): update task title or description (only before worktree creation)."],
  ["delete_task", "delete_task(task_id): permanently delete a task and all its data. Git branch is preserved."],
  ["move_task", "move_task(task_id, to_state): move a task to a different workflow column. Triggers on_enter_prompt if configured."],
  ["message_task", "message_task(task_id, message): send a message to another task's conversation and trigger its AI model."],
  ["create_todo", "create_todo(number, title, description): create a todo subtask with rich markdown description for context memory."],
  ["edit_todo", "edit_todo(id, number?, title?, description?): update number, title, or description of a todo. Use update_todo_status to change status."],
  ["list_todos", "list_todos(): list active todos for this task (id, number, title, status). Call before creating todos."],
  ["get_todo", "get_todo(id): get full details including description for a todo item."],
  ["reorganize_todos", "reorganize_todos(items): atomically update execution order of multiple todos in one call."],
  ["update_todo_status", "update_todo_status(id, status): update a todo's status (pending/in-progress/done/blocked/deleted). Use 'deleted' to soft-delete. ALWAYS use this instead of edit_todo for status changes."],
  ["lsp", "lsp(operation, file_path?, line?, character?, query?, new_name?): code intelligence — goToDefinition, findReferences, hover, documentSymbol, workspaceSymbol, goToImplementation, prepareCallHierarchy, incomingCalls, outgoingCalls, typeDefinition, rename. ALWAYS call documentSymbol first to get positions. workspaceSymbol: file_path optional."],
]);

/** Ordered group definitions for the worktree context tool description block. */
const TOOL_GROUP_LABELS: Array<[groupName: string, label: string]> = [
  ["web", "Web tools"],
  ["interactions", "Interaction tool"],
  ["agents", "Agent tool"],
  ["tasks_read", "Task read tools"],
  ["tasks_write", "Task write tools"],
  ["todos", "Todo tools"],
  ["lsp", "LSP tool"],
];

/**
 * Build the natural-language tool description block for the worktree context system message.
 * Only includes tools present in `columnTools` (expanded from group names).
 */
export function getToolDescriptionBlock(columnTools: string[] | undefined): string {
  const names = columnTools ?? DEFAULT_TOOL_NAMES;

  const expanded = new Set<string>();
  for (const entry of names) {
    const groupMembers = TOOL_GROUPS.get(entry);
    if (groupMembers) {
      for (const t of groupMembers) expanded.add(t);
    } else {
      expanded.add(entry);
    }
  }

  const lines: string[] = ["You have access to the following tools to work with the project files:", ""];

  for (const [groupName, label] of TOOL_GROUP_LABELS) {
    const groupTools = TOOL_GROUPS.get(groupName)?.filter((t) => expanded.has(t)) ?? [];
    if (groupTools.length === 0) continue;
    lines.push(`**${label}:**`);
    for (const t of groupTools) {
      const desc = TOOL_DESCRIPTIONS.get(t);
      if (desc) lines.push(`- ${desc}`);
    }
    lines.push("");
  }

  lines.push(
    "CRITICAL: Always invoke tools using the API tool_call mechanism. NEVER write tool calls as XML (`<tool_call>`), JSON, or any other text format in your response — those formats are silently ignored and the tool will not run.",
  );

  return lines.join("\n");
}

/**
 * Resolve the tool definitions to offer for a given column.
 * Entries in columnTools may be group names (e.g. "tasks_write") or individual tool
 * names — both are supported and can be mixed. Groups are expanded to their
 * constituent tools. Duplicates are deduplicated. Unknown names are skipped with a warning.
 */
export function resolveToolsForColumn(columnTools: string[] | undefined): AIToolDefinition[] {
  const names = columnTools ?? DEFAULT_TOOL_NAMES;
  const byName = new Map(TOOL_DEFINITIONS.map((t) => [t.name, t]));

  const expanded: string[] = [];
  const seen = new Set<string>();
  for (const entry of names) {
    const groupMembers = TOOL_GROUPS.get(entry);
    const toolNames = groupMembers ?? [entry];
    for (const toolName of toolNames) {
      if (!seen.has(toolName)) {
        seen.add(toolName);
        expanded.push(toolName);
      }
    }
  }

  return expanded.flatMap((name) => {
    const def = byName.get(name);
    if (!def) {
      console.warn(`[tools] Unknown tool "${name}" in column config — skipping`);
      return [];
    }
    return [def];
  });
}
