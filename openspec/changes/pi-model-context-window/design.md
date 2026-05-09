## Context

Pi and OpenCode engine models currently display a static context window badge computed at list time from either the server's `/v1/models` response or a single `context_window` field in `workspace.yaml` (engine-level). The Pi engine's compaction threshold is `contextWindow - 16_384` tokens. If this value is wrong — which it often is for local LLMs where context is a runtime choice (Ollama `num_ctx`, LM Studio load settings) — compaction fires too late or not at all.

The enabled/disabled state of models is already stored in the `enabled_models` DB table, keyed by `(workspace_key, qualified_model_id)`. This change follows that exact same pattern for context window overrides.

An existing SOLID violation is present: `PiEngine` calls `getDb()` directly at execution time (for `appendMessage`). The `boardTools` DI pattern was the first step toward fixing this class of issue — this change takes the second step, passing `contextWindowOverride` through `ExecutionParams` so the engine never reaches into global state.

## Goals / Non-Goals

**Goals:**
- Store per-model context window overrides in the DB, scoped to workspace + qualified model ID
- Expose an editable inline input in `ModelTreeView` for Pi/OpenCode models only
- Pass the resolved context window through `ExecutionParams` so Pi engine's compaction logic uses the correct value
- Follow the DI pattern already established by `boardTools` — engines receive values, don't query storage

**Non-Goals:**
- Querying the Ollama/LM Studio server to auto-discover the context window (deferred; unreliable for Ollama with custom `num_ctx`)
- Adding a `type` field to Pi engine providers (deferred; not needed for this change)
- Editing context window for Copilot or Claude (fixed values, not user-configurable)
- Migrating the existing `context_window` field out of `workspace.yaml` (it remains as the YAML-level default; DB override takes precedence)

## Decisions

### D1 — Store in DB, not YAML

**Decision**: Per-model context window overrides live in a new `model_settings` DB table, not in `workspace.yaml`.

**Rationale**: `enabled_models` already establishes this pattern. DB writes are atomic and don't require file parsing or conflict resolution. YAML edits from the UI have historically been fragile. The DB table is the right layer for runtime user preferences, as distinct from the structural workspace config in YAML.

**Alternative considered**: Add per-provider `models: { id: context_window }` map to `workspace.yaml`. Rejected: YAML keys with model IDs (containing slashes) are fragile, and it conflates deployment-time structural config with runtime user preferences.

### D2 — `ModelSettingsRepository` interface with SQLite implementation

**Decision**: Introduce a `ModelSettingsRepository` interface with two methods (`getContextWindow`, `setContextWindow`) and a `SqliteModelSettingsRepository` concrete class. Inject the interface at the handler factory and coordinator constructor.

**Rationale**: Follows the Interface Segregation and Dependency Inversion principles. The interface is tiny and purpose-specific — not a god-object. Makes the handler and orchestrator testable without a real DB. Consistent with the `IBoardToolExecutor` pattern already in the codebase.

**Alternative considered**: Pass `db: Database` directly to the handler. Rejected: reproduces the `getDb()` anti-pattern the codebase is already moving away from.

### D3 — Resolve in orchestrator, pass via `ExecutionParams`

**Decision**: The orchestrator reads `ModelSettingsRepository.getContextWindow(workspaceKey, qualifiedModelId)` before building `ExecutionParams`, then passes the resolved value as `contextWindowOverride?: number`. Pi engine's `buildModel()` uses `params.contextWindowOverride ?? this.config.context_window ?? DEFAULT_CONTEXT_WINDOW`.

**Rationale**: Engines are pure execution units — they receive resolved inputs, not storage references. This matches the comment on `boardTools` in `ExecutionParams`: "injected by orchestrator, avoids getDb() inside engines." The orchestrator is the correct place to resolve all runtime context before dispatch.

**Alternative considered**: Inject `ModelSettingsRepository` into `PiEngine` constructor. Rejected: introduces a storage dependency into the engine layer, which is the pattern we're eliminating. The engine would need workspace key context it currently doesn't have.

### D4 — `contextWindowEditable` flag on model list rows

**Decision**: `ProviderModelList.models[]` gains `contextWindowEditable?: boolean`. Pi and OpenCode engines set this to `true` on every model they return from `listModels()`. The handler passes it through. The UI renders an edit icon only when this flag is present and true.

**Rationale**: The UI should not hardcode engine IDs to decide editability. The engine signals its own capability. If a future engine type also needs editable context windows, it works for free.

### D5 — Inline click-to-edit with edit icon affordance

**Decision**: In `ModelTreeView`, Pi/OpenCode rows show the context window badge with a pencil icon that appears on row hover. Clicking the badge OR the icon enters an inline `InputNumber` edit mode (tokens as integer). Blur or Enter saves; Escape cancels. Null (clear) is represented by deleting the value and confirming — reverts to the engine default.

**Rationale**: Click-to-edit with explicit icon balances discoverability (the icon signals editability on hover) with density (no permanent input field cluttering every row). Copilot/Claude rows are visually identical to today — no regression.

## Risks / Trade-offs

- **User sets wrong value** → Mitigation: the input accepts any positive integer. A tooltip note "Set to match your server's loaded context size" sets the right expectation. No server-side validation is possible since we don't probe the server.
- **Compaction fires at wrong threshold if user forgets to update** → Mitigation: this is the same risk as today (hardcoded default). The override capability makes it *better*, not worse.
- **`contextWindowOverride` in `ExecutionParams` is `undefined` for engines that don't use it** → No risk: the field is optional; Copilot and Claude engines ignore it.
- **DB migration on existing installs** → Standard migration runner handles it; `model_settings` starts empty, existing behavior (YAML default or 128K fallback) is fully preserved.

## Migration Plan

1. New migration `043_model_settings.ts` adds the table — no data migration needed
2. Existing `context_window` in `workspace.yaml` remains valid and is used as the fallback when no DB override exists — no breaking change to existing configs
3. Rollback: drop the table, remove the `contextWindowOverride` field from `ExecutionParams` — Pi engine falls back to `this.config.context_window ?? DEFAULT_CONTEXT_WINDOW` unchanged

## Open Questions

- Should `model_settings` be generalized now (e.g., a `key/value` bag per model) to anticipate future per-model settings? Current lean: no — YAGNI; adding columns to a simple table is easy later.
