import { describe, test, expect, beforeEach } from "bun:test";
import { PiCompactionCoordinator, type MessageAppender } from "../../engine/pi/compaction-coordinator.ts";
import type { PiEngineConfig } from "../../config/index.ts";
import { ProviderLimiterRegistry } from "../../engine/pi/provider-limiter.ts";
import type { AgentSession } from "@earendil-works/pi-coding-agent";

class FakeAgentSession {
  compactCallCount = 0;
  compactResult: { summary?: string } | null = null;
  compactDelayMs = 0;

  async compact(): Promise<{ summary?: string }> {
    this.compactCallCount++;
    if (this.compactDelayMs > 0) {
      await new Promise((r) => setTimeout(r, this.compactDelayMs));
    }
    return this.compactResult ?? {};
  }
}

class FakeMessageAppender implements MessageAppender {
  summaries: Array<{ conversationId: number; summary: string }> = [];

  async appendCompactionSummary(conversationId: number, summary: string): Promise<void> {
    this.summaries.push({ conversationId, summary });
  }
}

describe("PiCompactionCoordinator", () => {
  const contextWindow = 128_000;
  const earlyMargin = 8192;
  const softThreshold = contextWindow - (16384 + earlyMargin);
  let registry: ProviderLimiterRegistry;
  let appender: FakeMessageAppender;

  beforeEach(() => {
    registry = new ProviderLimiterRegistry();
    registry.register("lmstudio", 2, 60_000);
    appender = new FakeMessageAppender();
  });

  function makeConfig(enabled = true, margin = earlyMargin): PiEngineConfig {
    return {
      type: "pi",
      harness: {
        background_compaction: { enabled, early_margin_tokens: margin },
      },
    };
  }

  test("CC-1: triggers compaction when usage exceeds soft threshold", async () => {
    const coordinator = new PiCompactionCoordinator(makeConfig(), registry, appender);
    const session = new FakeAgentSession();
    session.compactResult = { summary: "summary" };

    coordinator.handleTurnEnd(
      session as unknown as AgentSession,
      1,
      "lmstudio",
      softThreshold + 1,
      contextWindow,
    );

    await coordinator.waitForAll();

    expect(session.compactCallCount).toBe(1);
    expect(appender.summaries).toEqual([{ conversationId: 1, summary: "summary" }]);
  });

  test("CC-2: skips compaction when usage is below threshold", async () => {
    const coordinator = new PiCompactionCoordinator(makeConfig(), registry, appender);
    const session = new FakeAgentSession();

    coordinator.handleTurnEnd(
      session as unknown as AgentSession,
      1,
      "lmstudio",
      softThreshold,
      contextWindow,
    );

    await coordinator.waitForAll();

    expect(session.compactCallCount).toBe(0);
    expect(appender.summaries).toHaveLength(0);
  });

  test("CC-3: skips compaction when disabled", async () => {
    const coordinator = new PiCompactionCoordinator(makeConfig(false), registry, appender);
    const session = new FakeAgentSession();

    coordinator.handleTurnEnd(
      session as unknown as AgentSession,
      1,
      "lmstudio",
      softThreshold + 1000,
      contextWindow,
    );

    await coordinator.waitForAll();

    expect(session.compactCallCount).toBe(0);
  });

  test("CC-4: prevents double-trigger for the same conversation", async () => {
    const coordinator = new PiCompactionCoordinator(makeConfig(), registry, appender);
    const session = new FakeAgentSession();
    session.compactDelayMs = 10;
    session.compactResult = { summary: "summary" };

    coordinator.handleTurnEnd(
      session as unknown as AgentSession,
      1,
      "lmstudio",
      softThreshold + 1,
      contextWindow,
    );
    coordinator.handleTurnEnd(
      session as unknown as AgentSession,
      1,
      "lmstudio",
      softThreshold + 1,
      contextWindow,
    );

    await coordinator.waitForAll();

    expect(session.compactCallCount).toBe(1);
  });

  test("CC-5: skips compaction when limiter is saturated", async () => {
    const saturatedRegistry = new ProviderLimiterRegistry();
    saturatedRegistry.register("lmstudio", 0, 60_000);
    const coordinator = new PiCompactionCoordinator(makeConfig(), saturatedRegistry, appender);
    const session = new FakeAgentSession();

    coordinator.handleTurnEnd(
      session as unknown as AgentSession,
      1,
      "lmstudio",
      softThreshold + 1,
      contextWindow,
    );

    await coordinator.waitForAll();

    expect(session.compactCallCount).toBe(0);
  });

  test("CC-6: does not append empty summaries", async () => {
    const coordinator = new PiCompactionCoordinator(makeConfig(), registry, appender);
    const session = new FakeAgentSession();
    session.compactResult = { summary: "" };

    coordinator.handleTurnEnd(
      session as unknown as AgentSession,
      1,
      "lmstudio",
      softThreshold + 1,
      contextWindow,
    );

    await coordinator.waitForAll();

    expect(session.compactCallCount).toBe(1);
    expect(appender.summaries).toHaveLength(0);
  });

  test("CC-7: getPending returns the in-flight promise", async () => {
    const coordinator = new PiCompactionCoordinator(makeConfig(), registry, appender);
    const session = new FakeAgentSession();
    session.compactDelayMs = 50;
    session.compactResult = { summary: "summary" };

    coordinator.handleTurnEnd(
      session as unknown as AgentSession,
      1,
      "lmstudio",
      softThreshold + 1,
      contextWindow,
    );

    const pending = coordinator.getPending(1);
    expect(pending).toBeDefined();
    await pending;
    expect(coordinator.getPending(1)).toBeUndefined();
  });
});
