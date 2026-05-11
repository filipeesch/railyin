## Context

Today the resolved engine for a workspace can come from three places:

1. `engines.yaml` — the canonical source (when present)
2. `workspace.yaml engine: { type, model }` — legacy fallback (warned about, but still parsed and merged)
3. `workspace.yaml default_model` — already-existing field marked `@deprecated` for "legacy native-engine"

`LoadedConfig` exposes a single `engine: EngineConfig` field that resolves these inputs in priority order. Handlers across the backend read either `config.engine.type` (`tasks.ts`, `chat-sessions.ts`) or `config.engine.model` (`workspace.ts:49`, `chat-sessions.ts:50`). The frontend `WorkspaceConfig.engine: { model? }` and the `workspace.update({ engineModel })` RPC mirror that shape — and the handler does a small "derive engine type from `model.split('/')[0]`" dance to translate the qualified ID back into the legacy `{ type, model }` block.

The `enabled_models` DB table is unrelated to this resolution and stays.

## Goals / Non-Goals

**Goals**
- Single declarative source of truth: `engines.yaml` for instance definitions, `workspace.yaml default_model` for the workspace default.
- Delete every legacy resolution branch (`workspace.engine`, fallback to `workspace.engine`, precedence warning, deep-merge in `mergeWorkspaceDefaults` and `patchWorkspaceYaml`).
- Cleaner runtime types: drop `LoadedConfig.engine`; consumers route through `engines[]` or the registry.
- Hard-fail at startup when the new schema is violated, with a clear migration message.

**Non-Goals**
- Moving `enabled_models` out of SQLite. The table and its handlers (`models.list`, `models.setEnabled`, `models.listEnabled`) stay exactly as they are.
- Adding `allowed_models` to engine entries.
- Migration tooling. This is a breaking change with a one-line migration users perform by hand (replace the `engine:` block with `default_model:`).
- Changes to `allowed_engines` semantics — that field stays.

## Decisions

### D1 — `default_model` is a single fully-qualified string

**Decision**: `workspace.yaml` exposes `default_model: <engineId>/<modelId>` (e.g. `copilot/claude-sonnet-4.6`). No separate engine type field. Engine selection derives from the prefix.

**Rationale**: The qualified-ID format already exists everywhere — `enabled_models.qualified_model_id`, conversation `model` columns, the model picker. Reusing it removes the redundant `engine.type` field and the prefix-derive dance in `workspace.update`. One string is also easier to surface in the UI as "the workspace default model" — a single picker entry.

**Alternative considered**: Keep an explicit `default_engine: copilot` plus `default_model: claude-sonnet-4.6`. Rejected: redundant when the model already encodes the engine in its prefix, and asks users to keep two fields in sync.

### D2 — `engines.yaml` is mandatory; no fallback

**Decision**: When `engines.yaml` is missing the loader returns a config error: *"engines.yaml is required. See config/engines.yaml.sample for an example."* No degraded-mode startup, no implicit single-engine synthesis.

