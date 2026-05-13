## Why

Pi engine auto-compact has never worked reliably: a previous fix attempt (commit `aa183cd`) only addressed the threshold path during successful turns and missed two deeper root causes — the SDK silently inheriting the user's Pi CLI disk config (which may have `/compact off`), and the `.then()` hook never firing when a context overflow causes `prompt()` to reject. Additionally, the context window defaulting logic means a 32K model never triggers the threshold-based path at all.

## What Changes

- **RC1 fix**: Pass `SettingsManager.inMemory({ compaction: { enabled: true, ... } })` to `createAgentSession` so SDK compaction settings are always enabled, isolated from `~/.pi/agent/settings.jsonl`
- **RC2 fix**: Extract prompt chain to `runPromptWithCompaction()` private method that handles both the success path (threshold compact) and the rejection/overflow path (SDK handles via `_runAutoCompaction("overflow", willRetry=true)` — but RC1 must be fixed first)
- **RC3 fix + model-settings as sole source of truth**: Remove `DEFAULT_CONTEXT_WINDOW` constant and `config.context_window` fallback from `buildModel()`; always read context window from `model_settings` DB via injected `ModelSettingsRepository`; models without a `context_window` set in `model_settings` are **BREAKING** hidden from the chat model picker
- **Fix `compact()` model inconsistency**: `compact()` currently always calls `buildModel()` with no args (uses engine default model), ignoring the model the conversation was actually created with. Fix by reading `conversations.model` from DB and using it as the model override
- **Inject `ModelSettingsRepository` into `PiEngine`**: Required to look up `contextWindow` for both execution and compaction without calling `getDb()` directly
- **UI warning in model setup page**: Models in the Pi provider list that have no `context_window` configured show a warning badge — they won't appear in the chat picker until the context window is set
- **Block Compact button when context window is missing**: `ConversationInput.vue` `supportsManualCompact` guard is tightened — in a task context, a null `task.model` no longer falls back to `availableModels[0]`; the button is hidden until the conversation has an explicit model. Combined with the `listEnabled` filter (null-contextWindow models absent from `availableModels`), the Compact button is automatically hidden whenever the conversation model is unconfigured

## Capabilities

### New Capabilities

- `pi-autocompact-settings-isolation`: SDK compaction is always enabled via in-memory settings, independent of Pi CLI user configuration on disk

### Modified Capabilities

- `pi-engine`: Remove fallback chain for context window resolution; `ModelSettingsRepository` is now injected; `buildModel()` requires a resolved context window (throws if null); `compact()` uses stored conversation model
- `model-context-window-settings`: A `NULL` context window in `model_settings` now means the model is excluded from the chat model picker (not just "use engine default") — models must have an explicit context window to be chat-selectable
- `conversation-compaction`: `compact()` resolves model from `conversations.model` DB column, not from engine default

## Impact

- `src/bun/engine/pi/engine.ts` — primary changes
- `src/bun/index.ts` — `PiEngine` constructor gains `ModelSettingsRepository` + `workspaceKey` params
- `src/bun/handlers/models.ts` — `models.listEnabled` filters out null-contextWindow models
- `src/mainview/components/ModelTreeView.vue` — warning badge for null-contextWindow models
- `src/mainview/components/ConversationInput.vue` — `supportsManualCompact` guard tightened for task context (no fallback to `availableModels[0]` when `task.model` is null)
- Existing tests for Pi engine compaction threshold logic may need updating (fallback scenarios no longer valid)
