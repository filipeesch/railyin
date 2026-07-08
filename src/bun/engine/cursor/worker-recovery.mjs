import { AgentBusyError } from "@cursor/sdk";
import { resumeOrCreateAgent } from "./worker-resume.mjs";

export class PersistentBusyError extends Error {
  constructor(message, context = {}) {
    super(message);
    this.name = "PersistentBusyError";
    this.failureKind = "persistent_busy";
    this.context = context;
  }
}

async function safeCloseAgent(agent) {
  if (!agent || typeof agent.close !== "function") return;
  try {
    await agent.close();
  } catch {
    // Ignore close failures; recovery already did the useful work.
  }
}

function buildAgentOptions(agentId, baseOptions) {
  return agentId ? { ...baseOptions, agentId } : baseOptions;
}

function logRecoveryEvent(log, event, context) {
  if (typeof log !== "function") return;
  log("warn", JSON.stringify({ event, ...context }));
}

export function isBusyLikeError(err) {
  if (!err || typeof err !== "object") return false;
  if (err instanceof AgentBusyError) return true;
  const status = typeof err.status === "number" ? err.status : Number.NaN;
  const code = String(err.code ?? "").toLowerCase();
  const message = String(err.message ?? "").toLowerCase();
  return (
    status === 409
    || code.includes("busy")
    || code.includes("conflict")
    || message.includes("already has active run")
  );
}

export async function sendWithBusyRetry(agent, prompt) {
  try {
    return await agent.send(prompt);
  } catch (err) {
    if (isBusyLikeError(err)) {
      return await agent.send(prompt, { local: { force: true } });
    }
    throw err;
  }
}

async function recreateAndSend(Agent, agentId, baseOptions, prompt, recoveryContext, log) {
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

export async function sendPromptWithRecovery(Agent, agentId, baseOptions, prompt, context = {}) {
  const recoveryContext = {
    runId: context.runId ?? null,
    executionId: context.executionId ?? null,
    taskId: context.taskId ?? null,
    conversationId: context.conversationId ?? null,
    agentId: agentId ?? null,
  };

  let initialAgent;
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
