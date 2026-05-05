import type { EngineEvent, EngineModelInfo, EngineResumeInput, CommandInfo, CommonToolContext } from "../types.ts";
import type { Attachment } from "../../../shared/rpc-types.ts";

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
   * Resolve a pending ask_user question: sends the user's answer back through
   * the MCP long-poll HTTP response so OpenCode can continue the agent loop.
   * Throws if no ask_user is pending for this executionId (e.g. after server restart).
   */
  respondAskUser(executionId: number, content: string): Promise<void>;
  /**
   * Reply to a pending OpenCode permission request so the agent loop can continue.
   * Must be called after engine.resume() resolves the in-memory shell_approval promise.
   */
  respondPermission(executionId: number, decision: "approve_once" | "approve_all" | "deny"): Promise<void>;
}
