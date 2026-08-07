/**
 * Cursor agent pool — keeps live SDK agents warm across runs.
 *
 * Owns the set of warm (still-open) Cursor agents keyed by `agentId`. Agents
 * are returned to the pool after a run instead of being closed, so the next
 * turn can resume the same live agent with intact in-memory state (the SDK
 * local store already preserves the conversation via the deterministic
 * `agentId`). Idle agents are closed via an idle timeout; `closeAll()` closes
 * every pooled agent on engine shutdown.
 *
 * The pool is generic over the agent type and the close function is injected
 * (DI), so it can be unit-tested with lightweight stubs and wired to the real
 * `@cursor/sdk` `SDKAgent` by the adapter.
 */

import { LeaseRegistry } from "../lease-registry.ts";
import type { EngineShutdownOptions } from "../types.ts";

export interface AgentPoolOptions<TAgent> {
  /** Idle time (ms) before a returned agent is closed and evicted. */
  idleTimeoutMs: number;
  /** Close an agent (eviction / shutdown). Injected by the caller. */
  close: (agent: TAgent) => Promise<void> | void;
  logger?: (message: string, payload?: Record<string, unknown>) => void;
}

/**
 * Per-`agentId` pool of live agents with idle-timeout eviction.
 * `acquire` returns an agent (warm cached or newly created via `create`);
 * `release` returns it to the pool without closing it.
 */
export class AgentPool<TAgent> {
  private readonly agents = new Map<string, TAgent>();
  /** agentIds currently checked out / executing a run — never evicted while in use. */
  private readonly inUse = new Set<string>();
  private readonly leases: LeaseRegistry;

  constructor(private readonly options: AgentPoolOptions<TAgent>) {
    this.leases = new LeaseRegistry("cursor", options.idleTimeoutMs, async (leaseKey) => {
      // An agent mid-run must never be closed by idle eviction; it is re-armed
      // on release. Mirrors Copilot's activeSessions suppression.
      if (this.inUse.has(leaseKey)) return;
      const agent = this.agents.get(leaseKey);
      if (!agent) return;
      this.agents.delete(leaseKey);
      await this.options.close(agent);
    }, options.logger);
  }

  /** Whether an agent for the given id is currently warm (cached). */
  has(agentId: string): boolean {
    return this.agents.has(agentId);
  }

  /**
   * Obtain a live agent for `agentId`, marking it in-use. Reuses a warm agent
   * when one is cached, otherwise calls `create` (resume-or-create) to obtain
   * a new one and caches the result, preserving the conversation via the id.
   */
  async acquire<R extends TAgent>(
    agentId: string,
    create: (agentId: string) => Promise<R>,
  ): Promise<R> {
    const existing = this.agents.get(agentId) as R | undefined;
    if (existing) {
      // Reuse the warm (possibly in-use) agent; `inUse` only suppresses eviction.
      this.inUse.add(agentId);
      this.leases.touch(agentId, "running");
      return existing;
    }
    const agent = await create(agentId);
    this.agents.set(agentId, agent);
    this.inUse.add(agentId);
    this.leases.touch(agentId, "running");
    return agent;
  }

  /**
   * Return a run's agent to the pool, keeping it warm and arming idle
   * eviction. Does NOT close the agent.
   */
  release(agentId: string): void {
    this.inUse.delete(agentId);
    if (this.agents.has(agentId)) {
      this.leases.touch(agentId, "idle");
    }
  }

  /** Immediately close + evict an agent (e.g. persistent-busy failure). */
  async evict(agentId: string): Promise<void> {
    this.inUse.delete(agentId);
    const agent = this.agents.get(agentId);
    if (agent) {
      this.agents.delete(agentId);
      await this.options.close(agent);
    }
    this.leases.release(agentId, "manual");
  }

  /** Close and evict every pooled agent (engine shutdown). */
  async closeAll(_options?: EngineShutdownOptions): Promise<void> {
    const ids = [...this.agents.keys()];
    await Promise.all(ids.map((id) => this.evict(id)));
  }
}
