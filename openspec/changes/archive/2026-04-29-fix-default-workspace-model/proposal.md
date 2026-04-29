## Why

The workspace "Default model" setting (configured via Settings → Models and stored as `engine.model` in `workspace.yaml`) is saved correctly but silently ignored at execution time. New tasks are created with `model = NULL` and the executors (`TransitionExecutor`, `HumanTurnExecutor`, `RetryExecutor`) fall back to an empty string instead of `engine.model`, so every execution uses the engine's built-in default rather than the user's explicitly chosen workspace model.

## What Changes

- **`tasks.create` handler**: seed `task.model = engine.model` at creation time when `engine.model` is configured, so the model dropdown shows the correct value immediately after a task is created.
- **`TransitionExecutor`**: include `engine.model` in the model resolution chain (`column.model → task.model → engine.model → ""`).
- **`HumanTurnExecutor`**: same fallback; write the resolved value back to `task.model` in the DB if it was previously null.
- **`RetryExecutor`**: same fallback as HumanTurnExecutor.
- **`model-resolver.ts`** (new): extract a pure `resolveTaskModel(columnModel, taskModel, engineConfig)` utility consumed by all three executors — single source of truth for the resolution chain. The function uses `||` (not `??`) so empty strings fall through to the next source, identical to "not set". The `EngineConfig` union type is guarded via `"model" in engineConfig` to safely handle engine types without a `model` field.

## Capabilities

### New Capabilities

_(none)_

### Modified Capabilities

- `model-selection`: The model resolution priority chain (`column → task → engine.model → ""`) is not implemented correctly. Scenarios covering the workspace-default fallback and task-creation seeding need to be updated to use `engine.model` (the active engine config) rather than the legacy `default_model` field, and new scenarios covering `HumanTurnExecutor` / `RetryExecutor` fallback must be added.

## Impact

- **`src/bun/handlers/tasks.ts`** — `tasks.create` handler: conditional model seed
- **`src/bun/engine/execution/transition-executor.ts`** — use `resolveTaskModel`
- **`src/bun/engine/execution/human-turn-executor.ts`** — use `resolveTaskModel` + DB write-back
- **`src/bun/engine/execution/retry-executor.ts`** — use `resolveTaskModel` + DB write-back
- **`src/bun/engine/execution/model-resolver.ts`** — new pure utility (no side effects)
- **`openspec/specs/model-selection/spec.md`** — update scenarios to reflect `engine.model` as the workspace default source; add new scenarios for HumanTurn and Retry fallback
- No API surface changes, no DB schema changes, no frontend changes
