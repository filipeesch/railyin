/**
 * Busy-agent recovery for the in-process Cursor adapter.
 *
 * Ported verbatim from the former `worker-recovery.mjs` (Node subprocess
 * worker). `Agent` is passed as a parameter (not hard-imported) so this
 * module stays unit-testable with a stub agent namespace.
 */

import { AgentBusyError, type AgentOptions } from "@cursor/sdk";
import { resumeOrCreateAgent, type AgentNamespace } from "./resume.ts";

/** An agent that can send a prompt and optionally be closed. Minimal shape
 * so recovery logic stays unit-testable with lightweight stubs. */
export interface SendableAgent<TRun = unknown> {
  send(prompt: string, options?: { local?: { force?: boolean } }): Promise<TRun>;
  close?(): unknown;
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

async function safeCloseAgent(agent: SendableAgent | undefined | null): Promise<void> {
  if (!agent || typeof agent.close !== "function") return;
  try {
    await agent.close();
  } catch {
    // Ignore close failures; recovery already did the useful work.
  }
}

function buildAgentOptions(agentId: string | undefined, baseOptions: AgentOptions): AgentOptions {
  return agentId ? { ...baseOptions, agentId } : baseOptions;
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

async function recreateAndSend<TAgent extends SendableAgent<TRun>, TRun>(
  Agent: AgentNamespace<TAgent>,
  agentId: string | undefined,
  baseOptions: AgentOptions,
  prompt: string,
  recoveryContext: RecoveryContext,
  log: RecoveryLog | undefined,
): Promise<{ agent: TAgent; run: TRun }> {
  const recreatedAgent = await Agent.create(buildAgentOptions(agentId, baseOptions));
  try {
    const run = await sendWithBusyRetry(recreatedAgent, prompt);
    logRecoveryEvent(log, "cursor_busy_recovery_succeeded", {
      ...recoveryContext,
      stage: "same_id_recreate",
    });
    return { agent: recreatedAgent, run };
  } catch (recreateErr) {
    await safeCloseAgent(recreatedAgent);
    if (isBusyLikeError(recreateErr)) {
      logRecoveryEvent(log, "cursor_busy_recovery_failed", {
        ...recoveryContext,
        stage: "same_id_recreate",
      });
      throw new PersistentBusyError("Cursor agent remained busy after same-id recreate", recoveryContext);
    }
    throw recreateErr;
  }
}

export async function sendPromptWithRecovery<TAgent extends SendableAgent<TRun>, TRun>(
  Agent: AgentNamespace<TAgent>,
  agentId: string | undefined,
  baseOptions: AgentOptions,
  prompt: string,
  context: SendPromptContext = {},
): Promise<{ agent: TAgent; run: TRun }> {
  const recoveryContext: RecoveryContext = {
    runId: context.runId ?? null,
    executionId: context.executionId ?? null,
    taskId: context.taskId ?? null,
    conversationId: context.conversationId ?? null,
    agentId: agentId ?? null,
  };

  let initialAgent: TAgent;
  try {
    initialAgent = await resumeOrCreateAgent(Agent, agentId, baseOptions);
  } catch (resumeErr) {
    if (!isBusyLikeError(resumeErr)) throw resumeErr;
    logRecoveryEvent(context.log, "cursor_busy_retry_exhausted", {
      ...recoveryContext,
      stage: "resume_or_create",
    });
    return recreateAndSend(Agent, agentId, baseOptions, prompt, recoveryContext, context.log);
  }

  try {
    return { agent: initialAgent, run: await sendWithBusyRetry(initialAgent, prompt) };
  } catch (err) {
    if (!isBusyLikeError(err)) {
      await safeCloseAgent(initialAgent);
      throw err;
    }

    logRecoveryEvent(context.log, "cursor_busy_retry_exhausted", {
      ...recoveryContext,
      stage: "force_retry",
    });
    await safeCloseAgent(initialAgent);
    return recreateAndSend(Agent, agentId, baseOptions, prompt, recoveryContext, context.log);
  }
}
