import type {
  Task,
  Board,
  ConversationMessage,
  ExecutionState,
  MessageType,
} from "../../shared/rpc-types.ts";
import type {
  TaskRow,
  BoardRow,
  ConversationMessageRow,
} from "./row-types.ts";

export function mapTask(row: TaskRow): Task {
  return {
    id: row.id,
    boardId: row.board_id,
    projectKey: row.project_key,
    title: row.title,
    description: row.description,
    workflowState: row.workflow_state,
    executionState: row.execution_state as ExecutionState,
    conversationId: row.conversation_id ?? 0,
    currentExecutionId: row.current_execution_id,
    retryCount: row.retry_count,
    createdFromTaskId: row.created_from_task_id,
    createdFromExecutionId: row.created_from_execution_id,
    model: row.model ?? null,
    shellAutoApprove: row.shell_auto_approve === 1,
    approvedCommands: (() => { try { return JSON.parse(row.approved_commands ?? "[]"); } catch { return []; } })(),
    worktreeStatus: row.worktree_status ?? null,
    branchName: row.branch_name ?? null,
    worktreePath: row.worktree_path ?? null,
    executionCount: row.execution_count ?? 0,
    position: row.position ?? 0,
    enabledMcpTools: (() => { try { return row.enabled_mcp_tools ? JSON.parse(row.enabled_mcp_tools) : null; } catch { return null; } })(),
  };
}

export function mapBoard(row: BoardRow): Board {
  let projectKeys: string[] = [];
  try {
    projectKeys = JSON.parse(row.project_keys);
  } catch {
    projectKeys = [];
  }
  return {
    id: row.id,
    workspaceKey: row.workspace_key,
    name: row.name,
    workflowTemplateId: row.workflow_template_id,
    projectKeys,
  };
}

export function mapConversationMessage(row: ConversationMessageRow): ConversationMessage {
  let metadata: Record<string, unknown> | null = null;
  if (row.metadata) {
    try {
      metadata = JSON.parse(row.metadata);
    } catch {
      metadata = null;
    }
  }
  return {
    id: row.id,
    taskId: row.task_id,
    conversationId: row.conversation_id,
    type: row.type as MessageType,
    role: row.role,
    content: row.content,
    metadata,
    createdAt: row.created_at,
  };
}
