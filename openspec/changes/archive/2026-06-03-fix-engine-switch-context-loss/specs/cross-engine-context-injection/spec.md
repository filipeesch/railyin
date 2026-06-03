## MODIFIED Requirements

### Requirement: CrossEngineContextInjector detects engine switches and injects DB history
The system SHALL provide a `CrossEngineContextInjector` in `src/bun/conversation/cross-engine-context.ts`. The constructor SHALL accept a `Database` and an `EngineRegistry`. Before each execution, it SHALL compare `conversations.last_engine_type` with the target `QualifiedModelId.engineId`. If different and non-null, it SHALL fetch conversation messages from the last `compaction_summary` DB anchor (inclusive — the `compaction_summary` row itself SHALL be included in the fetched set) and return them as a `<message_history>` XML block prepended to the first user message of the new session. The system prompt SHALL NOT be modified, preserving its cacheability with providers that support prompt caching.

The `prepareSwitch()` method signature SHALL be:
```
prepareSwitch(
  conversationId: number,
  targetEngineId: string,
  targetModelInfo: EngineModelInfo | undefined,
  workingDirectory: string,
  workspaceKey: string,
  excludeBeforeMsgId?: number,
): Promise<PrepareResult>
```
The `sourceEngine` parameter is removed; the injector resolves the source engine internally from `last_engine_type` via `EngineRegistry`. The optional `excludeBeforeMsgId` parameter, when provided, excludes messages with `id >= excludeBeforeMsgId` from the fetched history (preventing the in-flight user message from appearing in both the history block and the main prompt).

#### Scenario: Same engine — no injection
- **WHEN** `last_engine_type` equals the target engine ID
- **THEN** `prepareSwitch()` returns `{ historyBlock: undefined }` and no context block is added

#### Scenario: First execution — no injection
- **WHEN** `last_engine_type` is `null` (conversation never executed)
- **THEN** `prepareSwitch()` returns `{ historyBlock: undefined }`

#### Scenario: Engine switch triggers context injection
- **WHEN** `last_engine_type` is `"pi"` and target engine is `"copilot"`
- **THEN** messages since (and including) the last `compaction_summary` anchor are formatted and returned as a `{ historyBlock: string }` result

#### Scenario: compaction_summary anchor row included in fetched messages
- **WHEN** a `compaction_summary` message exists in the DB (e.g. from Pi background compaction)
- **THEN** `fetchMessagesSinceAnchor` returns the `compaction_summary` row itself AND all subsequent messages; the formatted history block contains a `<SUMMARY>` section

#### Scenario: In-flight user message excluded from history block
- **WHEN** `excludeBeforeMsgId` is provided (the ID of the just-appended user message)
- **THEN** the fetched messages do NOT include that message; the history block contains only prior conversation turns

#### Scenario: Injected block is prepended to first user message content
- **WHEN** the injector returns a non-null `historyBlock`
- **THEN** the executor prepends the `<message_history>` XML block to the original user message content before calling `engine.execute()`; `systemInstructions` is unchanged

### Requirement: Pre-switch compaction when token usage exceeds threshold
Before injecting context, the injector SHALL estimate token usage of the messages-to-inject against the target model's `contextWindow`. If usage exceeds 75%, the injector SHALL look up the source engine from `EngineRegistry` using `last_engine_type`. If that engine implements `compact?()`, it SHALL trigger compaction on the source engine first, then re-fetch messages from the new anchor. If the source engine has no `compact()` (e.g. Claude), it SHALL proceed without compaction and log a warning.

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
