/**
 * PiExecutionController — drives the prompt/continue loop for a single Pi execution.
 *
 * Responsibilities:
 * - Subscribe to Pi SDK events and translate them to EngineEvents via translateEvent.
 * - Forward raw events to onRawModelMessage if provided.
 * - Observe turn_end events and delegate compaction decisions to PiCompactionCoordinator.
 * - Drive the run loop (start → wait → maybe continue) via RunDriver.
 * - Handle SDK overflow auto-compaction (willRetry) by awaiting the next agent_end.
 * - Close the AsyncQueue only after all events have been delivered.
 * - Preserve suspend-for-decision logic and post-execution error message stripping.
 */

import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { EngineEvent, ExecutionParams } from "../types.ts";
import { AsyncQueue } from "./async-queue.ts";
import { translateEvent } from "./event-translator.ts";
import { isContextOverflow } from "@earendil-works/pi-ai";
import type { RunDriver } from "./run-driver.ts";
import type { PiCompactionCoordinator } from "./compaction-coordinator.ts";
import type { Model } from "@earendil-works/pi-ai";

export interface ExecutionControllerOptions {
  session: AgentSession;
  resolvedPrompt: string;
  conversationId: number;
  piModel: Model<"openai-completions">;
  providerName: string;
  workingDirectory: string | undefined;
  signal?: AbortSignal;
  suspendRef: { onSuspend?: (event: EngineEvent) => void };
  onRawModelMessage: ExecutionParams["onRawModelMessage"];
  runDriver: RunDriver;
  compactionCoordinator: PiCompactionCoordinator;
}

export interface ExecutionState {
  suspendedForDecision: boolean;
  error: Error | undefined;
}

/**
 * Wire up the session event subscription and return the queue + state.
 * The queue receives translated EngineEvents and usage/compaction events.
 * The state is populated after the loop terminates (i.e. after the queue closes).
 *
 * Callers must:
 * 1. Iterate the returned queue (for await ... of queue)
 * 2. Call cleanup() in a finally block
 * 3. After the iteration, read state.suspendedForDecision and state.error
 */
export function startExecution(opts: ExecutionControllerOptions): {
  queue: AsyncQueue<EngineEvent>;
  state: ExecutionState;
  cleanup: () => void;
} {
  const {
    session,
    resolvedPrompt,
    conversationId,
    piModel,
    providerName,
    workingDirectory,
    signal,
    suspendRef,
    onRawModelMessage,
    runDriver,
    compactionCoordinator,
  } = opts;

  const queue = new AsyncQueue<EngineEvent>();
  const state: ExecutionState = { suspendedForDecision: false, error: undefined };
  const sdkWillRetryRef = { value: false };

  suspendRef.onSuspend = (event: EngineEvent) => {
    state.suspendedForDecision = true;
    queue.push(event);
    session.abort().catch(() => {});
  };

  const onAbort = () => {
    session.abort().catch(() => {});
    queue.close();
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  const unsubscribe = session.subscribe((event) => {
    if (onRawModelMessage) {
      onRawModelMessage({
        engine: "pi",
        sessionId: String(conversationId),
        direction: "inbound",
        eventType: event.type,
        payload: event as unknown as Record<string, unknown>,
      });
    }

    if (event.type === "turn_end") {
      const usage = session.getContextUsage();
      if (usage?.tokens != null) {
        queue.push({ type: "usage", inputTokens: usage.tokens, outputTokens: 0, contextWindow: piModel.contextWindow });
      }
      compactionCoordinator.handleTurnEnd(session, conversationId, providerName, usage?.tokens ?? undefined, piModel.contextWindow);
    }

    for (const engineEvent of translateEvent(event as any, workingDirectory)) {
      queue.push(engineEvent);
    }

    if (event.type === "compaction_end" && !event.aborted && event.willRetry) {
      sdkWillRetryRef.value = true;
    }
  });

  const cleanup = () => {
    signal?.removeEventListener("abort", onAbort);
    unsubscribe();
  };

  runWithCompactionResume(
    session,
    resolvedPrompt,
    conversationId,
    sdkWillRetryRef,
    providerName,
    signal,
    runDriver,
    compactionCoordinator,
  )
    .catch((err: unknown) => {
      state.error = err instanceof Error ? err : new Error(String(err));
    })
    .finally(() => {
      queue.close();
    });

  return { queue, state, cleanup };
}

async function runWithCompactionResume(
  session: AgentSession,
  resolvedPrompt: string,
  conversationId: number,
  sdkWillRetryRef: { value: boolean },
  providerName: string,
  signal: AbortSignal | undefined,
  runDriver: RunDriver,
  compactionCoordinator: PiCompactionCoordinator,
): Promise<void> {
  let isFirstIteration = true;
  while (true) {
    if (isFirstIteration) {
      isFirstIteration = false;
      await runDriver.start(session, resolvedPrompt, providerName, signal);
    } else {
      await runDriver.resume(session, providerName, signal);
    }

    if (sdkWillRetryRef.value) {
      sdkWillRetryRef.value = false;
      await waitForNextAgentEnd(session);
      continue;
    }

    const bgCompaction = compactionCoordinator.getPending(conversationId);
    if (bgCompaction) {
      await bgCompaction;
      const lastMsg = (session.agent.state.messages as any[]).at(-1);
      if (lastMsg?.role !== "assistant" || isContextOverflow(lastMsg)) {
        continue;
      }
      break;
    }

    break;
  }
}

async function waitForNextAgentEnd(session: AgentSession): Promise<void> {
  await new Promise<void>((resolve) => {
    const unsub = session.subscribe((evt) => {
      if (evt.type === "agent_end") {
        unsub();
        resolve();
      }
    });
  });
}
