/**
 * railyin-runner.ts — RailyinAgentRunner (InMemoryAgentRunner subclass): the
 * durable persistence + replay seam (D-04, RUNR-02/04/05/06/07).
 *
 * - `run()` overrides persist via pipe-tap on `super.run()`'s observable so
 *   the JSONL log contains EXACTLY what the client received — including the
 *   base runner's RUN_STARTED.input patch. Never persist from inside
 *   agent.run() (research anti-pattern).
 * - `connect()` branches: HOT (thread known to this process) → base machinery
 *   (compacted history + live tail with dedup); COLD (fresh process, durable
 *   log exists) → JSONL replay — the #3553 cold-start fix; NEVER-RUN (no
 *   store, no file) → base completes empty (RUNR-06).
 * - The base runner keeps the concurrency guard ("Thread already running"
 *   synchronous throw — RUNR-04), compaction, and live-tail — nothing
 *   reimplemented (anti-pattern: don't re-derive the runner from scratch).
 *
 * Replay shape (cold path): truncate at the first RUN_ERROR (Pitfall 4 safe
 * default — the pinned client cannot hydrate past a RUN_ERROR) → finalize an
 * unterminated last run (finalizeRunEvents; early-returns when a terminal
 * exists, research A5) → completeOpenToolCalls (RUNR-07 — synthetic results
 * for dangling tool calls, inserted before the terminal for wire-valid order)
 * → compactEvents (per-run boundaries) → emit verbatim.
 */
import { compactEvents, type BaseEvent } from "@ag-ui/client";
import { EventType } from "@ag-ui/core";
import {
  finalizeRunEvents,
  InMemoryAgentRunner,
  type AgentRunnerConnectRequest,
  type AgentRunnerRunRequest,
} from "@copilotkit/runtime/v2";
import { ReplaySubject, tap, type Observable } from "rxjs";
import type { JsonlStore } from "./jsonl-store.ts";

type RunnerRun = ReturnType<InMemoryAgentRunner["run"]>;
type RunnerConnect = ReturnType<InMemoryAgentRunner["connect"]>;

/**
 * Local synthesis pass (research A5 / D-09): appends TOOL_CALL_END (when
 * missing) + TOOL_CALL_RESULT `{ messageId: "${toolCallId}-result", content:
 * "" }` for every dangling TOOL_CALL_START. Inserted BEFORE the last terminal
 * when the last run ended (mirrors the bridge's D-09 wire-valid ordering);
 * appended at the end only for unterminated logs (which finalizeRunEvents
 * closes first, so this is a no-op there in practice).
 */
function completeOpenToolCalls(events: BaseEvent[]): BaseEvent[] {
  const openToolCalls = new Map<string, { hasEnd: boolean; hasResult: boolean }>();
  for (const event of events) {
    switch (event.type) {
      case EventType.TOOL_CALL_START: {
        const toolCallId = (event as { toolCallId?: string }).toolCallId;
        if (typeof toolCallId === "string") {
          openToolCalls.set(toolCallId, { hasEnd: false, hasResult: false });
        }
        break;
      }
      case EventType.TOOL_CALL_END: {
        const info = openToolCalls.get((event as { toolCallId?: string }).toolCallId ?? "");
        if (info) info.hasEnd = true;
        break;
      }
      case EventType.TOOL_CALL_RESULT: {
        const info = openToolCalls.get((event as { toolCallId?: string }).toolCallId ?? "");
        if (info) info.hasResult = true;
        break;
      }
      default:
        break;
    }
  }

  const synthesized: BaseEvent[] = [];
  for (const [toolCallId, info] of openToolCalls) {
    if (info.hasResult) continue;
    if (!info.hasEnd) {
      synthesized.push({ type: EventType.TOOL_CALL_END, toolCallId } as unknown as BaseEvent);
    }
    synthesized.push({
      type: EventType.TOOL_CALL_RESULT,
      toolCallId,
      messageId: `${toolCallId}-result`,
      content: "",
    } as unknown as BaseEvent);
  }
  if (synthesized.length === 0) return synthesized;

  let lastTerminal = -1;
  for (let i = events.length - 1; i >= 0; i--) {
    const t = events[i].type;
    if (t === EventType.RUN_FINISHED || t === EventType.RUN_ERROR) {
      lastTerminal = i;
      break;
    }
  }
  if (lastTerminal !== -1) {
    events.splice(lastTerminal, 0, ...synthesized);
  } else {
    events.push(...synthesized);
  }
  return synthesized;
}

