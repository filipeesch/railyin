import type {
  ExecutionEngine,
  ExecutionParams,
  EngineEvent,
  OnToken,
  OnError,
  OnTaskUpdated,
} from "../types.ts";
import type { Database } from "bun:sqlite";
import { fetchTaskWithModel } from "../../db/task-queries.ts";

/**
 * Owns the AbortController lifecycle and stream event processing for non-native engines.
 *
 * Responsibilities:
 *  - createSignal / abort: single registration site for AbortControllers
 *  - runNonNative: starts an engine execution and pipes events to consume()
 *  - consume: full EngineEvent state machine (tokens, tools, done, error, cancel)
 *
 * consume() is the single execution state machine for ALL runs (task, session,
 * AG-UI). It drives the DB lifecycle triad (tasks.execution_state /
 * chat_sessions.status / executions.status) and the AG-UI bridge tap
 * (opts.onEngineEvent) — the legacy write paths (conversation_messages via
 * ConvMessageBuffer, stream_events via the old event hook, model_raw_messages via
 * rawBuffer) were excised in 07-01: runs write zero rows to the frozen chat
 * tables (D-05).
 */
export class StreamProcessor {
  /** executionId → AbortController; single registration site */
  private readonly abortControllers = new Map<number, AbortController>();

  constructor(
    private readonly db: Database,
    private readonly onToken: OnToken,
    private readonly onError: OnError,
    private readonly onTaskUpdated: OnTaskUpdated,
    private readonly onDeferredTransition: (taskId: number, toState: string) => void = () => {},
    private readonly onPendingMessage: (taskId: number, message: string) => void = () => {},
  ) {}

  /**
   * Creates and registers a new AbortController for the given execution.
   * Returns the signal to pass into ExecutionParams.
   */
  createSignal(executionId: number): AbortSignal {
    const controller = new AbortController();
    this.abortControllers.set(executionId, controller);
    return controller.signal;
  }

  /** Aborts the execution (called by Orchestrator.cancel()). */
  abort(executionId: number): void {
    this.abortControllers.get(executionId)?.abort();
  }

  /** Emits a final done token event — used by cancel() when no active stream is running. */
  emitDone(taskId: number | null, conversationId: number, executionId: number): void {
    this.onToken(taskId, conversationId, executionId, "", true);
  }

  /** Starts the engine and pipes its event stream to consume(). */
  runNonNative(
    taskId: number | null,
    conversationId: number,
    executionId: number,
    engine: ExecutionEngine,
    params: ExecutionParams,
    opts?: import("../coordinator.ts").ChatTurnOpts,
  ): void {
    const stream = engine.execute(params);
    this.consume(taskId, conversationId, executionId, stream, opts).catch((err) => {
      console.error(
        `[stream-processor] Unhandled error from consume (task=${taskId}, execution=${executionId}):`,
        err,
      );
    });
  }

