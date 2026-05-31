import type {
  ExecutionEngine,
  ExecutionParams,
  EngineEvent,
  OnToken,
  OnError,
  OnTaskUpdated,
  OnNewMessage,
  OnStreamEvent,
  RawModelMessage,
} from "../types.ts";
import type { MessageType } from "../../../shared/rpc-types.ts";
import type { Database } from "bun:sqlite";
import { ConvMessageBuffer } from "../../conversation/conv-message-buffer.ts";
import type { WriteBuffer } from "../../pipeline/write-buffer.ts";
import type { RawMessageItem } from "./raw-message-buffer.ts";
import { fetchTaskWithModel } from "../../db/task-queries.ts";

/**
 * Per-token delta event types that are broadcast immediately but not persisted to
 * model_raw_messages. Skipping persistence for these reduces write load by ~90%
 * during active streaming without losing any information (assembled content is
 * stored via stream_events and conversation_messages).
 */
const HIGH_FREQ_RAW_EVENT_TYPES = new Set([
  "assistant.message_delta",   // Copilot text token
  "assistant.reasoning_delta", // Copilot reasoning token
  "content_block_delta",       // Claude text/tool-input token
]);

/**
 * Owns the AbortController lifecycle and stream event processing for non-native engines.
 *
 * Responsibilities:
 *  - createSignal / abort: single registration site for AbortControllers
 *  - runNonNative: starts an engine execution and pipes events to consume()
 *  - consume: full EngineEvent state machine (tokens, tools, done, error, cancel)
 *  - _appendPromptMessage / _pauseExecution: ask_user / shell_approval helpers
 *  - _emitFileDiffFromWrittenFiles: file diff emission on tool_result
 */
export class StreamProcessor {
  /** executionId → AbortController; single registration site */
  private readonly abortControllers = new Map<number, AbortController>();
  /** executionId → next seq number for raw model messages */
  private readonly rawMessageSeq = new Map<number, number>();

  private onStreamEvent?: OnStreamEvent;
  /** Execution IDs for which onRawMessageEnqueued is already broadcasting text/reasoning chunks.
   * consume() skips text_chunk/reasoning_chunk broadcast for these executions to avoid double-send. */
  private readonly claudeExecutionIds = new Set<number>();

  constructor(
    private readonly db: Database,
    private readonly rawBuffer: WriteBuffer<RawMessageItem>,
    private readonly onToken: OnToken,
    private readonly onError: OnError,
    private readonly onTaskUpdated: OnTaskUpdated,
    private readonly onNewMessage: OnNewMessage,
    private readonly onDeferredTransition: (taskId: number, toState: string) => void = () => {},
    private readonly onPendingMessage: (taskId: number, message: string) => void = () => {},
  ) {}

  setOnStreamEvent(cb: OnStreamEvent): void {
    this.onStreamEvent = cb;
  }

  /** Mark an execution as Claude-backed so consume() skips text/reasoning chunk broadcast. */
  markClaudeExecution(executionId: number): void {
    this.claudeExecutionIds.add(executionId);
  }

  /** Remove per-execution Claude marker on cleanup. */
  private clearClaudeExecution(executionId: number): void {
    this.claudeExecutionIds.delete(executionId);
  }

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

  /**
   * Returns a bound callback for persisting raw model messages for the given execution.
   * Used by ExecutionParamsBuilder to populate onRawModelMessage.
   *
   * High-frequency per-token events (text/reasoning deltas) are broadcast via
   * signalOnly() so the WS push fires immediately, but they are NOT written to
   * model_raw_messages — this reduces write load by ~90% during active streaming.
   */
  makePersistCallback(
    taskId: number | null,
    conversationId: number,
    executionId: number,
  ): (raw: RawModelMessage) => void {
    return (raw) => {
      const seq = (this.rawMessageSeq.get(executionId) ?? 0) + 1;
      this.rawMessageSeq.set(executionId, seq);
      const item = { taskId, conversationId, executionId, seq, raw };
      if (HIGH_FREQ_RAW_EVENT_TYPES.has(raw.eventType)) {
        // Broadcast immediately but skip DB persistence for token-level deltas.
        this.rawBuffer.signalOnly(item);
      } else {
        this.rawBuffer.enqueue(item);
      }
    };
  }

