import type { ToolCallDisplay } from "../../shared/rpc-types.ts";
import type { Attachment, ConversationMessage, StreamEvent, Task } from "../../shared/rpc-types.ts";
import type { ModelParamValue, ModelSettingAxis } from "../../shared/rpc-types.ts";
import type { LSPServerManager } from "../lsp/manager.ts";
import type { IBoardToolExecutor } from "../workflow/tools/board-tool-executor.ts";
import type { McpClientRegistry } from "../mcp/registry.ts";


// ─── AskUser option ───────────────────────────────────────────────────────────

export interface AskUserOption {
  label: string;
  description?: string;
  recommended?: boolean;
}

// ─── EngineEvent — emitted by any engine implementation ──────────────────────

export type EngineEvent = (
  | { type: "token"; content: string }
  | { type: "reasoning"; content: string }
  | { type: "tool_start"; name: string; arguments: string; callId?: string; parentCallId?: string; isInternal?: boolean; display?: ToolCallDisplay }
  | { type: "subagent_start"; callId: string; intent: string; prompt: string }
  | { type: "subagent_stop"; callId: string }
  | {
    type: "tool_result";
    name: string;
    result: string;
    callId?: string;
    isError?: boolean;
    parentCallId?: string;
    isInternal?: boolean;
    display?: ToolCallDisplay;
    detailedResult?: string;
    contentBlocks?: Array<Record<string, unknown>>;
    writtenFiles?: Array<import("../../shared/rpc-types.ts").FileDiffPayload>;
  }
  | { type: "ask_user"; payload: string /* serialised AskUserPrompt JSON */ }
  | { type: "decision_request"; payload: string /* serialised DecisionRequestPayload JSON */ }
  | { type: "shell_approval"; command: string; executionId: number }
  | { type: "status"; message: string }
  | { type: "usage"; inputTokens: number; outputTokens: number; contextWindow?: number }
  | { type: "task_updated"; task: import("../../shared/rpc-types.ts").Task }
  | { type: "new_message"; message: import("../../shared/rpc-types.ts").ConversationMessage }
  | { type: "compaction_start" }
  | { type: "compaction_done"; summary?: string }
  | { type: "done" }
  | { type: "error"; message: string; fatal?: boolean }
) & { isError?: boolean };

// ─── Execution parameters ─────────────────────────────────────────────────────

export type OnToken = (taskId: number | null, conversationId: number, executionId: number, token: string, done: boolean, isReasoning?: boolean, isStatus?: boolean) => void;
export type OnError = (taskId: number | null, conversationId: number, executionId: number, error: string) => void;
export type OnTaskUpdated = (task: Task) => void;
export type OnNewMessage = (message: ConversationMessage) => void;
export type OnStreamEvent = (event: StreamEvent) => void;

export type EngineResumeInput =
  | { type: "ask_user"; content: string }
  | { type: "shell_approval"; decision: "approve_once" | "approve_all" | "deny" };

export interface ExecutionParams {
  executionId: number;
  /** null for standalone chat sessions (not tied to a task) */
  taskId: number | null;
  /** conversationId — always set; used as the universal routing key */
  conversationId: number;
  /** Board the task belongs to (used by CopilotEngine for tool context). */
  boardId?: number;
  /** Resolved prompt text (on_enter_prompt or user message). */
  prompt: string;
  /** Merged workflow_instructions + stage_instructions (inline text only; no slash-reference resolution). */
  systemInstructions?: string;
  /** Task identity context (title + optional description). Populated when taskId is non-null. */
  taskContext?: { title: string; description?: string };
  /** Absolute path to the active worktree (or project root). */
  workingDirectory: string;
  /** Engine-specific qualified model ID. */
  model: string;
  /** AbortSignal — abort to cancel this execution. */
  signal: AbortSignal;

  /** Workspace key for the task's workspace. Used by engines to load the correct workspace config (e.g. LSP servers). */
  workspaceKey?: string;
  /**
   * Optional sink for raw model events/messages (provider-native payloads).
   * Used for debugging and incident forensics.
   */
  onRawModelMessage?: (message: RawModelMessage) => void;

  /** MCP tool filter: [] = all disabled, string[] = "server:tool" pairs enabled. */
  enabledMcpTools?: string[] | null;
  /** MCP client registry for this execution. null when no registry available. */
  mcpRegistry?: McpClientRegistry | null;
  /** Optional user-provided attachments for the first turn of an execution. */
  attachments?: Attachment[];
  /** Called when the engine tool triggers a task workflow-state transition. */
  onTransition?: (taskId: number, toState: string) => void;
  /** Called when the engine tool sends a human-turn message to another task. */
  onHumanTurn?: (taskId: number, message: string) => void;
  /** Board tool executor — injected by orchestrator, avoids getDb() inside engines. */
  boardTools?: IBoardToolExecutor;
  /** Resolved context window override from model_settings DB. When present, engines
   * MUST use this value instead of their built-in default. Injected by orchestrator. */
  contextWindowOverride?: number;
  /**
   * Name of the sampling preset to apply for this execution.
   * Resolved from the column's `sampling_preset` field. Pi engine resolves this
   * against its own config; other engines ignore it.
   */
  samplingPresetName?: string;
  /** Per-conversation model parameter overrides from conversations.model_params. Injected by ExecutionParamsEnricher. */
  modelParams?: ModelParamValue[];
  /**
   * Called by the engine to signal a soft cancellation (e.g. eviction).
   * The stream-processor uses this to abort its own AbortController so the
   * execution is marked as `cancelled` instead of being left in `running`.
   */
  onSoftCancel?: () => void;
}

