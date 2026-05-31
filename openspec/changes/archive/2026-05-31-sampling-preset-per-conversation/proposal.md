## Why

Sampling presets for the Pi engine are currently set globally (engine default) or per workflow column, but there is no way for a user to manually choose a preset for a specific task or chat session. Users working with different kinds of tasks — quick feedback vs. deep reasoning — need to switch presets without modifying YAML config. Once manually set, the override must survive column transitions so the user's intent is respected across the task lifecycle.

## What Changes

- Add `sampling_preset_override TEXT NULL` to the `conversations` table (single migration covers both tasks and chat sessions, since both have a `conversation_id`).
- Introduce `ExecutionParamsEnricher` — a new focused class that owns applying conversation-level overrides (`contextWindowOverride`, `samplingPresetName`) to execution params. Replaces duplicated inline spread logic across all four executors.
- Extend `ModelInfo.availablePresets` to surface Pi engine preset names and their parameter values to the frontend.
- Add `conversations.setSamplingPreset` RPC method to persist the user's choice.
- Add a preset `Select` dropdown in `ConversationInput.vue`, rendered only when the active model's engine is `pi`. Shows "Auto" (NULL) as the default, plus all named presets with their parameters visible in the opened option rows.
- Update resolution chain in all executors: conversation override → column preset → engine default.
- Fix existing gap: `HumanTurnExecutor` and `RetryExecutor` currently do not pass `column.sampling_preset` at all; the refactor corrects this as a side effect.

## Capabilities

### New Capabilities

- `conversation-sampling-preset`: Per-conversation sampling preset override — storing, persisting, and resolving a user-selected sampling preset that takes priority over column and engine defaults.
- `execution-params-enricher`: `ExecutionParamsEnricher` class that centralises applying conversation-level overrides (context window, sampling preset) to `ExecutionParams`, eliminating scattered inline spread code across executors.
- `sampling-preset-ui`: Frontend preset selector in `ConversationInput.vue` — Pi-only dropdown with "Auto" default, preset names and parameter details, wired to `conversations.setSamplingPreset`.

### Modified Capabilities

- `pi-sampling-presets`: Resolution chain gains a new first level — conversation override — before column preset and engine default.
- `engine-execution-params`: `ExecutionParamsBuilder` is no longer responsible for applying overrides; that moves to `ExecutionParamsEnricher`. Builder remains pure.

## Impact

- **DB**: New column on `conversations` table (migration 047).
- **Backend**: `ExecutionParamsEnricher` (new); `TransitionExecutor`, `HumanTurnExecutor`, `RetryExecutor`, `ChatExecutor` all simplified; `conversations` handler gets new RPC method; `models.listEnabled` handler extended.
- **Shared types**: `ModelInfo.availablePresets`, `Task.samplingPresetOverride`, `ChatSession.samplingPresetOverride`, new `conversations.setSamplingPreset` RPC entry.
- **Frontend**: `ConversationInput.vue` (new prop + conditional preset select), `TaskChatView.vue`, `SessionChatView.vue`.
- **No breaking changes** — existing column-level preset behaviour is fully preserved for users not setting a manual override.
