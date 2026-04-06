import type { AIProvider, AIMessage, AICallOptions, StreamEvent, AITurnResult } from "./types.ts";
import { log } from "../logger.ts";

// ─── ProviderError ────────────────────────────────────────────────────────────

/**
 * Thrown by AIProvider implementations on non-2xx HTTP responses.
 * The retry wrapper uses `status` for policy decisions (which codes to retry,
 * how many consecutive 529s to allow, etc.) and `retryAfter` to respect
 * the `retry-after` response header.
 */
export class ProviderError extends Error {
  readonly status: number;
  readonly retryAfter?: number;

  constructor(status: number, message: string, retryAfter?: number) {
    super(message);
    this.name = "ProviderError";
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** HTTP status codes that warrant a retry with backoff. */
const RETRYABLE_STATUSES = new Set([429, 529, 500, 502, 503, 504]);

/** Anthropic's overload code is capped separately — 3 consecutive 529s → give up. */
const MAX_529_RETRIES = 3;

const DEFAULT_MAX_STREAM_RETRIES = 3;
const DEFAULT_MAX_TURN_RETRIES = 10;

const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 32_000;
const JITTER_MS = 1_000;

/** No SSE events for this long → watchdog fires (configurable via env var). */
const DEFAULT_IDLE_TIMEOUT_MS = (() => {
  const v = parseInt(process.env.RAILYN_STREAM_IDLE_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(v) && v > 0 ? v : 90_000;
})();

/** Log a stall warning when no events arrive for this long (does not abort). */
const DEFAULT_STALL_WARN_MS = 30_000;

/** Internal: allows tests to override timing without real delays. */
interface _RetryTimingConfig {
  baseBackoffMs?: number;
  idleTimeoutMs?: number;
  stallWarnMs?: number;
}

/** Ephemeral status messages emitted during non-streaming fallback waits. */
const STATUS_THRESHOLDS: ReadonlyArray<[number, string]> = [
  [15_000, "Waiting for response\u2026"],
  [30_000, "Model is taking longer than usual\u2026"],
  [60_000, "Still waiting \u2014 the provider may be under heavy load\u2026"],
  [120_000, "Still processing \u2014 this is taking a while. Please stand by\u2026"],
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isRetryableStatus(status: number): boolean {
  return RETRYABLE_STATUSES.has(status);
}

function computeBackoffMs(attempt: number, retryAfter?: number, baseMs = BASE_BACKOFF_MS): number {
  // When baseMs is 0 (test override), skip jitter entirely so tests run instantly.
  if (baseMs === 0) return retryAfter ? retryAfter * 1_000 : 0;
  const exp = Math.min(baseMs * Math.pow(2, attempt), MAX_BACKOFF_MS);
  const jitter = Math.random() * JITTER_MS;
  // Apply jitter AFTER Math.max so it is never absorbed by a large retryAfter value.
  const base = retryAfter ? Math.max(exp, retryAfter * 1_000) : exp;
  return base + jitter;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Cooldown helpers ─────────────────────────────────────────────────────────

/**
 * If the provider has an active rate-limit cooldown, sleeps until it expires.
 * Called before every API attempt so all concurrent callers respect the window
 * established by the first caller to receive a 429.
 */
function waitForCooldown(provider: AIProvider): Promise<void> {
  const remaining = provider.cooldownUntil - Date.now();
  if (remaining > 0) {
    log("info", `Provider rate-limit cooldown active, waiting ${Math.round(remaining)}ms`, {});
    return sleep(remaining);
  }
  return Promise.resolve();
}

/**
 * Records a provider-level cooldown based on the `retry-after` header value.
 * Once set, all concurrent callers sharing this provider instance will wait
 * before their next attempt.
 */
function setCooldown(provider: AIProvider, retryAfter: number): void {
  provider.cooldownUntil = Date.now() + retryAfter * 1_000;
}

// ─── retryStream ──────────────────────────────────────────────────────────────

/**
 * Resilient streaming wrapper around `provider.stream()`.
 *
 * Behaviour:
 * - Retry up to `maxStreamRetries` (default 3) on retryable ProviderErrors or watchdog timeout.
 * - Idle watchdog: fires `DOMException("stream idle timeout", "AbortError")` after 90 s of silence.
 * - 30 s stall threshold: logs a warning without aborting.
 * - After stream retries exhausted: falls back to `provider.turn()` (non-streaming path).
 * - Non-streaming fallback emits ephemeral `{ type: "status" }` events at 15/30/60/120 s.
 * - HTTP 529 is capped at 3 consecutive retries (applies across stream and turn loops).
 */
export async function* retryStream(
  provider: AIProvider,
  messages: AIMessage[],
  options: AICallOptions = {},
  maxStreamRetries = DEFAULT_MAX_STREAM_RETRIES,
  maxTurnRetries = DEFAULT_MAX_TURN_RETRIES,
  _tc: _RetryTimingConfig = {},
  source: "foreground" | "background" = "foreground",
): AsyncGenerator<StreamEvent> {
  const idleTimeoutMs = _tc.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  const stallWarnMs = _tc.stallWarnMs ?? DEFAULT_STALL_WARN_MS;
  const baseBackoffMs = _tc.baseBackoffMs ?? BASE_BACKOFF_MS;
  let streamAttempt = 0;
  let consecutive529 = 0;

  while (streamAttempt <= maxStreamRetries) {
    // Fresh watchdog state per attempt.
    const watchdogController = new AbortController();
    let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
    let stallWarnTimer: ReturnType<typeof setTimeout> | null = null;

    const resetWatchdog = () => {
      if (watchdogTimer) clearTimeout(watchdogTimer);
      if (stallWarnTimer) clearTimeout(stallWarnTimer);
      stallWarnTimer = setTimeout(() => {
        log("warn", `Stream stalled for ${stallWarnMs / 1_000}s with no events`, {});
      }, stallWarnMs);
      watchdogTimer = setTimeout(() => {
        watchdogController.abort(new DOMException("stream idle timeout", "AbortError"));
      }, idleTimeoutMs);
    };

    const clearWatchdog = () => {
      if (watchdogTimer) clearTimeout(watchdogTimer);
      if (stallWarnTimer) clearTimeout(stallWarnTimer);
      watchdogTimer = null;
      stallWarnTimer = null;
    };

    // Combine user-supplied signal + watchdog so either one aborts the fetch.
    const combinedSignal = options.signal
      ? AbortSignal.any([options.signal, watchdogController.signal])
      : watchdogController.signal;

    try {
      await waitForCooldown(provider);
      resetWatchdog();
      for await (const event of provider.stream(messages, { ...options, signal: combinedSignal })) {
        resetWatchdog(); // reset on every yielded event
        yield event;
      }
      clearWatchdog();
      return; // stream completed successfully
    } catch (err) {
      clearWatchdog();

      // Watchdog-triggered idle timeout → retryable.
      if (err instanceof DOMException && err.message === "stream idle timeout") {
        log("warn", `Stream watchdog fired (attempt ${streamAttempt + 1}/${maxStreamRetries + 1})`, {});
        streamAttempt++;
        consecutive529 = 0;
        continue;
      }

      // User cancellation: user signal aborted, or generic AbortError. Propagate.
      if (options.signal?.aborted) throw err;
      if (err instanceof Error && err.name === "AbortError") throw err;

      // ProviderError: check if retryable.
      if (err instanceof ProviderError && isRetryableStatus(err.status)) {
        if (err.status === 429) {
          if (err.retryAfter) setCooldown(provider, err.retryAfter);
          if (source === "background") {
            log("warn", `Stream 429 on background source — bailing immediately`, {});
            throw err;
          }
        }
        if (err.status === 529) {
          consecutive529++;
          if (consecutive529 >= MAX_529_RETRIES) {
            log("error", `Stream hit ${MAX_529_RETRIES} consecutive 529s, giving up`, {});
            throw err;
          }
        } else {
          consecutive529 = 0;
        }
        const delay = computeBackoffMs(streamAttempt, err.retryAfter, baseBackoffMs);
        log("warn", `Stream ProviderError ${err.status} (attempt ${streamAttempt + 1}), retrying in ${Math.round(delay)}ms`, {});
        await sleep(delay);
        streamAttempt++;
        continue;
      }

      // Non-retryable (e.g. 400, 401, 403, network error) → propagate.
      throw err;
    }
  }

  // Stream retry budget exhausted — fall back to non-streaming turn.
  log("warn", `Stream retry exhausted (${maxStreamRetries + 1} attempts), falling back to non-streaming`, {});
  yield* _retryStreamFallback(provider, messages, options, maxTurnRetries, _tc, source);
}

/**
 * Non-streaming fallback invoked after streaming retries are exhausted.
 * Emits ephemeral `{ type: "status" }` events at time thresholds while waiting.
 */
async function* _retryStreamFallback(
  provider: AIProvider,
  messages: AIMessage[],
  options: AICallOptions,
  maxTurnRetries: number,
  _tc: _RetryTimingConfig = {},
  source: "foreground" | "background" = "foreground",
): AsyncGenerator<StreamEvent> {
  const baseBackoffMs = _tc.baseBackoffMs ?? BASE_BACKOFF_MS;
  let turnAttempt = 0;
  let consecutive529 = 0;

  while (turnAttempt <= maxTurnRetries) {
    let turnDone = false;
    let result: AITurnResult | null = null;
    let turnError: unknown = null;

    await waitForCooldown(provider);

    const turnPromise = provider
      .turn(messages, { ...options })
      .then((r) => {
        result = r;
      })
      .catch((e) => {
        turnError = e;
      })
      .finally(() => {
        turnDone = true;
      });

    // Poll while waiting, emitting status events at time thresholds.
    const startMs = Date.now();
    const remainingThresholds = [...STATUS_THRESHOLDS] as Array<[number, string]>;

    while (!turnDone) {
      const elapsed = Date.now() - startMs;
      if (remainingThresholds.length > 0 && elapsed >= remainingThresholds[0][0]) {
        const [, content] = remainingThresholds.shift()!;
        yield { type: "status", content };
      }
      const nextDeadline = remainingThresholds[0]?.[0] ?? Infinity;
      const waitMs = Math.min(nextDeadline - (Date.now() - startMs), 200);
      if (waitMs > 0) await sleep(waitMs);
    }

    // Ensure the promise is settled before reading result/error.
    await turnPromise;

    if (turnError !== null) {
      if (options.signal?.aborted) throw turnError;
      if (turnError instanceof ProviderError && isRetryableStatus(turnError.status)) {
        if (turnError.status === 429) {
          if (turnError.retryAfter) setCooldown(provider, turnError.retryAfter);
          if (source === "background") {
            log("warn", `Non-streaming fallback 429 on background source — bailing immediately`, {});
            throw turnError;
          }
        }
        if (turnError.status === 529) {
          consecutive529++;
          if (consecutive529 >= MAX_529_RETRIES) throw turnError;
        } else {
          consecutive529 = 0;
        }
        if (turnAttempt >= maxTurnRetries) throw turnError;
        const delay = computeBackoffMs(turnAttempt, turnError.retryAfter, baseBackoffMs);
        log("warn", `Non-streaming fallback ProviderError ${turnError.status} (attempt ${turnAttempt + 1}), retrying in ${Math.round(delay)}ms`, {});
        await sleep(delay);
        turnAttempt++;
        continue;
      }
      throw turnError;
    }

    const r = result!;
    if (r.type === "text") {
      if (r.content) yield { type: "token", content: r.content };
    } else if (r.type === "tool_calls") {
      yield { type: "tool_calls", calls: r.calls };
    }
    yield { type: "done" };
    return;
  }

  throw new Error("AI provider exhausted all non-streaming retries without a successful response");
}

// ─── retryTurn ────────────────────────────────────────────────────────────────

/**
 * Resilient async wrapper around `provider.turn()`.
 *
 * Uses the same `ProviderError`-based exponential backoff as `retryStream`.
 * No watchdog is applied — `provider.turn()` is given a per-request AbortSignal
 * timeout by the engine. Used for compaction and sub-agent rounds.
 */
export async function retryTurn(
  provider: AIProvider,
  messages: AIMessage[],
  options: AICallOptions = {},
  maxRetries = DEFAULT_MAX_TURN_RETRIES,
  _tc: _RetryTimingConfig = {},
  source: "foreground" | "background" = "foreground",
): Promise<AITurnResult> {
  const baseBackoffMs = _tc.baseBackoffMs ?? BASE_BACKOFF_MS;
  let attempt = 0;
  let consecutive529 = 0;

  while (true) {
    try {
      await waitForCooldown(provider);
      return await provider.turn(messages, options);
    } catch (err) {
      if (options.signal?.aborted) throw err;
      if (!(err instanceof ProviderError) || !isRetryableStatus(err.status)) throw err;

      if (err.status === 429) {
        if (err.retryAfter) setCooldown(provider, err.retryAfter);
        if (source === "background") {
          log("warn", `retryTurn 429 on background source — bailing immediately`, {});
          throw err;
        }
      }

      if (err.status === 529) {
        consecutive529++;
        if (consecutive529 >= MAX_529_RETRIES) throw err;
      } else {
        consecutive529 = 0;
      }

      if (attempt >= maxRetries) throw err;

      const delay = computeBackoffMs(attempt, err.retryAfter, baseBackoffMs);
      log("warn", `retryTurn ProviderError ${err.status} (attempt ${attempt + 1}), retrying in ${Math.round(delay)}ms`, {});
      await sleep(delay);
      attempt++;
    }
  }
}
