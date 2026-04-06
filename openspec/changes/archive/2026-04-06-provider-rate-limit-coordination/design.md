## Context

Railyin runs multiple tasks and sub-agents concurrently against a shared API key. Each task independently calls `retryStream` or `retryTurn` (in `src/bun/ai/retry.ts`), which wrap `provider.stream()` / `provider.turn()` with exponential backoff. Provider instances are singletons cached in a `Map<string, AIProvider>` keyed by qualified model ID (e.g. `"anthropic/claude-sonnet-4-6"`).

When the upstream API returns HTTP 429 with a `retry-after` header, each caller independently computes its own backoff and retries—unaware that other callers are about to receive 429s too. Worse, the current jitter calculation adds jitter *before* `Math.max(backoff + jitter, retryAfter)`, so when `retryAfter` is large every caller collapses to the exact same sleep duration, creating a thundering herd on resume.

Background callers (compaction, session memory extraction) compete equally with foreground callers (main task execution, sub-agents) for the limited retry budget.

## Goals / Non-Goals

**Goals:**

- Coordinate concurrent callers via a shared cooldown timestamp on the provider singleton so callers skip known-bad windows without a queue or concurrency limiter.
- Spread retry attempts by fixing the jitter calculation to apply after `Math.max`.
- Differentiate foreground and background callers so low-priority work bails immediately on 429 instead of competing for quota.

**Non-Goals:**

- Token-rate-based queuing or concurrency semaphores — too complex, risk bottlenecks when the model is actively responding.
- Provider-level request serialization — would kill parallelism in the normal case.
- Configuration UI or user-facing settings — this is invisible infrastructure.
- Retry behavior changes for non-429 statuses (529, 500, etc.)

## Decisions

### Decision 1: Shared cooldown timestamp on provider singleton

Each `AIProvider` instance (already a singleton per qualified model) gets a mutable `cooldownUntil: number` field initialized to `0`. The retry wrappers check this before each API call:

```
if (Date.now() < provider.cooldownUntil) {
  await sleep(provider.cooldownUntil - Date.now());
}
```

On any 429 response with `retryAfter`, the wrapper sets:

```
provider.cooldownUntil = Date.now() + retryAfter * 1000;
```

**Why over alternatives:**
- *Global queue*: Requires serialization, creates head-of-line blocking when tokens are available. Rejected because the model can serve multiple concurrent requests when not rate-limited.
- *Semaphore*: Needs tuning (how many concurrent?), varies by provider/tier, still doesn't prevent cascading 429s.
- *No coordination*: Current state — every caller hits the wall independently.

The shared cooldown is zero-cost when no 429s occur (a single integer comparison) and naturally expires. No configuration needed.

### Decision 2: Pass provider instance to retry wrappers

Currently `retryStream` and `retryTurn` take a `provider: AIProvider` parameter. The cooldown field lives on the provider itself, so no new parameters are needed for reading/writing cooldown. The retry wrappers already have access to the provider.

### Decision 3: Source-based retry priority

Add a `source` parameter to `retryStream` and `retryTurn`:

```typescript
type RetrySource = "foreground" | "background";
```

- `"foreground"` (default): Main task execution, sub-agent turns. On 429, wait for cooldown and retry normally.
- `"background"`: Compaction, session memory extraction. On 429, set the cooldown for others' benefit but throw immediately instead of retrying.

Call sites:
- `engine.ts` main execution loop → `"foreground"`
- `engine.ts` sub-agent execution → `"foreground"`
- `engine.ts` compaction → `"background"`
- `engine.ts` sub-agent summary → `"foreground"`

### Decision 4: Fix jitter placement in computeBackoffMs

Current (broken):
```typescript
const base = exp + jitter;
return retryAfter ? Math.max(base, retryAfter * 1_000) : base;
```

Fixed:
```typescript
const base = retryAfter ? Math.max(exp, retryAfter * 1_000) : exp;
return base + jitter;
```

Jitter is always added on top, spreading callers even when `retryAfter` dominates.

## Risks / Trade-offs

- **[Clock skew across callers]** → Not a risk: all callers share the same process (`Date.now()` is consistent within a single Bun/Node process).
- **[Stale cooldown after provider instance is replaced]** → `clearProviderCache()` resets instances, which also clears any cooldown. This is correct — a new provider instance has no rate limit history.
- **[Background callers never complete on sustained 429]** → Acceptable: compaction and memory extraction are deferrable. They'll succeed on the next natural trigger when traffic subsides. The engine already handles compaction failures gracefully.
- **[cooldownUntil race between concurrent writers]** → Benign: the last writer wins with the most recent `retryAfter` value. Since all 429 responses for the same window carry similar `retryAfter` values, any writer's value is approximately correct.
