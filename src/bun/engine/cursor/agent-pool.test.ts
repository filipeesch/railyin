import { describe, expect, it, vi } from "vitest";
import { AgentPool } from "./agent-pool.ts";

interface FakeAgent {
  id: string;
  close: ReturnType<typeof vi.fn>;
}

function makeAgent(id: string): FakeAgent {
  return { id, close: vi.fn(async () => {}) };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

const SHORT_TIMEOUT_MS = 30;

function makePool(timeoutMs = SHORT_TIMEOUT_MS) {
  const close = vi.fn(async (_a: FakeAgent) => {});
  const pool = new AgentPool<FakeAgent>({ idleTimeoutMs: timeoutMs, close });
  return { pool, close };
}

describe("AgentPool", () => {
  it("creates on first acquire and caches the agent (warm)", async () => {
    const { pool } = makePool();
    const create = vi.fn(async (id: string) => makeAgent(id));

    const a1 = await pool.acquire("agent-1", create);
    const a2 = await pool.acquire("agent-1", create);

    expect(a1).toBe(a2); // same warm instance
    expect(create).toHaveBeenCalledTimes(1); // reused, not recreated
    expect(pool.has("agent-1")).toBe(true);
  });

  it("does NOT close an agent on release (keep warm for next turn)", async () => {
    const { pool, close } = makePool(60_000); // long timeout so no idle eviction
    const create = vi.fn(async (id: string) => makeAgent(id));

    const agent = await pool.acquire("agent-1", create);
    expect(agent.close).not.toHaveBeenCalled();

    pool.release("agent-1");
    expect(agent.close).not.toHaveBeenCalled();
    expect(pool.has("agent-1")).toBe(true); // still warm

    const again = await pool.acquire("agent-1", create);
    expect(again).toBe(agent); // resumed the warm agent
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("does not close an in-use agent while a long run is active", async () => {
    const { pool, close } = makePool(SHORT_TIMEOUT_MS);
    const create = vi.fn(async (id: string) => makeAgent(id));

    const agent = await pool.acquire("agent-1", create);
    // Simulate a run that outlives the idle timeout by NOT releasing yet.
    await sleep(SHORT_TIMEOUT_MS * 3);
    expect(agent.close).not.toHaveBeenCalled(); // in-use suppression
    pool.release("agent-1");
  });

  it("evicts and closes an idle agent after the timeout", async () => {
    const { pool, close } = makePool(SHORT_TIMEOUT_MS);
    const create = vi.fn(async (id: string) => makeAgent(id));

    const agent = await pool.acquire("agent-1", create);
    pool.release("agent-1");

    await sleep(SHORT_TIMEOUT_MS * 2);
    expect(close).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledWith(agent);
    expect(pool.has("agent-1")).toBe(false);

    // Next acquire must recreate.
    const fresh = await pool.acquire("agent-1", create);
    expect(fresh).not.toBe(agent);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("closeAll closes every pooled agent", async () => {
    const { pool, close } = makePool(60_000);
    const create = vi.fn(async (id: string) => makeAgent(id));

    const a1 = await pool.acquire("a", create);
    const a2 = await pool.acquire("b", create);

    await pool.closeAll();
    expect(close).toHaveBeenCalledWith(a1);
    expect(close).toHaveBeenCalledWith(a2);
    expect(pool.has("a")).toBe(false);
    expect(pool.has("b")).toBe(false);
    expect(close).toHaveBeenCalledTimes(2);
  });

  it("evict closes and removes a specific agent", async () => {
    const { pool, close } = makePool(60_000);
    const agent = await pool.acquire("a", async () => makeAgent("a"));

    await pool.evict("a");
    expect(close).toHaveBeenCalledWith(agent);
    expect(pool.has("a")).toBe(false);
  });
});