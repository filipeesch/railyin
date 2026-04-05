// ─── DB Row types (snake_case, matching SQLite column names) ─────────────────
// These are INTERNAL to the bun process only. Handlers map these to the
// camelCase shared types in rpc-types.ts before sending over IPC.

export interface WorkspaceRow {
  id: number;
  name: string;
}

export interface BoardRow {
  id: number;
  workspace_id: number;
  name: string;
  workflow_template_id: string;
  project_ids: string; // JSON-serialized number[]
  created_at: string;
}

export interface ProjectRow {
  id: number;
  workspace_id: number;
  name: string;
  project_path: string;
  git_root_path: string;
  default_branch: string;
  slug: string | null;
  description: string | null;
  created_at: string;
}

export interface ConversationRow {
  id: number;
  task_id: number;
}

export interface TaskRow {
  id: number;
  board_id: number;
  project_id: number;
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
  // Fields from LEFT JOIN task_git_context (populated by extended queries)
  worktree_status?: string | null;
  branch_name?: string | null;
  worktree_path?: string | null;
  execution_count?: number | null;
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
  task_id: number;
  from_state: string;
  to_state: string;
  prompt_id: string | null;
  status: string;
  attempt: number;
  started_at: string;
  finished_at: string | null;
  summary: string | null;
  details: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_creation_input_tokens: number | null;
  cache_read_input_tokens: number | null;
}

export interface ConversationMessageRow {
  id: number;
  task_id: number;
  conversation_id: number;
  type: string;
  role: string | null;
  content: string;
  metadata: string | null; // JSON-serialized Record<string, unknown>
  created_at: string;
}
