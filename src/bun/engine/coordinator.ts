import type { Task, ConversationMessage } from "../../shared/rpc-types.ts";
import type { EngineModelInfo } from "./types.ts";

export interface ExecutionCoordinator {
    executeTransition(taskId: number, toState: string): Promise<{ task: Task; executionId: number | null }>;
    executeHumanTurn(taskId: number, content: string): Promise<{ message: ConversationMessage; executionId: number }>;
    executeRetry(taskId: number): Promise<{ task: Task; executionId: number }>;
    executeCodeReview(taskId: number): Promise<{ message: ConversationMessage; executionId: number }>;
    respondShellApproval(taskId: number, decision: "approve_once" | "approve_all" | "deny"): Promise<void>;
    cancel(executionId: number): void;
    listModels(workspaceId?: number): Promise<EngineModelInfo[]>;
}
