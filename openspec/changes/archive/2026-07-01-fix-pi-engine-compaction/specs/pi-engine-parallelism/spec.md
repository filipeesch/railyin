## MODIFIED Requirements

### Requirement: Opportunistic background compaction

After each `turn_end` event on a parent Pi `AgentSession`, the engine SHALL check whether to trigger background compaction using the following rule:

```
softThreshold = contextWindow - (reserveTokens + harness.background_compaction.early_margin_tokens)

if harness.background_compaction.enabled (default true)
   and session.getContextUsage().tokens >= softThreshold
   and !session.isCompacting
   and no background compaction is currently in flight for this conversation
   and limiter.tryAcquire(provider) returns a release token
then
   start session.compact() asynchronously (fire-and-forget)
   release the slot when compaction settles
else
   do nothing
```

`early_margin_tokens` SHALL default to 8192 and SHALL be greater than zero. The SDK's threshold-based auto-compaction SHALL be disabled (`SettingsManager.inMemory({ compaction: { enabled: false } })`) because the engine owns the full compaction lifecycle; `reserveTokens` and `keepRecentTokens` still apply to `session.compact()` calls.

When `session.compact()` fires, it internally calls `session.abort()`, which resolves `session.prompt()` early. The execution loop SHALL detect this condition by checking `bgCompactions.get(conversationId)` after `session.prompt()` resolves, and SHALL await the in-flight compaction promise before resuming. After awaiting, it SHALL inspect the last message in `session.agent.state.messages`:
- If `role !== "assistant"`: the agent was mid-turn when aborted; the loop SHALL call `session.agent.continue()` (wrapped in `runWithLimiter`) to resume.
- If `role === "assistant"`: the agent had already completed its turn before the abort; the loop SHALL exit normally.

The `AsyncQueue` SHALL remain open throughout this pause-and-resume cycle. The subscriber is never torn down during compaction, so `compaction_start` and `compaction_done` events continue flowing to the UI.

#### Scenario: Fires when slot is free
- **WHEN** context usage crosses the soft threshold at `turn_end` and the limiter has at least one free slot
- **THEN** `session.compact()` is invoked asynchronously and the next assistant turn can begin without waiting for it

#### Scenario: Skipped when limiter saturated
- **WHEN** context usage crosses the soft threshold at `turn_end` and the limiter has zero free slots
- **THEN** no background compaction is started

#### Scenario: No double-trigger
- **WHEN** a background compaction is already in flight for the conversation and a subsequent `turn_end` would otherwise trigger another one
- **THEN** no second compaction is started

#### Scenario: Soft threshold below hard threshold
- **WHEN** any valid `harness.background_compaction` configuration is loaded
- **THEN** the soft threshold is strictly less than `contextWindow - reserveTokens`

#### Scenario: Summary persisted on success
- **WHEN** a background compaction completes successfully with a non-empty `summary`
- **THEN** the summary is appended to the conversation as a `compaction_summary` message via `appendMessage`

#### Scenario: Queue stays open during background compaction
- **WHEN** background compaction fires mid-execution and `session.abort()` resolves `session.prompt()` early
- **THEN** the `AsyncQueue` is NOT closed; `compaction_start` and `compaction_done` events emitted by the subscriber flow to the UI; the execution loop awaits the compaction promise and then calls `session.agent.continue()` if the agent was mid-turn

#### Scenario: Execution resumes after background compaction (mid-turn abort)
- **WHEN** background compaction fires while the agent is in the middle of a turn (last message role is not `assistant`)
- **THEN** after the compaction promise resolves, `session.agent.continue()` is called via `runWithLimiter` and the agent continues from where it left off

#### Scenario: Execution ends after background compaction (turn-boundary abort)
- **WHEN** background compaction fires at the boundary of a completed turn (last message role is `assistant`)
- **THEN** after the compaction promise resolves, the execution loop exits normally without calling `session.agent.continue()`

#### Scenario: Shutdown cancels in-flight background compactions
- **WHEN** the engine shuts down while one conversation has a background compaction running
- **THEN** that session's `cancelCompaction()` is called prior to disposal and `shutdown()` resolves without hanging
