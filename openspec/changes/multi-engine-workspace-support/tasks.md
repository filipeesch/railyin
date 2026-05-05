## 1. Foundation — Value Object & DB Migration

- [ ] 1.1 Create `src/bun/engine/qualified-model-id.ts` — `QualifiedModelId` class with `parse()`, `nativeModelId()`, `toString()`, and validation
- [ ] 1.2 Add DB migration `src/bun/db/migrations/041_last_engine_type.ts` — `ALTER TABLE conversations ADD COLUMN last_engine_type TEXT NULL`

## 2. Config — engines.yaml Loading

- [ ] 2.1 Add `OpenCodeEngineConfig.providers` and `allowed_engines` field support to `src/bun/config/index.ts`; add `LoadedConfig.engines: EngineConfig[]` and `LoadedConfig.allowedEngineIds: string[] | null`
- [ ] 2.2 Implement `loadEnginesConfig(dir)` in `src/bun/config/index.ts` — parses `engines.yaml`, falls back to `workspace.yaml engine:` block when file is absent
- [ ] 2.3 Create `config/engines.yaml.sample` with all three engine types documented; update `config/workspace.yaml.sample` to document `allowed_engines`

## 3. Engine Registry — Multi-Engine Routing

- [ ] 3.1 Refactor `src/bun/engine/engine-registry.ts` — replace `Map<workspaceKey, ExecutionEngine>` with `Map<engineId, ExecutionEngine>`; add `getEngineForModel(workspaceKey, qmid)`, `listAllEngines(workspaceKey)`, `getDefaultEngine(workspaceKey)`; remove `fromFixed()` static helper
- [ ] 3.2 Delete `src/bun/engine/resolver.ts`; move engine construction to `src/bun/index.ts` as a `EngineFactoryMap` (DI pattern); wire `buildEngineInstances(engines, factories, notifiers)` before registry construction

## 4. OpenCode — Model ID Namespacing

- [ ] 4.1 Update `src/bun/engine/opencode/adapter.ts` `listModels()` to wrap every returned ID as `opencode/{providerId}/{modelId}`

## 5. Executors — Route by QualifiedModelId

- [ ] 5.1 Update all five executors in `src/bun/engine/execution/` — replace `registry.getEngine(workspaceKey)` with `registry.getEngineForModel(workspaceKey, QualifiedModelId.parse(model))`
- [ ] 5.2 Update `src/bun/engine/execution/model-resolver.ts` — `seedConversationModel()` seeds from `defaultEngine` (first in `engines.yaml`) and its configured `model`
- [ ] 5.3 Update `src/bun/engine/orchestrator.ts` — `listModels()` aggregates across `registry.listAllEngines(workspaceKey)`; `compactConversation()` routes via `getEngineForModel()`

## 6. Cross-Engine Context Injection

- [ ] 6.1 Create `src/bun/conversation/cross-engine-context.ts` — `CrossEngineContextInjector` with `prepareSwitch()`: detects engine change via `last_engine_type`, fetches messages since last compaction anchor, estimates tokens, optionally compacts source engine, returns formatted context block
- [ ] 6.2 Wire `CrossEngineContextInjector` into the transition and human-turn executors — call `prepareSwitch()` before `engine.execute()`, prepend result to `systemInstructions`; update `last_engine_type` in DB after execution

## 7. Frontend — Multi-Engine Model Picker

- [ ] 7.1 Update `src/shared/rpc-types.ts` — extend `WorkspaceConfig` to include available engines and their models
- [ ] 7.2 Update `src/mainview/stores/workspace.ts` — consume multi-engine model list; group models by engine then provider in the picker

## 8. Cleanup

- [ ] 8.1 Remove `EngineRegistry.fromFixed()` static helper and update all test usages to pass `Map<engineId, ExecutionEngine>` directly to the constructor
- [ ] 8.2 Audit all remaining `getEngine(workspaceKey)` call sites and replace with `getEngineForModel()` or `getDefaultEngine()` as appropriate
