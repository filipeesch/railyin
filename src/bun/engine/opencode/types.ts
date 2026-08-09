import type { EngineEvent, EngineModelInfo, CommandInfo, CommonToolContext } from "../types.ts";
import type { Attachment } from "../../../shared/rpc-types.ts";

export type PermissionDecision = "approve_once" | "approve_all" | "deny";

export interface OpenCodeRunParams {
  executionId: number;
  conversationId: number;
  sessionId: string;
  prompt: string;
  systemInstructions?: string;
  model?: string;
  workingDirectory: string;
  attachments?: Attachment[];
  signal: AbortSignal;
  commonToolContext: CommonToolContext;
  onRawEvent?: (event: Record<string, unknown>) => void;
  /**
   * A3 posture: called when OpenCode asks for a permission (e.g. bash). Must
   * return a deterministic decision — auto-approve when shellAutoApprove is
   * configured, deny otherwise. NEVER waits: no UI can answer a permission
   * request (decision_request is the only HITL channel).
   */
  onPermissionAsked?: (executionId: number) => Promise<PermissionDecision>;
}

export interface OpenCodeSdkAdapter {
  run(params: OpenCodeRunParams): AsyncIterable<EngineEvent>;
  cancel(executionId: number): Promise<void>;
  getOrCreateSession(conversationId: number, workingDirectory: string): Promise<string>;
  listModels(workingDirectory: string): Promise<EngineModelInfo[]>;
  listCommands(workingDirectory: string): Promise<CommandInfo[]>;
  compact(sessionId: string, workingDirectory: string): Promise<void>;
  shutdown(): Promise<void>;
  /**
   * Reply to a pending OpenCode permission request so the agent loop can
   * continue. The decision comes from the A3 onPermissionAsked callback — the
   * engine never waits for a permission reply.
   */
  respondPermission(executionId: number, decision: "approve_once" | "approve_all" | "deny"): Promise<void>;
}
