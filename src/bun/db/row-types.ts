// ─── DB Row types (snake_case, matching SQLite column names) ─────────────────
// These are INTERNAL to the bun process only. Handlers map these to the
// camelCase shared types in rpc-types.ts before sending over IPC.

export interface BoardRow {
  id: number;
  workspace_key: string;
  name: string;
  workflow_template_id: string;
  project_keys: string; // JSON-serialized string[]
  created_at: string;
}

export interface ConversationRow {
  id: number;
  task_id: number | null;
}

export interface TaskRow {
  id: number;
  board_id: number;
  project_key: string;
  title: string;
  description: string;
  workflow_state: string;
  execution_state: string;
  conversation_id: number | null;
  current_execution_id: number | null;
  retry_count: number;
  created_from_task_id: number | null;
  created_from_execution_id: number | null;
  created_at: string;
  model: string | null;
  shell_auto_approve: number;
  approved_commands: string;
  // Fields from LEFT JOIN task_git_context (populated by extended queries)
  worktree_status?: string | null;
  branch_name?: string | null;
  worktree_path?: string | null;
  execution_count?: number | null;
  position: number;
  enabled_mcp_tools?: string | null;
}

export interface TaskGitContextRow {
  task_id: number;
  git_root_path: string;
  subrepo_path: string | null;
  branch_name: string | null;
  worktree_path: string | null;
  worktree_status: string; // 'not_created' | 'creating' | 'ready' | 'removed' | 'error'
}

export interface ExecutionRow {
  id: number;
  task_id: number | null;
  conversation_id: number | null;
  from_state: string;
  to_state: string;
  prompt_id: string | null;
  status: string;
  attempt: number;
  started_at: string;
  finished_at: string | null;
  summary: string | null;
  details: string | null;
  cost_estimate: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_creation_input_tokens: number | null;
  cache_read_input_tokens: number | null;
}

export interface ConversationMessageRow {
  id: number;
  task_id: number | null;
  conversation_id: number;
  type: string;
  role: string | null;
  content: string;
  metadata: string | null; // JSON-serialized Record<string, unknown>
  created_at: string;
}

export interface PendingMessageRow {
  id: number;
  task_id: number;
  content: string;
  created_at: string;
}

export interface ModelRawMessageRow {
  id: number;
  task_id: number | null;
  execution_id: number;
  engine: "claude" | "copilot";
  session_id: string | null;
  stream_seq: number;
  direction: "inbound" | "outbound" | "control";
  event_type: string;
  event_subtype: string | null;
  payload_json: string;
  created_at: string;
}

export interface TaskTodoRow {
  id: number;
  task_id: number;
  title: string;
  status: string; // 'not-started' | 'in-progress' | 'completed'
  result: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChatSessionRow {
  id: number;
  workspace_key: string;
  title: string;
  status: string;
  conversation_id: number;
  enabled_mcp_tools?: string | null;
  last_activity_at: string;
  last_read_at: string | null;
  archived_at: string | null;
  created_at: string;
}
