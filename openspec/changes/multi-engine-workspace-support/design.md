## Context

Railyin currently supports three AI engines: Copilot, Claude, and OpenCode. Each workspace is restricted to exactly one engine, configured via `engine:` in `workspace.yaml`. The `EngineRegistry` maintains a `Map<workspaceKey, ExecutionEngine>` and lazily creates one engine per workspace using `resolveEngine()` — a factory function that `new`s concrete engine classes via `if/else if` chains.

This single-engine constraint prevents users from choosing a model from a different engine per task, mixing local LLMs (OpenCode/Ollama) with cloud engines, or switching engines mid-conversation. The goal is to remove that constraint cleanly, without breaking existing workspace configs.

## Goals / Non-Goals

**Goals:**
- Support multiple engines per workspace simultaneously, configured in a new global `engines.yaml`
- `QualifiedModelId` value object that encodes `{engineId}/{providerId?}/{modelId}` — all routing layers above the engine tier treat it as opaque
- Engine instances are singletons: one per `engines.yaml` entry, shared across all workspaces
- `EngineRegistry` routes executions to the correct engine by parsing `QualifiedModelId.engineId` — no knowledge of Copilot/Claude/OpenCode internals
- Cross-engine context injection: when the active engine changes mid-conversation, DB messages since the last compaction anchor are prepended to the new engine's first turn
- Pre-switch compaction: if estimated token usage exceeds 75% of target model's context window, compact the source engine before switching
- Workspace `allowed_engines` optional filter; absent = all engines available
- Full backward compatibility: `engines.yaml` absent → fall back to `engine:` block in `workspace.yaml`

**Non-Goals:**
- Per-project engine configuration (workspace-level only, v1)
- Persistent cross-engine session resumption (always fresh session on engine switch)
- UI settings panel for managing `engines.yaml` (config-file only, v1)
- Changing the OpenCode singleton design beyond what's described here
- Exposing raw OpenCode provider IDs to UI without the `opencode/` namespace prefix

## Decisions

### D1: `QualifiedModelId` value object

**Decision**: Introduce `src/bun/engine/qualified-model-id.ts` with a `QualifiedModelId` class.

Format: `{engineId}/{providerId?}/{modelId}`
- 2-part: `copilot/gpt-4.1` → engine=`copilot`, model=`gpt-4.1`
- 2-part: `claude/claude-sonnet-4-5` → engine=`claude`, model=`claude-sonnet-4-5`
- 3-part: `opencode/anthropic/claude-sonnet-4-5` → engine=`opencode`, provider=`anthropic`, model=`claude-sonnet-4-5`

`nativeModelId()` returns what the engine itself expects:
- Copilot/Claude → `modelId` alone
- OpenCode → `providerId/modelId` (its native format)

All executors, orchestrator, and model-resolver pass `QualifiedModelId` instances; none inspect `.engineId` or `.providerId`.

**Rationale**: Prevents scattered `split('/')` logic, localises format knowledge, and makes routing changes safe. Opaqueness above the registry keeps all layers engine-agnostic.

**Alternative considered**: Colon separator (`copilot:gpt-4.1`). Rejected for v1 — would require a DB migration to rewrite all existing `conversations.model` values.

### D2: `engines.yaml` is global; workspace declares `allowed_engines` only

**Decision**: `config/engines.yaml` is a single global file declaring all engine instances. Workspaces optionally declare `allowed_engines: [id, ...]` to restrict visibility. Engine instances are constructed once at startup from `engines.yaml` and shared across all workspaces.

```yaml
# config/engines.yaml
engines:
  - id: copilot
    type: copilot
    model: gpt-4.1
  - id: claude
    type: claude
    model: claude-sonnet-4-5
  - id: opencode
    type: opencode
    model: anthropic/claude-sonnet-4-5
    providers:
      anthropic:
        api_key: ${ANTHROPIC_API_KEY}
```

**Rationale**: Engines have process-level lifecycle (Copilot/Claude spawn subprocesses; OpenCode starts an HTTP server). Creating them once is correct. Workspaces don't own engines — they just filter which ones are visible.

**Alternative considered**: Per-workspace engine instances. Rejected — wastes resources, contradicts OpenCode's `?directory=` design, and complicates shutdown.

### D3: Engine factory via dependency injection; `resolver.ts` deleted

**Decision**: Concrete engine construction moves to the composition root (`src/bun/index.ts`) as a `EngineFactoryMap: Record<string, EngineFactory>`. `EngineRegistry` receives already-constructed instances (`Map<engineId, ExecutionEngine>`). `resolver.ts` is deleted.

```typescript
// index.ts (composition root)
const engineFactories: EngineFactoryMap = {
  copilot:  (cfg, n) => new CopilotEngine(...),
  claude:   (cfg, n) => new ClaudeEngine(...),
  opencode: (cfg, n) => new OpenCodeEngine(...),
  scripted: ()       => new MockExecutionEngine(),
};
const instances = buildEngineInstances(loadedEngines, engineFactories, notifiers);
const registry = new EngineRegistry(instances, getWorkspaceConfig);
```

**Rationale**: `EngineRegistry` becomes engine-agnostic (imports zero concrete classes). Open/closed: adding a 4th engine = add one factory entry. Tests inject a fully-constructed `EngineRegistry` via DI; a `makeRegistry()` test helper wraps the common single-engine case. `fromFixed()` is deleted from production code.

