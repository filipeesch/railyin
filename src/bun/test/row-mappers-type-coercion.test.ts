import { describe, it, expect } from "vitest";
import { mapTask, mapChatSession, mapConversationMessage } from "../db/mappers.ts";
import type { TaskRow, ChatSessionRow, ConversationMessageRow } from "../db/row-types.ts";

/**
 * PC-6 (pure, no DB): row mappers must yield identical TypeScript shapes
 * regardless of engine. By design (decision: ids as `integer` not `bigint`,
 * booleans as `integer` 0/1 on both SQLite and PostgreSQL — see dialect.ts),
 * the wire values these mappers receive are already uniform across engines,
 * so no dialect branching is needed in the mappers themselves. These tests
 * lock that assumption in with fake rows.
 */
describe("Row mapper type coercion (PC-6, pure — no DB)", () => {
  const baseTaskRow: TaskRow = {
    id: 1,
    board_id: 1,
    project_key: "p",
    title: "T",
    description: "",
    workflow_state: "backlog",
    execution_state: "idle",
    conversation_id: 1,
    current_execution_id: null,
    retry_count: 0,
    created_from_task_id: null,
    created_from_execution_id: null,
    shell_auto_approve: 0,
    approved_commands: "[]",
    worktree_status: null,
    branch_name: null,
    worktree_path: null,
    execution_count: 0,
    position: 0,
    enabled_mcp_tools: null,
  } as TaskRow;

  it("MT-1: integer 1 boolean-flag coerces to JS true", () => {
    const task = mapTask({ ...baseTaskRow, shell_auto_approve: 1 });
    expect(task.shellAutoApprove).toBe(true);
  });

  it("MT-2: integer 0 boolean-flag coerces to JS false", () => {
    const task = mapTask({ ...baseTaskRow, shell_auto_approve: 0 });
    expect(task.shellAutoApprove).toBe(false);
  });

  it("MT-3: id fields pass through as plain numbers (no bigint)", () => {
    const task = mapTask({ ...baseTaskRow, id: 42, board_id: 7 });
    expect(typeof task.id).toBe("number");
    expect(task.id).toBe(42);
    expect(typeof task.boardId).toBe("number");
  });

  it("MT-4: malformed approved_commands JSON degrades to an empty array, not a throw", () => {
    const task = mapTask({ ...baseTaskRow, approved_commands: "{not json" });
    expect(task.approvedCommands).toEqual([]);
  });

  it("MT-5: null enabled_mcp_tools maps to an empty array", () => {
    const task = mapTask({ ...baseTaskRow, enabled_mcp_tools: null });
    expect(task.enabledMcpTools).toEqual([]);
  });

  const baseSessionRow: ChatSessionRow = {
    id: 1,
    workspace_key: "default",
    title: "S",
    status: "idle",
    conversation_id: 1,
    conversation_model: null,
    enabled_mcp_tools: null,
    shell_auto_approve: 0,
    approved_commands: "[]",
    conversation_sampling_preset_override: null,
    conversation_model_params: null,
    last_activity_at: "now",
    last_read_at: null,
    archived_at: null,
    created_at: "now",
  } as ChatSessionRow;

  it("MC-1: chat session boolean-flag coercion matches task coercion", () => {
    expect(mapChatSession({ ...baseSessionRow, shell_auto_approve: 1 }).shellAutoApprove).toBe(true);
    expect(mapChatSession({ ...baseSessionRow, shell_auto_approve: 0 }).shellAutoApprove).toBe(false);
  });

  it("MC-2: null timestamp fields pass through as null (not coerced to strings)", () => {
    const session = mapChatSession({ ...baseSessionRow, last_read_at: null, archived_at: null });
    expect(session.lastReadAt).toBeNull();
    expect(session.archivedAt).toBeNull();
  });

  it("MM-1: conversation message JSON metadata round-trips through parse", () => {
    const row: ConversationMessageRow = {
      id: 1,
      task_id: 1,
      conversation_id: 1,
      type: "text",
      role: "user",
      content: "hi",
      metadata: JSON.stringify({ a: 1 }),
      created_at: "now",
    } as ConversationMessageRow;
    const msg = mapConversationMessage(row);
    expect(msg.metadata).toEqual({ a: 1 });
  });

  it("MM-2: null metadata maps to null, not an empty object", () => {
    const row: ConversationMessageRow = {
      id: 1,
      task_id: 1,
      conversation_id: 1,
      type: "text",
      role: "user",
      content: "hi",
      metadata: null,
      created_at: "now",
    } as ConversationMessageRow;
    expect(mapConversationMessage(row).metadata).toBeNull();
  });
});
