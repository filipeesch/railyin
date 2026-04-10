## Why

When Anthropic returns HTTP 529 (overloaded) repeatedly, the current retry logic exhausts 3 attempts and then the task fails. Similarly, when 429 rate limits have long retry-after windows (30-60s), the execution idles for minutes even when a cheaper, available model could complete the work. Free Code solves this by falling back to a less-capable model (e.g., Opus→Sonnet) on repeated overloaded errors, allowing work to continue rather than stalling. Railyin should support the same pattern — especially for background sub-agent and compaction calls where model quality is less critical.

## What Changes

- **Fallback model config**: Each provider section in workspace config gains an optional `fallback_model` field (fully-qualified model ID) specifying which model to try when the primary is exhausted or overloaded.
- **529 fallback in retryStream/retryTurn**: After 3 consecutive 529 errors, instead of throwing, the retry wrappers attempt the same call using the fallback model's provider. If the fallback also fails, the error is thrown as today.
- **Fallback is transparent**: The fallback is logged, the response is used as-is, and the task's configured model is unchanged. The next round reverts to the primary model.

## Capabilities

### New Capabilities

_(none)_

### Modified Capabilities

- `api-resilience`: After exhausting 529 retries, the retry wrappers attempt a single fallback call using the configured `fallback_model` before failing
- `multi-provider-config`: Provider config supports an optional `fallback_model` field

## Impact

- `src/bun/ai/retry.ts`: `retryStream` and `retryTurn` accept an optional `fallbackProvider` parameter; on 529 exhaustion, attempt one call with the fallback
- `src/bun/config/index.ts`: Add optional `fallback_model` field to provider config schema
- `src/bun/workflow/engine.ts`: `runExecution` resolves fallback provider from config and passes it to retry wrappers
- `config/workspace.yaml.sample`: Document fallback_model option
- No DB or frontend changes
