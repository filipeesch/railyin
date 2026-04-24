// ─── Domain types ───────────────────────────────────────────────────────────

export interface Board {
  id: number;
  workspaceKey: string;
  name: string;
  workflowTemplateId: string;
  projectKeys: string[];
}

export interface Project {
  key: string;
  workspaceKey: string;
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
  projectKey: string;
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
  shellAutoApprove: boolean;
  approvedCommands: string[];
  worktreeStatus: string | null;
  branchName: string | null;
  worktreePath: string | null;
  executionCount: number;
  position: number;
  enabledMcpTools: string[] | null;
}

export interface ChatSession {
  id: number;
  workspaceKey: string;
  title: string;
  status: 'idle' | 'running' | 'waiting_user' | 'archived';
  conversationId: number;
  enabledMcpTools: string[] | null;
  lastActivityAt: string;
  lastReadAt: string | null;
  archivedAt: string | null;
  createdAt: string;
}

export type MessageType =
  | "user"
  | "assistant"
  | "system"
  | "tool_call"
  | "tool_result"
  | "transition_event"
  | "ask_user_prompt"
  | "interview_prompt"
  | "file_diff"
  | "reasoning"
  | "compaction_summary"
  | "code_review";

export interface ModelInfo {
  id: string | null;
  displayName?: string;
  description?: string;
  contextWindow: number | null;
  /** True when the engine supports manual context compaction for this model. */
  supportsManualCompact?: boolean;
}

