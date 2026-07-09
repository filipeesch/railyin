## Context

Railyin's model settings feature (shipped in commit `2ca5ee11`) stores a per-conversation `reasoning_mode_override TEXT` value and exposes it in the chat UI — but never passes it to the engine at runtime. The SDK call is unaffected by user selection. Additionally, `ModelSettingsInfo` hard-codes a single `reasoningMode` axis with a flat `supportedValues: string[]`, which cannot represent Cursor's generic `parameters[]` system (where each axis has its own id, label, and values) or future multi-axis models.

The three SDKs expose setting metadata in incompatible shapes:
- **Claude** (`@anthropic-ai/claude-agent-sdk`): `supportsEffort`, `supportedEffortLevels[]`, no named axis — Railyin must synthesize the axis definition
- **Copilot** (`@github/copilot-sdk`): `capabilities.supports.reasoningEffort`, `supportedReasoningEfforts[]`, `defaultReasoningEffort` — Railyin must synthesize the axis
- **Cursor** (`@cursor/sdk`): `parameters: ModelParameterDefinition[]` (fully generic named axes with values), `variants: ModelVariant[]` (named presets) — axis ids and labels come directly from the SDK

## Goals / Non-Goals

**Goals:**
- Define a single `ModelSettingAxis` contract that maps cleanly from all three SDK shapes
- Replace `reasoning_mode_override TEXT` with `model_params JSON` (an array of `{id, value}` pairs)
- Wire `modelParams` through `ExecutionParams` to each engine's `execute()`, so user selection actually affects the SDK call
- Keep each engine adapter responsible for mapping `modelParams → SDK-specific field` (no cross-engine logic)
- Support Cursor's `parameters[]` primary, `variants[]` fallback — no `if modelId == Composer` logic anywhere

**Non-Goals:**
- Supporting more than one setting axis per model in v1 (multi-axis is enabled by the contract but not tested)
- Exposing raw SDK metadata (`rawReasoningModeMetadata`) on the RPC response in v2 format (keep existing raw field for debugging only)
- Adding new setting types beyond effort/reasoning level

## Decisions

### Decision: `ModelSettingAxis` is the normalized unit — engines synthesize it from SDK metadata

**Chosen**: Each engine's `listModels()` produces `settings: ModelSettingAxis[]` on `EngineModelInfo`. The normalizer (`model-settings-normalizer.ts`) maps `EngineModelInfo.settings` → `ModelSettingsInfo.settings` for the RPC response. Engines own the synthesis; the normalizer is a pass-through.

**Alternatives considered**:
- Let the normalizer infer axes from raw SDK shapes — rejected because it concentrates SDK knowledge in one place and requires the normalizer to know about all three SDKs
- Keep `reasoningMode` shape and add optional `parameters[]` alongside — rejected because it creates two parallel representations that diverge

### Decision: Cursor parameters[] takes precedence over variants[]

**Chosen**: If a model has `parameters[]`, expose each parameter as a `ModelSettingAxis`. If it only has `variants[]` (no parameters), synthesize one axis with `id: "variant"`, `options` = variants mapped to `{value: variant.displayName, label: variant.displayName}`, and a `variantParams` side-table in the axis for runtime lookup.

**Rationale**: Parameters are the SDK's canonical runtime mechanism (`ModelSelection.params`). Variants are named presets that combine params. When parameters are present, they give the user direct axis control. When only variants are present (Composer Fast/Normal), exposing them as options is the correct UX with no special-casing.

### Decision: Persistence shape is `[{id, value}]` JSON — mirrors Cursor's `ModelSelection.params`

**Chosen**: `conversations.model_params JSON NULL` replaces `reasoning_mode_override TEXT`. Stored as a JSON array of `ModelParamValue` objects. Empty array / null = no overrides.

**Rationale**: Cursor's runtime selection API is exactly `params?: ModelParamValue[]`. Claude and Copilot each have one axis each, so their values are stored as single-element arrays (`[{id:"effort",value:"high"}]`). This shape is forward-compatible with multi-axis models.

### Decision: Each engine adapter maps `modelParams[]` to its own SDK field

**Chosen**: In `execute()`:
- Claude: `find(id="effort")?.value → ClaudeRunConfig.effort`
- Copilot: `find(id="reasoningEffort")?.value → SessionConfig.reasoningEffort`
- Cursor: pass `modelParams` directly as `ModelSelection.params` in the model selection object

**Rationale**: No cross-engine knowledge needed. The axis `id` used by each engine is the same id returned by that engine's `listModels()`, so the round-trip is self-consistent.

### Decision: `ExecutionParamsEnricher` loads `model_params` from DB and injects into `ExecutionParams`

**Chosen**: Add `modelParams?: ModelParamValue[]` to `ExecutionParams`. The enricher reads `conversations.model_params`, deserializes the JSON, and populates the field alongside `samplingPresetName` and `contextWindowOverride`.

**Rationale**: This keeps all conversation-override resolution in one class, consistent with the existing pattern.

## Risks / Trade-offs

- **DB migration loses existing `reasoning_mode_override` data** → Acceptable: v1 values are effort strings that map 1:1 to the new `model_params` format. Migration script converts existing non-null values to `[{"id":"effort","value":"<existing>"}]` before dropping the old column.
- **Cursor variant lookup requires a side-table in axis metadata** → The `ModelSettingAxis` carries `variantParams?: Record<string, ModelParamValue[]>` for variant-mode axes. This is never serialized to DB — only used in normalizer and engine at runtime.
- **`find(id="effort")` relies on stable axis ids** → Each engine synthesizes its own axis id and uses the same id to extract from `modelParams`. This is self-consistent as long as an engine's axis ids don't change between `listModels()` and `execute()` calls — which they won't since they are constants per engine.

## Migration Plan

1. Add migration `051_conversation_model_params.ts`:
   - Add `model_params JSON NULL`
   - Migrate existing rows: `UPDATE conversations SET model_params = json_array(json_object('id','effort','value',reasoning_mode_override)) WHERE reasoning_mode_override IS NOT NULL`
   - Drop `reasoning_mode_override`
2. Update `row-types.ts`, `mappers.ts`, and all SQL queries touching the old column
3. Update `ExecutionParams`, enricher, engines, RPC types, handlers, frontend — in that order
4. **Rollback**: Re-add `reasoning_mode_override`, reverse migration data transform, revert code changes

## Open Questions

- None — all decisions confirmed by user.
