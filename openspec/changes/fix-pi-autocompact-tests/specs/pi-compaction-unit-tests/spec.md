## MODIFIED Requirements

### Requirement: Pi engine compact() unit tests
The test suite SHALL have tests for `PiEngine.compact()` in `src/bun/test/pi-engine.test.ts` with a `describe("PiEngine.compact()")` block. Tests use a test subclass of `PiEngine` overriding `protected getOrCreateSession()` to inject a `MockAgentSession`. The `TestPiEngine` subclass SHALL also accept a `MockModelSettingsRepository` and `workspaceKey` in its constructor (forwarded to super), and SHALL expose a public `exposeCompactionSettings()` method that returns `super.buildCompactionSettings()`. The `TestPiEngine` constructor SHALL be updated to pass the mock repo and workspaceKey to `PiEngine` super.

#### Scenario: PE-COMPACT-1 no live session triggers session restoration
- **GIVEN** the sessions map is empty (no live session for `conversationId`)
- **WHEN** `engine.compact(null, conversationId, "/wd")` is called
- **THEN** `getOrCreateSession` is called with `conversationId`
- **AND** the restored session's `compact()` is invoked

#### Scenario: PE-COMPACT-2 isCompacting true causes throw
- **GIVEN** a mock session is in the sessions map with `isCompacting = true`
- **WHEN** `engine.compact(null, conversationId, "/wd")` is called
- **THEN** it throws an error matching `"Compaction already in progress"`

#### Scenario: PE-COMPACT-3 successful compact writes compaction_summary row to DB
- **GIVEN** `session.compact()` resolves with `{ summary: "the summary" }`
- **WHEN** `engine.compact(null, conversationId, "/wd")` is called
- **THEN** a `compaction_summary` row exists in `conversation_messages` with `content` containing `"the summary"`

#### Scenario: PE-COMPACT-4 null compact result inserts no row
- **GIVEN** `session.compact()` resolves with `null`
- **WHEN** `engine.compact(null, conversationId, "/wd")` is called
- **THEN** no `compaction_summary` row is inserted into `conversation_messages`

#### Scenario: PE-COMPACT-5 compact() passes stored conversation model to session creation
- **WHEN** `compact(null, conversationId, "/wd")` is called and `conversations.model` is `"pi-local/lmstudio/llama-3.2-3b"`
- **THEN** the session is created with model id `"lmstudio/llama-3.2-3b"` (engine prefix stripped)

#### Scenario: PE-COMPACT-6 compact() resolves contextWindow from modelSettingsRepo
- **WHEN** `compact()` resolves model `"pi-local/lmstudio/qwen3:8b"` and `mockModelSettingsRepo.getContextWindow` returns `32768`
- **THEN** the session used for compaction has `model.contextWindow = 32768`

#### Scenario: PE-COMPACT-7 compact() rejects when modelSettingsRepo returns null contextWindow
- **WHEN** `compact()` resolves a model but `mockModelSettingsRepo.getContextWindow` returns `null`
- **THEN** `compact()` rejects with an error indicating the context window is not configured for that model

#### Scenario: PE-COMPACT-8 compact() rejects when conversations.model is null
- **WHEN** `compact()` is called and `conversations.model` is `NULL` in the DB
- **THEN** `compact()` rejects with an error indicating no model is stored for this conversation
