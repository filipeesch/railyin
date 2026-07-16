import { describe, test, expect, beforeEach } from "bun:test";
import { DefaultRunDriver } from "../../engine/pi/run-driver.ts";
import { ProviderLimiterRegistry } from "../../engine/pi/provider-limiter.ts";
import type { AgentSession } from "@earendil-works/pi-coding-agent";

class FakeAgentSession {
  promptCalls: string[] = [];
  continueCallCount = 0;
  waitForIdleCallCount = 0;
  waitForIdleError: Error | null = null;

  readonly agent = {
    waitForIdle: async (): Promise<void> => {
      this.waitForIdleCallCount++;
      if (this.waitForIdleError) throw this.waitForIdleError;
    },
    continue: async (): Promise<void> => {
      this.continueCallCount++;
    },
  } as any;

  async prompt(text: string): Promise<void> {
    this.promptCalls.push(text);
  }
}

describe("DefaultRunDriver", () => {
  let registry: ProviderLimiterRegistry;

  beforeEach(() => {
    registry = new ProviderLimiterRegistry();
    registry.register("lmstudio", 2, 60_000);
  });

  test("RD-1: start calls prompt then waitForIdle", async () => {
    const driver = new DefaultRunDriver(registry);
    const session = new FakeAgentSession();

    await driver.start(session as unknown as AgentSession, "hello", "lmstudio");

    expect(session.promptCalls).toEqual(["hello"]);
    expect(session.waitForIdleCallCount).toBe(1);
  });

  test("RD-2: resume calls continue then waitForIdle", async () => {
    const driver = new DefaultRunDriver(registry);
    const session = new FakeAgentSession();

    await driver.resume(session as unknown as AgentSession, "lmstudio");

    expect(session.continueCallCount).toBe(1);
    expect(session.waitForIdleCallCount).toBe(1);
  });

  test("RD-3: holds limiter slot for the full run", async () => {
    const driver = new DefaultRunDriver(registry);
    const session = new FakeAgentSession();
    let slotHeldDuringWait = false;

    session.agent.waitForIdle = async () => {
      const snapshot = registry.snapshot("lmstudio");
      slotHeldDuringWait = snapshot!.inFlight === 1;
    };

    await driver.start(session as unknown as AgentSession, "hello", "lmstudio");

    expect(slotHeldDuringWait).toBe(true);
    expect(registry.snapshot("lmstudio")!.inFlight).toBe(0);
  });

  test("RD-4: releases slot when waitForIdle rejects", async () => {
    const driver = new DefaultRunDriver(registry);
    const session = new FakeAgentSession();
    session.waitForIdleError = new Error("idle timeout");

    await expect(driver.start(session as unknown as AgentSession, "hello", "lmstudio")).rejects.toThrow(
      "idle timeout",
    );

    expect(registry.snapshot("lmstudio")!.inFlight).toBe(0);
  });

  test("RD-5: abort signal rejects the driver promise", async () => {
    const driver = new DefaultRunDriver(registry);
    const session = new FakeAgentSession();
    const controller = new AbortController();
    controller.abort();

    await expect(
      driver.start(session as unknown as AgentSession, "hello", "lmstudio", controller.signal),
    ).rejects.toThrow(/aborted before queuing/i);

    expect(registry.snapshot("lmstudio")!.inFlight).toBe(0);
  });
});
