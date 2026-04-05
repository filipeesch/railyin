import type { RPCSchema } from "electrobun/bun";

// ─── Domain types ───────────────────────────────────────────────────────────

export interface Board {
  id: number;
  workspaceId: number;
  name: string;
  workflowTemplateId: string;
  projectIds: number[];
}

export interface Project {
  id: number;
  workspaceId: number;
  name: string;
  projectPath: string;
  gitRootPath: string;
  defaultBranch: string;
  slug?: string;
  description?: string;
}

export type WorkflowState = string; // matches column id from YAML

export type ExecutionState =
  | "idle"
  | "running"
  | "waiting_user"
  | "waiting_external"
  | "failed"
  | "completed"
  | "cancelled";

export interface Task {
  id: number;
  boardId: number;
  projectId: number;
  title: string;
  description: string;
  workflowState: WorkflowState;
  executionState: ExecutionState;
  conversationId: number;
  currentExecutionId: number | null;
  retryCount: number;
  createdFromTaskId: number | null;
  createdFromExecutionId: number | null;
  model: string | null;
  worktreeStatus: string | null;
  branchName: string | null;
  worktreePath: string | null;
  executionCount: number;
}

export type MessageType =
  | "user"
  | "assistant"
  | "system"
  | "tool_call"
  | "tool_result"
  | "transition_event"
  | "ask_user_prompt"
  | "file_diff"
  | "reasoning"
  | "compaction_summary"
  | "code_review";

export interface ModelInfo {
  id: string;
  contextWindow: number | null;
}

export interface ProviderModelList {
  id: string;
  models: Array<{
    id: string;
    contextWindow: number | null;
    enabled: boolean;
  }>;
  error?: string;
}

// ─── File diff types ─────────────────────────────────────────────────────────

export interface HunkLine {
  type: "context" | "added" | "removed";
  old_line?: number;
  new_line?: number;
  content: string;
}

export interface Hunk {
  old_start: number;
  new_start: number;
  lines: HunkLine[];
}

export interface FileDiffPayload {
  operation: "write_file" | "patch_file" | "delete_file" | "rename_file";
  path: string;
  to_path?: string;
  is_new?: boolean;
  added: number;
  removed: number;
  hunks?: Hunk[];
}

// ─── Ask user prompt types ───────────────────────────────────────────────────

export interface AskUserOption {
  label: string;
  description?: string;
  recommended?: boolean;
  preview?: string;
}

export interface AskUserQuestion {
  question: string;
  selection_mode: "single" | "multi";
  options: AskUserOption[];
}

export interface AskUserPromptContent {
  questions: AskUserQuestion[];
}

// ─── Code review types ──────────────────────────────────────────────────────

export type HunkDecision = "accepted" | "rejected" | "change_request" | "pending";

export interface CodeReviewHunk {
  hunkIndex: number;
  originalRange: [number, number];
  modifiedRange: [number, number];
  decision: HunkDecision;
  comment: string | null;
}

export interface CodeReviewFile {
  path: string;
  hunks: CodeReviewHunk[];
}

export interface CodeReviewPayload {
  taskId: number;
  files: CodeReviewFile[];
}

/** A single reviewer's decision on a hunk (human or future AI reviewer). */
export interface ReviewerDecision {
  reviewerId: string;       // 'user' for human; model name for AI
  reviewerType: "human" | "ai";
  decision: HunkDecision;
  comment: string | null;
}

/** A parsed hunk from git diff, enriched with all reviewer decisions from DB. */
export interface HunkWithDecisions {
  /** Content-hash identity: SHA-256(filePath + "\0" + originalLines + "\0" + modifiedLines) */
  hash: string;
  hunkIndex: number;
  originalStart: number;
  originalEnd: number;
  modifiedStart: number;
  modifiedEnd: number;
  decisions: ReviewerDecision[];
  /** Convenience: the human reviewer's current decision (defaults to 'pending') */
  humanDecision: HunkDecision;
  humanComment: string | null;
}

export interface FileDiffContent {
  original: string;
  modified: string;
  /** Parsed hunks with decisions joined from DB. Empty if no diff. */
  hunks: HunkWithDecisions[];
}

