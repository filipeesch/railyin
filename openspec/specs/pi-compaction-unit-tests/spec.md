# Pi Compaction Unit Tests

## Purpose

Unit and integration test coverage for all layers changed by the `fix-pi-compaction` feature: stream-processor compaction_done content, Pi engine compact() lifecycle, orchestrator post-compact broadcast, and frontend conversation store gauge refresh.

## Requirements

### Requirement: Stream processor compaction_done tests
The test suite SHALL add tests to `src/bun/test/stream-processor.test.ts` covering the `compaction_done` content fix.

#### Scenario: SP-COMPACT-1 compaction_done stores actual summary text
- **WHEN** the engine emits `{ type: "compaction_done", summary: "Summarised 40 messages." }`
- **THEN** the `conversation_messages` row inserted has `type = "compaction_summary"` and `content = "Summarised 40 messages."`

#### Scenario: SP-COMPACT-2 compaction_done with no summary stores empty string
- **WHEN** the engine emits `{ type: "compaction_done" }` with no `summary` field
- **THEN** the `conversation_messages` row has `type = "compaction_summary"` and `content = ""`

#### Scenario: SP-COMPACT-3 compaction_start followed by compaction_done inserts both rows
- **WHEN** the engine emits `{ type: "compaction_start" }` then `{ type: "compaction_done", summary: "S" }`
- **THEN** the DB has a `system` row (compaction_start) and a `compaction_summary` row with `content = "S"`, in that order

### Requirement: Pi engine compact() unit tests
The test suite SHALL add a new file `src/bun/test/pi-engine.test.ts` with a `describe("PiEngine.compact()")` block. Tests use a test subclass of `PiEngine` overriding the `protected getOrCreateSession()` to inject a `MockAgentSession`.

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

### Requirement: Orchestrator compactTask broadcast tests
The test suite SHALL add tests to `src/bun/test/orchestrator.test.ts` covering `compactTask()` post-compact broadcast behaviour. Tests use a `CompactableScriptedEngine extends ScriptedEngine` with a configurable `compact()`.

#### Scenario: ORCH-COMPACT-1 compactTask broadcasts message.new with compaction_summary
- **GIVEN** a task exists and `engine.compact()` resolves (inserting a `compaction_summary` row)
- **WHEN** `orchestrator.compactTask(taskId)` is called
- **THEN** `onNewMessage` is called once with a message where `type = "compaction_summary"`

#### Scenario: ORCH-COMPACT-2 compactTask with engine lacking compact() throws
- **GIVEN** the registered engine has no `compact` method
- **WHEN** `orchestrator.compactTask(taskId)` is called
- **THEN** it throws with a message indicating the engine does not support compaction

#### Scenario: ORCH-COMPACT-3 compactTask propagates engine error
- **GIVEN** `engine.compact()` throws `new Error("Compaction already in progress")`
- **WHEN** `orchestrator.compactTask(taskId)` is called
- **THEN** the error propagates (not swallowed) with the original message

### Requirement: Frontend conversation store gauge-refresh tests
The test suite SHALL add tests to `src/mainview/stores/conversation.test.ts` verifying that `onNewMessage` with a `compaction_summary` triggers `fetchContextUsage`.

#### Scenario: SB-NEW-1 onNewMessage with compaction_summary triggers fetchContextUsage
- **GIVEN** the active conversation ID is `42`
- **AND** `conversations.contextUsage` is mocked to return `{ usedTokens: 1000, maxTokens: 8192, fraction: 0.12 }`
- **WHEN** `store.onNewMessage({ conversationId: 42, type: "compaction_summary", ... })` is called
- **THEN** the API was called with `"conversations.contextUsage"` and `{ conversationId: 42 }`
- **AND** `store.contextUsage.usedTokens` equals `1000`

#### Scenario: SB-NEW-2 onNewMessage with compaction_summary for non-active conversation does not fetch
- **GIVEN** the active conversation ID is `42`
- **WHEN** `store.onNewMessage({ conversationId: 99, type: "compaction_summary", ... })` is called
- **THEN** `conversations.contextUsage` is NOT called
