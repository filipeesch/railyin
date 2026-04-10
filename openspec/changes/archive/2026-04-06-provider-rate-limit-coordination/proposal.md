## Why

Multiple concurrent tasks and sub-agents share the same Anthropic API key and independently fire requests against org-level rate limits (30,000 input tokens/min). When one caller hits a 429, the others continue firing and also get 429s, creating a cascade where every caller retries simultaneously with identical backoff (jitter is swallowed by the `Math.max(backoff + jitter, retryAfter)` calculation). This wastes retry budget and delays all tasks.

## What Changes

- **Provider-level shared cooldown**: Each provider singleton gets a `cooldownUntil` timestamp. When any caller receives a 429, it sets `cooldownUntil = now + retryAfter * 1000` on the provider. Before any API call, callers check the cooldown and wait if active. Zero overhead when no 429s are occurring; full parallelism is preserved.
- **Source-based retry policy**: Callers are categorized by priority. Foreground sources (main task execution, sub-agents) wait for cooldown and retry. Background sources (compaction, session memory extraction) bail immediately on 429 instead of competing for quota.
- **Jitter bug fix**: Move jitter addition after the `Math.max` so it isn't swallowed when `retryAfter` is set. Currently `Math.max(backoff + jitter, retryAfter)` collapses all callers to identical `retryAfter` delays. Fixed to `Math.max(backoff, retryAfter) + jitter`.

## Capabilities

### New Capabilities

_(none)_

### Modified Capabilities

- `api-resilience`: Add shared cooldown coordination across concurrent callers, source-based retry priority, and fix jitter calculation to spread retries after a 429.

## Impact

- **`src/bun/ai/retry.ts`**: Add cooldown check before API calls, set cooldown on 429, fix `computeBackoffMs` jitter ordering, add source priority parameter to `retryStream`/`retryTurn`.
- **`src/bun/ai/index.ts`**: Add `cooldownUntil` field to provider instances (or registry entry).
- **`src/bun/workflow/engine.ts`**: Pass source category (foreground/background) to retry wrappers at each call site.
- No API changes, no database changes, no frontend changes.
