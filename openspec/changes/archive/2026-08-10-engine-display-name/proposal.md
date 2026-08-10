## Why

Engine display names in Railyin's workspace setup page come from two disconnected sources: a hardcoded `ENGINE_LABELS` map in the frontend and raw engine IDs. There is no way for users to assign a custom display name to an engine in `engines.yaml`. The same issue affects the model picker dropdown in conversations, where raw engine IDs (e.g. "pi-local") appear as group headers instead of human-friendly names.

## What Changes

- Add an optional `name` field to engine entries in `engines.yaml`
- Propagate `name` through the backend config pipeline to the frontend via `WorkspaceConfig.availableEngines`
- Use `name` as the primary display label in the workspace setup engine checkboxes (fallback to existing `ENGINE_LABELS[type]`, then `id`)
- Use `name` as the group header label in the conversation model picker dropdown (fallback to `engineId`)
- Document the new `name` field in `config/engines.yaml.sample`

## Capabilities

### New Capabilities
- `engine-display-name`: Engine entries in `engines.yaml` can declare an optional `name` field that is surfaced as the human-readable display label in the workspace setup page and the conversation model picker.

### Modified Capabilities
- None — no existing spec-level requirements change; this adds a new capability.

## Impact

- **`engines.yaml`**: New optional `name` field on engine entries (backward compatible)
- **`src/bun/config/index.ts`**: `RawEngineYamlEntry`, `EngineEntry` types extended; `loadEnginesConfig()` extracts and passes `name`
- **`src/shared/rpc-types.ts`**: `WorkspaceConfig.availableEngines` type extended
- **`src/bun/handlers/workspace.ts`**: RPC handler includes `name` in mapped output
- **`src/mainview/views/SetupView.vue`**: `engineLabel()` function updated to use `engine.name` with fallback chain
- **`src/mainview/components/ConversationInput.vue`**: Model picker group headers use engine name
- **`config/engines.yaml.sample`**: Documentation for the new `name` field
