## 1. PiEngine Constructor Injection

- [ ] 1.1 Add `modelSettingsRepo: ModelSettingsRepository` and `workspaceKey: string` constructor parameters to `PiEngine`
- [ ] 1.2 Update `PiEngine` constructor to store both as instance fields
- [ ] 1.3 Update `engineFactories.pi` in `src/bun/index.ts` to pass `modelSettingsRepo` and `workspaceKey` when constructing `PiEngine`

## 2. Fix RC1 — In-Memory Compaction Settings

- [ ] 2.1 Import `SettingsManager` from the Pi SDK in `engine.ts`
- [ ] 2.2 In `getOrCreateSession()`, pass `settingsManager: SettingsManager.inMemory({ compaction: { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 } })` to `createAgentSession`

## 3. Fix RC3 — Remove Context Window Defaults

- [ ] 3.1 Remove `DEFAULT_CONTEXT_WINDOW` constant from `engine.ts`
- [ ] 3.2 Remove `config.context_window` fallback from `buildModel()`
- [ ] 3.3 Change `buildModel()` to throw if `contextWindowOverride` is undefined or null
- [ ] 3.4 Update all internal callers of `buildModel()` that omit `contextWindowOverride` to pass a resolved value

## 4. Fix `compact()` Model Resolution

- [ ] 4.1 In `compact()`, query `conversations.model` from DB: `SELECT model FROM conversations WHERE id = ?`
- [ ] 4.2 Resolve `contextWindowOverride` from `this.modelSettingsRepo.getContextWindow(this.workspaceKey, resolvedModel)`
- [ ] 4.3 Pass both `modelOverride` and `contextWindowOverride` to `buildModel()` when creating the compaction session

## 5. Extract `runPromptWithCompaction()` Private Method

- [ ] 5.1 Extract the `session.prompt().then().catch().finally()` inline chain from `createManagedExecution()` into a new private method `runPromptWithCompaction(session, resolvedPrompt, conversationId, queue)`
- [ ] 5.2 Verify extracted method produces identical behavior to the inline chain (no logic changes)

## 6. Backend — Filter Models Without Context Window

- [ ] 6.1 In `models.listEnabled` handler (`src/bun/handlers/models.ts`), filter out models where the resolved `contextWindow` is `null`
- [ ] 6.2 Verify `models.list` (setup page) remains unfiltered

## 7. Frontend — Warning Badge for Unconfigured Models

- [ ] 7.1 In `ModelTreeView.vue`, add a warning badge (⚠) for models where `contextWindow === null && contextWindowEditable === true`
- [ ] 7.2 Add a tooltip/inline message: "Context window not set — this model will not appear in the chat picker until configured"
- [ ] 7.3 Ensure clicking the badge or the context window field still opens the existing edit form

## 8. Frontend — Block Compact Button When Context Window Missing

- [ ] 8.1 In `ConversationInput.vue`, update `supportsManualCompact` computed: when `props.taskId != null` (task context), do NOT fall back to `availableModels[0]` when `props.modelId` is null — return `false` instead
- [ ] 8.2 Verify that when `task.model` references a model absent from `availableModels` (null-contextWindow model filtered out by listEnabled), the Compact button is already hidden — no additional code needed
