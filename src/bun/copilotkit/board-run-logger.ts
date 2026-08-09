/**
 * board-run-logger.ts — WR-01 fix: board-driven runs (transition/retry/
 * code-review executors, RPC-driven task turns via tasks.sendMessage /
 * tasks.submitDecisions) have NO AG-UI run in flight, so their engine output
 * previously reached nothing: `opts?.onEngineEvent` was never wired, `onToken`
 * is a no-op, and the JSONL thread log (the task-drawer chat's source) stayed
 * empty — "No messages yet" for a task that genuinely ran.
 *
 * This logger gives those runs the SAME translation + persistence path the
 * RailyinAgent uses (BRDG-01 single path): every EngineEvent is translated via
 * translateEngineEvent into AG-UI BaseEvents and appended to the conversation's
 * JSONL thread log (threadId = String(conversationId)), so RailyinChat's cold
 * replay shows the run's output.
 *
 * Wire shape mirrors the agent's run():
 *  - a synthetic RUN_STARTED opens the run (RUN_STARTED-FIRST per RESEARCH.md
 *    Pattern 2 — verifyEvents rejects a stream whose first event is not
 *    RUN_STARTED), with a minimal schema-valid RunAgentInput;
 *  - every raw engine event is translated in exact order (BRDG-01);
 *  - at run end, open text/reasoning blocks are closed, missing tool results
 *    synthesized (D-09/A5), and exactly one terminal appended (Pitfall 3).
 *
 * Persistence failures are warn-only: a disk error must never break the
 * execution itself (mirrors the runner's tap).
 */
import { EventType } from "@ag-ui/core";
import type { BaseEvent } from "@ag-ui/client";
import type { EngineEvent } from "../engine/types.ts";
import type { ChatTurnOpts } from "../engine/coordinator.ts";
import { JsonlStore } from "./jsonl-store.ts";
import {
  createTranslateState,
  synthesizeMissingToolResults,
  terminalEvent,
  translateEngineEvent,
} from "./event-bridge.ts";

export class BoardRunLogger {
  constructor(private readonly store: JsonlStore) {}

  /**
   * Build the ChatTurnOpts tap for one board-driven execution. Each run gets a
   * fresh TranslateState (per-run machinery, mirroring the agent's run
   * closure) keyed by executionId so concurrent runs on the same conversation
   * never share translation state.
   */
  buildOpts(conversationId: number, executionId: number): ChatTurnOpts {
    const threadId = String(conversationId);
    const runId = `board-${executionId}`;
    const state = createTranslateState(threadId, runId);
    let lastEngineError: string | null = null;

    const append = (events: BaseEvent[]): void => {
      for (const event of events) {
        try {
          this.store.append(threadId, event);
        } catch (err) {
          console.warn(
            `[board-run-logger] Failed to persist event for thread ${threadId}:`,
            err instanceof Error ? err.message : err,
          );
        }
      }
    };

    // RUN_STARTED-FIRST: open the run with a minimal schema-valid input so the
    // log is a canonical AG-UI stream (the runner's cold replay + the client's
    // apply pipeline expect exactly the wire shape the agent produces).
    append([
      {
        type: EventType.RUN_STARTED,
        threadId,
        runId,
        input: { threadId, runId, tools: [], context: [], forwardedProps: {}, state: [], messages: [] },
      },
    ]);

    return {
      onEngineEvent: (event: EngineEvent) => {
        if (event.type === "error") lastEngineError = event.message;
        append(translateEngineEvent(event, state));
      },
      onRunEnd: (outcome: "done" | "error" | "aborted" | "decision") => {
        // Close any open text/reasoning blocks: for done/error/decision the
        // tap already translated the terminal-causing event, so the open flags
        // are false and this is a no-op; for aborted (and the WR-02
        // no-terminal EOF case) no done event was seen, so this closes the
        // blocks — mirroring the agent's finish().
        append(translateEngineEvent({ type: "done" }, state));
        // D-09/A5: never leave a dangling tool call in the persisted log.
        append(synthesizeMissingToolResults(state, []));
        append([
          terminalEvent(
            threadId,
            runId,
            outcome,
            outcome === "error" ? { message: lastEngineError ?? "Run failed" } : undefined,
          ),
        ]);
      },
    };
  }
}
