/**
 * Limiter-aware wrappers for Pi SDK AgentSession calls.
 *
 * Pi SDK v0.74.0 does not expose a transport hook in CreateAgentSessionOptions.
 * Concurrency limiting is therefore applied at the call site — around session.prompt()
 * and session.compact() — rather than at the HTTP transport layer.
 *
 * Every LLM inference call (parent prompt, child prompt, manual compact, background
 * compact) must go through runWithLimiter() or tryRunWithLimiter() so the registry
 * is the single source of truth for provider saturation.
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

/**
 * Fire-and-forget wrapper that tries a non-blocking acquire.
 * If no slot is available, returns false immediately without calling fn().
 * On success, fires fn() asynchronously, releases when it settles, and returns true.
 *
 * Used exclusively by background compaction so it never queues behind
 * foreground inference requests.
 *
 * @param registry - The shared ProviderLimiterRegistry.
 * @param providerName - Provider name.
 * @param fn - Async work. Errors are swallowed by the caller's finally handler.
 * @returns true if the slot was acquired and fn() was launched, false otherwise.
 */
export function tryRunWithLimiter(
  registry: ProviderLimiterRegistry,
  providerName: string,
  fn: () => Promise<void>,
): boolean {
  const release = registry.tryAcquire(providerName);
  if (release === null) return false;
  fn().finally(() => release());
  return true;
}
