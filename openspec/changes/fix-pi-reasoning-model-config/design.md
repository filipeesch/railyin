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
- Restore DeepSeek reasoning bubbles for `pi-local` and `pi-openrouter` by fixing the run-path model-config resolution so Mode-selected reasoning effort is honored.
- Make the fix consistent with the existing, correct resolution in `model-builder.ts` and `listModels()` (single normalization rule, no duplicated ad-hoc logic).
- Wire `requiresReasoningContentOnAssistantMessages` for OpenRouter-served DeepSeek so assistant-message reasoning stays coherent across turns.
- Align the resolved SDK version to `^0.80.3` (as declared) and verify the reasoning surface is unchanged.

**Non-Goals:**
- No migration to SDK `0.84.x` (v4 lane-based Session API churn; deferred to a separate change).
- No UI/model-reasoning rendering changes (`ReasoningBubble`/`event-translator`/persistence already correct).
- No changes to the inference server (ds4) or the SDK's reasoning param building (both verified correct).

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

### D4 — SDK lockfile bump to 0.80.3 (no API migration)
Align the resolved `@earendil-works/pi-coding-agent` / `@earendil-works/pi-ai` / `@earendil-works/pi-agent-core` versions from `0.74.0` to `0.80.3` in the lockfile to match `package.json`'s `^0.80.3`. Verify the reasoning surface (`thinkingLevel → reasoningEffort → thinking:{enabled/disabled}` and `thinking_delta` emission) is unchanged between 0.74 and 0.80.3 (verified identical in source). No 0.84 migration.

**Rationale:** "running 0.74 but declared 0.80.3" is a real skew (decision #1942), and 0.80.3 is the version the openspec reasoning design was validated against. It is a small, backward-compatible bump that removes a variable without the risk of the 0.84 v4 Session rewrite (deferred).

## Risks / Trade-offs

- **[Behavior change for provider-bearing models]** → The fix only makes `modelCfg` resolve where it previously did not; any config key collision (a model whose bare name equals another model's family prefix) would now match. Mitigation: native-id normalization preserves the provider path segment before the final `slice(1)`, so family-prefixed model ids (e.g. `deepseek/...`) are looked up with their full relative path via two-step fallback — same semantics as `model-builder` today.
- **[SDK bump 0.74→0.80.3 across a wide dependency]** → Mitigation: this change only bumps three pi-* packages to the declared range; the reasoning-specific behavior is verified identical in source; full pi test suite runs before merge. A larger 0.84 migration is explicitly out of scope.
- **[Config still unresolved when bare key absent]** → The engine still falls back to `modelCfg === undefined` → defaults apply (reasoning off). This mirrors current `model-builder` behavior and is acceptable; the bug was that a *configured* key was unreachable, not the fallback itself.
- **[test coverage for 3/4-part ids was missing]** → Add regression tests; the existing `resolvePiModelConfig` tests only covered 2-part ids, which is why this slipped through.

## Migration Plan

1. Add the shared native-id helper (D2); use it in `model-builder.ts` and the engine run path (D1).
2. Wire openrouter+deepseek replay flag (D3) + MB tests.
3. Bump lockfile pi packages to 0.80.3 (D4).
4. Add regression tests for provider-bearing id resolution + `applyToSession(mode=max)` → reasoning-enabled `thinkingLevel`.
5. Run pi test suite; live-verify a "reasoning test" (mode=max) shows a bubble and persists `reasoning` stream events.
6. Rollback: revert the run-path normalization (configs simply remain unresolved as before) and the lockfile bump; the helper is additive, so reverting is low-risk.

## Open Questions

- None blocking. (Minor: whether to reuse `QualifiedModelId` directly or add the small helper — resolved in favor of the helper for DRY.)
