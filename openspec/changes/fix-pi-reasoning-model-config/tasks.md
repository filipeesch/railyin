## 1. Shared native-id helper

- [x] 1.1 Add `nativeModelIdFor(modelStr: string | undefined): string` helper to `src/bun/engine/pi/model-config.ts` that returns `QualifiedModelId.tryParse(modelStr)?.nativeModelId() ?? modelStr` (total, non-throwing), importing `QualifiedModelId` from `../qualified-model-id.ts`.
- [x] 1.2 Update `PiModelBuilder.build()` (`src/bun/engine/pi/model-builder.ts:38-55`) to use the shared helper for `nativeId` instead of its inline `tryParse` expression (behavior unchanged).

## 2. Core run-path config resolution fix

- [x] 2.1 In `src/bun/engine/pi/engine.ts` (`createManagedExecution`, ~line 289), resolve `modelCfg` from the native id via the shared helper: `const modelCfg = resolvePiModelConfig(this.config, nativeModelIdFor(modelStr))` instead of `resolvePiModelConfig(this.config, modelStr)`. Import the helper.
- [x] 2.2 Verify `applyToSession(session, modelCfg, ...)` now receives the configured entry for provider-bearing ids (spot-check `pi-local/vllm/deepseek-v4-flash` → `deepseek-v4-flash` and `pi-openrouter/openrouter/deepseek/deepseek-v4-flash-0731` → `deepseek/deepseek-v4-flash-0731`).

## 3. OpenRouter-served DeepSeek coherence flag

- [x] 3.1 In `src/bun/engine/pi/model-builder.ts` (~line 64), extend the `requiresReasoningContentOnAssistantMessages` condition from `thinkingFormat === "deepseek"` to also cover `thinkingFormat === "openrouter"` when the lowercased native model id contains `deepseek` (apply `9f41fa3a`).
- [x] 3.2 Add/confirm model-builder tests (MB-14 openrouter+deepseek → flag true; MB-15 openrouter+non-deepseek → flag not set).

## 4. Regression tests

- [x] 4.1 Add `resolvePiModelConfig`/`pmc-resolution` tests for 3-part (`pi-local/vllm/deepseek-v4-flash` → `deepseek-v4-flash`) and 4-part (`pi-openrouter/openrouter/deepseek/deepseek-v4-flash-0731` → `deepseek/deepseek-v4-flash-0731`) qualified ids, plus the 2-part and unparseable fallback cases.
- [x] 4.2 Add an engine-level test asserting that with `model_params` mode=max on a resolved `deepseek-v4-flash` config, `applyToSession` yields the direct-injection wire body (`reasoning_effort:"max"` + `thinking:{type:"enabled"}`). (Note: originally asserted `thinkingLevel === "xhigh"`; superseded by decision #1953 direct-injection — see task 7.4 to update.)
- [x] 4.3 Assert config not reached for a genuinely absent key still yields `modelCfg === undefined` (defaults apply, no crash).

## 5. SDK lockfile alignment

- [x] 5.1 Bump resolved `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, `@earendil-works/pi-agent-core` from `0.74.0` to `0.80.3` in the lockfile (matches `package.json ^0.80.3`). No code/API migration. Do NOT bump to 0.84.x. (REVISED: authoritative bun.lock already resolves 0.80.3; per decision #1948 the stale npm package-lock.json pinned at 0.74.0 was removed instead of synced.)
- [x] 5.2 Run the Pi test suite to confirm 0.80.3 preserves reasoning param-building and `thinking_delta` behavior.

## 6. Verification

- [x] 6.1 Run `bun test src/bun --timeout 20000` (or the pi-focused subset) — all existing and new tests pass. (Full backend 2279 + pi 306 green; API smoke 39 green; Playwright 696 green, S-D5 pre-existing/flaky.)
- [ ] 6.2 Live-verify: start Railyin from this branch, open a chat with `pi-local/vllm/deepseek-v4-flash` set to Mode=max, send a reasoning-seeking prompt, and confirm (a) a reasoning bubble streams, (b) `stream_events` row(s) with type `reasoning` persist, (c) the assistant message no longer leads with inline "Let me think…". (Requires the user's engines.yaml migrated to the `thinking:`+`options.reasoning_effort` shape — see 7.5.)
- [ ] 6.3 Repeat a smoke run for Mode=none (thinking off) to confirm no reasoning bubble and no regression.

## 7. Direct-injection reasoning architecture (decision #1953 — supersedes the map-derivation plan)

- [x] 7.1 Update `PiModelConfig`/`PiVariantConfig` types + `validatePiEngineConfig` so a variant's `thinking: boolean` is accepted and `options.reasoning_effort`/`reasoningEffort` are NOT rejected/stripped as reasoning-effort keys (they are legitimate verbatim wire values).
- [x] 7.2 Update `PiModelConfigApplier.applyToSession` to (a) inject `thinking:{type:"enabled"|"disabled"}` for the selected variant's `thinking` when declared, and (b) STOP deleting `reasoning_effort`/`reasoningEffort` from `mergedOptions` so variant `options` flow through verbatim.
- [x] 7.3 Reconcile remaining reasoning references with the applier — injected `thinking`/`reasoning_effort` win because `onPayload` merges last over `buildParams`; `thinkingLevel` kept as a simple reasoning on/off sentinel (child/inherited sessions), with `thinking_level` config fallback when no mode selected.
- [x] 7.4 Update the engine-reasoning regression test (RE-*) to assert the direct-injection wire body (`thinking:{type:"enabled"}` + `reasoning_effort:"max"` for max; `reasoning_effort:"high"` for normal; `thinking:{type:"disabled"}` for none). Added boolean-only-model case (RE-6 `enable_thinking`).
- [x] 7.5 Update `config/engines.yaml.sample` to the `thinking:` + `options.reasoning_effort` variant shape. User's ~/.railyn/config/engines.yaml MIGRATED (done 2026-08-09): pi-local + pi-deepseek `deepseek-v4-flash` and pi-openrouter `deepseek/deepseek-v4-flash-0731` now use `none`→`thinking:false`+`reasoning_effort:none`, `normal`→`thinking:true`+`reasoning_effort:high`, `max`→`thinking:true`+`reasoning_effort:max`. Removed obsolete model-level `options.reasoningEffort`. Backup saved.
- [x] 7.6 Pi test suite (306) + typecheck green; removed dead `canonicalThinkingLevel`/`CANONICAL_THINKING_LEVELS` (unused under direct-injection) and their tests.
