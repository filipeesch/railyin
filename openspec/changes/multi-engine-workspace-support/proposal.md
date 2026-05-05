## Why

Today each workspace is locked to a single AI engine (Copilot, Claude, or OpenCode). Users cannot switch engines per-conversation or have multiple engines available simultaneously, which prevents them from mixing local LLM access (OpenCode/Ollama) with cloud engines on the same board. This also blocks context-aware cross-engine switching, a prerequisite for letting users select the right model for each task.

## What Changes

- **New `engines.yaml` global config file** — declares all available engine instances with their settings; replaces the single `engine:` block in `workspace.yaml` as the primary engine configuration surface.
- **`allowed_engines` field in `workspace.yaml`** — optional workspace-level filter; when omitted all engines from `engines.yaml` are available.
- **`QualifiedModelId` value object** — encapsulates the `{engineId}/{providerId?}/{modelId}` format used to unambiguously route model IDs across engines; all layers above the engine tier treat it as opaque.
- **Multi-engine `EngineRegistry`** — accepts pre-constructed engine instances (one per `engines.yaml` entry) and routes by `QualifiedModelId.engineId`; replaces the lazy per-workspace factory.
- **`resolveEngine()` replaced by DI factory map** — concrete engine construction moves to the composition root (`index.ts`); `resolver.ts` is deleted; `EngineRegistry` imports no engine classes.
- **Cross-engine context injection** — new `CrossEngineContextInjector` module that, when the active engine changes mid-conversation, fetches DB messages since the last compaction anchor and prepends them as a formatted context block to the next turn's `systemInstructions`.
- **Pre-switch compaction** — before injecting context into a new engine, estimate token usage; if above 75% of the target model's `contextWindow`, trigger `compact()` on the source engine first (waking the session if needed).
- **`conversations.last_engine_type` DB column** — tracks which engine ran last per conversation; drives injection trigger.
- **`listModels()` merges across all engines** — orchestrator aggregates model lists from all workspace-allowed engines; OpenCode adapter wraps model IDs with `opencode/` prefix.
- **Backward compatibility** — if `engines.yaml` is absent, the existing `engine:` block in `workspace.yaml` is used as a single-engine fallback; all existing configs continue to work.

## Capabilities

### New Capabilities
- `engines-config`: Global `engines.yaml` configuration file — schema, loading, validation, and backward-compat fallback from `workspace.yaml`.
- `multi-engine-registry`: `EngineRegistry` multi-engine routing by `QualifiedModelId`; engine factory DI; singleton engine instances shared across workspaces.
- `qualified-model-id`: `QualifiedModelId` value object — parse, route, and extract native model ID; format: `{engineId}/{providerId?}/{modelId}`.
- `cross-engine-context-injection`: `CrossEngineContextInjector` — detects engine switches via `last_engine_type`, estimates token budget, optionally compacts source engine, injects DB history into new engine's first turn.

### Modified Capabilities
- `execution-engine`: `compact?()` and `listModels()` contracts extended; OpenCode `listModels()` wraps IDs with `opencode/` prefix.
- `engine-registry-behavior`: Registry now holds `Map<engineId, ExecutionEngine>` (was `Map<workspaceKey, ExecutionEngine>`); API changes to `getEngineForModel(workspaceKey, qmid)` and `listAllEngines(workspaceKey)`.
- `model-selection`: Model picker aggregates models from all workspace-allowed engines; model IDs use qualified format.
- `workspace`: `allowed_engines` optional field added; `engine:` block retained for backward compat only.

## Impact

**Backend:**
- `src/bun/config/index.ts` — add `engines.yaml` loading, `LoadedConfig.engines[]`, backward-compat fallback
- `src/bun/engine/engine-registry.ts` — multi-engine map, new routing API
- `src/bun/engine/resolver.ts` — **deleted**; logic moves to `index.ts` factory map
- `src/bun/engine/execution/*-executor.ts` (5 files) — switch from `getEngine()` to `getEngineForModel()`
- `src/bun/engine/execution/model-resolver.ts` — seed from `defaultEngine` in `engines.yaml`
- `src/bun/engine/orchestrator.ts` — `listModels()` aggregates across engines
- `src/bun/engine/opencode/adapter.ts` — `listModels()` wraps IDs with `opencode/` prefix
- `src/bun/conversation/cross-engine-context.ts` — **new file**
- `src/bun/db/migrations/041_last_engine_type.ts` — **new migration**
- `src/bun/engine/qualified-model-id.ts` — **new file**

**Config:**
- `config/engines.yaml.sample` — **new file**
- `config/workspace.yaml.sample` — document `allowed_engines`

**Frontend:**
- `src/shared/rpc-types.ts` — update `WorkspaceConfig` to expose available engines/models
- `src/mainview/stores/workspace.ts` — consume multi-engine config for model picker
