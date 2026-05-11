## Why

Engine configuration is split across two files with overlapping semantics. `workspace.yaml` carries an `engine: { type, model }` block that predates `engines.yaml`, and the loader keeps both branches alive with fallback logic, precedence warnings, and a backward-compat `engine` field on `LoadedConfig`. The result: two ways to declare an engine, three ways to read the resolved engine in handlers, and conditional code paths whose only purpose is to keep the legacy block working.

`engines.yaml` is already the right place to declare engines — it supports multiple instances, lives at the right scope, and the model picker already drives off it. The only thing `workspace.yaml` actually needs to express is *which model is the workspace default*. That fits in a single string.

## What Changes

- **BREAKING**: Remove the `engine:` block from `workspace.yaml`. The config loader errors at startup if it is present.
- **BREAKING**: Make `engines.yaml` mandatory. The loader errors at startup if absent. All fallback branches in the loader are deleted.
- Add a `default_model: <engineId>/<modelId>` field to `workspace.yaml` (fully-qualified single string). Engine ID is derived from the prefix; no separate `engine.type` is needed.
- Delete `LoadedConfig.engine` (the resolved-single-engine field). All read sites switch to either `engines[0]` or registry-based lookup keyed off the conversation's qualified model.
- Repurpose the existing `WorkspaceYaml.default_model` field (currently `@deprecated`) as the canonical workspace default model. The native-engine `default_model` semantics — which were already non-functional — are gone.
- `workspace.update` RPC: replace `engineModel: string` with `defaultModel: string`. The handler writes `default_model` directly to YAML; the prefix-derives-engine-type logic disappears.
- `WorkspaceConfig` RPC type: replace `engine: { model? }` with `defaultModel: string | null`.
- `models.list` and `models.setEnabled` are unchanged. The `enabled_models` DB table stays.
- Sample configs (`workspace.yaml.sample`, `engines.yaml.sample`) updated to the new schema with no commented-out fallback examples.
- All test fixtures (`setupTestConfig`, `config/workspace.test.yaml`, e2e fixtures) write the new schema. `setupTestConfig` writes a default `engines.yaml` when none is provided.

## Capabilities

### Modified Capabilities

- `engines-config`: `engines.yaml` is mandatory; the backward-compat fallback to `workspace.yaml engine:` is removed.
- `workspace`: workspace YAML no longer holds an `engine:` block; the workspace default model is declared via `default_model` as a fully-qualified string.

## Impact

- `src/bun/config/index.ts` — delete `WorkspaceYaml.engine`, delete `LoadedConfig.engine`, delete `mergeWorkspaceDefaults` engine branch, delete `patchWorkspaceYaml` engine deep-merge, delete `loadEnginesConfig`'s `workspaceEngine` parameter and precedence warning, rewrite the engine-resolution block in `loadConfig` to error on `engine:` and require `engines.yaml`, repurpose `default_model` as canonical.
- `src/bun/handlers/workspace.ts` — `workspace.update` writes `default_model` directly; `workspace.getConfig` returns `defaultModel`.
- `src/bun/handlers/tasks.ts`, `src/bun/handlers/chat-sessions.ts` — replace `config.engine.type` / `config.engine.model` reads with registry lookup or `engines[0]` reads.
- `src/bun/engine/execution/model-resolver.ts` — drop the first-engine-model fallback; `default_model` is now the only source.
- `src/shared/rpc-types.ts` — `WorkspaceConfig.engine → defaultModel`; `workspace.update.params.engineModel → defaultModel`.
- `src/mainview/views/SetupView.vue`, `src/mainview/stores/workspace.ts` — rename `engineModel` → `defaultModel`; load from `cfg.defaultModel`.
- `config/workspace.yaml.sample`, `config/engines.yaml.sample` — new schema, no fallback notes.
- `src/bun/test/helpers.ts` — `setupTestConfig` writes a default one-engine `engines.yaml` and emits `default_model` instead of an `engine:` block; rename param from `engineModel` to `defaultModel`.
- `config/workspace.test.yaml`, `src/bun/test/project-registration-paths.test.ts`, `e2e/api/fixtures/server.ts`, `e2e/ui/fixtures/mock-data.ts` — updated fixtures.
- `src/bun/test/engines-config.test.ts` — delete EC-3, EC-7, EC-8 (fallback cases); add coverage for the new error paths and `default_model` resolution.
- `openspec/specs/engines-config/spec.md`, `openspec/specs/workspace/spec.md` — delta updates aligned with this change.
