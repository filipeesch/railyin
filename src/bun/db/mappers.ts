import type {
  Task,
  Board,
  Project,
  ConversationMessage,
  ExecutionState,
  MessageType,
} from "../../shared/rpc-types.ts";
import type {
  TaskRow,
  BoardRow,
  ProjectRow,
  ConversationMessageRow,
} from "./row-types.ts";

export function mapTask(row: TaskRow): Task {
  return {
    id: row.id,
    boardId: row.board_id,
    projectId: row.project_id,
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
    worktreeStatus: row.worktree_status ?? null,
    branchName: row.branch_name ?? null,
    worktreePath: row.worktree_path ?? null,
    executionCount: row.execution_count ?? 0,
  };
}

export function mapBoard(row: BoardRow): Board {
  let projectIds: number[] = [];
  try {
    projectIds = JSON.parse(row.project_ids);
  } catch {
    projectIds = [];
  }
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    workflowTemplateId: row.workflow_template_id,
    projectIds,
  };
}

export function mapProject(row: ProjectRow): Project {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    projectPath: row.project_path,
    gitRootPath: row.git_root_path,
    defaultBranch: row.default_branch,
    slug: row.slug ?? undefined,
    description: row.description ?? undefined,
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
