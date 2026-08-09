/**
 * railyin-agent.ts — RailyinAgent (AbstractAgent subclass): the AG-UI bridge
 * (D-01). Routes RunAgentInput → ExecutionCoordinator.executeChatTurn and
 * translates every raw EngineEvent through event-bridge.ts into AG-UI events.
 *
 * Verified contract (RESEARCH.md Pattern 2 / Code Examples):
 *  - The runtime clones the registered agent per request (cloneAgentForRequest);
 *    default clone() copies ONLY the fixed field list → override clone() to
 *    re-attach injected deps (Pitfall 1).
 *  - run() must emit RUN_STARTED FIRST and a terminal itself — finalizeRunEvents
 *    otherwise appends RUN_ERROR INCOMPLETE_STREAM (Pitfall 3).
 *  - abortRun() is a no-op in the base class — route to orchestrator.cancel.
 *  - Per-run machinery lives in the run closure (anti-pattern: per-thread state
 *    on the agent — the runtime clones per request). The only instance field is
 *    a pointer to the ACTIVE run's closure so abortRun() can reach it.
 */
import { AbstractAgent, type BaseEvent } from "@ag-ui/client";
import { EventType, type RunAgentInput } from "@ag-ui/core";
import { ReplaySubject } from "rxjs";
import type { Database } from "bun:sqlite";
import type { ExecutionCoordinator } from "../engine/coordinator.ts";
import type { EngineEvent } from "../engine/types.ts";
import { getDefaultWorkspaceKey } from "../workspace-context.ts";
import {
  createTranslateState,
  translateEngineEvent,
  synthesizeMissingToolResults,
  terminalEvent,
  type TranslateState,
} from "./event-bridge.ts";

/** Last user text message (string content or text part) — the chat turn body. */
function extractUserText(messages: RunAgentInput["messages"]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "user") continue;
    if (typeof msg.content === "string") {
      if (msg.content.trim()) return msg.content;
      continue;
    }
    const textPart = msg.content.find((part) => part.type === "text");
    if (textPart && textPart.text.trim()) return textPart.text;
  }
  return null;
}

/**
 * resolveWorkspaceKey — per-conversation workspace resolution (RUNR-03,
 * research Open Question 3). Mirrors conversations.ts:64-76: task-linked
 * conversations resolve through tasks → boards.workspace_key; standalone
 * sessions through chat_sessions.workspace_key; otherwise the default
 * workspace key. Returns null ONLY when the conversation does not exist —
 * that null distinguishes "unknown conversation" from "known with default
 * key" (T-02-15).
 */
export function resolveWorkspaceKey(db: Database, conversationId: number): string | null {
  const row = db
    .query<{ task_workspace_key: string | null; session_workspace_key: string | null }, [number]>(
      `SELECT 
         b.workspace_key AS task_workspace_key, 
         cs.workspace_key AS session_workspace_key 
       FROM conversations c
       LEFT JOIN tasks t ON t.conversation_id = c.id
       LEFT JOIN boards b ON b.id = t.board_id
       LEFT JOIN chat_sessions cs ON cs.conversation_id = c.id
       WHERE c.id = ?`,
    )
    .get(conversationId);
  if (!row) return null;
  return row.task_workspace_key ?? row.session_workspace_key ?? getDefaultWorkspaceKey();
}

interface ActiveRun {
  executionId: number | null;
  abortRequested: boolean;
}

export class RailyinAgent extends AbstractAgent {
  /** Pointer to the active run's closure so abortRun() can reach it. */
  private activeRun: ActiveRun | null = null;

  constructor(
    public db: Database,
    public orchestrator: ExecutionCoordinator,
  ) {
    super({ agentId: "default", description: "Railyin engine bridge agent" });
  }

  /** Pitfall 1: the runtime clones per request; re-attach injected deps. */
  override clone(): any {
    const c = super.clone() as RailyinAgent;
    c.db = this.db;
    c.orchestrator = this.orchestrator;
    return c;
  }

  /** Base abortRun() is a no-op — route to the orchestrator's cancel. */
  override abortRun(): void {
    const run = this.activeRun;
    if (!run) return;
    if (run.executionId != null) {
      this.orchestrator.cancel(run.executionId);
    } else {
      // executeChatTurn hasn't resolved yet — cancel as soon as it does.
      run.abortRequested = true;
    }
  }

