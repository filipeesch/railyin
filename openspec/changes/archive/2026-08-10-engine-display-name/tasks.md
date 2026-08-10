## 1. Backend — Config Layer

- [x] 1.1 Add `name?: string` to `RawEngineYamlEntry` interface in `src/bun/config/index.ts`
- [x] 1.2 Add `name?: string` to `EngineEntry` interface in `src/bun/config/index.ts`
- [x] 1.3 Extract `name` from raw entry in `loadEnginesConfig()` and pass it through to `EngineEntry`

## 2. Backend — RPC Handler

- [x] 2.1 Extend `WorkspaceConfig.availableEngines` type with `name?: string` in `src/shared/rpc-types.ts`
- [x] 2.2 Include `name` in the `.map()` call in `src/bun/handlers/workspace.ts` line 48

## 3. Frontend — SetupView

- [x] 3.1 Update `engineLabel()` function in `src/mainview/views/SetupView.vue` to use `engine.name ?? ENGINE_LABELS[engine.type] ?? engine.id`
- [x] 3.2 Update `engineLabel()` function signature to accept `name?: string` on the engine parameter type

## 4. Frontend — ConversationInput Model Picker

- [x] 4.1 Read `availableEngines` from the workspace store in `ConversationInput.vue`
- [x] 4.2 Build a `Map<engineId, engineName>` lookup for engine group headers
- [x] 4.3 Update `groupedModels` computed to use engine name (with fallback to engineId) for group headers

## 5. Documentation

- [x] 5.1 Add `name` field example to `config/engines.yaml.sample` for at least one engine entry
