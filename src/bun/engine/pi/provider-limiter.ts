/**
 * Per-provider concurrency limiter for the Pi engine.
 *
 * Local LLM servers (vLLM, Ollama, LM Studio) perform best when the number of
 * concurrent in-flight inference requests is capped. This module provides a
 * bounded semaphore per provider that parent sessions, child sessions (delegate),
 * and background compaction all share — preventing the server from being
 * over-saturated regardless of how many tasks or conversations are active.
 */

/** Defaults applied when provider config does not specify a value. */
export const PROVIDER_LIMITER_DEFAULTS = {
  max_inflight: 8,
  queue_timeout_ms: 60_000,
} as const;

/** A release function returned by acquire/tryAcquire. Call it when the request is done. */
export type ReleaseSlot = () => void;

/** Read-only snapshot of a provider's current concurrency state. */
export interface ProviderLimiterSnapshot {
  providerName: string;
  maxInflight: number;
  inFlight: number;
  queueDepth: number;
  /** 50th-percentile latency of recently completed requests in milliseconds. */
  p50LatencyMs: number | null;
  /** Number of requests that timed out or were aborted while queued since construction. */
  recentRejectCount: number;
}

interface QueueEntry {
  resolve: (release: ReleaseSlot) => void;
  reject: (error: Error) => void;
  timeoutHandle: ReturnType<typeof setTimeout>;
}

/**
 * Bounded semaphore for a single provider.
 * Concurrent acquire() calls that exceed maxInflight are queued FIFO.
 */
class ProviderLimiter {
  private readonly providerName: string;
  private readonly maxInflight: number;
  private readonly queueTimeoutMs: number;
  private inflight = 0;
  private readonly queue: QueueEntry[] = [];
  private recentRejectCount = 0;
  private readonly latencySamples: number[] = [];

  constructor(providerName: string, maxInflight: number, queueTimeoutMs: number) {
    this.providerName = providerName;
    this.maxInflight = maxInflight;
    this.queueTimeoutMs = queueTimeoutMs;
  }

  /**
   * Acquire a slot, waiting (FIFO) if the provider is at capacity.
   * Respects the provided AbortSignal — rejects with AbortError if the signal fires.
   * Rejects with a TimeoutError if queue_timeout_ms elapses before a slot is available.
   */
  acquire(signal?: AbortSignal): Promise<ReleaseSlot> {
    if (signal?.aborted) {
      this.recentRejectCount++;
      return Promise.reject(new DOMException("Request aborted before queuing", "AbortError"));
    }

    if (this.inflight < this.maxInflight) {
      this.inflight++;
      return Promise.resolve(this.makeRelease(Date.now()));
    }

    return new Promise<ReleaseSlot>((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        const idx = this.queue.findIndex((e) => e.resolve === resolve);
        if (idx !== -1) this.queue.splice(idx, 1);
        this.recentRejectCount++;
        reject(new Error(`[pi] Provider "${this.providerName}" queue timeout after ${this.queueTimeoutMs}ms`));
      }, this.queueTimeoutMs);

      const entry: QueueEntry = { resolve, reject, timeoutHandle };
      this.queue.push(entry);

      if (signal) {
        const onAbort = () => {
          const idx = this.queue.findIndex((e) => e.resolve === resolve);
          if (idx !== -1) {
            this.queue.splice(idx, 1);
            clearTimeout(entry.timeoutHandle);
            this.recentRejectCount++;
            reject(new DOMException("Request aborted while queued", "AbortError"));
          }
        };
        signal.addEventListener("abort", onAbort, { once: true });
      }
    });
  }

  /**
   * Non-blocking acquire attempt. Returns a ReleaseSlot immediately if a slot
   * is free, or null if the provider is at capacity.
   * Used by background compaction — never queues, never blocks.
   */
  tryAcquire(): ReleaseSlot | null {
    if (this.inflight < this.maxInflight) {
      this.inflight++;
      return this.makeRelease(Date.now());
    }
    return null;
  }

  snapshot(): ProviderLimiterSnapshot {
    return {
      providerName: this.providerName,
      maxInflight: this.maxInflight,
      inFlight: this.inflight,
      queueDepth: this.queue.length,
      p50LatencyMs: this.computeP50(),
      recentRejectCount: this.recentRejectCount,
    };
  }

  private makeRelease(startMs: number): ReleaseSlot {
    let released = false;
    return () => {
      if (released) return;
      released = true;

      const latency = Date.now() - startMs;
      this.latencySamples.push(latency);
      if (this.latencySamples.length > 100) this.latencySamples.shift();

      const next = this.queue.shift();
      if (next) {
        clearTimeout(next.timeoutHandle);
        // Hand the slot directly to the next waiter — inflight count stays the same.
        next.resolve(this.makeRelease(Date.now()));
      } else {
        this.inflight--;
      }
    };
  }

  private computeP50(): number | null {
    if (this.latencySamples.length === 0) return null;
    const sorted = [...this.latencySamples].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }
}

/**
 * Registry of per-provider limiters keyed by provider name.
 * A single registry instance is shared across all Pi sessions (parent, children,
 * background compaction) for a PiEngine instance.
 */
export class ProviderLimiterRegistry {
  private readonly limiters = new Map<string, ProviderLimiter>();

  /**
   * Register a provider. Idempotent — subsequent calls with the same name are ignored.
   * Call once at engine construction for each configured provider.
   */
  register(providerName: string, maxInflight: number, queueTimeoutMs: number): void {
    if (!this.limiters.has(providerName)) {
      this.limiters.set(providerName, new ProviderLimiter(providerName, maxInflight, queueTimeoutMs));
    }
  }

  /**
   * Ensure a provider exists in the registry, creating it with defaults if absent.
   * Useful for provider names that appear in model IDs but were not pre-configured.
   */
  ensureProvider(providerName: string): void {
    if (!this.limiters.has(providerName)) {
      this.register(providerName, PROVIDER_LIMITER_DEFAULTS.max_inflight, PROVIDER_LIMITER_DEFAULTS.queue_timeout_ms);
    }
  }

  /**
   * Acquire a slot for the given provider, waiting FIFO if at capacity.
   * Auto-registers the provider with defaults if it has not been configured.
   */
  acquire(providerName: string, signal?: AbortSignal): Promise<ReleaseSlot> {
    this.ensureProvider(providerName);
    return this.limiters.get(providerName)!.acquire(signal);
  }

  /**
   * Non-blocking acquire. Returns null if the provider is at capacity.
   * Auto-registers the provider with defaults if it has not been configured.
   */
  tryAcquire(providerName: string): ReleaseSlot | null {
    this.ensureProvider(providerName);
    return this.limiters.get(providerName)!.tryAcquire();
  }

  /** Snapshot of all registered providers. Pure read — does not mutate state. */
  snapshots(): ProviderLimiterSnapshot[] {
    return [...this.limiters.values()].map((l) => l.snapshot());
  }

  /** Snapshot of a single provider. Returns null if provider is not registered. */
  snapshot(providerName: string): ProviderLimiterSnapshot | null {
    return this.limiters.get(providerName)?.snapshot() ?? null;
  }
}