  /** Starts the engine and pipes its event stream to consume(). */
  runNonNative(
    taskId: number | null,
    conversationId: number,
    executionId: number,
    engine: ExecutionEngine,
    params: ExecutionParams,
  ): void {
    const stream = engine.execute(params);
    this.consume(taskId, conversationId, executionId, stream).catch((err) => {
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
  ): Promise<void> {
    const db = this.db;
    const convBuffer = new ConvMessageBuffer(db);
    let tokenAccum = "";
    let reasoningAccum = "";
    let hadOutput = false;
    const callStack: string[] = [];
    let reasoningBlockId: string | null = null;
    let reasoningFlushCount = 0;
    // Subagent child tool callIds are only unique within a child session and can repeat
    // (local models reuse ids like "call_0" across sequential calls) or collide with parent
    // callIds. The frontend store keys live blocks by blockId, so any repeat would be silently
    // dropped. We assign each child tool-call occurrence a globally-unique LIVE blockId and
    // remember it so the matching tool_result (and any file_diff) reuse the same id. The
    // persisted message keeps the raw callId (DB reload nests via parent_tool_call_id), so
    // history is unaffected.
    let childToolSeq = 0;
    const childLiveBlockIdByCall = new Map<string, string>();
    const childCallKey = (parentCallId: string, callId: string) => `${parentCallId}\u0000${callId}`;

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
          this._flushAccumulators(convBuffer, taskId, conversationId, executionId, tokenAccum, reasoningAccum, callStack);
          convBuffer.flush().forEach((msg) => this.onNewMessage(msg));
          tokenAccum = "";
          reasoningAccum = "";
          if (taskId != null) {
            db.run("UPDATE tasks SET execution_state = 'waiting_user' WHERE id = ?", [taskId]);
          } else {
            db.run("UPDATE chat_sessions SET status = 'idle' WHERE conversation_id = ?", [conversationId]);
          }
          db.run(
            "UPDATE executions SET status = 'cancelled', finished_at = datetime('now') WHERE id = ?",
            [executionId],
          );
          this.onToken(taskId, conversationId, executionId, "", true);
          this.onStreamEvent?.({ taskId, conversationId, executionId, seq: 0, blockId: `${executionId}-done`, type: "done", content: "", metadata: null, parentBlockId: null, done: true, subagentId: null });
          return;
        }

        switch (event.type) {
          case "token": {
            if (reasoningAccum) {
              convBuffer.enqueue({ taskId, conversationId, type: "reasoning", role: null, content: reasoningAccum, notify: true });
              convBuffer.flush().forEach((msg) => this.onNewMessage(msg));
              this.onStreamEvent?.({ taskId, conversationId, executionId, seq: 0, blockId: "", type: "reasoning", content: reasoningAccum, metadata: null, parentBlockId: callStack.at(-1) ?? null, done: false, subagentId: null });
              reasoningAccum = "";
            }
            reasoningBlockId = null;
            tokenAccum += event.content;
            hadOutput = true;
            this.onToken(taskId, conversationId, executionId, event.content, false);
            if (!this.claudeExecutionIds.has(executionId)) {
              // For non-Claude engines (mock, Copilot): broadcast text_chunk here.
              // For Claude: onEnqueue fires earlier in the adapter IIFE; skip to avoid double-send.
              this.onStreamEvent?.({ taskId, conversationId, executionId, seq: 0, blockId: "", type: "text_chunk", content: event.content, metadata: null, parentBlockId: null, done: false, subagentId: null });
            }
            break;
          }

          case "reasoning": {
            reasoningAccum += event.content;
            this.onToken(taskId, conversationId, executionId, event.content, false, true);
            if (!this.claudeExecutionIds.has(executionId)) {
              // For non-Claude engines: broadcast reasoning_chunk here.
              // For Claude: onEnqueue fires earlier; skip to avoid double-send.
              this.onStreamEvent?.({ taskId, conversationId, executionId, seq: 0, blockId: "", type: "reasoning_chunk", content: event.content, metadata: null, parentBlockId: null, done: false, subagentId: null });
            }
            break;
          }

          case "status": {
            this.onToken(taskId, conversationId, executionId, event.message, false, false, true);
            this.onStreamEvent?.({ taskId, conversationId, executionId, seq: 0, blockId: "", type: "status_chunk", content: event.message, metadata: null, parentBlockId: callStack.at(-1) ?? null, done: false, subagentId: null });
            convBuffer.enqueue({ taskId, conversationId, type: "status", role: null, content: event.message, notify: false });
            convBuffer.flush();
            break;
          }

          case "subagent_start": {
            hadOutput = true;
            const subagentArgs = JSON.stringify({ intent: event.intent, prompt: event.prompt });
            const subagentCallContent = JSON.stringify({
              type: "function",
              function: { name: "subagent", arguments: subagentArgs },
              id: event.callId,
              display: { label: event.intent },
            });
            const subagentMeta = { parent_tool_call_id: null };
            convBuffer.enqueue({ taskId, conversationId, type: "tool_call", role: null, content: subagentCallContent, metadata: subagentMeta, notify: true });
            convBuffer.flush().forEach((msg) => this.onNewMessage(msg));
            this.onStreamEvent?.({ taskId, conversationId, executionId, seq: 0, blockId: event.callId, type: "tool_call", content: subagentCallContent, metadata: JSON.stringify(subagentMeta), parentBlockId: null, done: false, subagentId: event.callId });
            // Do NOT push to callStack — subagent blocks are structural containers, not call frames
            break;
          }

          case "tool_start": {
            // Suppress truly internal events (e.g. Copilot skill-planner tools).
            // Subagent child events (isInternal + parentCallId) are persisted and nested.
            if (event.isInternal && !event.parentCallId) break;
            hadOutput = true;
            if (!event.isInternal) {
              if (reasoningAccum) {
                const rBlockId = `${executionId}-pre-r${++reasoningFlushCount}`;
                convBuffer.enqueue({ taskId, conversationId, type: "reasoning", role: null, content: reasoningAccum, notify: true });
                convBuffer.flush().forEach((msg) => this.onNewMessage(msg));
                this.onStreamEvent?.({ taskId, conversationId, executionId, seq: 0, blockId: rBlockId, type: "reasoning", content: reasoningAccum, metadata: null, parentBlockId: callStack.at(-1) ?? null, done: false, subagentId: null });
                reasoningBlockId = rBlockId;
                reasoningAccum = "";
              }
              if (tokenAccum) {
                convBuffer.enqueue({ taskId, conversationId, type: "assistant", role: "assistant", content: tokenAccum, notify: true });
                convBuffer.flush().forEach((msg) => this.onNewMessage(msg));
                this.onStreamEvent?.({ taskId, conversationId, executionId, seq: 0, blockId: "", type: "assistant", content: tokenAccum, metadata: null, parentBlockId: callStack.at(-1) ?? null, done: false, subagentId: null });
                tokenAccum = "";
              }
            }
            const callId = event.callId ?? `call_${Date.now()}_${Math.random().toString(36).slice(2)}`;
            const toolCallMsg = JSON.stringify({
              type: "function",
              function: { name: event.name, arguments: event.arguments },
              id: callId,
              display: event.display,
            });
            const toolMeta = {
              parent_tool_call_id: event.parentCallId ?? null,
            };
            convBuffer.enqueue({ taskId, conversationId, type: "tool_call", role: null, content: toolCallMsg, metadata: toolMeta, notify: true });
            convBuffer.flush().forEach((msg) => this.onNewMessage(msg));
            const toolParentBlockId = event.parentCallId ?? null;
            // Subagent child tool callIds are only unique WITHIN a child session. They can
            // collide with parent callIds, with PARALLEL siblings (different bubbles), or be
            // REUSED sequentially within one child (local models emit "call_0" repeatedly).
            // The frontend store keys live blocks by blockId, so any repeat is silently
            // dropped. Give every child tool-call occurrence a globally-unique LIVE blockId
            // (namespaced by parent bubble + a monotonic counter) and remember it so the
            // matching tool_result and any file_diff reuse the exact same id. The persisted
            // message keeps the raw callId (nested on reload via parent_tool_call_id), so
            // history is unaffected.
            let liveToolBlockId: string;
            if (event.isInternal && event.parentCallId) {
              liveToolBlockId = `${event.parentCallId}::${callId}::${++childToolSeq}`;
              childLiveBlockIdByCall.set(childCallKey(event.parentCallId, callId), liveToolBlockId);
            } else {
              liveToolBlockId = callId;
            }
            this.onStreamEvent?.({ taskId, conversationId, executionId, seq: 0, blockId: liveToolBlockId, type: "tool_call", content: toolCallMsg, metadata: JSON.stringify(toolMeta), parentBlockId: toolParentBlockId, done: false, subagentId: null });
            if (!event.isInternal) callStack.push(callId);
            break;
          }

          case "tool_result": {
            // Suppress truly internal events (e.g. Copilot skill-planner tools).
            // Subagent child events (isInternal + parentCallId) are persisted and nested.
            if (event.isInternal && !event.parentCallId) break;
            hadOutput = true;
            if (!event.isInternal && reasoningAccum) {
              convBuffer.enqueue({ taskId, conversationId, type: "reasoning", role: null, content: reasoningAccum, notify: true });
              convBuffer.flush().forEach((msg) => this.onNewMessage(msg));
              this.onStreamEvent?.({ taskId, conversationId, executionId, seq: 0, blockId: "", type: "reasoning", content: reasoningAccum, metadata: null, parentBlockId: callStack.at(-1) ?? null, done: false, subagentId: null });
              reasoningAccum = "";
            }
            const resultMsg = JSON.stringify({
              type: "tool_result",
              tool_use_id: event.callId,
              content: event.result,
              detailedContent: event.detailedResult,
              contents: event.contentBlocks,
              is_error: event.isError,
              writtenFiles: event.writtenFiles,
            });
            const resultMeta = {
              tool_call_id: event.callId ?? null,
              parent_tool_call_id: event.parentCallId ?? null,
            };
            convBuffer.enqueue({ taskId, conversationId, type: "tool_result", role: null, content: resultMsg, metadata: resultMeta, notify: true });
            const flushedResult = convBuffer.flush();
            const resultMsgRow = flushedResult[0];
            if (resultMsgRow) this.onNewMessage(resultMsgRow);
            const resultCallId = event.callId ?? (resultMsgRow?.id.toString() ?? "");
            if (!event.isInternal) {
              const stackIdx = callStack.lastIndexOf(resultCallId);
              if (stackIdx !== -1) callStack.splice(stackIdx, 1);
            }
            const resultParentBlockId = event.parentCallId ?? null;
            // Reuse the exact LIVE blockId assigned to the matching child tool_call so the
            // result resolves the correct (namespaced, possibly-repeated) live block. Consume
            // the mapping so the next reuse of this callId starts a fresh occurrence.
            let liveResultBlockId = resultCallId;
            if (event.isInternal && event.parentCallId) {
              const key = childCallKey(event.parentCallId, resultCallId);
              liveResultBlockId = childLiveBlockIdByCall.get(key) ?? `${event.parentCallId}::${resultCallId}::${++childToolSeq}`;
              childLiveBlockIdByCall.delete(key);
            }
            this.onStreamEvent?.({ taskId, conversationId, executionId, seq: 0, blockId: liveResultBlockId, type: "tool_result", content: resultMsg, metadata: JSON.stringify(resultMeta), parentBlockId: resultParentBlockId, done: false, subagentId: null });

            if (!event.isError && event.callId) {
              const writtenFiles = event.writtenFiles ?? [];
              if (writtenFiles.length > 0) {
                await this._emitFileDiffFromWrittenFiles(
                  convBuffer,
                  taskId,
                  conversationId,
                  executionId,
                  event.callId,
                  writtenFiles,
                  // Child file diffs must nest under the namespaced live tool block, not the
                  // raw callId (which may collide). Persisted metadata keeps the raw callId.
                  (event.isInternal && event.parentCallId) ? liveResultBlockId : undefined,
                );
              }
            }
            break;
          }

          case "usage": {
            db.run(
              "UPDATE executions SET input_tokens = ?, output_tokens = ? WHERE id = ?",
              [event.inputTokens ?? null, event.outputTokens ?? null, executionId],
            );
            if (event.inputTokens != null) {
              this.onStreamEvent?.({
                taskId,
                conversationId,
                executionId,
                seq: 0,
                blockId: "",
                type: "usage",
                content: "",
                metadata: JSON.stringify({
                  usedTokens: event.inputTokens,
                  maxTokens: event.contextWindow ?? null,
                }),
                parentBlockId: null,
                done: false,
                subagentId: null,
              });
            }
            break;
          }

          case "done": {
            if (reasoningAccum) {
              convBuffer.enqueue({ taskId, conversationId, type: "reasoning", role: null, content: reasoningAccum, notify: true });
              this.onStreamEvent?.({ taskId, conversationId, executionId, seq: 0, blockId: "", type: "reasoning", content: reasoningAccum, metadata: null, parentBlockId: callStack.at(-1) ?? null, done: false, subagentId: null });
              reasoningAccum = "";
            }
            if (tokenAccum) {
              convBuffer.enqueue({ taskId, conversationId, type: "assistant", role: "assistant", content: tokenAccum, notify: true });
              this.onStreamEvent?.({ taskId, conversationId, executionId, seq: 0, blockId: "", type: "assistant", content: tokenAccum, metadata: null, parentBlockId: callStack.at(-1) ?? null, done: false, subagentId: null });
              tokenAccum = "";
            } else if (!hadOutput) {
              const warnMsg = "Agent completed with no output. The prompt may not have been resolved correctly.";
              convBuffer.enqueue({ taskId, conversationId, type: "system", role: null, content: warnMsg, notify: true });
            }
            convBuffer.flush().forEach((msg) => this.onNewMessage(msg));

            if (taskId != null) {
              db.run("UPDATE tasks SET execution_state = 'completed' WHERE id = ?", [taskId]);
            } else {
              db.run("UPDATE chat_sessions SET status = 'idle' WHERE conversation_id = ?", [conversationId]);
            }
            db.run(
              "UPDATE executions SET status = 'completed', finished_at = datetime('now') WHERE id = ?",
              [executionId],
            );
            this.onToken(taskId, conversationId, executionId, "", true);
            this.onStreamEvent?.({ taskId, conversationId, executionId, seq: 0, blockId: `${executionId}-done`, type: "done", content: "", metadata: null, parentBlockId: null, done: true, subagentId: null });
            break;
          }

          case "error": {
            if (event.fatal) {
              if (taskId != null) {
                db.run("UPDATE tasks SET execution_state = 'failed' WHERE id = ?", [taskId]);
              } else {
                db.run("UPDATE chat_sessions SET status = 'idle' WHERE conversation_id = ?", [conversationId]);
              }
              db.run(
                "UPDATE executions SET status = 'failed', finished_at = datetime('now'), details = ? WHERE id = ?",
                [event.message, executionId],
              );
              this.onError(taskId, conversationId, executionId, event.message);
              this.abortControllers.get(executionId)?.abort();
              this.onStreamEvent?.({ taskId, conversationId, executionId, seq: 0, blockId: `${executionId}-done`, type: "done", content: "", metadata: null, parentBlockId: null, done: true, subagentId: null });
              return;
            }
            this.onError(taskId, conversationId, executionId, event.message);
            convBuffer.enqueue({ taskId, conversationId, type: "system", role: null, content: `Error: ${event.message}`, notify: false });
            convBuffer.flush();
            break;
          }

          case "shell_approval": {
            this._appendPromptMessage(
              convBuffer,
              taskId,
              conversationId,
              JSON.stringify({ subtype: "shell_approval", command: event.command, unapprovedBinaries: [] }),
            );
            this._pauseExecution(taskId, conversationId, executionId);
            break;
          }

          case "ask_user": {
            this._appendPromptMessage(convBuffer, taskId, conversationId, event.payload);
            this._pauseExecution(taskId, conversationId, executionId);
            break;
          }

          case "decision_request": {
            convBuffer.enqueue({ taskId, conversationId, type: "decision_request_prompt", role: null, content: event.payload, notify: true });
            convBuffer.flush().forEach((msg) => this.onNewMessage(msg));
            if (taskId != null) {
              db.run("UPDATE tasks SET execution_state = 'waiting_user' WHERE id = ?", [taskId]);
            }
            db.run(
              "UPDATE executions SET status = 'waiting_user', finished_at = datetime('now') WHERE id = ?",
              [executionId],
            );
            this.onStreamEvent?.({ taskId, conversationId, executionId, seq: 0, blockId: `${executionId}-done`, type: "done", content: "", metadata: null, parentBlockId: null, done: true, subagentId: null });
            this.onToken(taskId, conversationId, executionId, "", true);
            return;
          }

          case "compaction_start": {
            convBuffer.enqueue({ taskId, conversationId, type: "system", role: null, content: "Compacting conversation…", notify: true });
            convBuffer.flush().forEach((msg) => this.onNewMessage(msg));
            break;
          }

          case "compaction_done": {
            const lastMsg = db.query<{ type: string }, [number]>(
              "SELECT type FROM conversation_messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1"
            ).get(conversationId);
            if (lastMsg?.type === "compaction_summary") break;
            convBuffer.enqueue({ taskId, conversationId, type: "compaction_summary", role: null, content: event.summary ?? "", notify: true });
            convBuffer.flush().forEach((msg) => this.onNewMessage(msg));
            break;
          }

          case "task_updated": {
            this.onTaskUpdated(event.task);
            break;
          }

          case "new_message": {
            this.onNewMessage(event.message);
            break;
          }

          default:
            break;
        }
      }

      // Post-loop: generator ended normally (done event handled above) or was aborted.
      if (abortController.signal.aborted) {
        this._flushAccumulators(convBuffer, taskId, conversationId, executionId, tokenAccum, reasoningAccum, callStack);
        convBuffer.flush().forEach((msg) => this.onNewMessage(msg));
        tokenAccum = "";
        reasoningAccum = "";
        if (taskId != null) {
          db.run("UPDATE tasks SET execution_state = 'waiting_user' WHERE id = ?", [taskId]);
        } else {
          db.run("UPDATE chat_sessions SET status = 'idle' WHERE conversation_id = ?", [conversationId]);
        }
        db.run(
          "UPDATE executions SET status = 'cancelled', finished_at = datetime('now') WHERE id = ?",
          [executionId],
        );
        this.onToken(taskId, conversationId, executionId, "", true);
        this.onStreamEvent?.({ taskId, conversationId, executionId, seq: 0, blockId: `${executionId}-done`, type: "done", content: "", metadata: null, parentBlockId: null, done: true, subagentId: null });
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (taskId != null) {
        db.run("UPDATE tasks SET execution_state = 'failed' WHERE id = ?", [taskId]);
      } else {
        db.run("UPDATE chat_sessions SET status = 'idle' WHERE conversation_id = ?", [conversationId]);
      }
      db.run(
        "UPDATE executions SET status = 'failed', finished_at = datetime('now'), details = ? WHERE id = ?",
        [errMsg, executionId],
      );
      this.abortControllers.get(executionId)?.abort();
      this.onError(taskId, conversationId, executionId, errMsg);
      this.onStreamEvent?.({ taskId, conversationId, executionId, seq: 0, blockId: `${executionId}-done`, type: "done", content: "", metadata: null, parentBlockId: null, done: true, subagentId: null });
    } finally {
      this.abortControllers.delete(executionId);
      this.rawMessageSeq.delete(executionId);
      this.clearClaudeExecution(executionId);

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

  // ─── Private helpers ───────────────────────────────────────────────────────

  /** Flush accumulated tokens and reasoning to buffer before a cancel or done transition. */
  private _flushAccumulators(
    convBuffer: ConvMessageBuffer,
    taskId: number | null,
    conversationId: number,
    executionId: number,
    tokenAccum: string,
    reasoningAccum: string,
    callStack: string[],
  ): void {
    if (reasoningAccum) {
      convBuffer.enqueue({ taskId, conversationId, type: "reasoning", role: null, content: reasoningAccum, notify: true });
      this.onStreamEvent?.({ taskId, conversationId, executionId, seq: 0, blockId: "", type: "reasoning", content: reasoningAccum, metadata: null, parentBlockId: callStack.at(-1) ?? null, done: false, subagentId: null });
    }
    if (tokenAccum) {
      convBuffer.enqueue({ taskId, conversationId, type: "assistant", role: "assistant", content: tokenAccum, notify: true });
      this.onStreamEvent?.({ taskId, conversationId, executionId, seq: 0, blockId: "", type: "assistant", content: tokenAccum, metadata: null, parentBlockId: callStack.at(-1) ?? null, done: false, subagentId: null });
    }
  }

  private _appendPromptMessage(
    convBuffer: ConvMessageBuffer,
    taskId: number | null,
    conversationId: number,
    content: string,
  ): void {
    convBuffer.enqueue({ taskId, conversationId, type: "ask_user_prompt" as MessageType, role: null, content, notify: true });
    convBuffer.flush().forEach((msg) => this.onNewMessage(msg));
  }

  private _pauseExecution(taskId: number | null, conversationId: number, executionId: number): void {
    const db = this.db;
    if (taskId != null) {
      db.run("UPDATE tasks SET execution_state = 'waiting_user' WHERE id = ?", [taskId]);
    } else {
      db.run("UPDATE chat_sessions SET status = 'idle' WHERE conversation_id = ?", [conversationId]);
    }
    db.run(
      "UPDATE executions SET status = 'waiting_user', finished_at = NULL WHERE id = ?",
      [executionId],
    );
    this.onToken(taskId, conversationId, executionId, "", true);
  }

  private async _emitFileDiffFromWrittenFiles(
    convBuffer: ConvMessageBuffer,
    taskId: number | null,
    conversationId: number,
    executionId: number,
    callId: string,
    writtenFiles: Array<import("../../../shared/rpc-types.ts").FileDiffPayload>,
    liveParentBlockIdOverride?: string,
  ): Promise<void> {
    const db = this.db;

    let worktreePath = "";
    if (taskId != null) {
      const gitRow = db
        .query<{ worktree_path: string | null; worktree_status: string | null }, [number]>(
          "SELECT worktree_path, worktree_status FROM task_git_context WHERE task_id = ?",
        )
        .get(taskId);
      worktreePath = gitRow?.worktree_status === "ready" ? (gitRow.worktree_path ?? "") : "";
    }

    for (const file of writtenFiles) {
      const payload: Record<string, unknown> = { ...file };

      if (worktreePath && file.path) {
        try {
          const proc = Bun.spawn(["git", "diff", "HEAD", "--", file.path], {
            cwd: worktreePath,
            stdout: "pipe",
            stderr: "pipe",
          });
          await proc.exited;
          const diffOut = await new Response(proc.stdout).text();
          if (diffOut.trim()) {
            payload.rawDiff = diffOut;
          }
        } catch {
          // git diff failure is non-fatal
        }
      }

      const diffMeta = { tool_call_id: callId };
      const diffContent = JSON.stringify(payload);
      convBuffer.enqueue({ taskId, conversationId, type: "file_diff", role: null, content: diffContent, metadata: diffMeta, notify: true });
      // Persisted row keeps the raw callId (reload nests via tool_call_id). The LIVE block must
      // nest under the namespaced child tool block when one was assigned, else the raw callId.
      const liveParentBlockId = liveParentBlockIdOverride ?? callId;
      convBuffer.flush().forEach((msg) => {
        this.onNewMessage(msg);
        this.onStreamEvent?.({
          taskId,
          conversationId,
          executionId,
          seq: 0,
          blockId: `${liveParentBlockId}-diff-${file.path}`,
          type: "file_diff",
          content: diffContent,
          metadata: JSON.stringify(diffMeta),
          parentBlockId: liveParentBlockId,
          done: false,
          subagentId: null,
        });
      });
    }
  }
}
