import type { AIToolDefinition } from "../../ai/types.ts";
import { DECISION_REQUEST_TOOL_DEFINITION } from "../../engine/decision-request-tool-definition.ts";
import { LSP_TOOL_DEFINITIONS } from "../../engine/lsp-tool-definitions.ts";
import { CARD_TOOL_DEFINITIONS } from "../../engine/card-tool-definitions.ts";

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
  DECISION_REQUEST_TOOL_DEFINITION,
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
  // ── cards_read + cards_write group ─────────────────────────────────────────
  ...CARD_TOOL_DEFINITIONS,
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
  // ── decision tools ────────────────────────────────────────────────────────
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
    description: "Silently record an AI-made decision without user interaction. Use when you've made a choice and want to persist it for future context. For user-interactive decisions, use decision_request instead.",
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
  // ── lsp group ──────────────────────────────────────────────────────────────
  ...LSP_TOOL_DEFINITIONS,
];

/** Built-in tool groups. A column's `tools` array may use group names, individual
 * tool names, or a mix. Groups are expanded by resolveToolsForColumn. */
export const TOOL_GROUPS: Map<string, string[]> = new Map([
  ["interactions", ["ask_me", "decision_request"]],
  ["agents", ["spawn_agent"]],
  ["web", ["fetch_url", "search_internet"]],
  ["cards_read", ["list_boards", "get_card", "get_board_summary", "list_cards"]],
  ["cards_write", ["create_card", "edit_card", "delete_card", "move_card", "message_card"]],
  ["todos", ["create_todo", "edit_todo", "list_todos", "get_todo", "reorganize_todos", "update_todo_status"]],
  ["decisions", ["list_decisions", "record_decision", "update_decision", "delete_decision"]],
  ["lsp", [
    "lsp_go_to_definition",
    "lsp_find_references",
    "lsp_document_symbols",
    "lsp_workspace_symbols",
    "lsp_hover",
    "lsp_rename",
    "lsp_incoming_calls",
    "lsp_outgoing_calls",
    "lsp_diagnostics",
    "lsp_type_definition",
  ]],
]);

/** Default tool names used when a column has no explicit 'tools' config. */
export const DEFAULT_TOOL_NAMES = ["cards_read", "cards_write"];

/** One-line natural-language description for each tool, used in the worktree context block. */
const TOOL_DESCRIPTIONS: Map<string, string> = new Map([
  ["ask_me", "ask_me(questions): pause and ask questions with structured options (label, description?, recommended?, preview?). Batch related decisions into one call."],
  ["decision_request", "decision_request(questions, context?): ALWAYS use instead of prose for architectural decisions, technology choices, or any high-stakes direction. Each option has a rich markdown description explaining tradeoffs. Supports exclusive, non_exclusive, and freetext question types."],
  ["spawn_agent", "spawn_agent(children): run parallel sub-agents. Each child needs self-contained instructions and tools array — no access to parent conversation. Returns JSON array of results."],
  ["fetch_url", "fetch_url(url): fetch a public URL and return its text content (HTML stripped to readable text). Use for documentation, API references, web pages."],
  ["search_internet", "search_internet(query): search the web for ranked results (title, URL, snippet). Requires search config in workspace.yaml. Follow up with fetch_url for full content."],
  ["list_boards", "list_boards(): list all boards in the workspace (id + name). Use to discover boards before calling board tools."],
  ["get_card", "get_card(task_id, include_messages?): get card metadata (title, description, state, model, branch). Use include_messages=N for last N conversation messages."],
  ["get_board_summary", "get_board_summary(board_id?): overview of card distribution across board columns with execution_state breakdown. Uses current board if board_id omitted."],
  ["list_cards", "list_cards(board_id?, state?, query?, limit?): list cards with filters. Use query for case-insensitive text search across title and description."],
  ["create_card", "create_card(title, description?, board_id?): create a new card in backlog. Use move_card to start it. Board required in chat sessions."],
  ["edit_card", "edit_card(task_id, title?, description?): update card title or description (only before worktree creation)."],
  ["delete_card", "delete_card(task_id): permanently delete a card and all its data. Git branch is preserved."],
  ["move_card", "move_card(task_id, to_state): move a card to a different workflow column. Triggers on_enter_prompt if configured."],
  ["message_card", "message_card(task_id, message): send a message to another card's conversation and trigger its AI model."],
  ["create_todo", "create_todo(number, title, description): create a todo subtask with rich markdown description for context memory."],
  ["edit_todo", "edit_todo(id, number?, title?, description?): update number, title, or description of a todo. Use update_todo_status to change status."],
  ["list_todos", "list_todos(): list active todos for this task (id, number, title, status). Call before creating todos."],
  ["get_todo", "get_todo(id): get full details including description for a todo item."],
  ["reorganize_todos", "reorganize_todos(items): atomically update execution order of multiple todos in one call."],
  ["update_todo_status", "update_todo_status(id, status): update a todo's status (pending/in-progress/done/blocked/deleted). Use 'deleted' to soft-delete. ALWAYS use this instead of edit_todo for status changes."],
  ["list_decisions", "list_decisions(): list all active decision records for this conversation. Returns id, question, answer, weight, revisionCount, isSourceAi."],
  ["record_decision", "record_decision(question, answer, weight?, notes?): silently record an AI-made decision without user interaction. weight: critical|medium|easy."],
  ["update_decision", "update_decision(id, answer, reason, notes?): revise a decision record. reason is required to prevent loops. Old answer preserved in revision history."],
  ["delete_decision", "delete_decision(id): soft-delete a decision record. Excluded from context injection after deletion."],
  ["lsp_go_to_definition", "lsp_go_to_definition(file_path, line, character): navigate to where a symbol is defined. ALWAYS call lsp_document_symbols first to get positions."],
  ["lsp_find_references", "lsp_find_references(file_path, line, character, include_declaration?, limit?, offset?): find all usages of a symbol. Paginated (default limit=50). Use before renaming or removing."],
  ["lsp_document_symbols", "lsp_document_symbols(file_path): list all symbols in a file with 1-based positions. ALWAYS call first before any position-based LSP operation."],
  ["lsp_workspace_symbols", "lsp_workspace_symbols(query, limit?, offset?): search symbols by name across the project. Paginated (default limit=20)."],
  ["lsp_hover", "lsp_hover(file_path, line, character): get type information and docs for a symbol. ALWAYS call lsp_document_symbols first."],
  ["lsp_rename", "lsp_rename(file_path, line, character, new_name): rename a symbol across the project — scope-aware, all cross-file refs updated atomically. ALWAYS save op:XXXX for undo_write."],
  ["lsp_incoming_calls", "lsp_incoming_calls(file_path, line, character): find all callers of a function (who calls this)."],
  ["lsp_outgoing_calls", "lsp_outgoing_calls(file_path, line, character): find all functions called by a function (what this calls)."],
  ["lsp_diagnostics", "lsp_diagnostics(file_path): get errors, warnings, and hints from the language server. Use after editing to verify correctness."],
  ["lsp_type_definition", "lsp_type_definition(file_path, line, character): navigate to the type definition of a symbol (the type declaration, not value)."],
]);

/** Ordered group definitions for the worktree context tool description block. */
const TOOL_GROUP_LABELS: Array<[groupName: string, label: string]> = [
  ["web", "Web tools"],
  ["interactions", "Interaction tool"],
  ["agents", "Agent tool"],
  ["cards_read", "Card read tools"],
  ["cards_write", "Card write tools"],
  ["todos", "Todo tools"],
  ["decisions", "Decision tools"],
  ["lsp", "LSP tools"],
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
