import type { Task, ConversationMessage, ManualEdit } from "../../shared/rpc-types.ts";
import type { EngineModelInfo, CommandInfo, EngineEvent } from "./types.ts";

/** Optional tap for the AG-UI bridge (BRDG-01): fired for every raw engine event
 * in exact order, and at the terminal points of a chat-turn execution. When
 * absent, executeChatTurn behaves byte-identically to the legacy path. */
export interface ChatTurnOpts {
  onEngineEvent?: (event: EngineEvent) => void;
  onRunEnd?: (outcome: "done" | "error" | "aborted" | "decision") => void;
}

export interface ExecutionCoordinator {
    executeTransition(taskId: number, toState: string): Promise<{ task: Task; executionId: number | null }>;
    executeHumanTurn(taskId: number, content: string, attachments?: import("../../shared/rpc-types.ts").Attachment[], engineContent?: string): Promise<{ message: ConversationMessage; executionId: number }>;
    executeRetry(taskId: number): Promise<{ task: Task; executionId: number }>;
    respondShellApprovalByExecution(executionId: number, decision: "approve_once" | "approve_all" | "deny"): Promise<void>;
    executeCodeReview(taskId: number, manualEdits?: ManualEdit[]): Promise<{ message: ConversationMessage; executionId: number }>;
    executeChatTurn(sessionId: number, conversationId: number, content: string, model?: string, enabledMcpTools?: string[] | null, workspaceKey?: string, attachments?: import("../../shared/rpc-types.ts").Attachment[], engineContent?: string, opts?: ChatTurnOpts): Promise<{ message: ConversationMessage; executionId: number }>;
    cancel(executionId: number): void;
    listModels(workspaceKey?: string, engineType?: string): Promise<EngineModelInfo[]>;
    compactTask(taskId: number): Promise<void>;
    compactConversation(conversationId: number, workspaceKey?: string): Promise<void>;
    listCommands(taskId: number): Promise<CommandInfo[]>;
    shutdownNonNativeEngines?(options?: import("./types.ts").EngineShutdownOptions): Promise<void>;
}
