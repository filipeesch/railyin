import type { Task, ConversationMessage, ManualEdit } from "../../shared/rpc-types.ts";
import type { EngineModelInfo, CommandInfo } from "./types.ts";

export interface ExecutionCoordinator {
    executeTransition(taskId: number, toState: string): Promise<{ task: Task; executionId: number | null }>;
    executeHumanTurn(taskId: number, content: string): Promise<{ message: ConversationMessage; executionId: number }>;
    executeRetry(taskId: number): Promise<{ task: Task; executionId: number }>;
    respondShellApproval(taskId: number, decision: "approve_once" | "approve_all" | "deny"): Promise<void>;
    executeCodeReview(taskId: number, manualEdits?: ManualEdit[]): Promise<{ message: ConversationMessage; executionId: number }>;
    cancel(executionId: number): void;
    listModels(workspaceKey?: string): Promise<EngineModelInfo[]>;
    compactTask(taskId: number): Promise<void>;
    listCommands(taskId: number): Promise<CommandInfo[]>;
    shutdownNonNativeEngines?(options?: import("./types.ts").EngineShutdownOptions): Promise<void>;
}
