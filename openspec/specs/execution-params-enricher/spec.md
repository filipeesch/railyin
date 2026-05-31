## Purpose
Defines `ExecutionParamsEnricher` — the centralised component responsible for applying `contextWindowOverride` and `samplingPresetName` to base `ExecutionParams` after `ExecutionParamsBuilder` produces them, keeping override-resolution logic out of individual executor classes.

## Requirements

### Requirement: ExecutionParamsEnricher centralises conversation-level override application
The system SHALL provide a class `ExecutionParamsEnricher` in `src/bun/engine/execution/execution-params-enricher.ts`. It SHALL be injected into all executor classes (`TransitionExecutor`, `HumanTurnExecutor`, `RetryExecutor`, `ChatExecutor`) and called to apply `contextWindowOverride` and `samplingPresetName` to base `ExecutionParams` after the builder produces them.

`ExecutionParamsEnricher.enrich(base, ctx)` SHALL accept:
- `base: ExecutionParams` — params from `ExecutionParamsBuilder`
- `ctx.workspaceKey: string`
- `ctx.conversationId: number`
- `ctx.columnPreset?: string` — the column's `sampling_preset` value (if any)
- `ctx.engineId: string` — used to determine whether to load `contextWindowOverride`

It SHALL return a new `ExecutionParams` object (not mutate the input) with `contextWindowOverride` and `samplingPresetName` populated according to their respective resolution chains.

#### Scenario: Enricher applies conversation override when set
- **WHEN** `enrich()` is called and `conversations.sampling_preset_override` is non-null
- **THEN** the returned params have `samplingPresetName` equal to the stored override, ignoring `ctx.columnPreset`

#### Scenario: Enricher falls back to column preset when no override
- **WHEN** `enrich()` is called and `conversations.sampling_preset_override` is NULL
- **THEN** the returned params have `samplingPresetName` equal to `ctx.columnPreset` (or `undefined` if that is also absent)

#### Scenario: Enricher applies contextWindowOverride
- **WHEN** `enrich()` is called and `ModelSettingsRepository` returns a context window override for the workspace+model combination
- **THEN** the returned params have `contextWindowOverride` populated

#### Scenario: Enricher does not mutate base params
- **WHEN** `enrich()` is called
- **THEN** the original `base` object is unchanged and the returned object is a new instance

### Requirement: All executors delegate override application to ExecutionParamsEnricher
`TransitionExecutor`, `HumanTurnExecutor`, `RetryExecutor`, and `ChatExecutor` SHALL NOT directly read from `ModelSettingsRepository` or `ConversationRepository` to apply `contextWindowOverride` or `samplingPresetName`. Each SHALL call `ExecutionParamsEnricher.enrich()` after calling `ExecutionParamsBuilder`.

#### Scenario: HumanTurnExecutor passes samplingPresetName via enricher
- **WHEN** `HumanTurnExecutor` executes for a task in a column with `sampling_preset: "precise"`
- **THEN** the enricher is called with `ctx.columnPreset = "precise"` and the resulting params contain `samplingPresetName: "precise"`

#### Scenario: RetryExecutor passes samplingPresetName via enricher
- **WHEN** `RetryExecutor` executes for a task in a column with `sampling_preset: "balanced"`
- **THEN** the enricher is called with `ctx.columnPreset = "balanced"` and the resulting params contain `samplingPresetName: "balanced"`

#### Scenario: TransitionExecutor uses enricher instead of inline spread
- **WHEN** `TransitionExecutor` builds params for a column with `sampling_preset: "creative"`
- **THEN** `ExecutionParamsEnricher.enrich()` is used to apply `samplingPresetName` (not inline spread)