export interface ProviderModelList {
  id: string;
  models: Array<{
    id: string;
    displayName?: string;
    description?: string;
    contextWindow: number | null;
    enabled: boolean;
    /** True when the model supports adaptive thinking (Anthropic claude-3-7+ and claude-4+). */
    supportsAdaptiveThinking?: boolean;
    /** True when the engine supports manual context compaction for this model. */
    supportsManualCompact?: boolean;
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
  operation: "write_file" | "edit_file" | "patch_file" | "delete_file" | "rename_file";
  path: string;
  to_path?: string;
  is_new?: boolean;
  added: number;
  removed: number;
  hunks?: Hunk[];
}

// ─── Tool call display metadata ───────────────────────────────────────────────

export interface ToolCallDisplay {
  /** Human-readable verb shown in tool call headers: "read", "run", "move task". */
  label: string;
  /** What the tool operates on: path, URL, command, or task target. */
  subject?: string;
  /** Semantic hint for result rendering behavior. */
  contentType?: "file" | "terminal";
  /** Optional line offset for file-oriented renderers. */
  startLine?: number;
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

// ─── Interview prompt types ───────────────────────────────────────────────────

export interface InterviewOption {
  title: string;
  description: string;
}

export interface InterviewQuestion {
  question: string;
  type: "exclusive" | "non_exclusive" | "freetext";
  weight?: "critical" | "medium" | "easy";
  model_lean?: string;
  model_lean_reason?: string;
  answers_affect_followup?: boolean;
  options?: InterviewOption[];
}

export interface InterviewPayload {
  context?: string;
  questions: InterviewQuestion[];
}

// ─── Code review types ──────────────────────────────────────────────────────

export type HunkDecision = "accepted" | "rejected" | "change_request" | "pending";

/** A line comment posted by a reviewer on a specific line or range of lines. */
export interface LineComment {
  id: number;
  filePath: string;
  lineStart: number;
  lineEnd: number;
  /** Column start within lineStart (0 = full-line comment). */
  colStart: number;
  /** Column end within lineEnd (0 = full-line comment). */
  colEnd: number;
  /** The annotated lines at comment creation time. */
  lineText: string[];
  /** ±3 surrounding context lines captured at creation time. */
  contextLines: string[];
  comment: string;
  reviewerType: "human" | "ai";
}

export interface CodeReviewHunk {
  hunkIndex: number;
  originalRange: [number, number];
  modifiedRange: [number, number];
  decision: HunkDecision;
  comment: string | null;
  /** Actual diff content — original (minus) lines for this hunk. Populated at submit time. */
  originalLines?: string[];
  /** Actual diff content — modified (plus) lines for this hunk. Populated at submit time. */
  modifiedLines?: string[];
}

export interface CodeReviewFile {
  path: string;
  hunks: CodeReviewHunk[];
  /** Line comments on this file; populated at submit time or when loading for display. */
  lineComments?: LineComment[];
}

export interface CodeReviewPayload {
  taskId: number;
  files: CodeReviewFile[];
  /** Manual edits the user made directly in the diff editor; populated at submit time. */
  manualEdits?: ManualEdit[];
}

/** A manual edit the user made directly in the Monaco diff editor. */
export interface ManualEdit {
  filePath: string;
  unifiedDiff: string;
}

/** Per-file git numstat entry. */
export interface GitFileNumstat {
  path: string;
  additions: number;
  deletions: number;
}

/** Structured git numstat result (replaces raw string from getGitStat). */
export interface GitNumstat {
  files: GitFileNumstat[];
  totalAdditions: number;
  totalDeletions: number;
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
  /** First/last "+" line in modified file (excludes leading/trailing context). Both 0 for pure deletions. */
  modifiedContentStart: number;
  modifiedContentEnd: number;
  /** First/last "-" line in original file (excludes leading/trailing context). Both 0 for pure additions. */
  originalContentStart: number;
  originalContentEnd: number;
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
  taskId: number | null;
  conversationId: number;
  type: MessageType;
  role: string | null;
  content: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

/** A user-attached reference — either a pasted/dropped binary file (base64 data) or a file-path reference (@file:path). */
export interface Attachment {
  /** Human-readable name shown in the UI (filename, symbol name, etc.) */
  label: string;
  /** MIME type for binary attachments, or "text/plain" for @file references */
  mediaType: string;
  /** Base64-encoded content for binary attachments, or "@file:path" / "@file:path:L10-L25" for file references */
  data: string;
}

export type TodoStatus = "pending" | "in-progress" | "done" | "blocked" | "deleted";

export interface CodeRef {
  taskId: number;
  file: string;
  startLine: number;
  startChar: number;
  endLine: number;
  endChar: number;
  text: string;
  language: string;
}

export interface TodoItem {
  id: number;
  taskId: number;
  number: number;
  title: string;
  description: string;
  status: TodoStatus;
  result: string | null;
  phase: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TodoListItem {
  id: number;
  number: number;
  title: string;
  status: TodoStatus;
  phase: string | null;
}

// ─── Launch types ─────────────────────────────────────────────────────────────

export interface LaunchEntry {
  label?: string;
  icon: string;
  command: string;
}

export interface LaunchConfig {
  profiles: LaunchEntry[];
  tools: LaunchEntry[];
}

export interface WorkspaceConfig {
  id: number;
  key: string;
  name: string;
  workflows: WorkflowTemplate[];
  ai: {
    baseUrl: string;
    apiKey: string;
    model: string;
    provider: string;
    contextWindowTokens?: number;
  };
  worktreeBasePath: string;
  /** Whether adaptive thinking is enabled for supported Anthropic models. */
  enableThinking: boolean;
}

export interface WorkspaceSummary {
  key: string;
  name: string;
}

export interface WorkflowColumnGroup {
  id?: string;
  label?: string;
  columns: string[];
}

export interface WorkflowColumn {
  id: string;
  label: string;
  model?: string;
  limit?: number;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  columns: WorkflowColumn[];
  groups?: WorkflowColumnGroup[];
}

// ─── LSP setup types ─────────────────────────────────────────────────────────

export interface LspInstallOption {
  label: string;
  command: string;
  platforms: string[];
}

export interface LspLanguageEntry {
  name: string;
  detectionGlobs: string[];
  serverName: string;
  extensions: string[];
  installOptions: LspInstallOption[];
}

export interface LspDetectedLanguage {
  entry: LspLanguageEntry;
  alreadyInstalled: boolean;
  installOptions: LspInstallOption[];
}

// ─── Unified stream event (new pipeline) ─────────────────────────────────────

export type StreamEventType =
  | "text_chunk"       // live token — not persisted
  | "reasoning_chunk"  // live reasoning token — not persisted
  | "status_chunk"     // ephemeral status — not persisted
  | "user"             // persisted: user message
  | "assistant"        // persisted: finalized assistant text
  | "reasoning"        // persisted: finalized reasoning block
  | "tool_call"        // persisted: tool call
  | "tool_result"      // persisted: tool result
  | "file_diff"        // persisted: file diff
  | "system"           // persisted: system/error message
  | "done";            // terminal event — closes all state for this execution

export interface StreamEvent {
  taskId: number | null;
  conversationId: number;
  executionId: number;
  seq: number;
  blockId: string;
  type: StreamEventType;
  content: string;
  metadata: string | null;
  parentBlockId?: string | null;
  subagentId: string | null;
  done: boolean;
}

export interface StreamError {
  taskId: number | null;
  conversationId: number;
  executionId: number;
  error: string;
}

// ─── RPC schema ──────────────────────────────────────────────────────────────

// ─── RPC schema ──────────────────────────────────────────────────────────────
// RailynAPI maps every method name to its { params, response } types.
// Used by api() in rpc.ts for type-safe fetch calls.

export type RailynAPI = {
  "workspace.getConfig": {
    params: { workspaceKey?: string };
    response: WorkspaceConfig;
  };
  "workspace.list": {
    params: Record<string, never>;
    response: WorkspaceSummary[];
  };
  "workspace.setThinking": {
    params: { workspaceKey?: string; enabled: boolean };
    response: Record<string, never>;
  };

  // Boards
  "boards.list": {
    params: Record<string, never>;
    response: Array<Board & { template: WorkflowTemplate }>;
  };
  "boards.create": {
    params: { workspaceKey: string; name: string; projectKeys: string[]; workflowTemplateId: string };
    response: Board;
  };

  // Projects
  "projects.list": {
    params: Record<string, never>;
    response: Project[];
  };
  "projects.register": {
    params: {
      workspaceKey: string;
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
      projectKey: string;
      title: string;
      description: string;
    };
    response: Task;
  };
  "tasks.reorder": {
    params: { taskId: number; position: number };
    response: Task;
  };
  "tasks.reorderColumn": {
    params: { boardId: number; columnId: string; taskIds: number[] };
    response: void;
  };
  "tasks.transition": {
    params: { taskId: number; toState: WorkflowState; targetPosition?: number };
    response: { task: Task; executionId: number | null };
  };
  "tasks.retry": {
    params: { taskId: number };
    response: { task: Task; executionId: number };
  };
  "tasks.sendMessage": {
    params: { taskId: number; content: string; engineContent?: string; attachments?: Attachment[] };
    response: { message: ConversationMessage; executionId: number };
  };

  // Conversations
  "conversations.getMessages": {
    params: { conversationId: number };
    response: ConversationMessage[];
  };
  "conversations.getStreamEvents": {
    params: { conversationId: number; afterSeq?: number };
    response: import("../bun/db/stream-events").PersistedStreamEvent[];
  };
  "conversations.contextUsage": {
    params: { conversationId: number };
    response: { usedTokens: number; maxTokens: number; fraction: number };
  };

  // Models
  "models.list": {
    params: { workspaceKey?: string };
    response: ProviderModelList[];
  };
  "models.setEnabled": {
    params: { workspaceKey?: string; qualifiedModelId: string; enabled: boolean };
    response: Record<string, never>;
  };
  "models.listEnabled": {
    params: { workspaceKey?: string };
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
    response: void;
  };

  // Task management
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
  "tasks.listBranches": {
    params: { taskId: number };
    response: { branches: string[] };
  };
  "tasks.createWorktree": {
    params: {
      taskId: number;
      path: string;
      mode: "new" | "existing";
      branchName: string;
      sourceBranch?: string;
    };
    response: Task;
  };
  "tasks.removeWorktree": {
    params: { taskId: number };
    response: { warning?: string };
  };
  "tasks.getGitStat": {
    params: { taskId: number };
    response: GitNumstat | null;
  };
  "tasks.getChangedFiles": {
    params: { taskId: number };
    response: string[];
  };
  "tasks.getFileDiff": {
    params: { taskId: number; filePath: string; checkpointRef?: string };
    response: FileDiffContent;
  };
  "tasks.writeFile": {
    params: { taskId: number; filePath: string; content: string };
    response: void;
  };
  "tasks.getPendingHunkSummary": {
    params: { taskId: number };
    response: { filePath: string; pendingCount: number }[];
  };
  "tasks.getCheckpointRef": {
    params: { taskId: number };
    response: string | null;
  };
  "tasks.rejectHunk": {
    params: { taskId: number; filePath: string; hunkIndex: number };
    response: FileDiffContent;
  };
  "tasks.decideAllHunks": {
    params: { taskId: number; decision: "accepted" | "rejected" };
    response: { decided: number };
  };
  "tasks.setHunkDecision": {
    params: {
      taskId: number;
      hunkHash: string;
      filePath: string;
      decision: HunkDecision;
      comment: string | null;
      originalStart: number;
      originalEnd: number;
      modifiedStart: number;
      modifiedEnd: number;
    };
    response: void;
  };
  "tasks.addLineComment": {
    params: {
      taskId: number;
      filePath: string;
      lineStart: number;
      lineEnd: number;
      colStart?: number;
      colEnd?: number;
      lineText: string[];
      contextLines: string[];
      comment: string;
    };
    response: LineComment;
  };
  "tasks.getLineComments": {
    params: { taskId: number; filePath: string };
    response: LineComment[];
  };
  "tasks.deleteLineComment": {
    params: { taskId: number; commentId: number };
    response: void;
  };

  // Workflow
  "workflow.getYaml": {
    params: { workspaceKey?: string; templateId: string };
    response: { yaml: string };
  };
  "workflow.saveYaml": {
    params: { workspaceKey?: string; templateId: string; yaml: string };
    response: { ok: true };
  };
  "tasks.sessionMemory": {
    params: { taskId: number };
    response: { content: string | null };
  };
  "tasks.respondShellApproval": {
    params: { taskId: number; decision: "approve_once" | "approve_all" | "deny" };
    response: { ok: boolean };
  };
  "tasks.setShellAutoApprove": {
    params: { taskId: number; enabled: boolean };
    response: Task;
  };
  "todos.list": {
    params: { taskId: number; includeDeleted?: boolean };
    response: TodoListItem[];
  };
  "todos.get": {
    params: { taskId: number; todoId: number };
    response: TodoItem | null;
  };
  "todos.create": {
    params: { taskId: number; number: number; title: string; description: string; phase?: string };
    response: TodoListItem;
  };
  "todos.edit": {
    params: { taskId: number; todoId: number; number?: number; title?: string; description?: string; status?: TodoStatus; phase?: string | null };
    response: TodoListItem | null;
  };
  "todos.delete": {
    params: { taskId: number; todoId: number };
    response: TodoListItem | null;
  };

  // Autocomplete / engine
  "engine.listCommands": {
    params: { taskId?: number; workspaceKey?: string };
    response: { name: string; description?: string }[];
  };

  // Autocomplete / workspace files
  "workspace.listFiles": {
    params: { taskId?: number; workspaceKey?: string; query?: string };
    response: { name: string; path: string }[];
  };

  // Autocomplete / LSP symbols
  "lsp.workspaceSymbol": {
    params: { taskId?: number; workspaceKey?: string; query: string };
    response: unknown[];
  };

  // Launch
  "launch.getConfig": {
    params: { taskId: number };
    response: LaunchConfig | null;
  };
  "launch.run": {
    params: { taskId: number; command: string; mode: "terminal" | "external-terminal" | "app" };
    response: { ok: true; sessionId?: string } | { ok: false; error: string };
  };
  "launch.shell": {
    params: { cwd: string };
    response: { sessionId: string };
  };
  "launch.kill": {
    params: { sessionId: string };
    response: { ok: true } | { ok: false; error: string };
  };

  // LSP setup
  "lsp.detectLanguages": {
    params: { projectPath: string };
    response: LspDetectedLanguage[];
  };
  "lsp.addToConfig": {
    params: { projectPath: string; languageServerName: string };
    response: { ok: boolean };
  };
  "lsp.runInstall": {
    params: { command: string; projectPath: string };
    response: { success: boolean; output: string };
  };

  // Code server
  "codeServer.start": {
    params: { taskId: number };
    response: { port: number } | { error: string };
  };
  "codeServer.status": {
    params: { taskId: number };
    response: { port: number; status: "starting" | "ready" | "error" } | null;
  };
  "codeServer.stop": {
    params: { taskId: number };
    response: { ok: boolean };
  };
  "codeServer.sendRef": {
    params: CodeRef;
    response: { ok: boolean };
  };

  // Chat sessions (workspace-scoped, not tied to a task)
  "chatSessions.list": {
    params: { workspaceKey?: string; includeArchived?: boolean };
    response: ChatSession[];
  };
  "chatSessions.create": {
    params: { workspaceKey?: string; title?: string };
    response: ChatSession;
  };
  "chatSessions.rename": {
    params: { sessionId: number; title: string };
    response: void;
  };
  "chatSessions.archive": {
    params: { sessionId: number };
    response: void;
  };
  "chatSessions.markRead": {
    params: { sessionId: number };
    response: void;
  };
  "chatSessions.sendMessage": {
    params: { sessionId: number; content: string; engineContent?: string; model?: string | null; attachments?: Attachment[] };
    response: { messageId: number; executionId: number };
  };
  "chatSessions.getMessages": {
    params: { sessionId: number };
    response: ConversationMessage[];
  };
  "chatSessions.cancel": {
    params: { sessionId: number };
    response: void;
  };
  "chatSessions.compact": {
    params: { sessionId: number };
    response: void;
  };
  "mcp.setSessionTools": {
    params: { sessionId: number; enabledTools: string[] | null };
    response: ChatSession;
  };
};

// ─── Push message types (WebSocket server → browser) ─────────────────────────

export type PushMessage =
  | { type: "stream.event"; payload: StreamEvent }
  | { type: "stream.error"; payload: StreamError }
  | { type: "task.updated"; payload: Task }
  | { type: "message.new"; payload: ConversationMessage }
  | { type: "workflow.reloaded"; payload: Record<string, never> }
  | { type: "code.ref"; payload: CodeRef }
  | { type: "chatSession.updated"; payload: ChatSession }
  | { type: "chatSession.created"; payload: ChatSession };
