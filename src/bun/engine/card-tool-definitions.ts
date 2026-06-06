/**
 * Card tool definitions — single source of truth for board card operations.
 *
 * Imported by both:
 *   - common-tools.ts (engine-facing tool registration)
 *   - workflow/tools/registry.ts (workflow column tool resolution)
 *
 * Contains card-named tools (get_card, list_cards, etc.) to distinguish from
 * the internal Task domain concept. Board items are Kanban "cards".
 */

import type { AIToolDefinition } from "../ai/types.ts";

// ─── Tool definitions (metadata + JSON schema) ────────────────────────────────

export const CARD_TOOL_DEFINITIONS: AIToolDefinition[] = [
  // ── cards_read ───────────────────────────────────────────────────────────
  {
    name: "list_boards",
    description:
      "List all boards in the workspace.\n\n" +
      "Usage:\n" +
      "- Returns board id and name for each board\n" +
      "- Use this to discover available boards before calling board tools (list_cards, create_card, etc.)\n" +
      "- Board tools require board_id — use list_boards to find valid board IDs",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "get_card",
    description:
      "Fetch metadata for a specific card by ID.\n\n" +
      "Usage:\n" +
      "- Returns title, description, workflow_state, execution_state, model, branch, worktree path, execution count\n" +
      "- Use include_messages=N for the last N conversation messages in chronological order\n" +
      "- Returns metadata only — use read_file to inspect files in the card's worktree",
    parameters: {
      type: "object",
      properties: {
        task_id: { type: "number", description: "The id of the card to fetch." },
        include_messages: { type: "number", description: "If provided, include the last N conversation messages in chronological order." },
      },
      required: ["task_id"],
    },
  },
  {
    name: "get_board_summary",
    description:
      "Return a high-level summary of card distribution across board columns.\n\n" +
      "Usage:\n" +
      "- Shows total count and breakdown by execution_state (idle, running, completed, failed) per column\n" +
      "- Omit board_id to summarise the current card's board\n" +
      "- Use to get an overview before listing individual cards",
    parameters: {
      type: "object",
      properties: {
        board_id: { type: "number", description: "The board to summarise. Defaults to the current card's board when omitted." },
      },
      required: [],
    },
  },
  {
    name: "list_cards",
    description:
      "List cards on a board with optional filters.\n\n" +
      "Usage:\n" +
      "- Filter by workflow_state, execution_state, project_key\n" +
      "- Use query for case-insensitive text search across title and description\n" +
      "- Omit board_id to search the current card's board; default limit 50 (max 200)",
    parameters: {
      type: "object",
      properties: {
        board_id: { type: "number", description: "Board to list cards from. Defaults to the current card's board." },
        workflow_state: { type: "string", description: "Filter by exact workflow column id (e.g. 'backlog', 'in-progress')." },
        execution_state: { type: "string", description: "Filter by execution state (e.g. 'idle', 'running', 'failed')." },
        project_key: { type: "string", description: "Filter cards belonging to a specific project." },
        query: { type: "string", description: "Case-insensitive substring search across title and description." },
        limit: { type: "number", description: "Maximum number of results to return (default 50, max 200)." },
      },
      required: [],
    },
  },
  // ── cards_write ──────────────────────────────────────────────────────────
  {
    name: "create_card",
    description:
      "⚠️ BOARD TOOL — use ONLY when the user EXPLICITLY asks to create a board card. " +
      "Do NOT use this to track your own work or break down your current task — use the todo tools (create_todo) for that.\n\n" +
      "Create a new card in the backlog column of a board.\n\n" +
      "Usage:\n" +
      "- Starts in 'idle' execution state; use move_card to start it\n" +
      "- Omit board_id to create on the current card's board\n" +
      "- Use model parameter to override the default model for this card",
    parameters: {
      type: "object",
      properties: {
        project_key: { type: "string", description: "The project this card belongs to." },
        title: { type: "string", description: "The card title." },
        description: { type: "string", description: "The card description." },
        board_id: { type: "number", description: "Board to create the card on. Defaults to the current card's board." },
        model: { type: "string", description: "Optional model override for this card (e.g. 'lmstudio/qwen3-8b')." },
      },
      required: ["project_key", "title", "description"],
    },
  },
  {
    name: "edit_card",
    description:
      "⚠️ BOARD TOOL — use ONLY when the user EXPLICITLY asks to edit a board card. " +
      "Do NOT use this to track your own work — use the todo tools (edit_todo) for that.\n\n" +
      "Update the title and/or description of a card.\n\n" +
      "Usage:\n" +
      "- Only allowed before a worktree/branch has been created\n" +
      "- At least one of title or description must be provided",
    parameters: {
      type: "object",
      properties: {
        task_id: { type: "number", description: "The id of the card to edit." },
        title: { type: "string", description: "New title for the card." },
        description: { type: "string", description: "New description for the card." },
      },
      required: ["task_id"],
    },
  },
  {
    name: "delete_card",
    description:
      "⚠️ BOARD TOOL — use ONLY when the user EXPLICITLY asks to delete a board card. " +
      "Never use this to manage your own work items — use the todo tools instead.\n\n" +
      "Fully delete a card and all its data including conversation history, executions, and worktree.\n\n" +
      "Usage:\n" +
      "- Git branch is preserved; only card data is removed\n" +
      "- Running cards are cancelled first; this action is permanent and cannot be undone",
    parameters: {
      type: "object",
      properties: {
        task_id: { type: "number", description: "The id of the card to delete." },
      },
      required: ["task_id"],
    },
  },
  {
    name: "move_card",
    description:
      "⚠️ BOARD TOOL — use ONLY when the user EXPLICITLY asks to move a board card between columns. " +
      "Do NOT use this to mark your own progress — use update_todo_status for that.\n\n" +
      "Move a card to a different workflow column.\n\n" +
      "Usage:\n" +
      "- workflow_state is updated immediately\n" +
      "- If the target column has an on_enter_prompt, it is triggered asynchronously\n" +
      "- Returns immediately without waiting for triggered execution to complete",
    parameters: {
      type: "object",
      properties: {
        task_id: { type: "number", description: "The id of the card to move." },
        workflow_state: { type: "string", description: "The target column id (e.g. 'backlog', 'in-progress', 'done')." },
      },
      required: ["task_id", "workflow_state"],
    },
  },
  {
    name: "message_card",
    description:
      "⚠️ BOARD TOOL — use ONLY when the user EXPLICITLY asks to message another board card. " +
      "This is for inter-card communication, not for your own notes or work tracking.\n\n" +
      "Append a message to another card's conversation and trigger its AI model.\n\n" +
      "Usage:\n" +
      "- Returns 'delivered' (idle/waiting) or 'queued' (running — delivered when execution finishes)\n" +
      "- Use for inter-card communication: sending results, requesting actions",
    parameters: {
      type: "object",
      properties: {
        task_id: { type: "number", description: "The id of the card to message." },
        message: { type: "string", description: "The message content to send." },
      },
      required: ["task_id", "message"],
    },
  },
];

export const CARD_TOOL_NAMES = new Set(CARD_TOOL_DEFINITIONS.map((t) => t.name));