  /**
   * Consume an EngineEvent stream and drive DB writes + RPC relay.
   * Used by non-native engines that emit structured events.
   */
  async consume(
    taskId: number | null,
    conversationId: number,
    executionId: number,
    stream: AsyncIterable<EngineEvent>,
    opts?: import("../coordinator.ts").ChatTurnOpts,
  ): Promise<void> {
    const db = this.db;
    // WR-02: set when the done event finalized the run in-loop. The post-loop
    // uses it to distinguish "generator ended after a terminal" from
    // "generator ended WITHOUT any terminal" (the wedge case).
    let sawDoneEvent = false;

    try {
      const abortController = this.abortControllers.get(executionId) ?? (() => {
        const ctrl = new AbortController();
        this.abortControllers.set(executionId, ctrl);
        return ctrl;
      })();

      if (taskId != null) {
        db.run("UPDATE tasks SET execution_state = 'running' WHERE id = ?", [taskId]);
      } else {
        db.run("UPDATE chat_sessions SET status = 'running' WHERE conversation_id = ?", [conversationId]);
      }
      db.run(
        "UPDATE executions SET status = 'running', started_at = datetime('now') WHERE id = ?",
        [executionId],
      );

      for await (const event of stream) {
        if (abortController.signal.aborted) {
          if (taskId != null) {
            db.run("UPDATE tasks SET execution_state = 'waiting_user' WHERE id = ?", [taskId]);
          } else {
            db.run("UPDATE chat_sessions SET status = 'idle' WHERE conversation_id = ?", [conversationId]);
            opts?.onSessionStatusChange?.(conversationId);
          }
          db.run(
            "UPDATE executions SET status = 'cancelled', finished_at = datetime('now') WHERE id = ?",
            [executionId],
          );
          this.onToken(taskId, conversationId, executionId, "", true);
          opts?.onRunEnd?.("aborted");
          return;
        }

        // BRDG-01: fire the AG-UI bridge tap for EVERY raw engine event in exact
        // order, before the legacy switch (which owned the /ws broadcast + DB
        // dual-write). Absent opts → byte-identical behavior.
        opts?.onEngineEvent?.(event);

        switch (event.type) {
          case "token": {
            this.onToken(taskId, conversationId, executionId, event.content, false);
            break;
          }

          case "reasoning": {
            this.onToken(taskId, conversationId, executionId, event.content, false, true);
            break;
          }

          case "subagent_start": {
            break;
          }

          case "subagent_stop": {
            break;
          }

          case "tool_start": {
            // Suppress truly internal events (e.g. Copilot skill-planner tools).
            if (event.isInternal && !event.parentCallId) break;
            break;
          }

          case "tool_result": {
            // Suppress truly internal events (e.g. Copilot skill-planner tools).
            if (event.isInternal && !event.parentCallId) break;
            break;
          }

          case "done": {
            sawDoneEvent = true;
            if (taskId != null) {
              db.run("UPDATE tasks SET execution_state = 'completed' WHERE id = ?", [taskId]);
            } else {
              db.run("UPDATE chat_sessions SET status = 'idle' WHERE conversation_id = ?", [conversationId]);
              opts?.onSessionStatusChange?.(conversationId);
            }
            db.run(
              "UPDATE executions SET status = 'completed', finished_at = datetime('now') WHERE id = ?",
              [executionId],
            );
            this.onToken(taskId, conversationId, executionId, "", true);
            opts?.onRunEnd?.("done");
            break;
          }

          case "error": {
            if (event.fatal) {
              if (taskId != null) {
                db.run("UPDATE tasks SET execution_state = 'failed' WHERE id = ?", [taskId]);
              } else {
                db.run("UPDATE chat_sessions SET status = 'idle' WHERE conversation_id = ?", [conversationId]);
                opts?.onSessionStatusChange?.(conversationId);
              }
              db.run(
                "UPDATE executions SET status = 'failed', finished_at = datetime('now'), details = ? WHERE id = ?",
                [event.message, executionId],
              );
              this.onError(taskId, conversationId, executionId, event.message);
              this.abortControllers.get(executionId)?.abort();
              opts?.onRunEnd?.("error");
              return;
            }
            this.onError(taskId, conversationId, executionId, event.message);
            break;
          }

          case "decision_request": {
            // The only live HITL channel. For standalone sessions (taskId == null)
            // the chat_sessions 'waiting_user' write replaces the legacy new-message
            // push that previously drove the sidebar state (stores/chat.ts
            // onChatSessionUpdated); the session-status callback fires so the
            // orchestrator broadcasts chatSession.updated.
            if (taskId != null) {
              db.run("UPDATE tasks SET execution_state = 'waiting_user' WHERE id = ?", [taskId]);
            } else {
              db.run("UPDATE chat_sessions SET status = 'waiting_user' WHERE conversation_id = ?", [conversationId]);
              opts?.onSessionStatusChange?.(conversationId);
            }
            db.run(
              "UPDATE executions SET status = 'waiting_user', finished_at = datetime('now') WHERE id = ?",
              [executionId],
            );
            this.onToken(taskId, conversationId, executionId, "", true);
            opts?.onRunEnd?.("decision");
            return;
          }

          case "task_updated": {
            this.onTaskUpdated(event.task);
            break;
          }

          default:
            break;
        }
      }

      // Post-loop: generator ended normally (done event handled above) or was aborted.
      if (abortController.signal.aborted) {
        if (taskId != null) {
          db.run("UPDATE tasks SET execution_state = 'waiting_user' WHERE id = ?", [taskId]);
        } else {
          db.run("UPDATE chat_sessions SET status = 'idle' WHERE conversation_id = ?", [conversationId]);
          opts?.onSessionStatusChange?.(conversationId);
        }
        db.run(
          "UPDATE executions SET status = 'cancelled', finished_at = datetime('now') WHERE id = ?",
          [executionId],
        );
        this.onToken(taskId, conversationId, executionId, "", true);
        opts?.onRunEnd?.("aborted");
      } else if (!sawDoneEvent) {
        // WR-02: a stream that ended WITHOUT a done event — and without abort
        // (e.g. the Pi engine's fatal:false error followed by end-of-stream) —
        // never wrote a terminal. Without this guard the DB triad stays
        // 'running' with finished_at NULL forever: the task card spins, and
        // the agent's advisory lock rejects every future run for the
        // conversation with THREAD_BUSY. Finalize exactly like the done case
        // (completed + terminal events) so the run can never wedge.
        if (taskId != null) {
          db.run("UPDATE tasks SET execution_state = 'completed' WHERE id = ?", [taskId]);
        } else {
          db.run("UPDATE chat_sessions SET status = 'idle' WHERE conversation_id = ?", [conversationId]);
          opts?.onSessionStatusChange?.(conversationId);
        }
        db.run(
          "UPDATE executions SET status = 'completed', finished_at = datetime('now') WHERE id = ?",
          [executionId],
        );
        this.onToken(taskId, conversationId, executionId, "", true);
        opts?.onRunEnd?.("done");
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (taskId != null) {
        db.run("UPDATE tasks SET execution_state = 'failed' WHERE id = ?", [taskId]);
      } else {
        db.run("UPDATE chat_sessions SET status = 'idle' WHERE conversation_id = ?", [conversationId]);
        opts?.onSessionStatusChange?.(conversationId);
      }
      db.run(
        "UPDATE executions SET status = 'failed', finished_at = datetime('now'), details = ? WHERE id = ?",
        [errMsg, executionId],
      );
      this.abortControllers.get(executionId)?.abort();
      this.onError(taskId, conversationId, executionId, errMsg);
      opts?.onRunEnd?.("error");
    } finally {
      this.abortControllers.delete(executionId);

      if (taskId != null) {
        const finalTask = fetchTaskWithModel(db, taskId);
        if (finalTask) {
          this.onTaskUpdated(finalTask);

          const finalRow = db.query<{ needs_column_prompt: number; workflow_state: string }, [number]>(
            "SELECT needs_column_prompt, workflow_state FROM tasks WHERE id = ?",
          ).get(taskId);
          if (finalRow?.needs_column_prompt === 1) {
            db.run("UPDATE tasks SET needs_column_prompt = 0 WHERE id = ?", [taskId]);
            void this.onDeferredTransition(taskId, finalRow.workflow_state);
          } else {
            const pending = db
              .query<{ id: number; content: string }, [number]>(
                "SELECT id, content FROM pending_messages WHERE task_id = ? ORDER BY id",
              )
              .all(taskId);
            if (pending.length > 0) {
              db.run("DELETE FROM pending_messages WHERE task_id = ?", [taskId]);
              for (const row of pending) {
                void this.onPendingMessage(taskId, row.content);
              }
            }
          }
        }
      }
    }
  }
}
