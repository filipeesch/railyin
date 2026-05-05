## Purpose
Defines how the system detects engine switches mid-conversation and injects DB-backed message history into the new engine's context, preserving conversational continuity across engine boundaries.

## Requirements

### Requirement: CrossEngineContextInjector detects engine switches and injects DB history
The system SHALL provide a `CrossEngineContextInjector` in `src/bun/conversation/cross-engine-context.ts`. Before each execution, it SHALL compare `conversations.last_engine_type` with the target `QualifiedModelId.engineId`. If different and non-null, it SHALL fetch conversation messages from the last `compaction_summary` DB anchor and return them as a `<message_history>` XML block prepended to the first user message of the new session. The system prompt SHALL NOT be modified, preserving its cacheability with providers that support prompt caching.

#### Scenario: Same engine — no injection
- **WHEN** `last_engine_type` equals the target engine ID
- **THEN** `prepareSwitch()` returns `undefined` and no context block is added

#### Scenario: First execution — no injection
- **WHEN** `last_engine_type` is `null` (conversation never executed)
- **THEN** `prepareSwitch()` returns `undefined`

#### Scenario: Engine switch triggers context injection
- **WHEN** `last_engine_type` is `"copilot"` and target engine is `"claude"`
- **THEN** messages since the last `compaction_summary` anchor are formatted and returned as a `{ prefixedUserContent: string }` result

#### Scenario: Injected block is prepended to first user message content
- **WHEN** the injector returns a non-null result
- **THEN** the executor prepends the `<message_history>` XML block to the original user message content before calling `engine.execute()`; `systemInstructions` is unchanged

### Requirement: Pre-switch compaction when token usage exceeds threshold
Before injecting context, the injector SHALL estimate token usage of the messages-to-inject against the target model's `contextWindow`. If usage exceeds 75% AND the source engine implements `compact?()`, it SHALL trigger compaction on the source engine first, then re-fetch messages from the new anchor. If the source engine has no `compact()` (e.g. Claude), it SHALL proceed without compaction and log a warning.

#### Scenario: Under threshold — no compaction
- **WHEN** estimated tokens are below 75% of target model's contextWindow
- **THEN** `compact()` is NOT called and injection proceeds immediately

#### Scenario: Over threshold with compact-capable source engine
- **WHEN** estimated tokens exceed 75% of target model's contextWindow AND source engine has `compact()`
- **THEN** `compact()` is awaited, messages are re-fetched from the new anchor, and injection proceeds with the compacted history

#### Scenario: Over threshold with Claude as source (no compact)
- **WHEN** estimated tokens exceed 75% AND source engine has no `compact()` method
- **THEN** a warning is logged, injection proceeds with the uncompacted history

#### Scenario: Target model has no contextWindow (e.g. copilot/auto)
- **WHEN** the target model's `contextWindow` is `undefined`
- **THEN** the 75% threshold check is skipped and injection proceeds without compaction

### Requirement: last_engine_type is updated after each execution
After each successful or failed execution, the system SHALL update `conversations.last_engine_type` to the current execution's `QualifiedModelId.engineId`.

#### Scenario: last_engine_type updated after execution
- **WHEN** an execution with model `"claude/claude-sonnet-4-5"` completes
- **THEN** `conversations.last_engine_type` is set to `"claude"` for that conversation

#### Scenario: last_engine_type updated even on execution failure
- **WHEN** an execution fails partway through
- **THEN** `conversations.last_engine_type` is still updated to the attempted engine ID
