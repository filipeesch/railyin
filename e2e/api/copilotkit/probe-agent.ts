/**
 * probe-agent.ts — deterministic AG-UI ScriptedAgent for the CopilotRuntime
 * spike (D-05). Mirrors src/bun/testing/mock-engine.ts: a scripted async
 * generator producing a fixed event lifecycle, driven by forwardedProps.
 *
 * Registered ONLY under RAILYN_COPILOTKIT_PROBE=1 (dynamic import in
 * src/bun/index.ts behind the env gate) — never part of the production agent
 * map and never pulled into the prod module graph when the flag is unset.
 *
 * Event contract (verified against @ag-ui/client@0.0.57 + runtime@1.66.4):
 * - The agent MUST emit RUN_STARTED FIRST — the runtime does NOT synthesize it
 *   and the client's verifyEvents rejects streams that start otherwise
 *   (research Pitfall 2).
 * - The agent MUST emit RUN_FINISHED itself — finalizeRunEvents only appends a
 *   terminal event when the stream lacks one, and would otherwise append
 *   RUN_ERROR "Run ended without emitting a terminal event" (verified in
 *   @copilotkit/shared finalize-events.mjs).
 * - AbstractAgent.run() returns an rxjs Observable (verified d.ts) — the
 *   async-generator body is wrapped with from(). Dual rxjs instances interop
 *   cleanly (top-level 7.8.2 from() feeding @ag-ui/client's nested 7.8.1
 *   pipeline — verified empirically).
 */
import { AbstractAgent } from "@ag-ui/client";
import { EventType, type AGUIEvent, type RunAgentInput } from "@ag-ui/core";
import { from } from "rxjs";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Canonical quick-run event sequence — the single source of event truth.
 * Plan 01-03's fixture text-diff reuses this exact builder so the fixture can
 * never drift from the wire format the real agent emits.
 */
export function buildQuickRunEvents(threadId: string, runId: string): AGUIEvent[] {
  return [
    { type: EventType.RUN_STARTED, threadId, runId },
    { type: EventType.TEXT_MESSAGE_START, messageId: "m1", role: "assistant" },
    { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "m1", delta: "hello" },
    { type: EventType.TEXT_MESSAGE_END, messageId: "m1" },
    { type: EventType.RUN_FINISHED, threadId, runId, result: null },
  ];
}

interface ScriptedProps {
  script?: "quick" | "silence";
  silenceMs?: number;
}

export class ScriptedAgent extends AbstractAgent {
  constructor() {
    super({ agentId: "default", description: "Spike probe agent" });
  }

  run(input: RunAgentInput): ReturnType<AbstractAgent["run"]> {
    // The base class's Observable type resolves to @ag-ui/client's NESTED
    // rxjs@7.8.1, while `from()` here imports the top-level rxjs@7.8.2. The
    // shapes are identical at runtime (verified end-to-end by the probe
    // tests) but rxjs's Subscriber is invariant across package copies, so the
    // cast bridges only the type-level gap.
    return from(this.generateEvents(input)) as unknown as ReturnType<AbstractAgent["run"]>;
  }

  private async *generateEvents(input: RunAgentInput): AsyncGenerator<AGUIEvent> {
    const { threadId, runId } = input;
    const forwarded = (input.forwardedProps ?? {}) as ScriptedProps;
    const script = forwarded.script ?? "quick";
    const silenceMs = forwarded.silenceMs ?? 0;

    yield { type: EventType.RUN_STARTED, threadId, runId };
    yield { type: EventType.TEXT_MESSAGE_START, messageId: "m1", role: "assistant" };
    yield { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "m1", delta: "hello" };
    yield { type: EventType.TEXT_MESSAGE_END, messageId: "m1" };
    if (script === "silence" && silenceMs > 0) {
      // HOST-02: a pause longer than the global Bun idleTimeout (30s). If the
      // server.timeout(req, 0) override is missing, Bun kills this stream
      // mid-silence and RUN_FINISHED never arrives.
      await delay(silenceMs);
    }
    yield { type: EventType.RUN_FINISHED, threadId, runId, result: null };
  }
}

/** Singleton registered in the probe-enabled agents map. */
export const scriptedAgent = new ScriptedAgent();
