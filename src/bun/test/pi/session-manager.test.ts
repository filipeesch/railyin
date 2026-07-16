import { describe, test, expect, beforeEach } from "bun:test";
import { PiSessionManager, type SessionPathResolver } from "../../engine/pi/session-manager.ts";
import type { PiEngineConfig } from "../../config/index.ts";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";

class FakeAgentSession {
  disposeCalled = false;
  setActiveToolsCallCount = 0;
  lastSetNames: string[] = [];

  readonly agent = {
    state: {
      model: null as any,
      thinkingLevel: "off" as string,
      systemPrompt: undefined as string | undefined,
    },
  } as any;

  async setActiveToolsByName(names: string[]): Promise<void> {
    this.setActiveToolsCallCount++;
    this.lastSetNames = [...names];
  }

  dispose(): void {
    this.disposeCalled = true;
  }
}

class FakeSessionPathResolver implements SessionPathResolver {
  constructor(private readonly dir: string) {}
  pathForConversation(conversationId: number): string {
    return `${this.dir}/${conversationId}.jsonl`;
  }
}

describe("PiSessionManager", () => {
  const config: PiEngineConfig = { type: "pi" };
  const model = { provider: "lmstudio" } as unknown as Model<"openai-completions">;
  const tools = [{ name: "read" }, { name: "write_file" }] as any[];

  test("SM-1: creates a new session on first use", async () => {
    let created = false;
    const factory = async () => {
      created = true;
      return new FakeAgentSession() as unknown as AgentSession;
    };
    const resolver = new FakeSessionPathResolver("/tmp/pi-sessions");
    const manager = new PiSessionManager(factory, config, resolver);

    const session = await manager.getOrCreate(1, model, tools, undefined, "/cwd");

    expect(created).toBe(true);
    expect(manager.get(1)).toBe(session);
  });

  test("SM-2: reuses an existing session and updates model/tools", async () => {
    const fake = new FakeAgentSession();
    const factory = async () => fake as unknown as AgentSession;
    const resolver = new FakeSessionPathResolver("/tmp/pi-sessions");
    const manager = new PiSessionManager(factory, config, resolver);

    await manager.getOrCreate(1, model, tools, undefined, "/cwd");
    fake.agent.state.systemPrompt = "system-prompt";
    const reused = await manager.getOrCreate(1, model, tools, "updated-prompt", "/cwd");

    expect(reused).toBe(fake as unknown as AgentSession);
    expect(fake.agent.state.systemPrompt).toBe("updated-prompt");
    expect(fake.setActiveToolsCallCount).toBe(1);
    expect(fake.lastSetNames).toContain("read");
    expect(fake.lastSetNames).toContain("write_file");
  });

  test("SM-3: undefined systemPrompt leaves existing prompt unchanged on reuse", async () => {
    const fake = new FakeAgentSession();
    const factory = async () => fake as unknown as AgentSession;
    const resolver = new FakeSessionPathResolver("/tmp/pi-sessions");
    const manager = new PiSessionManager(factory, config, resolver);

    await manager.getOrCreate(1, model, tools, undefined, "/cwd");
    fake.agent.state.systemPrompt = "keep-me";
    await manager.getOrCreate(1, model, tools, undefined, "/cwd");

    expect(fake.agent.state.systemPrompt).toBe("keep-me");
  });

  test("SM-4: disposes a session and removes it from the map", async () => {
    const fake = new FakeAgentSession();
    const factory = async () => fake as unknown as AgentSession;
    const resolver = new FakeSessionPathResolver("/tmp/pi-sessions");
    const manager = new PiSessionManager(factory, config, resolver);

    await manager.getOrCreate(1, model, tools, undefined, "/cwd");
    manager.dispose(1);

    expect(fake.disposeCalled).toBe(true);
    expect(manager.get(1)).toBeUndefined();
  });

  test("SM-5: disposeAll clears all sessions", async () => {
    const fake1 = new FakeAgentSession();
    const fake2 = new FakeAgentSession();
    let callCount = 0;
    const factory = async () => {
      callCount++;
      return (callCount === 1 ? fake1 : fake2) as unknown as AgentSession;
    };
    const resolver = new FakeSessionPathResolver("/tmp/pi-sessions");
    const manager = new PiSessionManager(factory, config, resolver);

    await manager.getOrCreate(1, model, tools, undefined, "/cwd");
    await manager.getOrCreate(2, model, tools, undefined, "/cwd");
    manager.disposeAll();

    expect(fake1.disposeCalled).toBe(true);
    expect(fake2.disposeCalled).toBe(true);
    expect(manager.get(1)).toBeUndefined();
    expect(manager.get(2)).toBeUndefined();
  });
});
