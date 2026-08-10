## Why

DeepSeek models served via the Pi engine are not surfacing their reasoning (thinking) tokens as collapsible "reasoning bubbles" in the chat UI — the reasoning arrives **inline** as regular assistant text instead. This affects both `pi-local` (DeepSeek V4 Flash) and `pi-openrouter`. The cause is not the SDK or inference server (their reasoning chain is verified correct) but a model-config resolution bug in the Pi engine's **run path**: it resolves the per-model config against the full qualified model id (e.g. `pi-local/vllm/deepseek-v4-flash`) where only a single path segment is stripped, so the configured `deepseek-v4-flash` entry is never found. With no config, Mode-selected reasoning effort is dropped and thinking defaults to "off", so the provider never emits a separate reasoning stream.

## What Changes

- **Fix the Pi run-path config resolution** (`src/bun/engine/pi/engine.ts` ~line 289): resolve `modelCfg` via the **native** model id (strip the engine prefix *and* provider segment) so provider-bearing qualified ids reach `config.models` keys — mirroring `model-builder.ts` and `listModels()`.
  - `pi-local/vllm/deepseek-v4-flash` → resolves `models["deepseek-v4-flash"]` ✓
  - `pi-openrouter/openrouter/deepseek/deepseek-v4-flash-0731` → resolves `models["deepseek/deepseek-v4-flash-0731"]` ✓
- **Restore reasoning bubbles for Pi DeepSeek**: with config resolved, the engine injects the mode's reasoning kwargs verbatim into the request body (`thinking:{type:"enabled"}` + `reasoning_effort:"max"/"high"` for Max/Normal), so the inference server streams `reasoning_content` → `thinking_delta` → `reasoning` events → bubbles.
- **Adopt a direct-injection reasoning architecture** (decision #1953): each variant declares `thinking: bool` and arbitrary `options` (e.g. `reasoning_effort`), sent verbatim to the provider, bypassing the Pi `thinkingLevel`/`thinkingLevelMap` normalization. Model-agnostic (supports ds4 `reasoning_effort`, boolean `enable_thinking`, `chat_template_kwargs`, etc.).
- **Wire openrouter-served DeepSeek coherence replay**: extend the model-builder so `thinkingFormat==="openrouter"` + a model id containing `deepseek` sets `compat.requiresReasoningContentOnAssistantMessages = true` (already merged from main — commit 5c8ac5f8).
- **SDK version alignment**: the authoritative `bun.lock` already resolves `@earendil-works/pi-coding-agent`/`pi-ai` to `0.80.3` (matching `package.json ^0.80.3`); remove the stale npm `package-lock.json`. No 0.84 migration.
- **Regression tests** for provider-bearing qualified model id resolution (3-part and 4-part), plus assertions that `applyToSession(mode=max/normal/none)` inject the correct direct wire body (`thinking` + `reasoning_effort`).

## Capabilities

### New Capabilities
- `pi-model-config-resolution`: Documents how the Pi engine resolves a per-model config from a qualified model id (engineId/providerId/modelId) in the run path, including the native-id normalization that lets provider-bearing ids reach `config.models` keys. This is required because the existing applier spec assumes the config is already resolved and never addresses how the qualified id is turned into a config key in `execute()`.

### Modified Capabilities
- `pi-engine`: The run path SHALL normalize the qualified model id to its native (engine-stripped) form before config lookup, matching `model-builder`/`listModels`, so provider-bearing ids reach `config.models` keys. Additionally, the per-model config applier SHALL adopt the direct-injection reasoning architecture: variant `thinking: bool` → `thinking:{type:enabled|disabled}`, and `options.reasoning_effort`/other kwargs pass through verbatim (no longer stripped).
- `pi-engine` (model-builder): extend the `requiresReasoningContentOnAssistantMessages` wiring so it also covers `thinkingFormat==="openrouter"` when the model id contains `deepseek` (currently only `thinkingFormat==="deepseek"` sets it; already merged from main).

## Impact

- **Code**: `src/bun/engine/pi/engine.ts` (run-path config resolution), `src/bun/engine/pi/model-builder.ts` (openrouter+deepseek replay flag).
- **Tests**: `src/bun/test/pi/model-config.test.ts` / `model-builder.test.ts`, plus engine-level test for provider-bearing id resolution.
- **Dependencies**: `@earendil-works/pi-coding-agent`/`pi-ai`/`pi-agent-core` lockfile bump `0.74.0` → `0.80.3` (no source/API migration required — the reasoning surface is verified identical and backward-compatible).
- **Systems**: Pi engine (pi-local, pi-openrouter) reasoning-bubble output; chat conversation timeline; persisted `reasoning` stream events.
