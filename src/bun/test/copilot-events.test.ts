import { describe, expect, it } from "vitest";
import { translateCopilotStream } from "../engine/copilot/events.ts";
import {
  MockCopilotSession,
  done,
  toolResult,
  toolStart,
  waitForAbort,
} from "./support/copilot-sdk-mock.ts";
import type { EngineEvent } from "../engine/types.ts";

async function collectEvents(session: MockCopilotSession): Promise<EngineEvent[]> {
  const sendPromise = session.send({ prompt: "test" });
  const events: EngineEvent[] = [];
  for await (const event of translateCopilotStream(session, { sendPromise })) {
    events.push(event);
  }
  return events;
}

describe("Copilot watchdog heartbeat (Bug B)", () => {
  it("B1: onHeartbeat fires on every watchdog cycle when no tools are in flight", async () => {
    const heartbeatCount = { value: 0 };
    const session = new MockCopilotSession().queueTurn({
      steps: [waitForAbort()],
    });
    const sendPromise = session.send({ prompt: "test" });
    const ctrl = new AbortController();

    const gen = translateCopilotStream(
      session,
      {
        signal: ctrl.signal,
        sendPromise,
        onHeartbeat: () => { heartbeatCount.value++; },
        idleTimeoutMs: 10,
        maxSilenceCount: 3,
      },
    );

    // Let the stream run for 35ms — should fire at least 2 heartbeats (every 10ms).
    await Promise.race([
      (async () => { for await (const _ of gen) { /**/ } })(),
      new Promise((r) => setTimeout(r, 35)),
    ]);
    ctrl.abort();
    // Drain remaining
    for await (const _ of gen) { /**/ }

    expect(heartbeatCount.value).toBeGreaterThanOrEqual(2);
  });

  it("B2: onHeartbeat fires even when a tool is in flight (toolsInFlight > 0)", async () => {
    const heartbeatCount = { value: 0 };
    const session = new MockCopilotSession().queueTurn({
      steps: [
        toolStart("t1", "some_tool"),
        waitForAbort(), // stream stays open with a tool in flight
      ],
    });
    const sendPromise = session.send({ prompt: "test" });
    const ctrl = new AbortController();

    const gen = translateCopilotStream(
      session,
      {
        signal: ctrl.signal,
        sendPromise,
        onHeartbeat: () => { heartbeatCount.value++; },
        idleTimeoutMs: 10,
        maxSilenceCount: 3,
      },
    );

    // Let the watchdog fire at least once while a tool is in flight.
    await Promise.race([
      (async () => { for await (const _ of gen) { /**/ } })(),
      new Promise((r) => setTimeout(r, 25)),
    ]);
    ctrl.abort();
    for await (const _ of gen) { /**/ }

    expect(heartbeatCount.value).toBeGreaterThanOrEqual(1);
  });
});

describe("Copilot unknown tool name humanization", () => {
  it("humanizes underscore-separated tool name in display label", async () => {
    const session = new MockCopilotSession().queueTurn({
      steps: [
        toolStart("c1", "my_custom_tool", {}),
        toolResult("c1", "ok"),
        done(),
      ],
    });

    const events = await collectEvents(session);
    const toolStartEvent = events.find((e): e is Extract<EngineEvent, { type: "tool_start" }> => e.type === "tool_start");

    expect(toolStartEvent).toBeDefined();
    expect(toolStartEvent?.display?.label).toBe("my custom tool");
  });

  it("humanizes external MCP tool name to server-tool label", async () => {
    const session = new MockCopilotSession().queueTurn({
      steps: [
        toolStart("c1", "mcp__other-server__do_thing", {}),
        toolResult("c1", "ok"),
        done(),
      ],
    });

    const events = await collectEvents(session);
    const toolStartEvent = events.find((e): e is Extract<EngineEvent, { type: "tool_start" }> => e.type === "tool_start");

    expect(toolStartEvent?.display?.label).toBe("other-server do thing");
  });
});
