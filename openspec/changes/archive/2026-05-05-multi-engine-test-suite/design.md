## Context

The `multi-engine-workspace-support` feature introduces new production modules with no existing test coverage. The test suite itself has two architectural concerns:

1. **Test infrastructure refactoring** — `BackendRpcRuntime` currently constructs `EngineRegistry` internally via `fromFixed()`. The production `fromFixed()` is being removed; tests must inject a fully-constructed registry instead.
2. **Cross-engine injection testability** — `CrossEngineContextInjector.prepareSwitch()` receives the source engine directly (executor does the lookup). This makes unit testing trivial — no registry needed.

The `model-resolver.test.ts` file (1 byte, empty) is deleted as cleanup. Existing `engine-registry.test.ts` tests the old lazy-factory API and is fully replaced.

## Goals / Non-Goals

**Goals:**
- Full unit coverage of `QualifiedModelId`, `engines.yaml` loader, `EngineRegistry` routing, and `CrossEngineContextInjector` trigger/compaction logic
- Integration coverage of two-engine execution routing and context injection flow via in-memory DB
- Playwright coverage of model picker grouping and OpenCode model ID persistence
- Refactor `BackendRpcRuntime` to accept injected `EngineRegistry` (DIP-compliant)
- Extend `setupTestConfig()` to write `engines.yaml` alongside `workspace.yaml`

**Non-Goals:**
- Testing OpenCode HTTP daemon (covered by `opencode-engine-tests` change)
- Mutation testing (separate workflow)
- Performance tests

## Decisions

### TD1: `BackendRpcRuntime` accepts injected `EngineRegistry`

**Decision**: Remove the `createEngine` callback from `BackendRpcRuntime`. Replace with an `engineRegistry: EngineRegistry` parameter. Add `makeRegistry(engine, configGetter)` convenience helper in `helpers.ts` for single-engine test cases.

```typescript
// helpers.ts — convenience for existing single-engine test files
export function makeRegistry(engine: ExecutionEngine, getConfig: ...) {
  return new EngineRegistry(new Map([[engine.id ?? "copilot", engine]]), getConfig);
}

// BackendRpcRuntime options (new signature)
interface RuntimeOptions {
  engineRegistry: EngineRegistry;
  // ...rest unchanged
}
```

**Rationale**: DIP — the runtime depends on the `EngineRegistry` interface, not on how it's built. Multi-engine integration tests pass a `new Map([[...], [...]])` registry directly. Single-engine tests use `makeRegistry()`. No special production paths.

**Migration**: Only `BackendRpcRuntime` and its callers need updating. `fromFixed()` is deleted from `EngineRegistry`.

### TD2: `setupTestConfig()` gains optional `enginesYaml` param

**Decision**: `setupTestConfig()` accepts `enginesYaml?: string` and, when provided, writes it as `engines.yaml` to the same temp `configDir` that `RAILYN_CONFIG_DIR` points to.

```typescript
setupTestConfig({
  enginesYaml: `
engines:
  - id: copilot
    type: copilot
    model: gpt-4.1
  - id: claude
    type: claude
    model: claude-sonnet-4-5
`})
```

**Rationale**: Zero new production paths. Config loader already reads `RAILYN_CONFIG_DIR`. The helper just writes the file; `loadEnginesConfig()` picks it up naturally.

### TD3: `CrossEngineContextInjector` receives `sourceEngine` directly

**Decision**: `prepareSwitch()` signature is:
```typescript
prepareSwitch(
  conversationId: number,
  targetQmid: QualifiedModelId,
  db: Database,
  sourceEngine: ExecutionEngine | null
): Promise<string | undefined>
```

The executor looks up `sourceEngine = registry.getEngineById(lastEngineType)` and passes it in. The injector never imports `EngineRegistry`.

**Rationale**: ISP + testability — injector tests pass mock engines directly. No registry dependency in `cross-engine-context.ts`. Executor already has the registry reference.

### TD4: Model picker Playwright tests extend existing `mock-api.ts` MODELS fixtures

**Decision**: `model-picker-multi-engine.spec.ts` defines its own `MULTI_ENGINE_MODELS` constant with copilot + claude + opencode entries. No changes to the shared `mock-data.ts` — grouping is frontend-only logic.

**Rationale**: Avoids changing test fixtures shared by `model-persistence.spec.ts`. The new spec is self-contained.

### TD5: `engine-registry.test.ts` is deleted and replaced

**Decision**: Delete `src/bun/test/engine-registry.test.ts`. Create `src/bun/test/engine-registry-multi.test.ts` that tests the new Map-based API from scratch.

**Rationale**: Old tests cover `fromFixed()` and lazy factory — both gone. Renaming avoids confusion; a fresh file documents the new API contract clearly.

## Risks / Trade-offs

- **`BackendRpcRuntime` callers**: Every test file that calls `createBackendRpcRuntime()` needs updating to pass `engineRegistry` instead of `createEngine`. This is ~6 files. Mechanical change but spread across the test suite.
- **`initDb()` DDL gap**: `initDb()` in `helpers.ts` has hardcoded DDL without the `last_engine_type` column. This must be updated alongside the migration file, or cross-engine context tests will fail with a schema mismatch. The `cross-engine-context.test.ts` relies on this column existing.
- **Playwright mock for multi-engine**: `models.listEnabled` in `mock-api.ts` returns a flat list. Grouping is done client-side. The Playwright tests are not sensitive to the mock shape — just need `id` to contain the engine prefix for the frontend grouping logic to work.
