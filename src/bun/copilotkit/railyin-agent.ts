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
  buildInterruptOutcome,
  createTranslateState,
  translateEngineEvent,
  synthesizeMissingToolResults,
  terminalEvent,
  translateResumeToSubmission,
  type TranslateState,
} from "./event-bridge.ts";
import * as interruptRegistry from "./interrupt-registry.ts";
import type { PendingInterrupt } from "./interrupt-registry.ts";

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

  /**
   * The durable executionId of a paused decision for a thread: the registry
   * entry's attached id when present, else the executions `waiting_user` row —
   * the durable truth written synchronously by stream-processor at
   * decision_request time. The registry's executionId is attached from the
   * executeChatTurn .then hook, which resolves AFTER the interrupt terminal
   * reaches the client — a machine-fast resume can fire before it lands, and
   * the row finalize (cancelled/completed) must not depend on that race.
   */
  private resolveDecisionExecutionId(conversationId: number, entry: PendingInterrupt): number | null {
    if (entry.executionId != null) return entry.executionId;
    const row = this.db
      .query<{ id: number }, [number]>(
        "SELECT id FROM executions WHERE conversation_id = ? AND status = 'waiting_user' LIMIT 1",
      )
      .get(conversationId);
    return row?.id ?? null;
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
    // D-06 (Pitfall 5): the decision_request payload captured in the
    // onEngineEvent tap — it fires immediately BEFORE onRunEnd("decision")
    // (stream-processor.ts:494-507), so it is visible at terminal time. The
    // registry entry carries the raw serialized payload; parsing stays in
    // buildInterruptOutcome.
    let capturedDecisionPayload: string | null = null;
    const run: ActiveRun = { executionId: null, abortRequested: false };
    this.activeRun = run;

    // T-02-01: threadId is a client-supplied string used for DB lookups and
    // (in 02-02) filesystem paths — validate BEFORE any side effect.
    const emitRunError = (message: string, code?: string): void => {
      subject.next({ type: EventType.RUN_STARTED, threadId, runId, input });
      subject.next({ type: EventType.RUN_ERROR, message, code });
      subject.complete();
      if (this.activeRun === run) this.activeRun = null; // IN-02: no stale pointer
    };

    // Pitfall 3 completion guard: the subject must NEVER complete without a
    // terminal (finalizeRunEvents would append INCOMPLETE_STREAM RUN_ERROR).
    // All completion paths go through guardedComplete(); when no terminal was
    // emitted (pause paths where consume ends without an outcome), it closes
    // open text/reasoning blocks (verifyEvents rejects RUN_FINISHED with active
    // messages) and appends RUN_FINISHED before completing.
    //
    // NOTE: these terminal closures are defined BEFORE the resume branch (not
    // at the bottom of run()) because the resume branch's synchronous tap
    // wiring (same shape as the main path) references `finish` — a const
    // declared later would be in the TDZ when a synchronous fake fires
    // onRunEnd inside the delivery call.
    const guardedComplete = (): void => {
      if (terminalEmitted) return;
      terminalEmitted = true;
      const closers = translateEngineEvent({ type: "done" }, state);
      for (const ev of closers) subject.next(ev);
      subject.next(terminalEvent(threadId, runId, "done"));
      subject.complete();
      if (this.activeRun === run) this.activeRun = null; // IN-02: no stale pointer
    };

    const finish = (
      outcome: "done" | "error" | "aborted" | "decision",
      error?: { message: string; code?: string },
    ): void => {
      if (terminalEmitted) return;
      terminalEmitted = true;
      // WR-01: the abort path (stream-processor's flush + onRunEnd("aborted"))
      // never emits a closing done engine event, so open TEXT_MESSAGE /
      // REASONING blocks are still active here. Close them with their END
      // events BEFORE the terminal — verifyEvents rejects a terminal while a
      // message is still active, and a spec-compliant client would leave a
      // dangling text bubble.
      const closers = translateEngineEvent({ type: "done" }, state);
      for (const ev of closers) subject.next(ev);
      // D-09/A5: no dangling tool calls in the persisted log — synthesize
      // missing results BEFORE the terminal. synthesizedEvents returns the
      // full list (accumulated + tail); the accumulated part was already
      // emitted live via onEngineEvent — emit only the appended tail.
      const synthesized = synthesizeMissingToolResults(state, accumulated);
      for (const ev of synthesized.slice(accumulated.length)) subject.next(ev);
      subject.next(terminalEvent(threadId, runId, outcome, error));
      subject.complete();
      if (this.activeRun === run) this.activeRun = null; // IN-02: no stale pointer
    };

    // D-06: the interrupt terminal (RUNR-08, D-01/D-03). Mirrors finish()
    // exactly — closer/synthesize/complete/clear sequence — with
    // buildInterruptOutcome as the terminal: a NORMAL completion carrying
    // outcome.interrupts, never a RUN_ERROR.
    const finishInterrupt = (interruptId: string): void => {
      if (terminalEmitted) return;
      terminalEmitted = true;
      const closers = translateEngineEvent({ type: "done" }, state);
      for (const ev of closers) subject.next(ev);
      const synthesized = synthesizeMissingToolResults(state, accumulated);
      for (const ev of synthesized.slice(accumulated.length)) subject.next(ev);
      subject.next(buildInterruptOutcome(threadId, runId, capturedDecisionPayload ?? "", interruptId));
      subject.complete();
      if (this.activeRun === run) this.activeRun = null; // IN-02: no stale pointer
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

    // D-07 resume branch (03-02): a client resume run carries the user's
    // decision payload via RunAgentInput.resume[] (the canonical channel,
    // D-01). Placement matters — BEFORE extractUserText (a resume run's
    // messages are history; the main path would reject NO_USER_MESSAGE) and
    // BEFORE the advisory lock (Pitfall 1 — the pending decision left a
    // 'waiting_user' row that would reject the resume itself with THREAD_BUSY).
    if (input.resume?.length) {
      // Hot path first (03-03 Task 2, A2): on a FRESH process the module-level
      // registry is empty — lazily rebuild the pending interrupt from the
      // thread's JSONL tail + the waiting_user executions row so a decision
      // paused before a restart stays answerable (old-stack parity). The
      // D-04 hasOpen/block path and the hot path stay on get().
      let open: PendingInterrupt | null | undefined = interruptRegistry.get(threadId);
      if (!open) open = interruptRegistry.ensureOpen(threadId, this.db);
      const openIds = open ? [open.interruptId] : []; // v1: one interrupt per batch (D-02)
      const addressed = new Set(input.resume.map((r) => r.interruptId));
      const resumeIds = input.resume.map((r) => r.interruptId);
      // D-05: all-or-nothing — every resume id must be an OPEN interrupt for
      // this thread AND every open interrupt must be addressed. Unknown,
      // partial, or duplicate-after-clear resumes → INVALID_INTERRUPT
      // (Pitfall 8: the entry clears only after delivery starts, so a replay
      // of an old id fails here).
      // IN-02: duplicates of the same interruptId also fail — find() below
      // would silently take the first entry and drop the second (possibly
      // conflicting) payload; rejecting makes the resolution deterministic.
      const allResolved =
        openIds.every((id) => addressed.has(id)) &&
        input.resume.every((r) => openIds.includes(r.interruptId)) &&
        new Set(resumeIds).size === resumeIds.length;
      if (!open || !allResolved) {
        emitRunError("Resume does not match open decision interrupt(s)", "INVALID_INTERRUPT");
        return subject.asObservable() as unknown as ReturnType<AbstractAgent["run"]>;
      }

      const entry = input.resume.find((r) => r.interruptId === open.interruptId)!;

      // A4: a cancelled resume is a dismissal — clear the registry, close the
      // execution row as 'cancelled', and complete with a plain RUN_FINISHED.
      // NO engine call: the rejection/dismissal delivers nothing (v1). Emits
      // its own single RUN_STARTED (the run starts, then finishes plainly).
      if (entry.status === "cancelled") {
        subject.next({ type: EventType.RUN_STARTED, threadId, runId, input });
        interruptRegistry.clear(threadId);
        // The durable executionId (registry attach can race the resume — see
        // resolveDecisionExecutionId): finalize the waiting_user row so the
        // thread never wedges (Pitfall 2).
        const execId = this.resolveDecisionExecutionId(conversationId, open);
        if (execId != null) {
          this.db.run(
            "UPDATE executions SET status = 'cancelled', finished_at = datetime('now') WHERE id = ? AND status = 'waiting_user'",
            [execId],
          );
        }
        subject.next(terminalEvent(threadId, runId, "done"));
        subject.complete();
        if (this.activeRun === run) this.activeRun = null; // IN-02: no stale pointer
        return subject.asObservable() as unknown as ReturnType<AbstractAgent["run"]>;
      }

      // CR-01: validate the resolved payload and resolve the workspace key
      // BEFORE the RUN_STARTED emission — every rejection path must precede
      // the first event so a spec-compliant client sees EXACTLY ONE
      // RUN_STARTED per run (verifyEvents rejects a second RUN_STARTED while
      // a run is active: the old order emitted RUN_STARTED here, then
      // emitRunError emitted a second one, and the client errored before the
      // INVALID_PAYLOAD RUN_ERROR surfaced). Mirrors the main path's
      // pre-RUN_STARTED workspace-key validation (IN-03 shape).
      //
      // Resolved: translate through the existing decision-submission path.
      // translateResumeToSubmission delegates to buildDecisionSubmission — the
      // Q/A pairs and hidden record_decision instructions are NEVER
      // re-formatted here (Don't Hand-Roll row 3). Malformed client payloads
      // (WR-05) yield null → the INVALID_PAYLOAD rejection.
      const sub = translateResumeToSubmission(entry.payload);
      if (sub == null) {
        // Planner's discretion (recorded in the plan objective): a resolved
        // resume whose payload lacks answers is a distinct error — clearer for
        // Phase 5 debugging than reusing INVALID_INTERRUPT.
        emitRunError("Resume payload missing decision answers", "INVALID_PAYLOAD");
        return subject.asObservable() as unknown as ReturnType<AbstractAgent["run"]>;
      }

      // TDZ guard: the main-path workspaceKey const (below, after the advisory
      // lock) is out of scope at this insertion point — resolve our own copy.
      // Resolved BEFORE RUN_STARTED so the THREAD_NOT_FOUND rejection cannot
      // emit a second RUN_STARTED (CR-01).
      const resumeWorkspaceKey = resolveWorkspaceKey(this.db, conversationId);
      if (resumeWorkspaceKey == null) {
        emitRunError(`Unknown thread: ${threadId}`, "THREAD_NOT_FOUND");
        return subject.asObservable() as unknown as ReturnType<AbstractAgent["run"]>;
      }

      // RUN_STARTED FIRST, WITH input — the runner only patches when input is
      // absent, so the persisted user turn matches the wire (State of the Art).
      subject.next({ type: EventType.RUN_STARTED, threadId, runId, input });

      // Pitfall 2: finalize the OLD orphaned 'waiting_user' execution row
      // BEFORE delivery — stream-processor.ts:494-506 is its only writer and no
      // existing code closes it; the advisory lock would otherwise wedge the
      // thread forever after the resume. The id resolves durably (registry
      // attach can race the resume — see resolveDecisionExecutionId).
      const finalizeId = this.resolveDecisionExecutionId(conversationId, open);
      if (finalizeId != null) {
        this.db.run(
          "UPDATE executions SET status = 'completed', finished_at = datetime('now') WHERE id = ? AND status = 'waiting_user'",
          [finalizeId],
        );
      }

      // The SAME tap wiring as the main path: translate every engine event and
      // push into the subject, capture lastEngineError, map onRunEnd through
      // finish()/finishInterrupt(). A continuation decision_request parks
      // again (register + interrupt terminal).
      const resumeOpts = {
        onEngineEvent: (event: EngineEvent) => {
          if (event.type === "error") lastEngineError = event.message;
          if (event.type === "decision_request") capturedDecisionPayload = event.payload;
          const translated = translateEngineEvent(event, state);
          accumulated.push(...translated);
          for (const ev of translated) subject.next(ev);
        },
        onRunEnd: (outcome: "done" | "error" | "aborted" | "decision") => {
          if (outcome === "error") {
            finish("error", { message: lastEngineError ?? "Run failed", code: "ENGINE_ERROR" });
          } else if (outcome === "decision") {
            const id = interruptRegistry.register(conversationId, capturedDecisionPayload ?? "");
            finishInterrupt(id);
          } else {
            finish(outcome);
          }
        },
      };

      // Routing: task-linked conversations deliver through executeHumanTurn
      // (the A6 opts seam carries the tap wiring); chat conversations through
      // executeChatTurn — the legacy decision-path semantics, engine-side
      // (D-07; research Pattern 3).
      const taskRow = this.db
        .query<{ task_id: number | null }, [number]>("SELECT task_id FROM conversations WHERE id = ?")
        .get(conversationId);
      const delivery = taskRow?.task_id != null
        ? this.orchestrator.executeHumanTurn(taskRow.task_id, sub.userContent, undefined, sub.engineContent, resumeOpts)
        : this.orchestrator.executeChatTurn(0, conversationId, sub.userContent, undefined, null, resumeWorkspaceKey, undefined, sub.engineContent, resumeOpts);

      delivery
        .then(({ executionId }) => {
          run.executionId = executionId;
          // WR-03: the Pi pre-flight fail-fast path (chat-executor.ts) returns
          // executionId -1 with NO events and NO onRunEnd — no execution was
          // started and nothing will ever emit. Complete the stream so the
          // client gets RUN_FINISHED instead of hanging on the SSE forever
          // (the runtime mount deliberately disables the idle timeout). The
          // registry entry stays open: the decision is still pending and the
          // resume stays retryable once the engine config is fixed.
          if (executionId === -1) {
            guardedComplete();
            return;
          }
          // Pitfall 8: clear the registry entry ONLY after delivery started —
          // a duplicate resume now fails with INVALID_INTERRUPT (the second
          // run finds no open entry).
          // WR-04: clear only when the pending entry still holds the ORIGINAL
          // interrupt id. A continuation decision_request can register
          // SYNCHRONOUSLY inside delivery (onRunEnd("decision") fires before
          // the .then hook — exactly what the unit-test fakes do), minting a
          // NEW entry; an unconditional clear() would wipe it and the follow-up
          // resume would fail with INVALID_INTERRUPT while the client holds
          // the fresh id (silently breaking the D-05 dedup contract).
          const pending = interruptRegistry.get(threadId);
          if (pending?.interruptId === open.interruptId) {
            interruptRegistry.clear(threadId);
          }
          if (run.abortRequested) {
            this.orchestrator.cancel(executionId);
            return;
          }
        })
        .catch((err) => {
          finish("error", {
            message: err instanceof Error ? err.message : String(err),
            code: "ENGINE_ERROR",
          });
        });

      return subject.asObservable() as unknown as ReturnType<AbstractAgent["run"]>;
    }

    // D-04 (CHAT-09 SC3): a pending decision interrupt blocks NEW input
    // server-side. Runs WITHOUT resume[] are rejected with the advisory
    // THREAD_BUSY code (e2e asserts the code — stays stable; the registry adds
    // the precise message per research). The resume branch that bypasses this
    // check occupies the same region (03-02 Task 3, before extractUserText).
    if (!input.resume?.length && interruptRegistry.hasOpen(threadId)) {
      emitRunError("A decision interrupt is pending for this thread", "THREAD_BUSY");
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

    // RUNR-03: per-conversation workspace resolution (task → chat_sessions →
    // default, mirroring conversations.ts:64-76). The conversation existence
    // check above already rejected unknown threads; a null here (defensive
    // contract layer, T-02-15) routes through the same THREAD_NOT_FOUND path.
    // IN-03: resolved BEFORE RUN_STARTED so this rejection cannot emit a
    // second RUN_STARTED (verifyEvents rejects a second RUN_STARTED while a
    // run is active — exactly-one-per-run contract).
    const workspaceKey = resolveWorkspaceKey(this.db, conversationId);
    if (workspaceKey == null) {
      emitRunError(`Unknown thread: ${threadId}`, "THREAD_NOT_FOUND");
      return subject.asObservable() as unknown as ReturnType<AbstractAgent["run"]>;
    }

    // RUN_STARTED FIRST, WITH input — the runner only patches when input is
    // absent, so the persisted user turn matches the wire (State of the Art).
    subject.next({ type: EventType.RUN_STARTED, threadId, runId, input });

    // sessionId 0 per research A3 (ignored by ChatExecutor); model/mcpTools
    // undefined — the executor resolves conversations.model via EngineRegistry (D-10).
    void this.orchestrator
      .executeChatTurn(0, conversationId, content, undefined, null, workspaceKey, undefined, undefined, {
        onEngineEvent: (event: EngineEvent) => {
          if (event.type === "error") lastEngineError = event.message;
          // D-06 (Pitfall 5): capture the decision payload BEFORE translation —
          // it fires immediately BEFORE onRunEnd("decision") and is needed at
          // terminal time (buildInterruptOutcome + registry.register).
          if (event.type === "decision_request") capturedDecisionPayload = event.payload;
          const translated = translateEngineEvent(event, state);
          accumulated.push(...translated);
          for (const ev of translated) subject.next(ev);
          // WR-02: async completion guard. A stream that ends WITHOUT a
          // terminal (non-fatal error + end-of-stream — the Pi engine's
          // fatal:false path) would otherwise leave the subject uncompleted
          // and the runner lock held forever. stream-processor calls onRunEnd
          // SYNCHRONOUSLY right after terminal-causing events; if it didn't
          // (no terminal arrived), the microtask below closes the stream so
          // the client still gets a terminal. For `done`/fatal `error`/
          // `decision_request` the synchronous onRunEnd sets terminalEmitted
          // first, making this a no-op.
          if (
            event.type === "done" ||
            event.type === "error" ||
            event.type === "decision_request"
          ) {
            queueMicrotask(() => {
              if (terminalEmitted) return;
              // Pitfall 5 (T-03-02): a decision_request that never reaches
              // onRunEnd (non-standard coordinator / pause-path return) must
              // still end with the interrupt terminal — the decision must not
              // silently vanish into a plain RUN_FINISHED or wedge the stream.
              if (capturedDecisionPayload != null) {
                const id = interruptRegistry.register(conversationId, capturedDecisionPayload);
                finishInterrupt(id);
                return;
              }
              guardedComplete();
            });
          }
        },
        onRunEnd: (outcome) => {
          if (outcome === "error") {
            finish("error", { message: lastEngineError ?? "Run failed", code: "ENGINE_ERROR" });
          } else if (outcome === "decision") {
            // D-06: register the pending interrupt (id minted per-thread
            // counter — Pitfall 3: NEVER decision-${executionId}, null during
            // synchronous dispatch) and emit the interrupt terminal.
            const id = interruptRegistry.register(conversationId, capturedDecisionPayload ?? "");
            finishInterrupt(id);
          } else {
            finish(outcome);
          }
        },
      })
      .then(({ executionId }) => {
        run.executionId = executionId;
        // D-06: attach the resolved executionId to the pending interrupt entry
        // (no-op when no decision was captured). Runs before the abortRequested
        // handling — the executionId is known by the time the user can resume.
        if (capturedDecisionPayload != null) {
          interruptRegistry.updateExecutionId(threadId, executionId);
        }
        // WR-02: the Pi pre-flight fail-fast path (chat-executor.ts) returns
        // executionId -1 with NO events and NO onRunEnd — no execution was
        // started and nothing will ever emit. Complete the stream so the
        // client gets RUN_FINISHED instead of hanging on the SSE forever
        // (the runtime mount deliberately disables the idle timeout).
        if (executionId === -1) {
          guardedComplete();
          return;
        }
        if (run.abortRequested) {
          this.orchestrator.cancel(executionId);
          return;
        }
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
