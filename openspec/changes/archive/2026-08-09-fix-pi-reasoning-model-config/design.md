## Context

The Pi engine (`src/bun/engine/pi/`) runs `@earendil-works/pi-ai` `AgentSession`s per conversation. Per-model config lives at engine level (`PiEngineConfig.models.<id>`), keyed by the **bare** model id (e.g. `deepseek-v4-flash`, or `deepseek/deepseek-v4-flash-0731` for an OpenRouter model that has a provider-family prefix). These entries carry `reasoning`, `thinkingFormat`, `variants` (the Mode axis), `SamplingPreset`s, `options`, etc.

Conversations address models by a **qualified** id of the form `{engineId}/{providerId?}/{modelId}`:
- `pi-local/vllm/deepseek-v4-flash` (3 parts)
- `pi-openrouter/openrouter/deepseek/deepseek-v4-flash-0731` (4 parts)

On each execution, `PiEngine.createManagedExecution()` (engine.ts) builds the `pi_ai` Model via `PiModelBuilder` (which correctly normalizes the id), and separately resolves the per-model *config* `modelCfg` via `resolvePiModelConfig(this.config, modelStr)`. **Bug:** `modelStr` is the *full* qualified id and `resolvePiModelConfig` only strips the **first** segment, so a provider-bearing id (`pi-local/vllm/deepseek-v4-flash` → `vllm/deepseek-v4-flash`) never matches the `deepseek-v4-flash` config key → `modelCfg === undefined`.

When `modelCfg` is `undefined`, `PiModelConfigApplier.applyToSession()` has no Mode variants/config, so `session.agent.state.thinkingLevel` defaults to `"off"`. The SDK then sends `thinking:{type:"disabled"}` in its DeepSeek branch, the inference server (ds4) falls into TEXT-only streaming, and reasoning is emitted inline as ordinary assistant text — no `reasoning_content` → no `thinking_delta` → no `reasoning` bubble. This reproduces identically for `pi-openrouter` (4-part id) and on main's currently-running version.

Correct resolution already exists in two places:
- `model-builder.ts:55` uses `QualifiedModelId.tryParse(modelStr).nativeModelId()` (= `vllm/deepseek-v4-flash`), whose `slice(1)` then yields `deepseek-v4-flash`.
- `engine.ts:419` (`listModels`) tries `${providerId}/${m.id}` then `m.id`.

Only the run path (engine.ts:289) passes the raw qualified id.

## Goals / Non-Goals

