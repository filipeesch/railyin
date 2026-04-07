## Context

The current retry logic in `retryStream` and `retryTurn` handles HTTP 529 (overloaded) by retrying up to 3 times with exponential backoff. After exhaustion, the error is thrown and the task fails. For sub-agents and compaction, this means the entire execution path stalls even when a lighter model could complete the work.

Anthropic's rate limits are per-model-class (Opus 4.x shares a pool, Sonnet 4.x shares a separate pool). This means falling back from Opus to Sonnet uses an entirely separate rate limit budget — not just a lighter model but a different quota.

## Goals / Non-Goals

**Goals:**
- Allow work to continue on a fallback model when the primary is overloaded (529) or rate-limited beyond a threshold
- Fallback is per-attempt and transparent — the task's configured model is not changed
- Configuration is explicit: users choose their fallback model

**Non-Goals:**
- Automatic model tier selection (always cheapest available)
- Fallback on quality issues (bad responses, safety refusals)
- Cascading fallback chains (A→B→C); only one level of fallback
- Fallback on 429 with short retry-after values (those are handled by cooldown)

## Decisions

**1. Fallback only on 529 exhaustion, not on 429**

429 errors include `retry-after` values that tell us exactly when to retry. The cooldown mechanism already coordinates callers. Model fallback on 429 would waste the fallback model's quota when waiting a few seconds would suffice. 529 means the model is truly overloaded with no clear recovery timeline — fallback is appropriate here.

**2. Single fallback attempt, not a full retry loop**

After the primary model's 3 consecutive 529 retries are exhausted, we try the fallback model once. If the fallback also returns 529 or any error, we throw the original error. This prevents cascading retry loops.

**3. Fallback configured per provider, not per model**

The `fallback_model` is set on the provider config (e.g., the `anthropic` provider section). All models from that provider share the same fallback target. Example:
```yaml
providers:
  - id: anthropic
    type: anthropic
    api_key: sk-...
    fallback_model: anthropic/claude-sonnet-4-20250514
```

**4. Fallback provider resolved lazily**

`resolveProvider(fallbackModel, providers)` is called only when a fallback is needed, not on every request. This avoids creating unused provider instances.

## Risks / Trade-offs

- **Quality degradation**: The fallback model may produce lower-quality responses. Mitigation: user explicitly configures which model to fall back to; they control the quality trade-off.
- **Prompt cache invalidation**: Switching models means switching providers, which invalidates the prompt cache. Mitigation: fallback is rare (only after 3 consecutive 529s), so cache loss is acceptable.
- **Different context limits**: The fallback model may have a different context window. Mitigation: if the fallback call fails with a context-length error, the original error propagates.