  run(input: RunAgentInput): ReturnType<AbstractAgent["run"]> {
    const { threadId, runId } = input;
    // The runtime's Observable type resolves to @ag-ui/client's NESTED rxjs
    // while ReplaySubject here is top-level rxjs — the shapes are identical at
    // runtime (probe-proven); the cast bridges only the type-level gap.
    const subject = new ReplaySubject<BaseEvent>(Infinity);
    const state: TranslateState = createTranslateState(threadId, runId);
    const accumulated: BaseEvent[] = [];
    let terminalEmitted = false;
    let lastEngineError: string | null = null;
    let eventsDuringDispatch = false;
    const run: ActiveRun = { executionId: null, abortRequested: false };
    this.activeRun = run;

    // T-02-01: threadId is a client-supplied string used for DB lookups and
    // (in 02-02) filesystem paths — validate BEFORE any side effect.
    const emitRunError = (message: string, code?: string): void => {
      subject.next({ type: EventType.RUN_STARTED, threadId, runId, input });
      subject.next({ type: EventType.RUN_ERROR, message, code });
      subject.complete();
    };

    if (!/^\d+$/.test(threadId)) {
      emitRunError(`Unknown thread: ${threadId}`, "THREAD_NOT_FOUND");
      return subject.asObservable() as unknown as ReturnType<AbstractAgent["run"]>;
    }
    const conversationId = Number(threadId);
    const conversation = this.db
      .query("SELECT 1 FROM conversations WHERE id = ?")
      .get(conversationId);
    if (!conversation) {
      emitRunError(`Unknown thread: ${threadId}`, "THREAD_NOT_FOUND");
      return subject.asObservable() as unknown as ReturnType<AbstractAgent["run"]>;
    }

    const content = extractUserText(input.messages);
    if (content == null) {
      emitRunError("No user text message in input", "NO_USER_MESSAGE");
      return subject.asObservable() as unknown as ReturnType<AbstractAgent["run"]>;
    }

    // Advisory cross-path lock (RUNR-04, research Open Question 2): reject a
    // run while ANOTHER execution (e.g. a board transition) is active on the
    // same conversation. Layering: the runner lock still fires FIRST for
    // same-thread AG-UI concurrency (200 + empty body — e2e unchanged); this
    // check only catches cross-path cases. 'completed'/'failed' rows never
    // block (status filter). One indexed lookup, no policy machinery —
    // queue-vs-reject stays reject for v1.
    const active = this.db
      .query("SELECT 1 FROM executions WHERE conversation_id = ? AND status IN ('running','waiting_user')")
      .get(conversationId);
    if (active) {
      emitRunError("Thread already has an active execution", "THREAD_BUSY");
      return subject.asObservable() as unknown as ReturnType<AbstractAgent["run"]>;
    }

    // RUN_STARTED FIRST, WITH input — the runner only patches when input is
    // absent, so the persisted user turn matches the wire (State of the Art).
    subject.next({ type: EventType.RUN_STARTED, threadId, runId, input });

    // Pitfall 3 completion guard: the subject must NEVER complete without a
    // terminal (finalizeRunEvents would append INCOMPLETE_STREAM RUN_ERROR).
    // All completion paths go through guardedComplete(); when no terminal was
    // emitted (pause paths where consume ends without an outcome), it closes
    // open text/reasoning blocks (verifyEvents rejects RUN_FINISHED with active
    // messages) and appends RUN_FINISHED before completing.
    const guardedComplete = (): void => {
      if (terminalEmitted) return;
      terminalEmitted = true;
      const closers = translateEngineEvent({ type: "done" }, state);
      for (const ev of closers) subject.next(ev);
      subject.next(terminalEvent(threadId, runId, "done"));
      subject.complete();
    };

    const finish = (
      outcome: "done" | "error" | "aborted" | "decision",
      error?: { message: string; code?: string },
    ): void => {
      if (terminalEmitted) return;
      terminalEmitted = true;
      // D-09/A5: no dangling tool calls in the persisted log — synthesize
      // missing results BEFORE the terminal. synthesizedEvents returns the
      // full list (accumulated + tail); the accumulated part was already
      // emitted live via onEngineEvent — emit only the appended tail.
      const synthesized = synthesizeMissingToolResults(state, accumulated);
      for (const ev of synthesized.slice(accumulated.length)) subject.next(ev);
      subject.next(terminalEvent(threadId, runId, outcome, error));
      subject.complete();
    };

    // RUNR-03: per-conversation workspace resolution (task → chat_sessions →
    // default, mirroring conversations.ts:64-76). The conversation existence
    // check above already rejected unknown threads; a null here (defensive
    // contract layer, T-02-15) routes through the same THREAD_NOT_FOUND path.
    const workspaceKey = resolveWorkspaceKey(this.db, conversationId);
    if (workspaceKey == null) {
      emitRunError(`Unknown thread: ${threadId}`, "THREAD_NOT_FOUND");
      return subject.asObservable() as unknown as ReturnType<AbstractAgent["run"]>;
    }
    // sessionId 0 per research A3 (ignored by ChatExecutor); model/mcpTools
    // undefined — the executor resolves conversations.model via EngineRegistry (D-10).
    void this.orchestrator
      .executeChatTurn(0, conversationId, content, undefined, null, workspaceKey, undefined, undefined, {
        onEngineEvent: (event: EngineEvent) => {
          eventsDuringDispatch = true;
          if (event.type === "error") lastEngineError = event.message;
          const translated = translateEngineEvent(event, state);
          accumulated.push(...translated);
          for (const ev of translated) subject.next(ev);
        },
        onRunEnd: (outcome) => {
          if (outcome === "error") {
            finish("error", { message: lastEngineError ?? "Run failed", code: "ENGINE_ERROR" });
          } else {
            finish(outcome);
          }
        },
      })
      .then(({ executionId }) => {
        run.executionId = executionId;
        if (run.abortRequested) {
          this.orchestrator.cancel(executionId);
          return;
        }
        // Completion guard trigger: a scripted/pause-style engine that produced
        // events during the synchronous dispatch and ended without onRunEnd
        // (e.g. ask_user/shell_approval pause paths) must still close the
        // stream. Real engines yield after the dispatch settles (network/delay),
        // so eventsDuringDispatch stays false for live runs — conservative.
        if (eventsDuringDispatch && !terminalEmitted) guardedComplete();
      })
      .catch((err) => {
        finish("error", {
          message: err instanceof Error ? err.message : String(err),
          code: "ENGINE_ERROR",
        });
      });

    return subject.asObservable() as unknown as ReturnType<AbstractAgent["run"]>;
  }
}