### D4: `EngineRegistry` multi-engine API

**Decision**: Registry holds `Map<engineId, ExecutionEngine>`. New API:
- `getEngineForModel(workspaceKey, qmid)` → parses `qmid.engineId`, checks `allowed_engines`, returns engine or falls back to default
- `listAllEngines(workspaceKey)` → returns engines filtered by `allowed_engines` (for `listModels()` aggregation)
- `getDefaultEngine(workspaceKey)` → first engine in `engines.yaml` order

**Alternative considered**: Keep lazy factory. Rejected — engines are now singletons; lazy creation no longer needed.

### D5: Cross-engine context injection via `CrossEngineContextInjector`

**Decision**: New module `src/bun/conversation/cross-engine-context.ts`.

Trigger: before each execution, compare `conversations.last_engine_type` with `QualifiedModelId.engineId`. If different → inject.

The executor is responsible for looking up the source engine from the registry (`registry.getEngineById(lastEngineType)`) and passing it directly to the injector. The injector never imports `EngineRegistry`.

```
// Executor (calls the injector):
const sourceEngine = lastEngineType ? registry.getEngineById(lastEngineType) : null;
const contextBlock = await injector.prepareSwitch(conversationId, targetQmid, db, sourceEngine);

// CrossEngineContextInjector.prepareSwitch(conversationId, targetQmid, db, sourceEngine):
  1. Load last_engine_type from DB — if null or same as target, return undefined
  2. Fetch messages from last compaction_summary anchor (same logic as compactMessages())
  3. Estimate tokens via ContextEstimator vs target contextWindow
  4. If > 75% AND sourceEngine?.compact → await compact(); re-fetch messages
     If > 75% AND no compact (Claude / null) → proceed with warning
  5. Format as "## Context from previous conversation\n<turns>"
  6. Return as string to prepend to systemInstructions
After execution: UPDATE conversations SET last_engine_type = engineId
```

**Rationale**: ISP compliance — the injector receives only what it needs (`ExecutionEngine | null`) and never depends on `EngineRegistry`. This makes unit testing trivial (pass mock engines directly). The executor already has the registry reference, so the lookup is free.

**Note on Claude**: `ClaudeEngine` has no explicit `compact()` method (auto-compacts internally). If over threshold on a Claude→X switch, we proceed without pre-compaction and log a warning.

### D6: OpenCode model IDs wrapped with `opencode/` prefix

**Decision**: `DefaultOpenCodeSdkAdapter.listModels()` wraps every returned model ID as `opencode/{providerId}/{modelId}`. The registry strips the `opencode/` prefix before passing `nativeModelId()` to the engine.

**Rationale**: OpenCode's native format is `{providerId}/{modelId}` which collides with potential Copilot/Claude prefixes (e.g., `anthropic/claude-sonnet` could be Claude engine or OpenCode+Anthropic provider). Wrapping makes `QualifiedModelId` parsing unambiguous without extra config.

### D7: New DB column `conversations.last_engine_type`

**Decision**: `ALTER TABLE conversations ADD COLUMN last_engine_type TEXT NULL` (migration `041_last_engine_type.ts`). `NULL` = never executed; no injection on the very first turn.

## Risks / Trade-offs

- **Context truncation on switch**: If source engine conversation is large and has no `compact()` (Claude), the injected context block may itself be large. Mitigation: the 75% threshold uses the *target* model's window; if Claude is the source, we skip compaction but still respect the window estimate — worst case the new engine sees a truncated history summary.
- **Backward compat drift**: `engine:` in `workspace.yaml` creates an implicit single-entry `engines.yaml` config. If a user has both files, `engines.yaml` wins. This must be clearly documented.
- **OpenCode singleton shared across workspaces**: All workspaces using `opencode` share one HTTP server. Provider config is global. If two users need different Anthropic API keys per-workspace, they cannot — this is an accepted v1 limitation.
- **`last_engine_type` staleness**: If a conversation was manually modified in DB (rare), `last_engine_type` could be stale. Mitigation: the injected block is read-only context — worst case is redundant injection, not data corruption.
- **`fromFixed()` removal**: `EngineRegistry.fromFixed()` is deleted. Tests inject a fully-constructed `EngineRegistry` via DI. A `makeRegistry()` test helper in `helpers.ts` covers the single-engine case. Migration touches `BackendRpcRuntime` (one call site) and is isolated to the test-suite change.

## Migration Plan

1. Ship `041_last_engine_type.ts` migration — additive, no data loss.
2. `engines.yaml` is optional at launch — existing `workspace.yaml`-only configs continue to work unchanged.
3. `config/engines.yaml.sample` and updated `workspace.yaml.sample` document the new surface.
4. `resolver.ts` deletion is safe once all callers switch to `EngineRegistry.getEngineForModel()`.

**Rollback**: Remove `engines.yaml`, ensure `workspace.yaml` has `engine:` block. Registry falls back to single-engine path. `last_engine_type` column is nullable — old code ignores it gracefully.

## Open Questions

- Should `last_engine_type` be indexed? Only one row per conversation is updated per execution — a table scan on `conversationId` (already PK) is sufficient. No index needed.
- Should `listModels()` on the orchestrator cache results across engines to avoid redundant HTTP calls? Deferred to a follow-up; not blocking for v1.