export interface RawModelMessage {
  engine: string;
  sessionId?: string;
  /** Set when the message originates from a child session spawned by the `delegate` tool. */
  parentToolCallId?: string;
  direction: "inbound" | "outbound" | "control";
  eventType: string;
  eventSubtype?: string;
  payload: Record<string, unknown>;
}

// ─── Engine command info ──────────────────────────────────────────────────────

export interface CommandInfo {
  name: string;
  description?: string;
  argumentHint?: string;
}

// ─── Engine model info ────────────────────────────────────────────────────────

export interface EngineModelInfo {
  /** Fully-qualified model ID (e.g. "anthropic/claude-opus-4-1"). */
  qualifiedId: string | null;
  /** Human-readable display name. */
  displayName: string;
  /** Optional detail text shown in richer model pickers. */
  description?: string;
  /** Context window in tokens, if known. */
  contextWindow?: number;
  /** Whether the model supports extended thinking / reasoning. */
  supportsThinking?: boolean;
  /** Whether this engine supports explicit manual compaction for this model. */
  supportsManualCompact?: boolean;
  /** Whether the user can set a custom context window for this model (Pi/OpenCode engines). */
  contextWindowEditable?: boolean;
  /** Whether this model is currently enabled for selection by the user. */
  enabled?: boolean;
  /** Generic model parameter axes exposed by this model. Empty = no configurable settings. */
  settings: ModelSettingAxis[];
}

export type EngineLeaseState = "running" | "waiting_user" | "idle" | "closing";

export interface EngineLeaseMetadata {
  leaseKey: string;
  engine: string;
  lastActivityAt: number;
  state: EngineLeaseState;
}

export interface EngineShutdownOptions {
  reason: "app-exit" | "workspace-reload" | "lifecycle-timeout";
  deadlineMs?: number;
}

// ─── ExecutionEngine interface ────────────────────────────────────────────────

export interface ExecutionEngine {
  /**
   * Start an execution and return an async iterable of events.
   * The caller should consume all events to drive the state machine.
   * Yielding stops after a `done` or `error { fatal: true }` event.
   */
  execute(params: ExecutionParams): AsyncIterable<EngineEvent>;

  /**
   * Resume a previously paused execution with user input or a permission decision.
   */
  resume(executionId: number, input: EngineResumeInput): Promise<void>;

  /**
   * Cancel an in-flight execution by executionId.
   * Idempotent — safe to call after the execution has already ended.
   */
  cancel(executionId: number): void;

  /**
   * List available models for this engine.
   */
  listModels(): Promise<EngineModelInfo[]>;

  /**
   * List available slash commands for this engine in the context of the given task.
   * taskId is used to look up worktree and project paths from the DB.
   */
  listCommands(taskId: number): Promise<CommandInfo[]>;

  /**
   * Optional engine-wide graceful shutdown hook for non-execution lifecycle cleanup.
   */
  shutdown?(options?: EngineShutdownOptions): Promise<void>;

  /**
   * Trigger manual context compaction for the given conversation scope.
   * Only implemented by engines that support explicit compaction (e.g. Copilot).
   * Engines that do not support manual compaction leave this undefined.
   * Compaction lifecycle is signalled via compaction_start/compaction_done EngineEvents.
   */
  compact?(taskId: number | null, conversationId: number, workingDirectory: string, workspaceKey: string): Promise<void>;
}

// ─── Common tool context ──────────────────────────────────────────────────────

/**
 * Context passed to common task-management tool handlers.
 * Shared by task-oriented engine integrations via common-tools.ts.
 */
export interface CommonToolContext {
  task: {
    id: number | null;         // null for chat sessions
    boardId: number | null;    // null for chat sessions
    conversationId: number;    // ALWAYS set — universal routing key
  };
  workspaceKey: string;
  repos: {
    todos: import("../db/todos.ts").TodoRepository;
    decisions: import("../db/repositories/decision-repository.ts").DecisionRepository;
    notes: import("../db/repositories/note-repository.ts").NoteRepository;
    boardTools: IBoardToolExecutor;
  };
  workflow: {
    onTransition: (taskId: number, toState: string) => void;
    onHumanTurn: (taskId: number, message: string) => void;
    onCancel: (executionId: number) => void;
    onTaskUpdated: (task: Task) => void;
  };
  runtime: {
    lspManager?: LSPServerManager;
    worktreePath?: string;
  };
}
