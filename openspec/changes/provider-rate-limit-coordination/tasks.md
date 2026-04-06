## 1. Shared Cooldown on Provider

- [x] 1.1 Add `cooldownUntil: number` field (default `0`) to the `AIProvider` interface in `src/bun/ai/types.ts`
- [x] 1.2 Initialize `cooldownUntil = 0` in `AnthropicProvider` and `OpenAICompatibleProvider` constructors
- [ ] 1.3 Add a `waitForCooldown(provider)` helper in `src/bun/ai/retry.ts` that sleeps if `Date.now() < provider.cooldownUntil`
- [ ] 1.4 Add a `setCooldown(provider, retryAfter)` helper that sets `provider.cooldownUntil = Date.now() + retryAfter * 1000`
- [ ] 1.5 Call `waitForCooldown` before each API attempt in `retryStream` and `_retryStreamFallback`
- [ ] 1.6 Call `waitForCooldown` before each API attempt in `retryTurn`
- [ ] 1.7 Call `setCooldown` when catching a 429 `ProviderError` with `retryAfter` in all retry loops

## 2. Source-Based Retry Priority

- [ ] 2.1 Add `source?: "foreground" | "background"` parameter to `retryStream` and `retryTurn` signatures
- [ ] 2.2 In the 429 catch path of `retryStream`, `_retryStreamFallback`, and `retryTurn`: if source is `"background"`, call `setCooldown` and re-throw immediately
- [ ] 2.3 Pass `"background"` as source for the compaction `retryTurn` call in `engine.ts`
- [ ] 2.4 Verify main execution and sub-agent call sites default to `"foreground"`

## 3. Jitter Bug Fix

- [ ] 3.1 Fix `computeBackoffMs` to apply jitter after `Math.max`: `const base = retryAfter ? Math.max(exp, retryAfter * 1000) : exp; return base + jitter;`
- [ ] 3.2 Update existing retry tests (if any) to validate jitter is present when `retryAfter` is set

## 4. Verification

- [ ] 4.1 Type-check passes with no errors
- [ ] 4.2 Manual test: run multiple concurrent tasks and confirm 429 cooldown is shared (logs show "waiting for cooldown" instead of independent retries)
