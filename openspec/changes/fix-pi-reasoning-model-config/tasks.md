## 1. Shared native-id helper

- [ ] 1.1 Add `nativeModelIdFor(modelStr: string | undefined): string` helper to `src/bun/engine/pi/model-config.ts` that returns `QualifiedModelId.tryParse(modelStr)?.nativeModelId() ?? modelStr` (total, non-throwing), importing `QualifiedModelId` from `../qualified-model-id.ts`.
- [ ] 1.2 Update `PiModelBuilder.build()` (`src/bun/engine/pi/model-builder.ts:38-55`) to use the shared helper for `nativeId` instead of its inline `tryParse` expression (behavior unchanged).

## 2. Core run-path config resolution fix

- [ ] 2.1 In `src/bun/engine/pi/engine.ts` (`createManagedExecution`, ~line 289), resolve `modelCfg` from the native id via the shared helper: `const modelCfg = resolvePiModelConfig(this.config, nativeModelIdFor(modelStr))` instead of `resolvePiModelConfig(this.config, modelStr)`. Import the helper.
- [ ] 2.2 Verify `applyToSession(session, modelCfg, ...)` now receives the configured entry for provider-bearing ids (spot-check `pi-local/vllm/deepseek-v4-flash` → `deepseek-v4-flash` and `pi-openrouter/openrouter/deepseek/deepseek-v4-flash-0731` → `deepseek/deepseek-v4-flash-0731`).

## 3. OpenRouter-served DeepSeek coherence flag

- [ ] 3.1 In `src/bun/engine/pi/model-builder.ts` (~line 64), extend the `requiresReasoningContentOnAssistantMessages` condition from `thinkingFormat === "deepseek"` to also cover `thinkingFormat === "openrouter"` when the lowercased native model id contains `deepseek` (apply `9f41fa3a`).
- [ ] 3.2 Add/confirm model-builder tests (MB-14 openrouter+deepseek → flag true; MB-15 openrouter+non-deepseek → flag not set).

## 4. Regression tests

- [ ] 4.1 Add `resolvePiModelConfig`/`pmc-resolution` tests for 3-part (`pi-local/vllm/deepseek-v4-flash` → `deepseek-v4-flash`) and 4-part (`pi-openrouter/openrouter/deepseek/deepseek-v4-flash-0731` → `deepseek/deepseek-v4-flash-0731`) qualified ids, plus the 2-part and unparseable fallback cases.
- [ ] 4.2 Add an engine-level test asserting that with `model_params` mode=max on a resolved `deepseek-v4-flash` config, `applyToSession` yields `session.agent.state.thinkingLevel === "xhigh"` (i.e. reasoning enabled via the native-id resolution).
- [ ] 4.3 Assert config not reached for a genuinely absent key still yields `modelCfg === undefined` (defaults apply, no crash).

## 5. SDK lockfile alignment

- [ ] 5.1 Bump resolved `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, `@earendil-works/pi-agent-core` from `0.74.0` to `0.80.3` in the lockfile (matches `package.json ^0.80.3`). No code/API migration. Do NOT bump to 0.84.x.
- [ ] 5.2 Run the Pi test suite to confirm 0.80.3 preserves reasoning param-building and `thinking_delta` behavior.

## 6. Verification

- [ ] 6.1 Run `bun test src/bun --timeout 20000` (or the pi-focused subset) — all existing and new tests pass.
- [ ] 6.2 Live-verify: start Railyin from this branch, open a chat with `pi-local/vllm/deepseek-v4-flash` set to Mode=max, send a reasoning-seeking prompt, and confirm (a) a reasoning bubble streams, (b) `stream_events` row(s) with type `reasoning` persist, (c) the assistant message no longer leads with inline "Let me think…".
- [ ] 6.3 Repeat a smoke run for Mode=none (thinking off) to confirm no reasoning bubble and no regression.
