/**
 * RunDriver — thin abstraction over the Pi SDK session prompt/continue lifecycle.
 *
 * Wraps session.prompt(), session.agent.continue(), and session.agent.waitForIdle()
 * behind a single narrow interface so PiExecutionController can drive runs without
 * being tightly coupled to the SDK surface. The default implementation acquires a
 * provider concurrency slot for the full duration of each call, including the idle
 * wait, to prevent background compaction from racing with in-flight inference.
 *
 * Regression fix: awaiting session.agent.waitForIdle() ensures all SDK events
 * (trailing text deltas, agent_end) have been delivered before the caller proceeds.
 * Without this, the execution loop could close the AsyncQueue before final events
 * arrived, producing "Agent completed with no output".
 */

import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { ProviderLimiterRegistry } from "./provider-limiter.ts";
import { runWithLimiter } from "./provider-transport.ts";

export interface RunDriver {
  /**
   * Send the initial prompt to the agent and wait for the SDK to fully settle.
   * Holds a provider concurrency slot for the full duration.
   */
  start(session: AgentSession, prompt: string, providerName: string, signal?: AbortSignal): Promise<void>;

  /**
   * Resume the agent after a mid-turn interruption (e.g. post-compaction) and
   * wait for the SDK to fully settle. Holds a provider concurrency slot.
   */
  resume(session: AgentSession, providerName: string, signal?: AbortSignal): Promise<void>;
}

export class DefaultRunDriver implements RunDriver {
  constructor(private readonly registry: ProviderLimiterRegistry) {}

  async start(session: AgentSession, prompt: string, providerName: string, signal?: AbortSignal): Promise<void> {
    await runWithLimiter(this.registry, providerName, signal, async () => {
      await session.prompt(prompt);
      await session.agent.waitForIdle();
    });
  }

  async resume(session: AgentSession, providerName: string, signal?: AbortSignal): Promise<void> {
    await runWithLimiter(this.registry, providerName, signal, async () => {
      await session.agent.continue();
      await session.agent.waitForIdle();
    });
  }
}
