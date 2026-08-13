/**
 * Cursor SDK adapter for Railyin integration.
 *
 * The SDK runs in-process under Bun via InProcessCursorAdapter. A prior
 * version routed through a Node.js subprocess to work around a suspected
 * Bun HTTP/2 bug; live testing confirmed the actual cause was a bug in
 * @cursor/sdk itself (fixed between 1.0.18 and 1.0.23), unrelated to Bun.
 *
 * This file exposes the public contract (interfaces + factory) and forwards
 * construction to InProcessCursorAdapter. engine.ts and tools.ts depend only
 * on the contract here and are unchanged.
 */

import type { EngineEvent } from "../types.ts";
import type { SDKCustomTool } from "@cursor/sdk";
import { InProcessCursorAdapter } from "./inprocess-adapter.ts";

export interface CursorSdkAdapter {
  run(config: CursorRunConfig): AsyncIterable<EngineEvent>;
  cancel(executionId: number): Promise<void>;
  listModels(workingDirectory: string): Promise<CursorSdkModelInfo[]>;
  /**
   * Signal compaction for the given conversation's agent. The `@cursor/sdk`
   * manages Cursor context compaction autonomously, so this is a no-op hook
   * (it keeps the agent warm in the pool); Railyin stores its own
   * `compaction_summary` at the engine level.
   */
  compact?(agentId: string): Promise<void>;
  shutdownAll?(): Promise<void>;
}

export interface CursorSdkModelInfo {
  value: string;
  displayName: string;
  description?: string;
  supportsThinking?: boolean;
  variants?: unknown[];
  parameters?: unknown[];
  /** Real context window in tokens, when derivable from the SDK metadata. */
  contextWindow?: number;
}

export interface CursorRunConfig {
  executionId: number;
  taskId: number;
  conversationId: number;
  prompt: string;
  workingDirectory: string;
  model?: string;
  systemInstructions?: string;
  taskContext?: { title: string; description?: string };
  signal?: AbortSignal;
  sessionId: string;
  /**
   * Custom tools to register with the Cursor agent (keyed by tool name).
   * Cursor's built-in tools (Read/Edit/Shell/Grep) remain available alongside.
   * Tool `execute` runs on the Bun side; the subprocess proxies invocations
   * back over stdio.
   */
  customTools?: Record<string, SDKCustomTool>;
  /**
   * Optional raw-message hook forwarded to the WS broadcast sink
   * (raw messages are no longer persisted).
   */
  onRawMessage?: (message: unknown) => void;
  /**
   * Caller-defined Cursor agent id (derived deterministically from the
   * conversation). The worker tries `Agent.resume(agentId, ...)` first; on
   * the first turn (or after a resume failure) it falls back to
   * `Agent.create({ agentId, ... })` with the same id, so subsequent turns
   * always resume the same SDK agent and preserve chat history.
   */
  agentId?: string;
  workspaceKey?: string;
  /** Model parameter overrides (e.g. effort, variant) to pass as ModelSelection.params. */
  modelParams?: Array<{ id: string; value: string }>;
}

export interface CursorAdapterOptions {
  /** Cursor API key. Falls back to `process.env.CURSOR_API_KEY` when omitted. */
  apiKey?: string;
}

export function createDefaultCursorSdkAdapter(options: CursorAdapterOptions = {}): CursorSdkAdapter {
  return new InProcessCursorAdapter(options);
}
