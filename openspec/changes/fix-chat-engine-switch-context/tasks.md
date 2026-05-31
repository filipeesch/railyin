## 1. Wire CrossEngineContextInjector into ChatExecutor

- [ ] 1.1 Add `crossEngineInjector: CrossEngineContextInjector` as a constructor parameter to `ChatExecutor` (after `paramsEnricher`, before `boardTools`)
- [ ] 1.2 In `ChatExecutor.execute()`, after resolving `targetEngineId`, read `conversations.last_engine_type` from the DB and call `engineRegistry.getEngineById(lastEngineType)` to get `sourceEngine`
- [ ] 1.3 Call `engine.listModels()` to resolve `targetModelInfo` for the effective model
- [ ] 1.4 Call `this.crossEngineInjector.prepareSwitch(conversationId, targetEngineId, sourceEngine, targetModelInfo, workingDirectory, workspaceKey)` and capture `historyBlock`
- [ ] 1.5 Build `enginePrompt = [historyBlock, engineContent ?? content].filter(Boolean).join("\n\n")` and pass it as the `prompt` to `paramsBuilder.buildForChat()` (replacing the direct `engineContent ?? content` usage)

## 2. Maintain last_engine_type for chat turns

- [ ] 2.1 After the `runNonNative()` call in `ChatExecutor.execute()`, add `db.run("UPDATE conversations SET last_engine_type = ? WHERE id = ?", [targetEngineId, conversationId])`
- [ ] 2.2 Verify the write does NOT occur in the Pi pre-flight error early-exit path (the path that returns before `runNonNative()` is called)

## 3. Fix model-update condition

- [ ] 3.1 Change the condition `if (effectiveModel && !modelValue)` to `if (effectiveModel && effectiveModel !== modelValue)` so the DB model stays in sync whenever the active model changes

## 4. Wire injector in Orchestrator

- [ ] 4.1 In `Orchestrator` constructor, pass `new CrossEngineContextInjector(db)` as the `crossEngineInjector` argument when constructing `ChatExecutor`

## 5. Verify

- [ ] 5.1 Run backend tests: `bun test src/bun/test --timeout 20000` — confirm no regressions
- [ ] 5.2 Manually verify: create a chat session, send a few messages with engine A, switch to engine B, confirm the next response references prior context
