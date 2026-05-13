## Purpose

Comprehensive test coverage for the `fix-pi-autocompact` change, spanning unit tests, integration tests (in-memory DB), and Playwright UI tests. Covers all new behaviour: constructor injection, compaction settings isolation, compact() model/contextWindow resolution, listEnabled filter, model setup warning badge, and compact button guard.

## Requirements

### Requirement: Existing Pi engine tests compile after constructor change
The test suite SHALL update `TestPiEngine` in `src/bun/test/pi-engine.test.ts` and `makeEngine()` in `src/bun/test/pi-engine-models.test.ts` to pass a `MockModelSettingsRepository` stub and a `workspaceKey` string to the `PiEngine` constructor. No existing test scenarios shall change behaviour.

#### Scenario: PE-CTOR-1 TestPiEngine compiles with injected mock repo
- **WHEN** `src/bun/test/pi-engine.test.ts` is compiled after constructor change
- **THEN** no TypeScript compilation errors occur

#### Scenario: PE-CTOR-2 makeEngine() compiles with injected mock repo
- **WHEN** `src/bun/test/pi-engine-models.test.ts` is compiled after constructor change
- **THEN** no TypeScript compilation errors occur

### Requirement: buildCompactionSettings() returns RC1-fix values
The test suite SHALL verify that `PiEngine.buildCompactionSettings()` (protected method exposed via `TestPiEngine`) returns `{ enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 }`.

#### Scenario: PE-SETTINGS-1 buildCompactionSettings returns correct in-memory settings
- **WHEN** `engine.exposeCompactionSettings()` is called on a `TestPiEngine` instance
- **THEN** the returned object has `enabled: true`, `reserveTokens: 16384`, `keepRecentTokens: 20000`

### Requirement: compact() resolves model from conversations.model
The test suite SHALL verify that `compact()` uses the model stored in `conversations.model`, not the engine default.

#### Scenario: PE-COMPACT-5 compact() passes stored model to buildModel
- **WHEN** `compact(null, conversationId, "/wd")` is called and `conversations.model` is `"pi-local/lmstudio/llama-3.2-3b"`
- **THEN** the session is created with model id `"lmstudio/llama-3.2-3b"` (qualified prefix stripped)

#### Scenario: PE-COMPACT-6 compact() resolves contextWindow from modelSettingsRepo
- **WHEN** `compact()` resolves model `"pi-local/lmstudio/qwen3:8b"` and `modelSettingsRepo.getContextWindow` returns `32768`
- **THEN** the session is created with `model.contextWindow = 32768`

#### Scenario: PE-COMPACT-7 compact() throws when modelSettingsRepo returns null contextWindow
- **WHEN** `compact()` resolves a model but `modelSettingsRepo.getContextWindow` returns `null`
- **THEN** `compact()` rejects with an error indicating the context window is not configured

#### Scenario: PE-COMPACT-8 compact() throws when conversations.model is null
- **WHEN** `compact()` is called and `conversations.model` is `NULL` in the DB
- **THEN** `compact()` rejects with an error indicating no model is stored for the conversation

### Requirement: models.listEnabled excludes null-contextWindow Pi models
The test suite SHALL verify that `models.listEnabled` integration tests cover the filter introduced in the backend handler.

#### Scenario: MH-L-1 Pi model with null contextWindow absent from listEnabled
- **WHEN** `models.listEnabled` is called and a Pi model has `contextWindow: null` (no DB override, no engine default)
- **THEN** that model is NOT present in the response array

#### Scenario: MH-L-2 Pi model with DB override contextWindow present in listEnabled
- **WHEN** `models.listEnabled` is called and a Pi model has `contextWindow: null` from engine but `context_window = 32768` in `model_settings`
- **THEN** that model IS present in the response with `contextWindow: 32768`

#### Scenario: MH-L-3 Pi model with non-null engine contextWindow + DB override present in listEnabled
- **WHEN** `models.listEnabled` is called and a Pi model has engine-reported `contextWindow: 131072` but `context_window = 65536` in `model_settings`
- **THEN** that model IS present in the response with `contextWindow: 65536` (DB override wins)

#### Scenario: MH-L-4 Non-Pi model with contextWindow unaffected by filter
- **WHEN** `models.listEnabled` is called and a Copilot model has `contextWindow: 131072`
- **THEN** that model IS present in the response regardless of `model_settings`

### Requirement: Warning badge shown for unconfigured Pi models in model setup page
The Playwright test suite SHALL verify that models with `contextWindowEditable === true` and `contextWindow === null` show a visible warning badge in `ModelTreeView.vue`.

#### Scenario: CTX-W-1 Warning badge visible for null-contextWindow Pi model
- **WHEN** the model setup page renders a Pi model with `contextWindow: null`
- **THEN** a warning badge (⚠) with class `model-ctx-warning` is visible on that model's row

#### Scenario: CTX-W-2 Warning badge has tooltip explaining chat picker exclusion
- **WHEN** the user hovers over the warning badge for a null-contextWindow Pi model
- **THEN** the tooltip text mentions that the model will not appear in the chat picker until context window is configured

#### Scenario: CTX-W-3 Warning badge absent when contextWindow is set
- **WHEN** the model setup page renders a Pi model with `contextWindow: 32768`
- **THEN** no warning badge is visible on that model's row

#### Scenario: CTX-W-4 Clicking warning badge activates the context window edit field
- **WHEN** the user clicks the warning badge on a null-contextWindow Pi model
- **THEN** the context window input field becomes focused/active on that model's row

### Requirement: Warning badge absent for non-editable models
The Playwright test suite SHALL verify that warning badges do not appear on models where `contextWindowEditable === false`, even if contextWindow is null.

#### Scenario: CTX-W-5 No warning badge for non-editable model with null contextWindow
- **WHEN** the model setup page renders a Copilot model with `contextWindow: null` and `contextWindowEditable: false`
- **THEN** no warning badge is visible on that model's row

### Requirement: Compact button hidden when task model absent from availableModels
The Playwright test suite SHALL verify that the Compact button is not rendered in the task chat when the conversation model is not present in `availableModels` (null-contextWindow model filtered by listEnabled).

#### Scenario: MP-F-1 Compact button hidden when task model filtered out of listEnabled
- **WHEN** a task chat is rendered with `task.model = "pi-local/lmstudio/qwen3:8b"` and `listEnabled` does NOT include that model (contextWindow null, filtered)
- **THEN** the Compact button / context popover compact action is NOT visible

#### Scenario: MP-F-2 Compact button visible when task model is in availableModels
- **WHEN** a task chat is rendered with `task.model = "pi-local/lmstudio/qwen3:8b"` and `listEnabled` includes that model with `supportsManualCompact: true`
- **THEN** the Compact button / context popover compact action IS visible

### Requirement: Compact button hidden when task.model is null
The Playwright test suite SHALL verify that the Compact button is not rendered when `task.model` is null, even if `availableModels[0]` supports manual compact.

#### Scenario: MP-F-3 Compact button hidden when task.model is null
- **WHEN** a task chat is rendered with `task.model = null` and `availableModels[0]` is a Pi model with `supportsManualCompact: true`
- **THEN** the Compact button / context popover compact action is NOT visible
