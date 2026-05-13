## 1. PiEngine Constructor Injection

- [x] 1.1 Add `modelSettingsRepo: ModelSettingsRepository` and `workspaceKey: string` constructor parameters to `PiEngine`
- [x] 1.2 Update `PiEngine` constructor to store both as instance fields
- [x] 1.3 Update `engineFactories.pi` in `src/bun/index.ts` to pass `modelSettingsRepo` and `workspaceKey` when constructing `PiEngine`

## 2. Fix RC1 — In-Memory Compaction Settings

- [x] 2.1 Import `SettingsManager` from the Pi SDK in `engine.ts`
- [x] 2.2 In `getOrCreateSession()`, pass `settingsManager: SettingsManager.inMemory({ compaction: { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 } })` to `createAgentSession`

## 3. Fix RC3 — Remove Context Window Defaults

- [x] 3.1 Remove `DEFAULT_CONTEXT_WINDOW` constant from `engine.ts`
- [x] 3.2 Remove `config.context_window` fallback from `buildModel()`
- [x] 3.3 Change `buildModel()` to throw if `contextWindowOverride` is undefined or null
- [x] 3.4 Update all internal callers of `buildModel()` that omit `contextWindowOverride` to pass a resolved value

## 4. Fix `compact()` Model Resolution

- [x] 4.1 In `compact()`, query `conversations.model` from DB: `SELECT model FROM conversations WHERE id = ?`
- [x] 4.2 Resolve `contextWindowOverride` from `this.modelSettingsRepo.getContextWindow(this.workspaceKey, resolvedModel)`
- [x] 4.3 Pass both `modelOverride` and `contextWindowOverride` to `buildModel()` when creating the compaction session

## 5. Extract `runPromptWithCompaction()` Private Method

- [x] 5.1 Extract the `session.prompt().then().catch().finally()` inline chain from `createManagedExecution()` into a new private method `runPromptWithCompaction(session, resolvedPrompt, conversationId, queue)`
- [x] 5.2 Verify extracted method produces identical behavior to the inline chain (no logic changes)

## 6. Backend — Filter Models Without Context Window

- [x] 6.1 In `models.listEnabled` handler (`src/bun/handlers/models.ts`), filter out models where the resolved `contextWindow` is `null` (only for models with `contextWindowEditable: true`)
- [x] 6.2 Verify `models.list` (setup page) remains unfiltered

## 7. Frontend — Warning Badge for Unconfigured Models

- [x] 7.1 In `ModelTreeView.vue`, add a warning badge (⚠) for models where `contextWindow === null && contextWindowEditable === true`
- [x] 7.2 Add a tooltip/inline message: "Context window not set — this model will not appear in the chat picker until configured"
- [x] 7.3 Ensure clicking the badge or the context window field still opens the existing edit form

## 8. Frontend — Block Compact Button When Context Window Missing

- [x] 8.1 In `ConversationInput.vue`, update `supportsManualCompact` computed: when `props.taskId != null` (task context), do NOT fall back to `availableModels[0]` when `props.modelId` is null — return `false` instead
- [x] 8.2 Verify that when `task.model` references a model absent from `availableModels` (null-contextWindow model filtered out by listEnabled), the Compact button is already hidden — no additional code needed
