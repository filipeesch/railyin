/**
 * IPC protocol between the Bun parent and the Node worker that hosts
 * @cursor/sdk. Messages are line-delimited JSON over stdio. The Bun side spawns
 * `node worker.mjs`; the worker imports the SDK directly and forwards stream
 * events / proxy tool calls back over stdout.
 *
 * Direction conventions:
 *   bun → worker   : commands the worker should execute
 *   worker → bun   : responses, async events, and tool-call requests
 */

import type { EngineEvent } from "../types.ts";

/** Schema portion of a custom tool — code (execute) stays on the Bun side. */
export interface ToolSchema {
  name: string;
  description: string;
  inputSchema: unknown;
}

/* ─── bun → worker ─────────────────────────────────────────────────── */

export type BunToWorker =
  | ListModelsRequest
  | StartRunRequest
  | CancelRunRequest
  | ToolResultMessage
  | ShutdownRequest;

export interface ListModelsRequest {
  type: "listModels";
  requestId: string;
  apiKey?: string;
}

export interface StartRunRequest {
  type: "startRun";
  runId: string;
  apiKey?: string;
  workingDirectory: string;
  model?: string;
  prompt: string;
  toolSchemas: ToolSchema[];
  /**
   * Cursor agent id from a prior run on this conversation. When present the
   * worker tries Agent.resume(agentId, ...) so chat history is preserved; on
   * resume failure (or when omitted) it falls back to Agent.create and reports
   * the new id via an `agentCreated` message.
   */
  agentId?: string;
}

export interface CancelRunRequest {
  type: "cancelRun";
  runId: string;
}

export interface ToolResultMessage {
  type: "toolResult";
  callId: string;
  /** Result value returned from the tool's execute(). Must be JSON-serializable. */
  result?: unknown;
  /** Error message if the tool threw. result is ignored when error is set. */
  error?: string;
}

export interface ShutdownRequest {
  type: "shutdown";
}

/* ─── worker → bun ─────────────────────────────────────────────────── */

export type WorkerToBun =
  | ResponseMessage
  | EventMessage
  | ToolCallRequest
  | RawMessage
  | RunDoneMessage
  | AgentCreatedMessage
  | WorkerLog
  | WorkerReady;

export interface ResponseMessage {
  type: "response";
  requestId: string;
  result?: unknown;
  error?: string;
}

export interface EventMessage {
  type: "event";
  runId: string;
  event: EngineEvent;
}

export interface ToolCallRequest {
  type: "toolCall";
  runId: string;
  callId: string;
  toolName: string;
  args: unknown;
}

export interface RawMessage {
  type: "rawMessage";
  runId: string;
  message: unknown;
}

export interface RunDoneMessage {
  type: "runDone";
  runId: string;
  status: "ok" | "error";
  /** Error/result detail from SDK run.wait().result; only set when status === "error". */
  detail?: string;
}

/**
 * Reported after a successful Agent.create() so the Bun side can persist the
 * new agent id keyed by conversation. Not emitted when a run resumed an
 * existing agent — the id already matches what the parent stored.
 */
export interface AgentCreatedMessage {
  type: "agentCreated";
  runId: string;
  agentId: string;
}

export interface WorkerLog {
  type: "log";
  level: "info" | "warn" | "error";
  message: string;
}

export interface WorkerReady {
  type: "ready";
}
