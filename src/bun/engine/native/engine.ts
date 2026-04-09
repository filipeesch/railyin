/**
 * NativeEngine — implements ExecutionEngine by wrapping the existing
 * callback-based engine functions from workflow/engine.ts.
 *
 * The async channel pattern bridges the callback-based API to AsyncIterable<EngineEvent>.
 * All DB writes and state management remain inside the existing engine functions for now.
 * DB writes will be moved to the orchestrator in a future extraction pass (tasks 3.2–3.7).
 */

import type { ExecutionEngine, ExecutionParams, EngineEvent, EngineModelInfo } from "../types.ts";
import type { OnToken, OnError, OnTaskUpdated, OnNewMessage } from "../../workflow/engine.ts";
import {
  handleTransition,
  handleHumanTurn,
  handleRetry,
  handleCodeReview,
  cancelExecution as nativeCancelExecution,
} from "../../workflow/engine.ts";
import { getConfig } from "../../config/index.ts";
import { listOpenAICompatibleModels } from "../../ai/index.ts";

// ─── Async channel ────────────────────────────────────────────────────────────

interface Channel<T> {
  push: (item: T) => void;
  finish: (err?: Error) => void;
  iter: () => AsyncGenerator<T>;
}

function makeChannel<T>(): Channel<T> {
  const queue: T[] = [];
  let waitResolve: (() => void) | null = null;
  let finished = false;
  let finishError: Error | null = null;

  return {
    push(item: T) {
      queue.push(item);
      if (waitResolve) { const r = waitResolve; waitResolve = null; r(); }
    },
    finish(err?: Error) {
      finished = true;
      if (err) finishError = err;
      if (waitResolve) { const r = waitResolve; waitResolve = null; r(); }
    },
    async *iter(): AsyncGenerator<T> {
      while (true) {
        while (queue.length > 0) {
          yield queue.shift()!;
        }
        if (finished) {
          if (finishError) throw finishError;
          return;
        }
        await new Promise<void>(resolve => {
          // Double-check state synchronously inside the executor to close
          // the race between checking `finished` above and setting waitResolve here.
          if (finished || queue.length > 0) {
            resolve();
          } else {
            waitResolve = resolve;
          }
        });
      }
    },
  };
}

// ─── NativeEngine ─────────────────────────────────────────────────────────────

export class NativeEngine implements ExecutionEngine {
  /** Per-execution channel finishers — used by cancel() to unblock the stream. */
  private readonly finishers = new Map<number, () => void>();

  execute(params: ExecutionParams): AsyncIterable<EngineEvent> {
    return this._run(params);
  }

  private async *_run(params: ExecutionParams): AsyncGenerator<EngineEvent> {
    const { executionId, taskId, nativeExecType = "transition", toState, prompt } = params;
    const channel = makeChannel<EngineEvent>();

    // Register finisher so cancel() can close the stream
    this.finishers.set(executionId, () => channel.finish());

    // Wrapper callbacks: relay token events to the EngineEvent channel
    const onToken: OnToken = (_tid, _eid, token, done, isReasoning, isStatus) => {
      if (done) {
        channel.finish();
      } else if (isStatus) {
        channel.push({ type: "status", message: token });
      } else if (isReasoning) {
        channel.push({ type: "reasoning", content: token });
      } else {
        channel.push({ type: "token", content: token });
      }
    };

    const onError: OnError = (_tid, _eid, error) => {
      channel.push({ type: "error", message: error, fatal: true });
      channel.finish();
    };

    // Wrap onTaskUpdated and onNewMessage into EngineEvents so the orchestrator
    // can relay them via RPC uniformly (no direct RPC calls from inside the engine).
    const onTaskUpdated: OnTaskUpdated = (task) => {
      channel.push({ type: "task_updated", task });
    };

    const onNewMessage: OnNewMessage = (message) => {
      channel.push({ type: "new_message", message });
    };

    try {
      switch (nativeExecType) {
        case "transition":
          if (!toState) throw new Error("toState is required for transition execution");
          handleTransition(taskId, toState, onToken, onError, onTaskUpdated, onNewMessage).catch(
            (e) => {
              channel.push({ type: "error", message: String(e), fatal: true });
              channel.finish();
            },
          );
          break;

        case "human_turn":
          handleHumanTurn(taskId, prompt, onToken, onError, onTaskUpdated, onNewMessage).catch(
            (e) => {
              channel.push({ type: "error", message: String(e), fatal: true });
              channel.finish();
            },
          );
          break;

        case "retry":
          handleRetry(taskId, onToken, onError, onTaskUpdated, onNewMessage).catch(
            (e) => {
              channel.push({ type: "error", message: String(e), fatal: true });
              channel.finish();
            },
          );
          break;

        case "code_review":
          handleCodeReview(
            taskId,
            onToken,
            onError,
            onTaskUpdated,
            onNewMessage,
          ).catch((e) => {
            channel.push({ type: "error", message: String(e), fatal: true });
            channel.finish();
          });
          break;

        default:
          channel.push({ type: "error", message: `Unknown nativeExecType: ${nativeExecType}`, fatal: true });
          channel.finish();
      }
    } catch (e) {
      channel.push({ type: "error", message: String(e), fatal: true });
      channel.finish();
    }

    try {
      yield* channel.iter();
    } finally {
      this.finishers.delete(executionId);
    }
  }

  cancel(executionId: number): void {
    // Abort the in-flight HTTP request / AI loop
    nativeCancelExecution(executionId);
    // Also finish the channel in case the engine doesn't call onToken(done=true)
    // after cancellation (e.g. cancellation during waiting_user state)
    const finisher = this.finishers.get(executionId);
    if (finisher) {
      finisher();
      this.finishers.delete(executionId);
    }
  }

  async listModels(): Promise<EngineModelInfo[]> {
    const config = getConfig();
    const results: EngineModelInfo[] = [];

    for (const provider of config.providers) {
      if (provider.type === "anthropic") {
        try {
          const res = await fetch("https://api.anthropic.com/v1/models", {
            headers: { "x-api-key": provider.api_key ?? "", "anthropic-version": "2023-06-01" },
          });
          if (res.ok) {
            const json = await res.json() as { data?: Array<{ id: string; display_name?: string; context_window?: number }> };
            for (const m of json.data ?? []) {
              results.push({
                qualifiedId: `${provider.id}/${m.id}`,
                displayName: m.display_name ?? m.id,
                contextWindow: m.context_window,
              });
            }
          }
        } catch { /* skip provider on error */ }
      } else if (provider.type !== "fake") {
        try {
          const models = await listOpenAICompatibleModels(provider);
          for (const m of models) {
            results.push({
              qualifiedId: `${provider.id}/${m.id}`,
              displayName: m.id,
              contextWindow: m.contextWindow ?? undefined,
            });
          }
        } catch { /* skip provider on error */ }
      }
    }

    return results;
  }
}
