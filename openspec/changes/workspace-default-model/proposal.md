## Why

Today there is no way to set a default AI model at the workspace level — every task gets `null` on column entry (unless the column declares its own `model`), which forces the user to manually pick a model for each task. Adding a workspace-level `default_model` field provides a single place to configure the fallback model used across all boards and tasks.

## What Changes

- A new optional `default_model` field is added to `workspace.yaml` (fully-qualified ID format: `providerId/modelId`).
- When a task enters a column that has no `model` field, the engine sets the task's model to the workspace `default_model` instead of `null`.
- The workspace config type, loader, and sample YAML are updated accordingly.
- The model-selection resolution chain becomes: column model → workspace default model → null.

## Capabilities

### New Capabilities

_(none — this is a configuration extension, not a new standalone capability)_

### Modified Capabilities

- `workspace`: New `default_model` field added to `WorkspaceYaml` schema and loaded config.
- `model-selection`: Resolution chain updated — column model takes precedence, falls back to workspace `default_model`, then `null`.

## Impact

- `src/bun/config/index.ts` — `WorkspaceYaml` interface and `loadConfig` function.
- `config/workspace.yaml.sample` — document the new field.
- `src/bun/workflow/engine.ts` (or wherever column transition sets `task.model`) — apply fallback logic.
- No database schema changes required.
- No frontend changes required (the model is already persisted and displayed correctly).
