# Spec: stream-test-watermark

## Purpose

Test bridge synchronization primitives for stream event injection, using the `streamVersion` watermark from the Pinia task store to eliminate sleep-based synchronization in tests.

## Requirements

### Requirement: getStreamVersion reads the global stream version counter
The bridge SHALL expose a `getStreamVersion()` function that reads `streamVersion` from the Pinia task store via `webEval` and returns it as a number.

#### Scenario: Read current version
- **WHEN** `getStreamVersion()` is called
- **THEN** it SHALL return the current value of `pinia._s.get('task').streamVersion` as a number

### Requirement: waitForStreamVersion blocks until version reaches target
The bridge SHALL expose a `waitForStreamVersion(minVersion, timeoutMs?)` function that polls `streamVersion` at 50ms intervals until it reaches or exceeds `minVersion`.

#### Scenario: Version already reached
- **WHEN** `waitForStreamVersion(5)` is called and current version is 7
- **THEN** it SHALL resolve immediately

#### Scenario: Version reached after polling
- **WHEN** `waitForStreamVersion(10)` is called and current version is 8
- **AND** events arrive bringing version to 10
- **THEN** it SHALL resolve once version >= 10

#### Scenario: Timeout before version reached
- **WHEN** `waitForStreamVersion(100, 2000)` is called and version never reaches 100
- **THEN** it SHALL throw an error after 2000ms with a message including the actual and expected version values

### Requirement: injectEvents queues events and waits for store processing
The bridge SHALL expose an `injectEvents(events)` function that sends events via HTTP POST and blocks until the store has processed all of them, using the `streamVersion` watermark.

#### Scenario: Single event injection
- **WHEN** `injectEvents([oneEvent])` is called
- **THEN** it SHALL POST to `/queue-stream-events`
- **AND** wait for `streamVersion` to increment by 1
- **AND** return the new version number

#### Scenario: Batch event injection
- **WHEN** `injectEvents([e1, e2, e3])` is called with 3 events
- **THEN** it SHALL POST all 3 in a single HTTP request
- **AND** wait for `streamVersion` to increment by 3
- **AND** return the new version number

#### Scenario: Store state is consistent after return
- **WHEN** `injectEvents(events)` returns
- **THEN** `getStreamState(taskId)` SHALL reflect all injected events in the tree structure

### Requirement: resetStream clears stream state with confirmation
The bridge SHALL expose a `resetStream(taskId, executionId)` function that clears all stream state for the given task and confirms via version watermark.

#### Scenario: Full reset
- **WHEN** `resetStream(taskId, execId)` is called
- **THEN** it SHALL send a synthetic `done` event
- **AND** delete the task from `streamStates` Map via webEval
- **AND** trigger Vue reactivity via `new Map()` assignment
- **AND** return after the version watermark confirms processing

#### Scenario: Reset on clean state
- **WHEN** `resetStream(taskId, execId)` is called and no stream state exists for the task
- **THEN** it SHALL complete without error

### Requirement: queueStreamEvents has no internal sleep
The `queueStreamEvents` function SHALL NOT include any internal `sleep()` delay. Synchronization is the caller's responsibility (via `injectEvents` or explicit `waitForStreamVersion`).

#### Scenario: Returns immediately after HTTP response
- **WHEN** `queueStreamEvents(events)` is called
- **THEN** it SHALL return as soon as the HTTP POST response is received
- **AND** SHALL NOT call `sleep()` before returning

### Requirement: Existing tests use injectEvents instead of sleep-based patterns
All existing tests (T-28 through T-45) SHALL use `injectEvents()` for event injection and `resetStream()` for beforeEach cleanup, with no `sleep()` calls between injection and assertion.

#### Scenario: No sleep-based synchronization in test bodies
- **WHEN** examining test code for T-28 through T-45
- **THEN** there SHALL be zero `await sleep(N)` calls used for event-to-assertion synchronization
- **AND** all event injection SHALL use `injectEvents()`

