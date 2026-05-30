## 1. Update `ChatExecutor` constructor and field declarations

- [x] 1.1 Add `modelSettingsRepo: ModelSettingsRepository` as a constructor parameter and private field
- [x] 1.2 Add `boardTools: IBoardToolExecutor` as a constructor parameter and private field
- [x] 1.3 Add `onNewMessage: (msg: ConversationMessage) => void` as a constructor parameter and private field

## 2. Inject dependencies into `ExecutionParams`

- [x] 2.1 In `ChatExecutor.execute()`, resolve `effectiveModel` (already available) and look up `contextWindowOverride` via `this.modelSettingsRepo.getContextWindow(workspaceKey, effectiveModel)` — follow the exact pattern from `TransitionExecutor`
- [x] 2.2 Add `contextWindowOverride` to the `ExecutionParams` object built in `execute()`, matching the pattern in `TransitionExecutor` (line 161)
- [x] 2.3 Add `boardTools: this.boardTools` to the same `ExecutionParams` object

## 3. Add pre-flight check for Pi + missing context window

- [x] 3.1 After resolving `contextWindowOverride`, check whether the engine for this workspace is Pi (use `EngineRegistry` to resolve the engine and check its ID or use a `requiresContextWindow()` / `engineId` property)
- [x] 3.2 If engine is Pi and `contextWindowOverride` is `undefined`, persist a system error message into the conversation via the existing message-append helper (match the pattern used elsewhere for system messages)
- [x] 3.3 Call `this.onNewMessage(errorMsg)` immediately after persisting, to push the error to the frontend via WebSocket
- [x] 3.4 Return early from `execute()` after pushing — do not create a managed execution

## 4. Wire new dependencies in `Orchestrator`

- [x] 4.1 In `Orchestrator.constructor()`, add `this.modelSettingsRepo`, `this.boardTools`, and `this.onNewMessage` to the `ChatExecutor` constructor call (line ~122)

## 5. Verify end-to-end manually

- [ ] 5.1 Start a Pi chat session with a model that has a context window configured → confirm an AI response is received
- [ ] 5.2 Start a Pi chat session with a model that has NO context window configured → confirm the error message appears in the conversation
- [ ] 5.3 Confirm Claude chat sessions are unaffected