export interface ConversationMessage {
  id: number;
  taskId: number;
  conversationId: number;
  type: MessageType;
  role: string | null;
  content: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface WorkspaceConfig {
  id: number;
  name: string;
  ai: {
    baseUrl: string;
    apiKey: string;
    model: string;
    provider: string;
    contextWindowTokens?: number;
  };
  worktreeBasePath: string;
}

export interface WorkflowColumn {
  id: string;
  label: string;
  model?: string;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  columns: WorkflowColumn[];
}

// ─── IPC streaming token event ───────────────────────────────────────────────

export interface StreamToken {
  taskId: number;
  executionId: number;
  token: string;
  done: boolean;
  isReasoning?: boolean;
}

export interface StreamError {
  taskId: number;
  executionId: number;
  error: string;
}

// ─── RPC schema ──────────────────────────────────────────────────────────────

export type RailynRPCType = {
  bun: RPCSchema<{
    requests: {
      // Workspace
      "workspace.getConfig": {
        params: Record<string, never>;
        response: WorkspaceConfig;
      };

      // Boards
      "boards.list": {
        params: Record<string, never>;
        response: Array<Board & { template: WorkflowTemplate }>;
      };
      "boards.create": {
        params: { name: string; projectIds: number[]; workflowTemplateId: string };
        response: Board;
      };

      // Projects
      "projects.list": {
        params: Record<string, never>;
        response: Project[];
      };
      "projects.register": {
        params: {
          name: string;
          projectPath: string;
          gitRootPath: string;
          defaultBranch: string;
          slug?: string;
          description?: string;
        };
        response: Project;
      };

      // Tasks
      "tasks.list": {
        params: { boardId: number };
        response: Task[];
      };
      "tasks.create": {
        params: {
          boardId: number;
          projectId: number;
          title: string;
          description: string;
        };
        response: Task;
      };
      "tasks.transition": {
        params: { taskId: number; toState: WorkflowState };
        response: { task: Task; executionId: number | null };
      };
      "tasks.retry": {
        params: { taskId: number };
        response: { task: Task; executionId: number };
      };
      "tasks.sendMessage": {
        params: { taskId: number; content: string };
        response: { message: ConversationMessage; executionId: number };
      };

      // Conversations
      "conversations.getMessages": {
        params: { taskId: number };
        response: ConversationMessage[];
      };

      // Models
      "models.list": {
        params: Record<string, never>;
        response: ProviderModelList[];
      };
      "models.setEnabled": {
        params: { qualifiedModelId: string; enabled: boolean };
        response: Record<string, never>;
      };
      "models.listEnabled": {
        params: Record<string, never>;
        response: ModelInfo[];
      };

      // Context usage
      "tasks.contextUsage": {
        params: { taskId: number };
        response: { usedTokens: number; maxTokens: number; fraction: number };
      };

      // Conversation compaction
      "tasks.compact": {
        params: { taskId: number };
        response: ConversationMessage;
      };

      // Task management (edit / delete / cancel / model / git stat)
      "tasks.setModel": {
        params: { taskId: number; model: string | null };
        response: Task;
      };
      "tasks.cancel": {
        params: { taskId: number };
        response: Task;
      };
      "tasks.update": {
        params: { taskId: number; title: string; description: string };
        response: Task;
      };
      "tasks.delete": {
        params: { taskId: number };
        response: { success: boolean; warning?: string };
      };
      "tasks.getGitStat": {
        params: { taskId: number };
        response: string | null;
      };
      "tasks.getChangedFiles": {
        params: { taskId: number };
        response: string[];
      };
      "tasks.getFileDiff": {
        params: { taskId: number; filePath: string };
        response: FileDiffContent;
      };
      "tasks.rejectHunk": {
        params: { taskId: number; filePath: string; hunkIndex: number };
        response: FileDiffContent;
      };
      "tasks.setHunkDecision": {
        params: {
          taskId: number;
          hunkHash: string;
          filePath: string;
          decision: HunkDecision;
          comment: string | null;
          originalStart: number;
          modifiedStart: number;
        };
        response: void;
      };
      "tasks.sessionMemory": {
        params: { taskId: number };
        response: { content: string | null };
      };
    };
    messages: Record<string, never>;
  }>;

  webview: RPCSchema<{
    requests: Record<string, never>;
    messages: {
      "stream.token": StreamToken;
      "stream.error": StreamError;
      "task.updated": Task;
      "message.new": ConversationMessage;
    };
  }>;
};
