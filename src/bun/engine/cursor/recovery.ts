/**
 * Busy-agent recovery for the in-process Cursor adapter.
 *
 * `sendPromptWithRecovery` obtains a live agent via an injected lifecycle
 * (acquire/release/evict), sends the prompt, retries once with `force:true`
 * on `AgentBusyError`, and recreates the same agent id when the forced retry
 * is still busy. The lifecycle handles are injected (DI) so the adapter can
 * route acquire/release/evict through its agent pool; the pure function stays
 * unit-testable with stubs.
 *
 * `Agent` is passed as a parameter to `resumeOrCreateAgent` (not hard-imported)
 * so this module stays unit-testable with a stub agent namespace.
 */

import { AgentBusyError, type AgentOptions } from "@cursor/sdk";
import { resumeOrCreateAgent, type AgentNamespace } from "./resume.ts";

/** An agent that can send a prompt (optionally closeable). */
export interface SendableAgent<TRun = unknown> {
  send(prompt: string, options?: { local?: { force?: boolean } }): Promise<TRun>;
  close?(): void | Promise<void>;
}

export interface RecoveryContext {
  runId?: string | null;
  executionId?: number | null;
  taskId?: number | null;
  conversationId?: number | null;
  agentId?: string | null;
}

export type RecoveryLog = (level: "info" | "warn" | "error", message: string) => void;

export interface SendPromptContext extends RecoveryContext {
  log?: RecoveryLog;
}

export class PersistentBusyError extends Error {
  readonly failureKind = "persistent_busy" as const;
  readonly context: RecoveryContext;

  constructor(message: string, context: RecoveryContext = {}) {
    super(message);
    this.name = "PersistentBusyError";
    this.context = context;
  }
}

function logRecoveryEvent(
  log: RecoveryLog | undefined,
  event: string,
  context: Record<string, unknown>,
): void {
  if (typeof log !== "function") return;
  log("warn", JSON.stringify({ event, ...context }));
}

export function isBusyLikeError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  if (err instanceof AgentBusyError) return true;
  const e = err as { status?: unknown; code?: unknown; message?: unknown };
  const status = typeof e.status === "number" ? e.status : Number.NaN;
  const code = String(e.code ?? "").toLowerCase();
  const message = String(e.message ?? "").toLowerCase();
  return (
    status === 409
    || code.includes("busy")
    || code.includes("conflict")
    || message.includes("already has active run")
  );
}

export async function sendWithBusyRetry<TRun>(agent: SendableAgent<TRun>, prompt: string): Promise<TRun> {
  try {
    return await agent.send(prompt);
  } catch (err) {
    if (isBusyLikeError(err)) {
      return await agent.send(prompt, { local: { force: true } });
    }
    throw err;
  }
}

async function safeCloseAgent(agent: SendableAgent | undefined | null): Promise<void> {
  if (!agent || typeof agent.close !== "function") return;
  try {
    await agent.close();
  } catch {
    // Ignore close failures; recovery already did the useful work.
  }
}

/**
 * Default lifecycle when no agent pool is provided: create/resume the agent
 * directly and close it on failure (legacy behavior for tests/direct use).
 */
export function legacyAgentLifecycle<TAgent extends SendableAgent<TRun>, TRun>(
  Agent: AgentNamespace<TAgent>,
  agentId: string | undefined,
  baseOptions: AgentOptions,
): { acquire: () => Promise<TAgent>; release: (a: TAgent) => Promise<void>; evict: (a: TAgent) => Promise<void> } {
  return {
    acquire: () => resumeOrCreateAgent(Agent, agentId, baseOptions),
    release: (a) => safeCloseAgent(a),
    evict: (a) => safeCloseAgent(a),
  };
}

/**
 * Agent lifecycle injected by the adapter. Lets recovery keep agents warm
 * (return to pool) instead of always closing.
 */
export interface AgentLifecycle<TAgent> {
  /** Obtain a live agent for the conversation (warm resume or create). */
  acquire: () => Promise<TAgent>;
  /** Recoverable failure — return the agent to the pool (keep warm). */
  release: (agent: TAgent) => void | Promise<void>;
  /** Unusable agent (persistent busy) — close/evict it. */
  evict: (agent: TAgent) => void | Promise<void>;
}

export async function sendPromptWithRecovery<TAgent extends SendableAgent<TRun>, TRun>(
  lifecycle: AgentLifecycle<TAgent>,
  prompt: string,
  context: SendPromptContext = {},
): Promise<{ agent: TAgent; run: TRun }> {
  const recoveryContext: RecoveryContext = {
    runId: context.runId ?? null,
    executionId: context.executionId ?? null,
    taskId: context.taskId ?? null,
    conversationId: context.conversationId ?? null,
    agentId: context.agentId ?? null,
  };

  const safeRelease = async (a: TAgent): Promise<void> => {
    try {
      await lifecycle.release(a);
    } catch {
      // Ignore release failures.
    }
  };
  const safeEvict = async (a: TAgent): Promise<void> => {
    try {
      await lifecycle.evict(a);
    } catch {
      // Ignore eviction failures.
    }
  };

  // Persistently-busy path: acquire a (re)created agent, send it, and if that
  // also stays busy, evict and report a persistent-busy failure.
  const recreate = async (): Promise<{ agent: TAgent; run: TRun }> => {
    let recreated: TAgent;
    try {
      recreated = await lifecycle.acquire();
    } catch (acquireErr) {
      if (isBusyLikeError(acquireErr)) {
        logRecoveryEvent(context.log, "cursor_busy_recovery_failed", {
          ...recoveryContext,
          stage: "same_id_recreate",
        });
        throw new PersistentBusyError("Cursor agent remained busy after same-id recreate", recoveryContext);
      }
      throw acquireErr;
    }

    try {
      return { agent: recreated, run: await sendWithBusyRetry(recreated, prompt) };
    } catch (recreateErr) {
      if (isBusyLikeError(recreateErr)) {
        logRecoveryEvent(context.log, "cursor_busy_recovery_failed", {
          ...recoveryContext,
          stage: "same_id_recreate",
        });
        await safeEvict(recreated);
        throw new PersistentBusyError("Cursor agent remained busy after same-id recreate", recoveryContext);
      }
      await safeRelease(recreated);
      throw recreateErr;
    }
  };

  // Initial acquire (warm resume or create).
  let initialAgent: TAgent;
  try {
    initialAgent = await lifecycle.acquire();
  } catch (acquireErr) {
    if (!isBusyLikeError(acquireErr)) throw acquireErr;
    logRecoveryEvent(context.log, "cursor_busy_retry_exhausted", {
      ...recoveryContext,
      stage: "resume_or_create",
    });
    return recreate();
  }

  try {
    return { agent: initialAgent, run: await sendWithBusyRetry(initialAgent, prompt) };
  } catch (err) {
    if (!isBusyLikeError(err)) {
      await safeRelease(initialAgent);
      throw err;
    }

    logRecoveryEvent(context.log, "cursor_busy_retry_exhausted", {
      ...recoveryContext,
      stage: "force_retry",
    });
    await safeRelease(initialAgent);
    return recreate();
  }
}

// Re-exported so callers can pass a raw Agent namespace when not using a pool.
export { resumeOrCreateAgent };
export type { AgentNamespace };
