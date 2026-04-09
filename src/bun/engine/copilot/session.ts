/**
 * Copilot session lifecycle management (Task 7.3).
 *
 * Manages a singleton CopilotClient (one per process) and creates per-execution
 * CopilotSessions via the @github/copilot-sdk.
 */

import { CopilotClient } from "@github/copilot-sdk";
import type { CopilotSession, SessionConfig, ResumeSessionConfig } from "@github/copilot-sdk";

export type { CopilotSession };

// Singleton client — lazily initialised, shared across all executions.
let _client: CopilotClient | undefined;

export function getClient(): CopilotClient {
  if (!_client) {
    _client = new CopilotClient({ autoStart: true });
  }
  return _client;
}

/**
 * Derive a deterministic Copilot SDK session ID from a Railyin task ID.
 *
 * Using a fixed, predictable ID means:
 * - No in-memory map needed.
 * - Context survives app restarts — resumeSession() always knows the right ID.
 * - A task always has exactly one persistent Copilot session.
 */
export function copilotSessionIdForTask(taskId: number): string {
  return `railyin-task-${taskId}`;
}

/**
 * Create a new Copilot session for the given execution.
 * The caller is responsible for calling disconnectCopilotSession when done.
 */
export async function createCopilotSession(config: SessionConfig): Promise<CopilotSession> {
  const client = getClient();
  return client.createSession(config);
}

/**
 * Resume an existing Copilot session by ID.
 * The session's context (history, infinite-session state) is restored from disk.
 * The caller is responsible for calling disconnectCopilotSession when done.
 */
export async function resumeCopilotSession(
  sessionId: string,
  config: ResumeSessionConfig,
): Promise<CopilotSession> {
  const client = getClient();
  return client.resumeSession(sessionId, config);
}

/**
 * Abort the currently processing message in this session.
 * Call this before disconnect() on user-initiated cancellation so the model
 * stops cleanly and the session state remains consistent for future resumption.
 */
export async function abortCopilotSession(session: CopilotSession): Promise<void> {
  await session.abort();
}

/**
 * Disconnect a Copilot session and release its resources.
 * Session data on disk is preserved — the session can be resumed later.
 */
export async function disconnectCopilotSession(session: CopilotSession): Promise<void> {
  await session.disconnect();
}
