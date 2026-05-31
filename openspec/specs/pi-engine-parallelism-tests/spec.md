# Pi Engine Parallelism Tests

## Purpose

Specifies the test coverage requirements for the Pi engine parallelism features: provider concurrency limiter unit tests, config validation tests, background compaction integration tests, delegate tool integration tests, and delegate UI rendering Playwright tests.

## Requirements

### Requirement: ProviderLimiter unit tests

`ProviderLimiter` SHALL be covered by a dedicated unit test file `src/bun/test/pi-provider-limiter.test.ts`. All tests MUST run without any SDK, network, or file I/O. The limiter under test is the standalone class extracted from `pi-engine-parallelism` task 2.x.

#### Scenario: Default max_inflight is 8
- **WHEN** a `ProviderLimiter` is constructed without an explicit `maxInflight`
- **THEN** `limiter.maxInflight` equals `8`

#### Scenario: FIFO: third waiter queued when two slots in use
- **WHEN** a limiter with `maxInflight = 2` has two outstanding acquisitions and a third `acquire()` is called
- **THEN** the third promise is pending (not yet resolved) and `limiter.queueDepth` equals `1`

#### Scenario: Waiter unblocks after slot release
- **WHEN** a limiter with `maxInflight = 1` has one outstanding acquisition and a second waiter is queued, then the first is released
- **THEN** the second waiter resolves

#### Scenario: Aborted waiter is removed without consuming a slot
- **WHEN** a waiter is queued and its `AbortSignal` fires before a slot is free
- **THEN** the waiter's `acquire()` rejects, `queueDepth` decrements, and `inFlight` is unchanged

#### Scenario: Release after transport error frees the next waiter
- **WHEN** an in-flight slot is released (simulating a stream error) while a waiter is queued
- **THEN** the queued waiter resolves within the same microtask tick

#### Scenario: tryAcquire returns release function when slot free
- **WHEN** `limiter.tryAcquire()` is called with a free slot
- **THEN** it returns a non-null release function and `inFlight` increments

#### Scenario: tryAcquire returns null when all slots taken
- **WHEN** `limiter.tryAcquire()` is called with all slots occupied
- **THEN** it returns `null` and `inFlight` is unchanged

#### Scenario: queue_timeout_ms fires and rejects waiter
- **WHEN** a limiter with `queueTimeoutMs = 50` has no free slots and a waiter has been queued for 50+ ms
- **THEN** the waiter's `acquire()` rejects with a timeout error and the queue entry is removed

#### Scenario: LM Studio startup warning when max_inflight > 2
- **WHEN** the engine starts with a provider configured as `base_url: "http://localhost:1234"` and `max_inflight: 8`
- **THEN** a warning is logged that names the provider and recommends `max_inflight: 2`

#### Scenario: LM Studio warning suppressed at max_inflight = 2
- **WHEN** a provider is configured as `base_url: "http://localhost:1234"` and `max_inflight: 2`
- **THEN** no LM Studio warning is logged

#### Scenario: getPiProviderStatus snapshot is accurate
- **WHEN** a provider limiter has 2 in-flight and 1 queued and `getPiProviderStatus()` is called
- **THEN** the snapshot contains `inFlight: 2`, `queueDepth: 1`, `p50LatencyMs: null | number`, `recentRejectCount: number`

### Requirement: Config validation unit tests

`validatePiEngineConfig` SHALL be covered in `src/bun/test/pi-engine.test.ts` under a dedicated `describe("PiEngine config validation")` block.

#### Scenario: max_per_call = 0 rejected
- **WHEN** `harness.delegate.max_per_call` is set to `0`
- **THEN** the validation throws and the error message names `harness.delegate.max_per_call`

#### Scenario: max_per_call = 11 rejected
- **WHEN** `harness.delegate.max_per_call` is set to `11`
- **THEN** the validation throws and the error message names `harness.delegate.max_per_call`

#### Scenario: early_margin_tokens below 1024 rejected
- **WHEN** `harness.background_compaction.early_margin_tokens` is set to `512`
- **THEN** the validation throws and the error message names `harness.background_compaction.early_margin_tokens`

#### Scenario: Valid config passes without error
- **WHEN** `harness.delegate.max_per_call = 5` and `harness.background_compaction.early_margin_tokens = 8192`
- **THEN** validation completes without throwing

#### Scenario: Soft threshold is strictly less than hard threshold
- **WHEN** `computeSoftCompactionThreshold(128000, 16384, 8192)` is called
- **THEN** the result equals `128000 - 16384 - 8192 = 103424` and is less than `128000 - 16384 = 111616`

### Requirement: Background compaction engine integration tests

Background compaction trigger logic SHALL be covered in `src/bun/test/pi-engine.test.ts` under a `describe("PiEngine background compaction")` block, using `MockAgentSession` and an injectable `InMemoryProviderLimiter` stub.

#### Scenario: Fires asynchronously when context exceeds soft threshold and slot is free
- **WHEN** `getContextUsage()` returns tokens above `softThreshold` at `turn_end` and `limiter.tryAcquire()` returns a release function
- **THEN** `session.compact()` is called asynchronously and the engine does not await it before yielding the next event

