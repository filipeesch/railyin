## Context

The Pi engine wraps the `@earendil-works/pi-coding-agent` SDK's `AgentSession` for LLM execution. The SDK has built-in auto-compact logic (`_checkCompaction`, `_runAutoCompaction`) that fires between turns during `session.prompt()`. Three root causes prevent it from working:

1. **RC1** — `createAgentSession` uses `SettingsManager.create(cwd, agentDir)` which reads `~/.pi/agent/settings.jsonl`. If the user has ever run `/compact off` in the Pi CLI, all engine sessions inherit `enabled: false` and `_checkCompaction` silently returns immediately.
2. **RC2** — Our manual `.then()` hook only fires on `prompt()` resolve. Context overflow causes `prompt()` to reject → `.catch()` runs → `.then()` never fires → no compaction retry.
3. **RC3** — `DEFAULT_CONTEXT_WINDOW = 128_000` is passed to the SDK for all models. For a 32K model, the threshold fires at `128K - 16K = 111K`, which the 32K model never reaches (it errors first). The overflow path handles this correctly *if* RC1 is fixed, but the threshold path is permanently broken for small-context models.

An additional correctness bug: `compact()` calls `buildModel()` with no arguments, always restoring sessions with the engine's default model — ignoring the model the conversation was actually created with.

## Goals / Non-Goals

**Goals:**
- Fix RC1 so SDK auto-compact always fires regardless of the user's Pi CLI disk config
- Fix RC3 by removing the 128K default and using `model_settings` DB as the sole source of truth
- Fix `compact()` model mismatch when restoring a session
- Inject `ModelSettingsRepository` into `PiEngine` to avoid ad-hoc DB lookups
- Enforce that models without a `context_window` in `model_settings` are not selectable in the chat picker
- Surface a clear UI warning in the model setup page for unconfigured models
- Extract `runPromptWithCompaction()` private method for clarity (structural only, no behavior change)

**Non-Goals:**
- Changing how `SessionManager` persists session history (still file-backed per `conversationId`, unchanged)
- Altering the SDK's `_checkCompaction` or `_runAutoCompaction` internals
- Handling the case where `_runAutoCompaction` itself fails (API call to summarize fails) — that is a separate concern
- Changing compaction behavior for other engines (Claude, Copilot, OpenCode)

## Decisions

### D1: `SettingsManager.inMemory()` for compaction settings isolation

The SDK's `SettingsManager.inMemory(settings)` is a static factory that holds settings in RAM only (identical pattern to `AuthStorage.inMemory()` already used in `getOrCreateSession`). Passing it to `createAgentSession` means:
- `_checkCompaction` always sees `enabled: true`
- `reserveTokens` and `keepRecentTokens` are under our control
- The user's Pi CLI configuration is completely isolated

**Alternative considered**: Read `settings.jsonl`, merge our overrides, re-write it. Rejected: mutates user's global config, creates race conditions with running Pi CLI sessions.

### D2: `ModelSettingsRepository` injected into `PiEngine` constructor

`PiEngine` needs to resolve `contextWindow` at two points: during `execute()` (already has `contextWindowOverride` from `ExecutionParams`) and during `compact()` (needs to look it up from DB). Rather than calling `getDb()` directly (anti-pattern), `ModelSettingsRepository` is injected at construction time via the `engineFactories` map in `index.ts`.

The `workspaceKey` is also injected so the repo can look up the right row. Both are already available at the `PiEngine` construction site in `index.ts`.

**Alternative considered**: Pass `contextWindowOverride` as a parameter to `compact()`. Rejected: `compact()` is part of the `ExecutionEngine` interface — changing its signature would require updating all engine implementations and the orchestrator.

### D3: `buildModel()` throws if `contextWindowOverride` is null/undefined

Remove `DEFAULT_CONTEXT_WINDOW` and `config.context_window` fallback. If `buildModel()` is called without a resolved context window it throws immediately. This makes misconfiguration a hard error rather than a silent degradation.

During `execute()`, the `contextWindowOverride` comes from `ExecutionParams` (resolved by the orchestrator via `ModelSettingsRepository`). During `compact()`, it's resolved inline from `ModelSettingsRepository` using the conversation's stored model.

**Alternative considered**: Emit a warning and use a conservative 32K default. Rejected: a wrong default means wrong threshold which means auto-compact still doesn't fire at the right time.

### D4: `models.listEnabled` filters null-contextWindow models server-side

The chat model picker calls `models.listEnabled`. Adding the filter server-side means:
- No frontend logic change required
- The filter is enforced consistently across all UI surfaces that use `listEnabled`
- `models.list` (setup page) remains unfiltered so users can still see and configure unconfigured models

### D5: Warning badge rendered in `ModelTreeView.vue` (client-side)

`ModelTreeView.vue` already has `contextWindow` per model and a `contextWindowEditable` flag. Adding a conditional warning badge (`⚠`) for `contextWindow === null && contextWindowEditable === true` is purely additive — no new RPC, no new store field needed.

## Risks / Trade-offs

- **[Risk] Existing Pi tasks with no context_window set stop executing** → Mitigation: The orchestrator already receives `contextWindowOverride` from `models.listEnabled`; if a model has no context_window it won't appear in the picker and won't be selectable for new tasks. Existing tasks with a conversation model that has no context_window set will fail at `buildModel()` — an error message will guide the user to set the context window.
- **[Risk] `compact()` inline `ModelSettingsRepository` lookup adds a DB query per compact call** → Acceptable: compact is rare, one extra SELECT is negligible.
- **[Risk] SettingsManager.inMemory API may change in SDK upgrades** → Mitigation: It's a static factory on the public SDK API surface, same as `AuthStorage.inMemory()` which has been stable.
- **[Trade-off] Removing config.context_window fallback breaks existing `workspace.yaml` configs that set it** → The field is still valid in YAML for engine-default purposes, but the Pi engine no longer reads it for model context window resolution. Document in changelog.

## Migration Plan

1. Run DB migration to ensure `model_settings` table exists (already done by migration 043)
2. Deploy: models without `context_window` disappear from chat picker immediately
3. Users see warning badges in setup page → they set `context_window` → models reappear in picker
4. No rollback concerns: `model_settings` data is additive; reverting the code restores old fallback behavior

### D6: Compact button blocked via `supportsManualCompact` guard — no new RPC

Two cases must block the Compact button:
1. **`task.model` is NULL** — conversation was never started with an explicit model (pre-migration tasks or brand-new tasks before first send). The `supportsManualCompact` computed in `ConversationInput.vue` currently falls back to `availableModels[0]` when `props.modelId` is null, which may be a Pi model with `supportsManualCompact: true`. In the task context (discriminated by `props.taskId != null`), the fallback is removed — null modelId → `supportsManualCompact = false`.
2. **Model has no `context_window`** — after the `listEnabled` server-side filter (D4), null-contextWindow models are absent from `availableModels`. If `task.model` references such a model, `find()` returns `undefined` → `supportsManualCompact = false` automatically.

No new RPC fields or props are required. The existing `supportsManualCompact` flag pathway handles both cases with a single conditional in the computed.

**Alternative considered**: Add a dedicated `compactBlocked: boolean` field to the Task RPC type. Rejected: unnecessary — the information is already derivable client-side from `task.model` + `availableModels`, and adding a new field would require backend handler changes across task creation, transition, and update paths.

## Open Questions

- None — all design decisions resolved during exploration.
