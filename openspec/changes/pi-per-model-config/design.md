## Context

The Pi engine (`src/bun/engine/pi/`) builds a SDK `Model` from engine config via `PiModelBuilder`. Today `PiEngineConfig` has no per-model config: `model-builder.ts` hardcodes `reasoning: true`, `maxTokens: 8192`, and takes `contextWindow` from a DB `model_settings` override. Reasoning is effectively disabled because `session.agent.state.thinkingLevel = "off"` is hardcoded in three sites (`engine.ts:120`, `session-manager.ts:67`, `child-session.ts:122`). Sampling presets are engine-wide (`sampling_presets` + `default_sampling_preset`), referenced by workflow columns and persisted per-conversation as `sampling_preset_override`.

Railyin already has a generic model-settings contract used by Copilot/Claude/Cursor: `EngineModelInfo.settings: ModelSettingAxis[]` synthesized from each SDK, normalized into `ModelSettingsInfo.settings`, rendered by `ConversationInput.vue` (one control per axis), and persisted per-conversation as `model_params` JSON via `conversations.setModelParams`. `model-params-policy.ts` prunes incompatible overrides on model switch. Sampling presets are already attached per model in `handlers/models.ts` (built from engine-level `sampling_presets`).

opencode's config shape (`provider.<id>.models.<modelId>`) carries `name`, `reasoning`, `tool_call`, `interleaved`, `limit{context,output}`, freeform `options` (request body params), and `variants` (named bundles of `options`, with `disabled:true` to hide one). Its UI is just a model picker + variant cycling — no user-facing axes.

## Goals / Non-Goals

**Goals:**
- Add per-model config to the Pi engine mirroring opencode's `models.<id>` shape.
- Internally translate config into Railyin's `ModelSettingAxis[]` so the existing chat UI works unchanged.
- Make sampling presets per-model (not engine-wide).
- Wire axis values (UI override → default) into the SDK request body + session thinking level at runtime.
- Make reasoning default to on for capable models, and have delegate children inherit the parent level.

**Non-Goals:**
- Exposing the opencode shape or a payload mini-language to users; `axes` is an optional presentation override only.
- New DB schema or RPC surface — reuse `model_params` and `sampling_preset_override`.
- Supporting freeform arbitrary-JSON UI editing of `options` in v1; custom params are expressed as variants or optional axes.
- Changing Copilot/Claude/Cursor behavior.

## Decisions

### Decision: Per-model config mirrors opencode's `models.<id>` shape

`PiEngineConfig` gains `models?: Record<string, PiModelConfig>` keyed by bare model id or `provider/model`. Each entry: `name`, `reasoning`, `tool_call`, `interleaved`, `limit{context,output}`, `options` (default request-body params), `variants` (named bundles each overriding `options`, `disabled:true` hides one), `sampling_presets` + `default_sampling_preset`, and optional `axes`.

**Rationale**: Mirrors the familiar opencode config exactly; users port configs without learning a new shape. `limit.context/output` map directly to Pi `model.contextWindow/maxTokens`.

### Decision: Internal translation to `ModelSettingAxis[]`

A new `model-config.ts` resolves a model's effective config (precedence: exact `provider/model` → bare `modelId` → provider-level default → engine defaults) and synthesizes axes:
- `variants` (respecting `disabled:true`) → a "Mode" select axis (options = variant names).
- `sampling_presets` → a "Sampling" select axis (options = preset names).
- reasoning-capable model with no variants → a "Reasoning"/"Mode" select axis over documented levels derived from `options.reasoning_effort`/`thinking`.
- Optional `axes` node overrides presentation (e.g. DeepSeek showing all reasoning-effort levels).

`EngineModelInfo.settings` carries these; `normalizeModelSettings` passes them through. Frontend unchanged.

**Alternatives**: A user-facing `axes`/`runtime` mini-language (rejected as over-complex; `variants` + optional `axes` already express the same without a payload DSL).

### Decision: Sampling presets become per-model

Engine-level `sampling_presets`/`default_sampling_preset` are removed. Each model owns `sampling_presets`. `handlers/models.ts` builds `availablePresets` per model (already the shape it returns). Workflow-column `sampling_preset` names and conversation `sampling_preset_override` resolve against the active model's preset set, falling back to `default_sampling_preset`, else engine default, else send nothing.

### Decision: Runtime application in `execute()`

`execute()` resolves each axis's active value (`params.modelParams` override → config default), then applies it:
- `thinkingLevel`/Mode → `session.agent.state.thinkingLevel` and provider-specific payload knob (`reasoning_effort`, `enable_thinking`, `chat_template_kwargs`).
- Sampling axis → merged sampling params (`temperature`, `top_p`, …) into `session.agent.onPayload`.
- Static `options` deep-merged as the base body.

UI override wins over config default (consistent with Copilot/Claude/Cursor).

### Decision: Child sessions inherit reasoning level

`child-session.ts` replaces hardcoded `thinkingLevel = "off"` with the level resolved from the parent session / model config so delegate children reason at the same level.

## Risks / Trade-offs

- **Preset-name collisions across models** → Resolution always uses the active model's preset set with fallback to model default; `model-params-policy` prunes stale overrides on model switch.
- **Config migration** — engine-level `sampling_presets` must move under each model → Update `config/engines.yaml.sample` and note the breaking change in AGENTS.md.
- **Arbitrary custom params not UI-editable in v1** → Expressed via `variants` bundles or optional `axes`; freeform JSON editing deferred.
- **`thinkingLevel` semantics vary by provider** → Keep mapping provider-specific in the model builder; no cross-provider logic in Railyin.

## Migration Plan

1. Update `config/engines.yaml.sample` and AGENTS.md to document per-model `models.<id>` config and removal of engine-level `sampling_presets`.
2. Add config types + validation, then `model-config.ts` translator.
3. Update `listModels()` to synthesize `settings` + per-model presets.
4. Update `execute()` runtime merge + child session inheritance.
5. Update `handlers/models.ts` and `model-params-policy.ts`.
6. **Rollback**: revert config type + translator changes; engine-level `sampling_presets` restored.
