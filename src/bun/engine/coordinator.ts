import type { Task, ManualEdit } from "../../shared/rpc-types.ts";
import type { EngineModelInfo, CommandInfo, EngineEvent } from "./types.ts";

/** Optional tap for the AG-UI bridge (BRDG-01): fired for every raw engine event
 * in exact order, and at the terminal points of a chat-turn execution. When
 * absent, executeChatTurn behaves byte-identically to the legacy path. */
export interface ChatTurnOpts {
  onEngineEvent?: (event: EngineEvent) => void;
  onRunEnd?: (outcome: "done" | "error" | "aborted" | "decision") => void;
  /**
   * Fired whenever consume() writes chat_sessions status for a standalone
   * session (taskId == null) at a terminal path (done/error/abort/catch/
   * decision). The orchestrator uses it to broadcast chatSession.updated —
   * the replacement for the removed legacy "done" push that previously
   * flipped the session sidebar from running to idle.
   */
  onSessionStatusChange?: (conversationId: number) => void;
}

export interface ExecutionCoordinator {
    executeTransition(taskId: number, toState: string): Promise<{ task: Task; executionId: number | null }>;
    executeHumanTurn(taskId: number, content: string, attachments?: import("../../shared/rpc-types.ts").Attachment[], engineContent?: string, opts?: ChatTurnOpts): Promise<{ executionId: number }>;
    executeRetry(taskId: number): Promise<{ executionId: number }>;
    executeCodeReview(taskId: number, manualEdits?: ManualEdit[]): Promise<{ executionId: number }>;
    executeChatTurn(sessionId: number, conversationId: number, content: string, model?: string, enabledMcpTools?: string[] | null, workspaceKey?: string, attachments?: import("../../shared/rpc-types.ts").Attachment[], engineContent?: string, opts?: ChatTurnOpts): Promise<{ executionId: number }>;
    cancel(executionId: number): void;
    listModels(workspaceKey?: string, engineType?: string): Promise<EngineModelInfo[]>;
    listCommands(taskId: number): Promise<CommandInfo[]>;
    shutdownNonNativeEngines?(options?: import("./types.ts").EngineShutdownOptions): Promise<void>;
}
