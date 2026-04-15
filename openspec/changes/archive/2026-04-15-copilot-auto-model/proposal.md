## Why

Copilot model selection currently exposes only concrete models, which forces users to pin a model even when they want Copilot to choose dynamically. We need an explicit Auto option so users can intentionally opt into Copilot-managed model selection.

## What Changes

- Add a first-class `Auto` model option for Copilot model selection.
- Represent `Auto` as `null` model identity (no pinned model) instead of a synthetic provider/model string.
- Show user-facing description explaining that Copilot chooses the best available model based on context, availability, and subscription access.
- Ensure model-listing, enabled-model filtering, persistence, and execution flows handle nullable model IDs safely.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `model-selection`: Allow and render an explicit Auto option with null identity in the model picker and selection pipeline.
- `copilot-engine`: Treat null model as intentional Auto behavior by omitting model from SDK session config and documenting behavior.

## Impact

- Backend engine model metadata and Copilot model list mapping.
- Shared model typing across engine, handlers, and RPC model payloads.
- Task detail model selector behavior and empty/enabled filtering semantics.
- Tests covering model listing and selection with nullable model IDs.
