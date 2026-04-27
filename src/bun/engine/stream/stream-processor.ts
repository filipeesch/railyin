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
import { getDb } from "../../db/index.ts";
import { mapTask, mapConversationMessage } from "../../db/mappers.ts";
import { appendMessage } from "../../conversation/messages.ts";
import type { TaskRow } from "../../db/row-types.ts";

/**
 * Owns the AbortController lifecycle and stream event processing for non-native engines.
 *
 * Responsibilities:
 *  - createSignal / abort: single registration site for AbortControllers
 *  - runNonNative: starts an engine execution and pipes events to consume()
 *  - consume: full EngineEvent state machine (tokens, tools, done, error, cancel)
 *  - _persistRawModelMessage: incremental raw event storage with retention
 *  - _appendPromptMessage / _pauseExecution: ask_user / shell_approval helpers
 *  - _emitFileDiffFromWrittenFiles: file diff emission on tool_result
 */
export class StreamProcessor {
  /** executionId → AbortController; single registration site */
  private readonly abortControllers = new Map<number, AbortController>();
  /** executionId → next seq number for raw model messages */
  private readonly rawMessageSeq = new Map<number, number>();

  private onStreamEvent?: OnStreamEvent;

  constructor(
    private readonly onToken: OnToken,
    private readonly onError: OnError,
    private readonly onTaskUpdated: OnTaskUpdated,
    private readonly onNewMessage: OnNewMessage,
  ) {}

  setOnStreamEvent(cb: OnStreamEvent): void {
    this.onStreamEvent = cb;
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
   */
  makePersistCallback(
    taskId: number | null,
    conversationId: number,
    executionId: number,
  ): (raw: RawModelMessage) => void {
    return (raw) => this._persistRawModelMessage(taskId, conversationId, executionId, raw);
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
    const db = getDb();
    let tokenAccum = "";
    let reasoningAccum = "";
    let hadOutput = false;
    const callStack: string[] = [];
    let reasoningBlockId: string | null = null;
    let reasoningFlushCount = 0;

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
          this._flushAccumulators(taskId, conversationId, executionId, tokenAccum, reasoningAccum, callStack);
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
              const rFlushId = appendMessage(taskId, conversationId, "reasoning", null, reasoningAccum);
              this.onNewMessage({ id: rFlushId, taskId, conversationId, type: "reasoning", role: null, content: reasoningAccum, metadata: null, createdAt: new Date().toISOString() });
              this.onStreamEvent?.({ taskId, conversationId, executionId, seq: 0, blockId: "", type: "reasoning", content: reasoningAccum, metadata: null, parentBlockId: callStack.at(-1) ?? null, done: false, subagentId: null });
              reasoningAccum = "";
            }
            reasoningBlockId = null;
            tokenAccum += event.content;
            hadOutput = true;
            this.onToken(taskId, conversationId, executionId, event.content, false);
            this.onStreamEvent?.({ taskId, conversationId, executionId, seq: 0, blockId: "", type: "text_chunk", content: event.content, metadata: null, parentBlockId: callStack.at(-1) ?? null, done: false, subagentId: null });
            break;
          }

          case "reasoning": {
            reasoningAccum += event.content;
            this.onToken(taskId, conversationId, executionId, event.content, false, true);
            this.onStreamEvent?.({ taskId, conversationId, executionId, seq: 0, blockId: "", type: "reasoning_chunk", content: event.content, metadata: null, parentBlockId: callStack.at(-1) ?? null, done: false, subagentId: null });
            break;
          }

          case "status": {
            appendMessage(taskId, conversationId, "status", null, event.message);
            this.onToken(taskId, conversationId, executionId, event.message, false, false, true);
            this.onStreamEvent?.({ taskId, conversationId, executionId, seq: 0, blockId: "", type: "status_chunk", content: event.message, metadata: null, parentBlockId: callStack.at(-1) ?? null, done: false, subagentId: null });
            break;
          }

