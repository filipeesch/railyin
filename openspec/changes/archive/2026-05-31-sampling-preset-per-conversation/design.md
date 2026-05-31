## Context

The Pi engine supports named sampling presets (`sampling_presets` in `engines.yaml`) and a `default_sampling_preset`. Workflow columns can reference a preset by name via `sampling_preset`. Until now, this is the finest granularity available — there is no way to override at the conversation level.

Execution params are assembled by four independent executor classes (`TransitionExecutor`, `HumanTurnExecutor`, `RetryExecutor`, `ChatExecutor`). Each manually appends overrides like `contextWindowOverride` and `samplingPresetName` via object spread after calling `ExecutionParamsBuilder`. This is "shotgun surgery" — every new execution-time param must be added to all four executors independently. `HumanTurnExecutor` and `RetryExecutor` currently omit `samplingPresetName` entirely, a silent bug.

## Goals / Non-Goals

**Goals:**
- Let users set a sampling preset per conversation (task or chat session) via the UI.
- A manually-set override persists across column transitions.
- "Auto" (NULL) defers to the existing column → engine default chain.
- Fix the existing gap where `HumanTurnExecutor` and `RetryExecutor` don't apply `column.sampling_preset`.
- Introduce `ExecutionParamsEnricher` to centralise applying conversation-level overrides so future params don't require visiting four executors.

**Non-Goals:**
- Presets for non-Pi engines (Claude effort levels, OpenCode model params — separate feature).
- Per-execution override (one-shot, not persisted).
- Exposing preset editing UI (presets remain defined in `engines.yaml`).

## Decisions

### 1. Store override on the `conversations` table

The `conversations` table already holds `model`, the other conversation-scoped runtime setting. Adding `sampling_preset_override TEXT NULL` here covers both task-linked conversations and standalone chat sessions with a single migration. No join needed at read time (executors already load `conversations.model`).

**Alternative considered:** Task/chat_session columns — requires two migrations and doesn't benefit from the already-established conversations join pattern.

### 2. `ExecutionParamsEnricher` owns all conversation-level overrides

A new class `ExecutionParamsEnricher` (in `src/bun/engine/execution/`) accepts a base `ExecutionParams`, a `conversationId`, a `workspaceKey`, and an optional `columnPreset` string. It queries `conversations.sampling_preset_override`, applies the resolution chain, fetches `contextWindowOverride` from `ModelSettingsRepository`, and returns enriched params.

Executors call `enricher.enrich(base, ctx)` instead of inline spreading. `ExecutionParamsBuilder` remains a pure factory with no side effects.

**Why not put it in `ExecutionParamsBuilder`?** Builder is a pure value constructor; enrichment requires DB access and a settings repository. Mixing them violates SRP and would make the builder harder to test.

### 3. Resolution chain (highest → lowest priority)

```
conversations.sampling_preset_override   (user set)
  └─ if NULL → column.sampling_preset    (workflow YAML)
       └─ if NULL → engine default       (engines.yaml default_sampling_preset)
            └─ if NULL → no override
```

Column transitions do **not** clear the override. The user must explicitly reset to "Auto".

### 4. Surface preset metadata via `ModelInfo.availablePresets`

The frontend already calls `models.listEnabled` to populate the model selector. Pi engine model entries will additionally return `availablePresets: Array<{ name: string; params: SamplingPreset }>`. Non-Pi models return `undefined`. This avoids a separate API call and matches the `contextWindowEditable` pattern already on `ModelInfo`.

### 5. Frontend: conditional inline select in `ConversationInput`

The preset selector renders in the model row only when `engineId === 'pi'`. It uses the same PrimeVue `Select` pattern as the model selector. Closed value shows preset name or "Auto"; open options show preset name + formatted parameter detail row (same slot pattern as model option description). `ConversationInput` emits `update:samplingPresetOverride`; parent views persist via `conversations.setSamplingPreset`.

**Alternative considered:** Popover (like MCP tools) — extra click cost for a per-message concern. Discarded.

## Risks / Trade-offs

- **Preset name drift** → If a user sets preset "fast" and the YAML is later edited to remove it, `resolveSamplingPreset` already handles this: it logs a warning and falls through to the engine default. No crash.
- **ConversationInput prop growth** → The component already has many props. Adding `samplingPresetOverride` + `availablePresets` continues the pattern. A future refactor could group Pi-specific props into a sub-object, but that's out of scope here.
- **HumanTurn/Retry gap fix is a side effect** → The fix is strictly additive (passing a previously-omitted field). No existing test should break; new tests will verify it.

## Migration Plan

1. Run migration `047_conversation_sampling_preset`: `ALTER TABLE conversations ADD COLUMN sampling_preset_override TEXT NULL`.
2. Existing rows get NULL (Auto) — no data migration needed.
3. Frontend displays "Auto" for all existing conversations until user changes it.
4. Rollback: column is nullable and unused by old code, safe to leave in place if deployed and rolled back.

## Open Questions

_(none — all resolved during exploration)_
