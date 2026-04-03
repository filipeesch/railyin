import type { RPCSchema } from "electrobun/bun";

// ─── Domain types ───────────────────────────────────────────────────────────

export interface Workspace {
  id: number;
  name: string;
}

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
  | "completed";

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
}

export type MessageType =
  | "user"
  | "assistant"
  | "system"
  | "tool_call"
  | "tool_result"
  | "transition_event"
  | "artifact_event"
  | "ask_user_prompt";

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

export interface Execution {
  id: number;
  taskId: number;
  fromState: string;
  toState: string;
  promptId: string | null;
  status: ExecutionState;
  attempt: number;
  startedAt: string;
  finishedAt: string | null;
  summary: string | null;
  details: string | null;
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
  description?: string;
  onEnterPrompt?: string;
  stageInstructions?: string;
  allowedTransitions?: string[];
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
    };
    messages: Record<string, never>;
  }>;

  webview: RPCSchema<{
    requests: Record<string, never>;
    messages: {
      "stream.token": StreamToken;
      "stream.error": StreamError;
      "task.updated": Task;
    };
  }>;
};
