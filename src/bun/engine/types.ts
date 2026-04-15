import type { ToolCallDisplay } from "../../shared/rpc-types.ts";

// ─── AskUser option ───────────────────────────────────────────────────────────

export interface AskUserOption {
  label: string;
  description?: string;
  recommended?: boolean;
}

// ─── EngineEvent — emitted by any engine implementation ──────────────────────

export type EngineEvent =
  | { type: "token"; content: string }
  | { type: "reasoning"; content: string }
  | { type: "tool_start"; name: string; arguments: string; callId?: string; parentCallId?: string; isInternal?: boolean; display?: ToolCallDisplay }
  | {
    type: "tool_result";
    name: string;
    result: string;
    callId?: string;
    isError?: boolean;
    parentCallId?: string;
    isInternal?: boolean;
    detailedResult?: string;
    contentBlocks?: Array<Record<string, unknown>>;
    writtenFiles?: Array<import("../../shared/rpc-types.ts").FileDiffPayload>;
  }
  | { type: "ask_user"; payload: string /* serialised AskUserPrompt JSON */ }
  | { type: "interview_me"; payload: string /* serialised InterviewPayload JSON */ }
  | { type: "shell_approval"; command: string; executionId: number }
  | { type: "status"; message: string }
  | { type: "usage"; inputTokens: number; outputTokens: number }
  | { type: "task_updated"; task: import("../../shared/rpc-types.ts").Task }
  | { type: "new_message"; message: import("../../shared/rpc-types.ts").ConversationMessage }
  | { type: "done" }
  | { type: "error"; message: string; fatal?: boolean };

// ─── Execution parameters ─────────────────────────────────────────────────────

/** Native engine execution type — used by NativeEngine to dispatch to the right function. */
export type NativeExecutionType = "transition" | "human_turn" | "retry" | "code_review";

export type EngineResumeInput =
  | { type: "ask_user"; content: string }
  | { type: "shell_approval"; decision: "approve_once" | "approve_all" | "deny" };

export interface ExecutionParams {
  executionId: number;
  taskId: number;
  /** Board the task belongs to (used by CopilotEngine for tool context). */
  boardId?: number;
  /** Resolved prompt text (on_enter_prompt or user message). */
  prompt: string;
  /** stage_instructions from the column config (already slash-reference resolved). */
  systemInstructions?: string;
  /** Absolute path to the active worktree (or project root). */
  workingDirectory: string;
  /** Engine-specific qualified model ID. */
  model: string;
  /** AbortSignal — abort to cancel this execution. */
  signal: AbortSignal;

  /**
   * Optional sink for raw model events/messages (provider-native payloads).
   * Used for debugging and incident forensics.
   */
  onRawModelMessage?: (message: RawModelMessage) => void;

  // ── Native engine discriminator (ignored by CopilotEngine) ────────────────
  /** Which flavour of native execution to run. */
  nativeExecType?: NativeExecutionType;
  /** Target workflow column (required when nativeExecType === "transition"). */
  toState?: string;
  /** Code-review hunk decisions (required when nativeExecType === "code_review"). */
  reviewDecisions?: Record<string, unknown>;
}

export interface RawModelMessage {
  engine: "claude" | "copilot";
  sessionId?: string;
  direction: "inbound" | "outbound" | "control";
  eventType: string;
  eventSubtype?: string;
  payload: Record<string, unknown>;
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
  /** Whether this model is currently enabled for selection by the user. */
  enabled?: boolean;
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
}

// ─── Common tool context ──────────────────────────────────────────────────────

/**
 * Context passed to common task-management tool handlers.
 * Shared between native and Copilot engines via common-tools.ts.
 */
export interface CommonToolContext {
  taskId: number;
  boardId: number;
  onTransition: (taskId: number, toState: string) => void;
  onHumanTurn: (taskId: number, message: string) => void;
  onCancel: (executionId: number) => void;
}