export class RailyinAgentRunner extends InMemoryAgentRunner {
  constructor(private readonly store: JsonlStore) {
    // onConcurrentRun stays "throw" — the lock contract (RUNR-04, RESEARCH.md:199).
    super();
  }

  override run(request: AgentRunnerRunRequest): RunnerRun {
    // Persist from the runner's observable so the log matches the wire
    // (incl. the RUN_STARTED.input patch the base runner applies after the
    // agent emits — research anti-pattern line 257). The base observable is
    // cast to the top-level rxjs Observable first: @copilotkit/runtime pipes
    // its NESTED rxjs@7.8.1 while this module imports hoisted rxjs@7.8.2 —
    // structurally identical at runtime, but Subscriber is invariant so the
    // types do not unify (same bridge the probe/agent use).
    const persisted = (super.run(request) as unknown as Observable<BaseEvent>).pipe(
      tap({
        next: (event) => {
          // NEVER let a persistence failure break the client's stream: the
          // agent already rejects non-numeric threadIds with RUN_ERROR before
          // any side effect (T-02-01, 02-01), and the store's sanitization is
          // the second defense line — a rejected append must not interrupt
          // the event flow downstream (the RUN_ERROR wire contract survives).
          try {
            this.store.append(request.threadId, event);
          } catch (err) {
            console.warn(
              `[railyin-runner] Failed to persist event for thread ${request.threadId}:`,
              err instanceof Error ? err.message : err,
            );
          }
        },
        complete: () => {
          try {
            this.store.endRun(request.threadId);
          } catch (err) {
            console.warn(
              `[railyin-runner] Failed to endRun for thread ${request.threadId}:`,
              err instanceof Error ? err.message : err,
            );
          }
        },
      }),
    );
    return persisted as unknown as RunnerRun;
  }

  override connect(request: AgentRunnerConnectRequest): RunnerConnect {
    // 1. HOT: thread known to this process — base machinery replays compacted
    // history AND live-tails the in-flight run with messageId dedup.
    if (this.getThreadEvents(request.threadId).length > 0) {
      return super.connect(request);
    }
    try {
      // 2. COLD: fresh process, durable log exists — replay the JSONL event log
      // (RUNR-05 — the #3553 cold-start fix).
      if (this.store.exists(request.threadId)) {
        const raw = this.store.read(request.threadId) ?? [];
        // Pitfall 4 safe default: nothing hydrates past a RUN_ERROR.
        const firstError = raw.findIndex((e) => e.type === EventType.RUN_ERROR);
        const events = firstError !== -1 ? raw.slice(0, firstError) : raw;
        if (events.length > 0) {
          // Completes the last run when it lacks a terminal (appends closers +
          // terminal); early-returns when a terminal exists (research A5).
          finalizeRunEvents(events);
        }
        // RUNR-07: no stale running tool cards on replay.
        completeOpenToolCalls(events);
        const compacted = compactEvents(events);
        const subject = new ReplaySubject<BaseEvent>(Infinity);
        for (const event of compacted) subject.next(event);
        subject.complete();
        return subject.asObservable() as unknown as RunnerConnect;
      }
    } catch (err) {
      // WR-04: the store's assertThreadId THROWS on malformed threadIds
      // (non-numeric / traversal). The run path rejects those cleanly with
      // RUN_ERROR + THREAD_NOT_FOUND and no side effect (T-02-01); the cold
      // connect path must not turn them into a 500 — fall through to the base
      // runner, which completes empty for unknown threads (RUNR-06).
      console.warn(
        `[railyin-runner] connect failed for thread ${request.threadId}, completing empty:`,
        err instanceof Error ? err.message : err,
      );
    }
    // 3. NEVER-RUN: no store, no file — base completes empty (RUNR-06;
    // Phase 1 test 5 contract).
    return super.connect(request);
  }
}
