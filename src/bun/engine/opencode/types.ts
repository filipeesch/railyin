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
}