          case "tool_start": {
            if (event.isInternal) break;
            hadOutput = true;
            if (reasoningAccum) {
              const rBlockId = `${executionId}-pre-r${++reasoningFlushCount}`;
              const rId = appendMessage(taskId, conversationId, "reasoning", null, reasoningAccum);
              this.onNewMessage({ id: rId, taskId, conversationId, type: "reasoning", role: null, content: reasoningAccum, metadata: null, createdAt: new Date().toISOString() });
              this.onStreamEvent?.({ taskId, conversationId, executionId, seq: 0, blockId: rBlockId, type: "reasoning", content: reasoningAccum, metadata: null, parentBlockId: callStack.at(-1) ?? null, done: false, subagentId: null });
              reasoningBlockId = rBlockId;
              reasoningAccum = "";
            }
            if (tokenAccum) {
              const flushId = appendMessage(taskId, conversationId, "assistant", "assistant", tokenAccum);
              this.onNewMessage({ id: flushId, taskId, conversationId, type: "assistant", role: "assistant", content: tokenAccum, metadata: null, createdAt: new Date().toISOString() });
              this.onStreamEvent?.({ taskId, conversationId, executionId, seq: 0, blockId: "", type: "assistant", content: tokenAccum, metadata: null, parentBlockId: callStack.at(-1) ?? null, done: false, subagentId: null });
              tokenAccum = "";
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
            const msgId = appendMessage(taskId, conversationId, "tool_call", null, toolCallMsg, toolMeta);
            this.onNewMessage({ id: msgId, taskId, conversationId, type: "tool_call", role: null, content: toolCallMsg, metadata: toolMeta, createdAt: new Date().toISOString() });
            const toolParentBlockId = event.parentCallId ?? reasoningBlockId ?? null;
            this.onStreamEvent?.({ taskId, conversationId, executionId, seq: 0, blockId: callId, type: "tool_call", content: toolCallMsg, metadata: JSON.stringify(toolMeta), parentBlockId: toolParentBlockId, done: false, subagentId: null });
            callStack.push(callId);
            break;
          }

          case "tool_result": {
            if (event.isInternal) break;
            hadOutput = true;
            if (reasoningAccum) {
              const rId = appendMessage(taskId, conversationId, "reasoning", null, reasoningAccum);
              this.onNewMessage({ id: rId, taskId, conversationId, type: "reasoning", role: null, content: reasoningAccum, metadata: null, createdAt: new Date().toISOString() });
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
            const msgId = appendMessage(taskId, conversationId, "tool_result", null, resultMsg, resultMeta);
            this.onNewMessage({ id: msgId, taskId, conversationId, type: "tool_result", role: null, content: resultMsg, metadata: resultMeta, createdAt: new Date().toISOString() });
            const resultCallId = event.callId ?? msgId.toString();
            const stackIdx = callStack.lastIndexOf(resultCallId);
            if (stackIdx !== -1) callStack.splice(stackIdx, 1);
            const resultParentBlockId = event.parentCallId ?? reasoningBlockId ?? null;
            this.onStreamEvent?.({ taskId, conversationId, executionId, seq: 0, blockId: resultCallId, type: "tool_result", content: resultMsg, metadata: JSON.stringify(resultMeta), parentBlockId: resultParentBlockId, done: false, subagentId: null });

            if (!event.isError && event.callId) {
              const writtenFiles = event.writtenFiles ?? [];
              if (writtenFiles.length > 0) {
                await this._emitFileDiffFromWrittenFiles(
                  taskId,
                  conversationId,
                  executionId,
                  event.callId,
                  writtenFiles,
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
            break;
          }

          case "done": {
            if (reasoningAccum) {
              const rDoneId = appendMessage(taskId, conversationId, "reasoning", null, reasoningAccum);
              this.onNewMessage({ id: rDoneId, taskId, conversationId, type: "reasoning", role: null, content: reasoningAccum, metadata: null, createdAt: new Date().toISOString() });
              this.onStreamEvent?.({ taskId, conversationId, executionId, seq: 0, blockId: "", type: "reasoning", content: reasoningAccum, metadata: null, parentBlockId: callStack.at(-1) ?? null, done: false, subagentId: null });
              reasoningAccum = "";
            }
            if (tokenAccum) {
              const msgId = appendMessage(taskId, conversationId, "assistant", "assistant", tokenAccum);
              this.onNewMessage({ id: msgId, taskId, conversationId, type: "assistant", role: "assistant", content: tokenAccum, metadata: null, createdAt: new Date().toISOString() });
              this.onStreamEvent?.({ taskId, conversationId, executionId, seq: 0, blockId: "", type: "assistant", content: tokenAccum, metadata: null, parentBlockId: callStack.at(-1) ?? null, done: false, subagentId: null });
              tokenAccum = "";
            } else if (!hadOutput) {
              const warnMsg = "Agent completed with no output. The prompt may not have been resolved correctly.";
              const msgId = appendMessage(taskId, conversationId, "system", null, warnMsg);
              this.onNewMessage({ id: msgId, taskId, conversationId, type: "system", role: null, content: warnMsg, metadata: null, createdAt: new Date().toISOString() });
            }

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
              return;
            }
            this.onError(taskId, conversationId, executionId, event.message);
            appendMessage(taskId, conversationId, "system", null, `Error: ${event.message}`);
            break;
          }

          case "shell_approval": {
            this._appendPromptMessage(
              taskId,
              conversationId,
              JSON.stringify({ subtype: "shell_approval", command: event.command, unapprovedBinaries: [] }),
            );
            this._pauseExecution(taskId, conversationId, executionId);
            break;
          }

          case "ask_user": {
            this._appendPromptMessage(taskId, conversationId, event.payload);
            this._pauseExecution(taskId, conversationId, executionId);
            break;
          }

          case "interview_me": {
            const msgId = appendMessage(taskId, conversationId, "interview_prompt", null, event.payload);
            this.onNewMessage({ id: msgId, taskId, conversationId, type: "interview_prompt", role: null, content: event.payload, metadata: null, createdAt: new Date().toISOString() });
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
            const compStartId = appendMessage(taskId, conversationId, "system", null, "Compacting conversation…");
            this.onNewMessage({ id: compStartId, taskId, conversationId, type: "system", role: null, content: "Compacting conversation…", metadata: null, createdAt: new Date().toISOString() });
            break;
          }

          case "compaction_done": {
            const lastMsg = db.query<{ type: string }, [number]>(
              "SELECT type FROM conversation_messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1"
            ).get(conversationId);
            if (lastMsg?.type === "compaction_summary") break;
            const compDoneId = appendMessage(taskId, conversationId, "compaction_summary", null, "");
            this.onNewMessage({ id: compDoneId, taskId, conversationId, type: "compaction_summary", role: null, content: "", metadata: null, createdAt: new Date().toISOString() });
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
        this._flushAccumulators(taskId, conversationId, executionId, tokenAccum, reasoningAccum, callStack);
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
      this.onError(taskId, conversationId, executionId, errMsg);
    } finally {
      this.abortControllers.delete(executionId);
      this.rawMessageSeq.delete(executionId);

      if (taskId != null) {
        const finalRow = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(taskId);
        if (finalRow) {
          this.onTaskUpdated(mapTask(finalRow));
        }
      }
    }
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  /** Flush accumulated tokens and reasoning to DB before a cancel or done transition. */
  private _flushAccumulators(
    taskId: number | null,
    conversationId: number,
    executionId: number,
    tokenAccum: string,
    reasoningAccum: string,
    callStack: string[],
  ): void {
    if (reasoningAccum) {
      const rId = appendMessage(taskId, conversationId, "reasoning", null, reasoningAccum);
      this.onNewMessage({ id: rId, taskId, conversationId, type: "reasoning", role: null, content: reasoningAccum, metadata: null, createdAt: new Date().toISOString() });
      this.onStreamEvent?.({ taskId, conversationId, executionId, seq: 0, blockId: "", type: "reasoning", content: reasoningAccum, metadata: null, parentBlockId: callStack.at(-1) ?? null, done: false, subagentId: null });
    }
    if (tokenAccum) {
      const tId = appendMessage(taskId, conversationId, "assistant", "assistant", tokenAccum);
      this.onNewMessage({ id: tId, taskId, conversationId, type: "assistant", role: "assistant", content: tokenAccum, metadata: null, createdAt: new Date().toISOString() });
      this.onStreamEvent?.({ taskId, conversationId, executionId, seq: 0, blockId: "", type: "assistant", content: tokenAccum, metadata: null, parentBlockId: callStack.at(-1) ?? null, done: false, subagentId: null });
    }
  }

  private _persistRawModelMessage(
    taskId: number | null,
    conversationId: number,
    executionId: number,
    raw: RawModelMessage,
  ): void {
    const db = getDb();
    const seq = (this.rawMessageSeq.get(executionId) ?? 0) + 1;
    this.rawMessageSeq.set(executionId, seq);

    const payloadJson = JSON.stringify(raw.payload);
    db.run(
      `INSERT INTO model_raw_messages
         (task_id, execution_id, engine, session_id, stream_seq, direction, event_type, event_subtype, payload_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        taskId,
        executionId,
        raw.engine,
        raw.sessionId ?? null,
        seq,
        raw.direction,
        raw.eventType,
        raw.eventSubtype ?? null,
        payloadJson,
      ],
    );
    db.run("DELETE FROM model_raw_messages WHERE created_at < datetime('now', '-1 day')");
  }

  private _appendPromptMessage(
    taskId: number | null,
    conversationId: number,
    content: string,
  ): void {
    const msgId = appendMessage(taskId, conversationId, "ask_user_prompt" as MessageType, null, content);
    this.onNewMessage({
      id: msgId,
      taskId,
      conversationId,
      type: "ask_user_prompt",
      role: null,
      content,
      metadata: null,
      createdAt: new Date().toISOString(),
    });
  }

  private _pauseExecution(taskId: number | null, conversationId: number, executionId: number): void {
    const db = getDb();
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
    taskId: number | null,
    conversationId: number,
    executionId: number,
    callId: string,
    writtenFiles: Array<import("../../../shared/rpc-types.ts").FileDiffPayload>,
  ): Promise<void> {
    const db = getDb();

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
      const diffId = appendMessage(taskId, conversationId, "file_diff", null, diffContent, diffMeta);
      this.onNewMessage({ id: diffId, taskId, conversationId, type: "file_diff", role: null, content: diffContent, metadata: diffMeta, createdAt: new Date().toISOString() });
      this.onStreamEvent?.({
        taskId,
        conversationId,
        executionId,
        seq: 0,
        blockId: `${callId}-diff-${file.path}`,
        type: "file_diff",
        content: diffContent,
        metadata: JSON.stringify(diffMeta),
        parentBlockId: callId,
        done: false,
        subagentId: null,
      });
    }
  }
}