### Requirement: Reasoning chunks stream incrementally
Test T-46 SHALL verify that `reasoning_chunk` events update the DOM incrementally — content grows after each individual event injection.

#### Scenario: T-46 one-by-one chunk streaming
- **WHEN** 3 `reasoning_chunk` events are injected one at a time via separate `injectEvents` calls
- **THEN** after each call, `.rb__content` text SHALL contain the accumulated content of all chunks so far
- **AND** `.rb__content--streaming` class SHALL be present throughout

### Requirement: Reasoning chunks batch-accumulate into single block
Test T-47 SHALL verify that multiple `reasoning_chunk` events in a single `injectEvents` call merge into one live block.

#### Scenario: T-47 batch accumulation
- **WHEN** 3 `reasoning_chunk` events are injected in one `injectEvents([c1, c2, c3])` call
- **THEN** the stream state SHALL contain exactly 1 block of type `reasoning_chunk`
- **AND** its content SHALL equal the concatenation of all 3 chunks

### Requirement: Reasoning bubble auto-opens during streaming and closes after done
Test T-48 SHALL verify the ReasoningBubble component's `open` behavior during and after streaming.

#### Scenario: T-48 auto-open and auto-close
- **WHEN** a `reasoning_chunk` event is injected
- **THEN** `.rb__body` SHALL be visible (bubble expanded)
- **AND** when a persisted `reasoning` event followed by `done` is injected
- **THEN** `.rb__body` SHALL NOT be visible (bubble collapsed)

### Requirement: Tool call with parentBlockId renders as child of parent tool
Test T-49 SHALL verify that a `tool_call` event with `parentBlockId` pointing to another tool call appears in that tool's `children[]` array, not in `roots[]`.

#### Scenario: T-49 nested tool call
- **WHEN** a parent `tool_call` is injected at root level
- **AND** a child `tool_call` is injected with `parentBlockId` set to the parent's blockId
- **THEN** `getStreamState()` SHALL show the child in the parent's `children[]`
- **AND** the child SHALL NOT appear in `roots[]`

### Requirement: Reasoning chunk inside tool context renders as child
Test T-50 SHALL verify that `reasoning_chunk` events with `parentBlockId` pointing to a tool call render inside the tool's collapsible body.

#### Scenario: T-50 nested reasoning under tool
- **WHEN** a `tool_call` event is injected
- **AND** a `reasoning_chunk` event is injected with `parentBlockId` set to the tool's blockId
- **THEN** the reasoning block SHALL appear in the tool's `children[]`
- **AND** `.tcg__children .rb` SHALL be present in the DOM

### Requirement: Full nesting flow matches orchestrator event sequence
Test T-51 SHALL verify the complete orchestrator event sequence: reasoning → tool_call → nested reasoning inside tool → tool_result → text.

#### Scenario: T-51 full orchestrator flow
- **WHEN** events are injected in order: `reasoning_chunk`, `reasoning` (persisted), `tool_call`, `reasoning_chunk` (parent=tool), `reasoning` (parent=tool, persisted), `tool_result`, `assistant`
- **THEN** roots SHALL contain: [reasoning, tool_call, assistant] in order
- **AND** tool_call.children SHALL contain the nested reasoning block
- **AND** after `done`, no live blocks SHALL remain

### Requirement: Persisted reasoning replaces accumulated live chunks
Test T-52 SHALL verify that when a persisted `reasoning` event arrives after live `reasoning_chunk` events, the live block is removed and replaced by the persisted block with matching content.

#### Scenario: T-52 live-to-persisted transition
- **WHEN** 3 `reasoning_chunk` events are injected building up content "abc"
- **AND** a persisted `reasoning` event arrives with content "abc"
- **THEN** blocks of type `reasoning_chunk` SHALL have length 0
- **AND** exactly 1 block of type `reasoning` SHALL exist with content "abc"
