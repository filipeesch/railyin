/**
 * Limiter-aware wrappers for Pi SDK AgentSession calls.
 *
 * Pi SDK v0.74.0 does not expose a transport hook in CreateAgentSessionOptions.
 * Concurrency limiting is therefore applied at the call site — around session.prompt()
 * and session.compact() — rather than at the HTTP transport layer.
 *
 * Every LLM inference call (parent prompt, child prompt, manual compact, background
 * compact) must go through runWithLimiter() so the registry is the single source of
 * truth for provider saturation.
 */

import type { ProviderLimiterRegistry } from "./provider-limiter.ts";

/**
 * Run an async function while holding a limiter slot for the given provider.
 * Awaits acquire() (FIFO queue) before calling fn(), releases when fn() settles.
 *
 * @param registry - The shared ProviderLimiterRegistry for this Pi engine.
 * @param providerName - Provider name matching PiEngineConfig.providers keys.
 * @param signal - Optional AbortSignal; propagated to the acquire queue.
 * @param fn - The async work to perform (e.g. () => session.prompt(text)).
 */
export async function runWithLimiter<T>(
  registry: ProviderLimiterRegistry,
  providerName: string,
  signal: AbortSignal | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  const release = await registry.acquire(providerName, signal);
  try {
    return await fn();
  } finally {
    release();
  }
}