**Goals:**
- Restore DeepSeek reasoning bubbles for `pi-local` and `pi-openrouter` by fixing the run-path model-config resolution so Mode-selected reasoning is honored.
- **Adopt a direct-injection reasoning architecture** (per user decision #1953): each Pi variant declares `thinking: bool` and an arbitrary `options` body fully injected into the OpenAI request, bypassing the Pi SDK `thinkingLevel`/`thinkingLevelMap` normalization. This makes the wire reasoning kwargs explicit and model-agnostic (ds4 `reasoning_effort`, booleans like `enable_thinking`, `chat_template_kwargs`, etc.).
- Make the id→config resolution consistent with `model-builder.ts`/`listModels()` (single normalization rule).
- Wire `requiresReasoningContentOnAssistantMessages` for OpenRouter-served DeepSeek so assistant-message reasoning stays coherent across turns.
- Keep the SDK aligned to `^0.80.3` (authoritative `bun.lock`; remove the stale npm `package-lock.json`).

**Non-Goals:**
- No migration to SDK `0.84.x` (v4 lane-based Session API churn; deferred to a separate change).
- No UI/model-reasoning rendering changes (`ReasoningBubble`/`event-translator`/persistence already correct).
- No changes to the inference server (ds4) or to the Pi SDK's *own* reasoning param building — Railyin simply overrides/forwards the reasoning kwargs it cares about via `onPayload`, which already merges last over the SDK's `buildParams`.

## Decisions

### D1 — Normalize the qualified model id before config lookup in the run path
Engine.ts run path SHALL compute the native id exactly as `model-builder.ts` does, then resolve the config from it:

```
qmid  = QualifiedModelId.tryParse(modelStr)     // {engine, provider?, model}
nativeId = qmid?.nativeModelId() ?? modelStr    // "vllm/deepseek-v4-flash"  |  "openrouter/deepseek/deepseek-v4-flash-0731"
modelCfg = resolvePiModelConfig(this.config, nativeId)
```

- `vllm/deepseek-v4-flash`.slice(1) → `deepseek-v4-flash` ✓
- `openrouter/deepseek/deepseek-v4-flash-0731`.slice(1) → `deepseek/deepseek-v4-flash-0731` ✓

**Rationale:** mirrors the already-correct model-builder path, keeps a single notion of "native id", and requires no change to `resolvePiModelConfig` itself. Alternatives considered:
- **Change `resolvePiModelConfig` to strip all leading non-config segments** (e.g. iterate `slice(1)`, `slice(2)`, … until a key matches). Rejected: it guesses how many segments are the namespace prefix and silently matches the wrong key when a model id itself contains slashes (e.g. `deepseek/deepseek-v4-flash-0731` should retain the `deepseek/` family). Normalizing to the already-known native id is deterministic and correct.
- **Reuse `PiModelBuilder`'s resolution by exposing `nativeId`** — this is essentially D1; we do not add a public API, we just call `QualifiedModelId.tryParse` in the run path (already imported in engine.ts or via the shared helper).

### D2 — Centralize the id→native resolution (small shared helper)
Extract the `QualifiedModelId.tryParse(modelStr)?.nativeModelId() ?? modelStr` expression into a tiny pure helper (e.g. `nativeModelIdFor(modelStr): string` in `model-config.ts` or alongside `QualifiedModelId`) and use it in **both** `model-builder.ts` and the engine run path, eliminating future divergence.

**Rationale:** SOLID/DRY — the exact same bug pattern is what went wrong (model-builder and run path diverged). A single helper means one change keeps both consistent. Alternatives: leave both sites doing their own `tryParse` (rejected — that's how the divergence arose); move resolution into `PiModelConfigApplier` (rejected — the applier already receives a resolved `modelCfg`, and resolution is the caller's job).

### D3 — DeepSeek-over-OpenRouter coherence flag
Extend `model-builder.ts` so `requiresReasoningContentOnAssistantMessages` is set when `thinkingFormat === "deepseek"` **OR** (`thinkingFormat === "openrouter"` and the native model id lowercased contains `deepseek`). Include the MB-14/MB-15 tests already authored in commit `9f41fa3a`.

**Rationale:** DeepSeek streams reasoning in a separate `reasoning_content` field on assistant messages; the SDK's hostname auto-detection only matches `deepseek.com`, so OpenRouter-served DeepSeek needs the compat flag set explicitly for coherent replays across turns. This is required for the *rest* of the feature (multi-turn conversation coherence) once bubbles are fixed.

### D4 — SDK already on 0.80.3 via bun.lock; remove stale npm lockfile
The authoritative `bun.lock` (Railyin uses `bun install`/`bun test` per AGENTS.md) already resolves `@earendil-works/pi-coding-agent`/`pi-ai`/`pi-agent-core` to `0.80.3` — matching `package.json`'s `^0.80.3`. The only `0.74.0` reference lives in the stale npm `package-lock.json`, which bun does not use. Per decision #1949, **remove** `package-lock.json` rather than sync it. No API migration. The reasoning surface (`thinking_delta` emission) is verified unchanged between 0.74 and 0.80.3.

**Rationale:** removes the false "running 0.74" premise and the unused npm lockfile; keeps Railyin on the version the reasoning design was validated against. No 0.84 migration (v4 Session rewrite deferred).

### D5 — Direct-injection reasoning architecture (variant `thinking` + raw `options`)
Adopt the user's final architecture (decision #1953). The Pi reasoning contract no longer routes through the SDK `thinkingLevel`/`thinkingLevelMap` normalization. Instead:

```yaml
models:
  deepseek-v4-flash:
    thinkingFormat: deepseek
    variants:
      none:  { label: Off,     thinking: false, options: { reasoning_effort: none } }
      high:  { label: Normal,  thinking: true,  options: { reasoning_effort: high } }
      max:   { label: Max,     thinking: true,  options: { reasoning_effort: max } }
```

- **Variant node name** is an opaque key (the UI Mode axis value), **not** a Pi level.
- **`label`** is what the UI shows.
- **`thinking: bool`** maps to the wire `thinking: { type: enabled|disabled }` when present.
- **`options`** are arbitrary request-body params merged verbatim into the outgoing OpenAI request via `onPayload` (which already runs *after* the SDK's `buildParams`, so it overrides the SDK's default `thinking`/`reasoning_effort`). This supports ds4's native `reasoning_effort` (`none`/`high`/`max`) and boolean-only reasoning models (`enable_thinking`, `chat_template_kwargs`, …).

Concretely, `PiModelConfigApplier.applyToSession`:
- Reads the selected variant's `options` and `thinking`.
- Maps `thinking: true` → `thinking: { type: "enabled" }`, `thinking: false` → `{ type: "disabled" }` in the merged request body (guarded: only when the variant declares `thinking`).
- **Stops stripping** `reasoning_effort`/`reasoningEffort` from `options` — they now pass through verbatim (this reverses prior D1 "SDK owns the effort key").
- Sets `session.agent.state.thinkingLevel` only as a simple **reasoning on/off sentinel** (for child/inherited sessions): `"high"` when the selected variant enables reasoning (`thinking: true` or a non-`none` effort), `"off"` otherwise; the model's `thinking_level` config is the fallback when no Mode is selected. The wire reasoning is fully driven by the injected `options`/`thinking`, and `onPayload` overrides the SDK's default `thinking:{type:disabled}`.

**Rationale (honest trade-off):** fully explicit, model-agnostic reasoning kwargs; no Pi canonical-level space, no clamping, no map. Cost: reverses D1/D2 (SDK-owns-effort / no-map) from the original openspec change, and touches the Pi config type, validation, applier, builder, sample config, and tests. The `requiresReasoningContentOnAssistantMessages` coherence flag (D3) is `compat`-level and independent of `thinkingLevel`, so it is unaffected.

## Risks / Trade-offs

- **[Behavior change for provider-bearing models]** → The fix only makes `modelCfg` resolve where it previously did not; any config key collision (a model whose bare name equals another model's family prefix) would now match. Mitigation: native-id normalization preserves the provider path segment before the final `slice(1)`, so family-prefixed model ids (e.g. `deepseek/...`) are looked up with their full relative path via two-step fallback — same semantics as `model-builder` today.
- **[SDK bump 0.74→0.80.3 across a wide dependency]** → Mitigation: this change only bumps three pi-* packages to the declared range; the reasoning-specific behavior is verified identical in source; full pi test suite runs before merge. A larger 0.84 migration is explicitly out of scope.
- **[Config still unresolved when bare key absent]** → The engine still falls back to `modelCfg === undefined` → defaults apply (reasoning off). This mirrors current `model-builder` behavior and is acceptable; the bug was that a *configured* key was unreachable, not the fallback itself.
- **[test coverage for 3/4-part ids was missing]** → Add regression tests; the existing `resolvePiModelConfig` tests only covered 2-part ids, which is why this slipped through.

## Migration Plan

1. Add the shared native-id helper (D2); use it in `model-builder.ts` and the engine run path (D1). **Note:** the engine run-path fix (D1) is already done + tested.
2. **Direct-injection rework (D5):** update `PiModelConfig`/`PiVariantConfig` type + validation to accept `thinking` and not reject `reasoning_effort`; update `PiModelConfigApplier.applyToSession` to inject `thinking:{type:enabled|disabled}` and stop stripping `reasoning_effort`; update sample config to the `thinking:`/`options.reasoning_effort` shape; update builder if needed.
3. Wire openrouter+deepseek replay flag (D3) + MB tests (already merged from main — commit 5c8ac5f8).
4. SDK: confirm bun.lock at 0.80.3; remove stale `package-lock.json` (D4, decision #1949).
5. Update regression tests for provider-bearing id resolution + `applyToSession(mode=max)` → wire body contains `reasoning_effort:"max"` and `thinking:{type:"enabled"}`.
6. Run pi test suite; live-verify a "reasoning test" (mode=max) shows a bubble and persists `reasoning` stream events.
7. Rollback: revert the run-path normalization and the applier/validation changes; the helper is additive and the config change can be reverted to the prior `reasoningEffort` shape.

## Open Questions

- None blocking. (The direct-injection design removes the earlier "off/high/xhigh mapping" question entirely — wire value = what's in `options`. The native-id helper (D2) is used in favor of a public `QualifiedModelId` API.)
