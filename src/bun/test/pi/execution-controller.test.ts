import { describe, test, expect, beforeEach } from "bun:test";
import { startExecution, type ExecutionControllerOptions } from "../../engine/pi/execution-controller.ts";
import type { RunDriver } from "../../engine/pi/run-driver.ts";
import { PiCompactionCoordinator, type MessageAppender } from "../../engine/pi/compaction-coordinator.ts";
import { ProviderLimiterRegistry } from "../../engine/pi/provider-limiter.ts";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { EngineEvent } from "../../engine/types.ts";
import type { Model } from "@earendil-works/pi-ai";

class FakeAgentSession {
  private subscribers: Array<(event: any) => void> = [];
  abortCalled = false;
  compactResult: { summary?: string } | null = null;

  readonly agent = {
    state: {
      messages: [] as any[],
    },
  } as any;

  subscribe(cb: (event: any) => void): () => void {
    this.subscribers.push(cb);
    return () => {
      const idx = this.subscribers.indexOf(cb);
      if (idx !== -1) this.subscribers.splice(idx, 1);
    };
  }

  emit(event: any): void {
    for (const cb of [...this.subscribers]) {
      cb(event);
    }
  }

  getContextUsage() {
    return { tokens: 1000, contextWindow: 128_000, maxTokens: 128_000, fraction: 0.1, percent: 10 };
  }

  async abort(): Promise<void> {
    this.abortCalled = true;
  }

  async compact(): Promise<{ summary?: string }> {
    return this.compactResult ?? {};
  }
}

class MockRunDriver implements RunDriver {
  startCalls: Array<{ session: AgentSession; prompt: string; providerName: string; signal?: AbortSignal }> = [];
  resumeCalls: Array<{ session: AgentSession; providerName: string; signal?: AbortSignal }> = [];
  private onStart?: () => void;
  private onResume?: () => void;
  private shouldReject?: Error;

  whenStart(fn: () => void): this {
    this.onStart = fn;
    return this;
  }

  whenResume(fn: () => void): this {
    this.onResume = fn;
    return this;
  }

  rejectWith(err: Error): this {
    this.shouldReject = err;
    return this;
  }

  async start(session: AgentSession, prompt: string, providerName: string, signal?: AbortSignal): Promise<void> {
    this.startCalls.push({ session, prompt, providerName, signal });
    if (this.shouldReject) throw this.shouldReject;
    this.onStart?.();
  }

  async resume(session: AgentSession, providerName: string, signal?: AbortSignal): Promise<void> {
    this.resumeCalls.push({ session, providerName, signal });
    this.onResume?.();
  }
}

class FakeMessageAppender implements MessageAppender {
  appendCompactionSummary(): void {}
}

function makeOptions(overrides?: Partial<ExecutionControllerOptions>): ExecutionControllerOptions {
  const registry = new ProviderLimiterRegistry();
  registry.register("lmstudio", 2, 60_000);
  const session = new FakeAgentSession();
  const runDriver = new MockRunDriver();
  const compactionCoordinator = new PiCompactionCoordinator(
    { type: "pi" },
    registry,
    new FakeMessageAppender(),
  );

  return {
    session: session as unknown as AgentSession,
    resolvedPrompt: "hello",
    conversationId: 1,
    piModel: { contextWindow: 128_000, provider: "lmstudio" } as unknown as Model<"openai-completions">,
    providerName: "lmstudio",
    workingDirectory: "/cwd",
    signal: undefined,
    suspendRef: {},
    onRawModelMessage: undefined,
    runDriver,
    compactionCoordinator,
    ...overrides,
  };
}

async function drain(queue: AsyncIterable<EngineEvent>): Promise<EngineEvent[]> {
  const events: EngineEvent[] = [];
  for await (const event of queue) {
    events.push(event);
  }
  return events;
}