#### Scenario: Skipped when limiter has no free slots
- **WHEN** `getContextUsage()` returns tokens above `softThreshold` at `turn_end` and `limiter.tryAcquire()` returns `null`
- **THEN** `session.compact()` is NOT called

#### Scenario: No double-trigger when compaction is already in flight
- **WHEN** a background compaction is in flight (tracked per conversationId) and a subsequent `turn_end` would otherwise trigger another
- **THEN** `session.compact()` is called exactly once, not twice

#### Scenario: Compaction summary persisted when background compact completes
- **WHEN** background compaction completes and returns `{ summary: "Compacted 40k tokens." }`
- **THEN** a `compaction_summary` row is inserted via `appendMessage` for the conversation

#### Scenario: Shutdown calls cancelCompaction on in-flight session
- **WHEN** `engine.shutdown()` is called while a background compaction is in flight for a conversation
- **THEN** `session.cancelCompaction()` is called before the session is disposed

### Requirement: Delegate tool integration tests

The `delegate` tool SHALL be covered in `src/bun/test/pi-delegate.test.ts` using `MockAgentSession` (injectable `childSessionFactory`) and in-memory SQLite.

#### Scenario: Two tasks both succeed — digest contains two sections
- **WHEN** `delegate` is called with two tasks `{ id: "a", prompt: "..." }` and `{ id: "b", prompt: "..." }` and both child sessions complete successfully
- **THEN** the tool result markdown contains `### a` and `### b` sections, each with the child's final assistant text

#### Scenario: One of three tasks fails — digest contains error section
- **WHEN** one of three child sessions throws and the other two succeed
- **THEN** the tool result contains two success sections and one `### c` section whose body begins with `**error**:`

#### Scenario: Concurrency cap: only min(N, limiter.maxInflight) children dispatch at once
- **WHEN** `max_inflight = 2` and three tasks are submitted
- **THEN** exactly two child sessions are started simultaneously; the third starts only after one of the first two completes

#### Scenario: Parent abort signal propagates to all children
- **WHEN** the parent execution's abort signal fires while two children are running
- **THEN** both child sessions' `abort()` methods are called and limiter slots held by children are released

#### Scenario: Child tool_start events carry parentCallId
- **WHEN** a child session emits a `tool_start` event
- **THEN** the event is forwarded on the parent stream with `parentCallId = delegate_tool_call_id` and `isInternal: true`

#### Scenario: Temp session files cleaned up after successful run
- **WHEN** a `delegate` invocation completes successfully
- **THEN** no files exist under `~/.railyin/pi-sessions/delegate-${parentConversationId}/`

#### Scenario: Temp session files cleaned up after error
- **WHEN** all child sessions fail
- **THEN** no files remain under the delegate temp directory

#### Scenario: tasks.length > max_per_call rejected before spawning
- **WHEN** `delegate` is called with 6 tasks and `harness.delegate.max_per_call = 5`
- **THEN** the tool returns an error result immediately and no child sessions are created

#### Scenario: Duplicate task ids rejected
- **WHEN** `delegate` is called with two tasks having the same `id`
- **THEN** the tool returns a validation error and no children are spawned

#### Scenario: Disallowed tool group rejected
- **WHEN** a task specifies `tools: ["shell"]` and `harness.delegate.allow_tools = ["read"]`
- **THEN** the tool returns an error naming the rejected group and no children are spawned

#### Scenario: Child tool set is read-only by default
- **WHEN** a child session is created without specifying `tools`
- **THEN** the tool names passed to the child factory include SDK builtins and `read` group tools but NOT `write`, `shell`, `patch_file`, `run_command`, `create_task`, `move_task`, `record_decision`, `update_todo_status`, `decision_request`, or `delegate`

#### Scenario: delegate not available in child tool set (recursive guard)
- **WHEN** a child session is created
- **THEN** `delegate` is not in the list of tools passed to the child factory

### Requirement: Delegate UI rendering Playwright tests

`delegate` tool rendering SHALL be covered in `e2e/ui/delegate-rendering.spec.ts` using static pre-seeded `conversations.getMessages` mock (same pattern as `tool-rendering.spec.ts` S-26). No live WS or real backend required.

#### Scenario: S-D1 — delegate card shows child badge count
- **WHEN** the conversation contains a `delegate` tool_call message with two child tool_call messages (parentCallId = delegate callId)
- **THEN** the delegate tool card badge shows `2`

#### Scenario: S-D2 — expand reveals nested child tool cards
- **WHEN** the delegate card header is clicked to expand
- **THEN** two nested `.tc` child cards are visible with the correct tool names

#### Scenario: S-D3 — digest markdown renders in message body
- **WHEN** the conversation contains an `assistant` message with the delegate digest markdown (`### a\n...`)
- **THEN** the message body renders a heading `a` and its content text

#### Scenario: S-D4 — collapsed children are hidden before expand
- **WHEN** the delegate card is rendered but not yet expanded
- **THEN** `tc__children > .tc` count is `0`
