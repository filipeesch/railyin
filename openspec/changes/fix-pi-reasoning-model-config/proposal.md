## Why

DeepSeek models served via the Pi engine are not surfacing their reasoning (thinking) tokens as collapsible "reasoning bubbles" in the chat UI — the reasoning arrives **inline** as regular assistant text instead. This affects both `pi-local` (DeepSeek V4 Flash) and `pi-openrouter`. The cause is not the SDK or inference server (their reasoning chain is verified correct) but a model-config resolution bug in the Pi engine's **run path**: it resolves the per-model config against the full qualified model id (e.g. `pi-local/vllm/deepseek-v4-flash`) where only a single path segment is stripped, so the configured `deepseek-v4-flash` entry is never found. With no config, Mode-selected reasoning effort is dropped and thinking defaults to "off", so the provider never emits a separate reasoning stream.

## What Changes

- **Fix the Pi run-path config resolution** (`src/bun/engine/pi/engine.ts` ~line 289): resolve `modelCfg` via the **native** model id (strip the engine prefix *and* provider segment) so provider-bearing qualified ids reach `config.models` keys — mirroring `model-builder.ts` and `listModels()`.
  - `pi-local/vllm/deepseek-v4-flash` → resolves `models["deepseek-v4-flash"]` ✓
  - `pi-openrouter/openrouter/deepseek/deepseek-v4-flash-0731` → resolves `models["deepseek/deepseek-v4-flash-0731"]` ✓
- **Restore reasoning bubbles for Pi DeepSeek**: with config resolved, `applyToSession(mode=max)` sets `thinkingLevel` to a non-"off" level, the SDK sends `thinking:{type:"enabled"}`, and the inference server streams `reasoning_content` → `thinking_delta` → `reasoning` events → bubbles.
- **Wire openrouter-served DeepSeek coherence replay**: extend the model-builder so `thinkingFormat==="openrouter"` + a model id containing `deepseek` sets `compat.requiresReasoningContentOnAssistantMessages = true` (matches existing `deepseek` handling). This keeps assistant-message reasoning coherent across turns.
- **Align SDK version to declared range**: bump the resolved `@earendil-works/pi-coding-agent`/`pi-ai` lockfile entry from `0.74.0` to `0.80.3` (matches `package.json ^0.80.3` and the version the reasoning design was verified against). No 0.84 migration in this change.
- **Regression tests** for provider-bearing qualified model id resolution (3-part and 4-part), plus an assertion that `applyToSession(mode=max)` yields a reasoning-enabled `thinkingLevel`.

## Capabilities

### New Capabilities
- `pi-model-config-resolution`: Documents how the Pi engine resolves a per-model config from a qualified model id (engineId/providerId/modelId) in the run path, including the native-id normalization that lets provider-bearing ids reach `config.models` keys. This is required because the existing applier spec assumes the config is already resolved and never addresses how the qualified id is turned into a config key in `execute()`.

### Modified Capabilities
- `pi-engine`: The "Per-model config application is extracted into a service" requirement currently implies the engine hands the applier a resolved `modelCfg`, but the run path fails to resolve it for provider-bearing qualified model ids. Add a requirement/behavior that the run path's config resolution SHALL normalize the qualified model id to its native (engine-stripped) form (and, when the id carries a provider segment, the remaining model id) before lookup, matching `model-builder`/`listModels`, so Mode-selected reasoning effort is honored.
- `pi-engine` (model-builder): extend the `requiresReasoningContentOnAssistantMessages` wiring so it also covers `thinkingFormat==="openrouter"` when the model id contains `deepseek` (currently only `thinkingFormat==="deepseek"` sets it).

## Impact

- **Code**: `src/bun/engine/pi/engine.ts` (run-path config resolution), `src/bun/engine/pi/model-builder.ts` (openrouter+deepseek replay flag).
- **Tests**: `src/bun/test/pi/model-config.test.ts` / `model-builder.test.ts`, plus engine-level test for provider-bearing id resolution.
- **Dependencies**: `@earendil-works/pi-coding-agent`/`pi-ai`/`pi-agent-core` lockfile bump `0.74.0` → `0.80.3` (no source/API migration required — the reasoning surface is verified identical and backward-compatible).
- **Systems**: Pi engine (pi-local, pi-openrouter) reasoning-bubble output; chat conversation timeline; persisted `reasoning` stream events.