describe("PiExecutionController", () => {
  test("EC-1: translates SDK events to EngineEvents", async () => {
    const opts = makeOptions();
    const fake = opts.session as unknown as FakeAgentSession;
    const driver = opts.runDriver as MockRunDriver;

    driver.whenStart(() => {
      fake.emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "Hi" } });
      fake.emit({ type: "agent_end" });
    });

    const { queue, cleanup } = startExecution(opts);
    const events = await drain(queue);
    cleanup();

    expect(events).toContainEqual({ type: "token", content: "Hi" });
    // The controller does not emit { type: "done" }; the facade yields it after the queue closes.
  });

  test("EC-2: emits usage event on turn_end", async () => {
    const opts = makeOptions();
    const fake = opts.session as unknown as FakeAgentSession;
    const driver = opts.runDriver as MockRunDriver;

    driver.whenStart(() => {
      fake.emit({ type: "turn_end" });
      fake.emit({ type: "agent_end" });
    });

    const { queue, cleanup } = startExecution(opts);
    const events = await drain(queue);
    cleanup();

    expect(events).toContainEqual({ type: "usage", inputTokens: 1000, outputTokens: 0, contextWindow: 128_000 });
  });

  test("EC-3: resumes after background compaction when last message is not assistant", async () => {
    const opts = makeOptions();
    const fake = opts.session as unknown as FakeAgentSession;
    const driver = opts.runDriver as MockRunDriver;
    const coordinator = opts.compactionCoordinator;

    // Inject a pending compaction promise that we control.
    let resolveCompaction!: () => void;
    const compactionPromise = new Promise<void>((resolve) => {
      resolveCompaction = resolve;
    });
    coordinator["bgCompactions"].set(1, compactionPromise);

    driver.whenStart(() => {
      fake.emit({ type: "agent_end" });
    });

    driver.whenResume(() => {
      fake.emit({ type: "agent_end" });
    });

    const { queue, cleanup } = startExecution(opts);

    // Give the loop time to await the pending compaction.
    await new Promise((r) => setTimeout(r, 10));
    // Last message is user → loop should call resume after compaction settles.
    fake.agent.state.messages = [{ role: "user" }];
    resolveCompaction();
    // Remove the injected entry so the loop does not see it again on the next iteration.
    coordinator["bgCompactions"].delete(1);

    const events = await drain(queue);
    cleanup();

    expect(driver.resumeCalls).toHaveLength(1);
  });

  test("EC-4: captures RunDriver error in state and closes queue", async () => {
    const opts = makeOptions();
    const driver = opts.runDriver as MockRunDriver;
    driver.rejectWith(new Error("prompt failed"));

    const { queue, state, cleanup } = startExecution(opts);
    const events = await drain(queue);
    cleanup();

    // The controller captures the error in state; the facade translates it to an error event.
    expect(state.error).toBeDefined();
    expect(state.error!.message).toBe("prompt failed");
    expect(events).toHaveLength(0);
  });

  test("EC-5: abort signal aborts session and closes queue", async () => {
    const controller = new AbortController();
    const opts = makeOptions({ signal: controller.signal });
    const fake = opts.session as unknown as FakeAgentSession;

    const { queue, cleanup } = startExecution(opts);
    controller.abort();
    const events = await drain(queue);
    cleanup();

    expect(fake.abortCalled).toBe(true);
    expect(events).not.toContainEqual({ type: "done" });
  });

  test("EC-6: forwards raw model messages", async () => {
    const rawMessages: any[] = [];
    const opts = makeOptions({
      onRawModelMessage: (msg) => rawMessages.push(msg),
    });
    const fake = opts.session as unknown as FakeAgentSession;
    const driver = opts.runDriver as MockRunDriver;

    driver.whenStart(() => {
      fake.emit({ type: "agent_end" });
    });

    const { queue, cleanup } = startExecution(opts);
    await drain(queue);
    cleanup();

    expect(rawMessages).toHaveLength(1);
    expect(rawMessages[0].eventType).toBe("agent_end");
    expect(rawMessages[0].sessionId).toBe("1");
  });
});