**Rationale**: Every install already has `engines.yaml` (it's auto-created on first run via the existing `ensureConfigExists` flow extended to also write the engines sample). Keeping a fallback path means keeping a parallel codepath for one user — the cost is the entire branch in `loadConfig` plus the `workspaceEngine` parameter on `loadEnginesConfig`.

**Alternative considered**: Auto-synthesize a single `copilot` engine when `engines.yaml` is absent. Rejected: hides config from the user and re-introduces the very fallback we're deleting.

### D3 — Delete `LoadedConfig.engine`

**Decision**: Remove the field. Callers that need "the workspace default engine" use `config.engines[0]`; callers that need "the engine for this conversation/model" go through the registry's `resolveEngineForModel(workspaceKey, model)`.

**Rationale**: The `engine` field was a legacy shim from when only one engine existed per workspace. Today every read site is one of two shapes: "the default" (better expressed as `engines[0]`) or "the engine for this model" (better expressed via the registry, which already knows about `allowed_engines` filtering). Keeping `engine` perpetuates the one-engine assumption in the type system.

**Alternative considered**: Keep `LoadedConfig.engine` as a getter aliased to `engines[0].config`. Rejected — it's a 1-line saving that preserves a confusing field; the user explicitly chose "delete it" in the design conversation.

### D4 — Repurpose the existing `default_model` field, don't introduce a new key

**Decision**: `WorkspaceYaml.default_model` already exists (currently `@deprecated`, used by `seedConversationModel` at `model-resolver.ts:46`). Drop the deprecated tag, make it the canonical workspace default. Document its format as `<engineId>/<modelId>`.

**Rationale**: The field name is already correct, the storage location is already correct, and one consumer is already reading it. Renaming would create churn without benefit. The only thing changing is its status (deprecated → canonical) and the type of the value (any model ID → fully-qualified ID).

### D5 — `setupTestConfig` writes a default `engines.yaml`

**Decision**: When the test caller doesn't pass an `enginesYaml` string, `setupTestConfig` writes a one-line `engines.yaml` with a single `copilot` entry. Tests that need a different engine pass their own YAML as today.

**Rationale**: Once `engines.yaml` becomes mandatory, every test that calls `setupTestConfig` would otherwise fail with the new "engines.yaml required" error. Defaulting it inside the helper preserves test ergonomics and matches the existing pattern for `workspace.test.yaml` (which is auto-written even when callers pass no overrides).

### D6 — Engine-type reads in handlers route through the registry, not `engines[0]`

**Decision**: `tasks.ts:314,329` and `chat-sessions.ts:131,184` currently do `config.engine.type`. After this change they call `engineRegistry.resolveEngineForModel(workspaceKey, conversationModel).id` (or equivalent). `chat-sessions.ts:50` (which reads `engine.model` to seed a default) reads `config.workspace.default_model` instead.

**Rationale**: The handlers are running in the context of a task or chat session that *already has a model*. The right "which engine?" answer is the engine for that model, not the workspace default. This was already the right answer before the change — the legacy `config.engine.type` happened to give a correct answer only because there was usually one engine per workspace. After this change there can be many; we should resolve correctly.

### D7 — No data migration, hard error on legacy schema

**Decision**: If `engine:` is present in `workspace.yaml`, the loader returns:

```
workspace.yaml: engine: block is no longer supported.
Replace it with:
  default_model: <engineId>/<modelId>   # e.g. copilot/claude-sonnet-4.6
and ensure engines.yaml declares the engines you want available.
See config/engines.yaml.sample.
```

No automatic rewrite. No tolerated-with-warning mode.

**Rationale**: Auto-rewriting user YAML clobbers comments and is fragile. A hard error with a one-paragraph migration is faster to act on than the current "warn and prefer engines.yaml" path, which leaves both files present and contradictory. The user explicitly accepted breaking change cost.

## Risks / Trade-offs

- **Existing installations break on first launch after the upgrade.** Mitigation: clear migration message in the loader error, sample file shows the new schema, `ensureConfigExists` writes the new format from scratch on fresh installs.
- **Test churn is real.** ~15 test files touch the `engine:` block in fixtures. Each needs a mechanical update to the new format. This is bounded — no logic changes, just YAML strings — but it's the largest single source of edits.
- **`LoadedConfig.engine` deletion ripples through ~6 handler call sites.** Each becomes a registry lookup. Type system catches every miss.

## Migration Plan

For a user upgrading their workspace:

1. Open `~/.railyn/workspaces/<key>/workspace.yaml`.
2. Replace:
   ```yaml
   engine:
     type: copilot
     model: claude-sonnet-4.6
   ```
   with:
   ```yaml
   default_model: copilot/claude-sonnet-4.6
   ```
3. If `~/.railyn/config/engines.yaml` doesn't exist, copy from `config/engines.yaml.sample`.

The loader's error message embeds these instructions verbatim. No tooling.

## Open Questions

None. Both prior open decisions (delete `LoadedConfig.engine`; mandate `engines.yaml` for tests via the helper) were resolved in the design conversation that produced this proposal.
