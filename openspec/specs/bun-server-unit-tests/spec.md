# Spec: Bun Server Unit Tests

## Purpose

Unit-test coverage for the extracted Bun server bootstrap modules: `BroadcastChannel`, `NotificationService`, `StreamEventProcessor`, `WebSocketHandler`, `createShutdownHandler`, and `setupFileLogging`. Each class/function is tested in isolation via dependency injection and spies — no real network, DB, or file I/O required except where explicitly noted.

## Requirements

### Requirement: BroadcastChannel sends to all clients and tolerates errors
The `BroadcastChannel` class SHALL broadcast JSON-serialized messages to every client in its `clients` Set and SHALL silently swallow errors from clients that have disconnected.

#### Scenario: BC-1 — Message is serialized and sent to all clients
- **WHEN** `broadcast(msg)` is called with a JSON-serializable object and two clients are in the Set
- **THEN** each client's `send()` is called with `JSON.stringify(msg)`

#### Scenario: BC-2 — Disconnected client error is swallowed
- **WHEN** one client's `send()` throws and `broadcast(msg)` is called
- **THEN** no exception propagates to the caller

#### Scenario: BC-3 — Remaining clients still receive message when one throws
- **WHEN** the first client throws on `send()` and a second client is healthy
- **THEN** the second client's `send()` is still called with the message

---

### Requirement: NotificationService maps domain events to typed broadcast payloads
The `NotificationService` class SHALL have one method per push event type and each method SHALL call `channel.broadcast()` with the correct `type` and `payload` shape matching the RPC contract.

#### Scenario: NS-1 — onError broadcasts stream.error
- **WHEN** `onError(taskId, conversationId, executionId, error)` is called
- **THEN** channel receives `{ type: "stream.error", payload: { taskId, conversationId, executionId, error } }`

#### Scenario: NS-2 — notifyTaskUpdated broadcasts task.updated
- **WHEN** `notifyTaskUpdated(task)` is called
- **THEN** channel receives `{ type: "task.updated", payload: task }`

#### Scenario: NS-3 — notifyNewMessage broadcasts message.new
- **WHEN** `notifyNewMessage(message)` is called
- **THEN** channel receives `{ type: "message.new", payload: message }`

#### Scenario: NS-4 — notifyWorkflowReloaded broadcasts workflow.reloaded
- **WHEN** `notifyWorkflowReloaded()` is called
- **THEN** channel receives `{ type: "workflow.reloaded", payload: {} }`

#### Scenario: NS-5 — notifyChatSessionUpdated broadcasts chatSession.updated
- **WHEN** `notifyChatSessionUpdated(session)` is called
- **THEN** channel receives `{ type: "chatSession.updated", payload: session }`

#### Scenario: NS-6 — broadcastConfigError broadcasts config.error
- **WHEN** `broadcastConfigError(details)` is called
- **THEN** channel receives `{ type: "config.error", payload: details }`

---

### Requirement: StreamEventProcessor enriches, broadcasts, and persists stream events
The `StreamEventProcessor` class SHALL enrich events with monotonically increasing `seq` and derived `blockId`, broadcast them immediately, and persist a subset to `stream_events` via its WriteBuffer.

#### Scenario: SP-1 — Non-persisted event type only broadcasts
- **WHEN** `onStreamEvent({ type: "text_chunk", ... })` is called
- **THEN** channel.broadcast is called and no row is added to `stream_events`

#### Scenario: SP-2 — Persisted event type broadcasts and enqueues
- **WHEN** `onStreamEvent({ type: "assistant", ... })` is called and the WriteBuffer is flushed
- **THEN** channel.broadcast is called and one row appears in `stream_events`

#### Scenario: SP-3 — Seq numbers are monotonically increasing per execution
- **WHEN** three events for the same execution are processed in order
- **THEN** their `seq` values are 0, 1, 2 respectively

#### Scenario: SP-4 — done=true flushes buffer and removes enricher
- **WHEN** `onStreamEvent({ type: "assistant", done: true, ... })` is called
- **THEN** the WriteBuffer is flushed synchronously and a subsequent event for the same execution starts with seq=0 on a fresh enricher

#### Scenario: SP-5 — Two parallel executions have independent seq counters
- **WHEN** events for execution A and execution B are interleaved
- **THEN** each execution's seq starts at 0 and increments independently

#### Scenario: SP-6 — Claude text_delta raw message broadcasts text_chunk immediately
- **WHEN** `onRawMessageEnqueued(item)` is called with a Claude `content_block_delta` / `text_delta` payload
- **THEN** channel.broadcast is called with `{ type: "stream.event", payload: { type: "text_chunk", ... } }` synchronously

#### Scenario: SP-7 — Claude thinking_delta raw message broadcasts reasoning_chunk immediately
- **WHEN** `onRawMessageEnqueued(item)` is called with a Claude `content_block_delta` / `thinking_delta` payload
- **THEN** channel.broadcast is called with `{ type: "stream.event", payload: { type: "reasoning_chunk", ... } }` synchronously

#### Scenario: SP-8 — Copilot assistant.message_delta broadcasts text_chunk immediately
- **WHEN** `onRawMessageEnqueued(item)` is called with a Copilot `assistant.message_delta` event
- **THEN** channel.broadcast is called with `{ type: "stream.event", payload: { type: "text_chunk", ... } }` synchronously

#### Scenario: SP-9 — setMarkClaudeExecution fn is called for qualifying raw deltas
- **WHEN** `setMarkClaudeExecution(spy)` is called and then a qualifying raw delta is enqueued
- **THEN** the spy is called with the execution id

#### Scenario: SP-10 — setMarkClaudeExecution not called before it is set
- **WHEN** a qualifying raw delta is enqueued before `setMarkClaudeExecution` is called
- **THEN** no error is thrown (defaults to no-op)

---

### Requirement: WebSocketHandler manages push and PTY WebSocket lifecycle
The `WebSocketHandler` class SHALL correctly register push clients, replay PTY scrollback, wire data/exit listeners, and clean up on close.

#### Scenario: WS-1 — Push WS open adds client to channel
- **WHEN** `open(ws)` is called with `ws.data.type === "push"`
- **THEN** `ws` is added to the channel's clients Set (visible via `channel.broadcast`)

#### Scenario: WS-2 — Push WS close removes client from channel
- **WHEN** `close(ws)` is called for a push WS
- **THEN** the client is removed and subsequent broadcasts do not reach it

#### Scenario: WS-3 — PTY WS open replays scrollback and registers listeners
- **WHEN** `open(ws)` is called with `ws.data.type === "pty"` for a known, running session
- **THEN** `ws.send(session.scrollback)` is called and a data listener is added to `session.dataListeners`

#### Scenario: WS-4 — PTY WS open for unknown session closes with 4404
- **WHEN** `open(ws)` is called for a session id that `getPtySession` returns `undefined` for
- **THEN** `ws.close(4404, "session-not-found")` is called

#### Scenario: WS-5 — PTY WS open for exited session replays scrollback only
- **WHEN** `open(ws)` is called for a session where `session.exited === true`
- **THEN** scrollback is sent but no data listener is registered

#### Scenario: WS-6 — PTY WS close removes data and exit listeners
- **WHEN** `close(ws)` is called after a PTY WS was opened
- **THEN** the data and exit listeners are removed from `session.dataListeners` and `session.exitListeners`

#### Scenario: WS-7 — PTY message raw text forwarded to terminal.write
- **WHEN** `message(ws, "hello")` is called for a PTY WS
- **THEN** `session.terminal.write("hello")` is called

#### Scenario: WS-8 — PTY message resize JSON calls terminal.resize
- **WHEN** `message(ws, JSON.stringify({ type: "resize", cols: 80, rows: 24 }))` is called
- **THEN** `session.terminal.resize(80, 24)` is called

#### Scenario: WS-9 — Push channel message is a no-op
- **WHEN** `message(ws, "any")` is called for a push WS
- **THEN** no error is thrown and no observable side-effect occurs

---

### Requirement: createShutdownHandler provides idempotent graceful shutdown
The `createShutdownHandler` factory SHALL return an object whose `shutdown()` is safe to call multiple times and calls all cleanup functions in sequence.

#### Scenario: SD-1 — shutdown() is idempotent
- **WHEN** `shutdown()` is called twice in succession
- **THEN** `killAllPtySessions` is called exactly once

#### Scenario: SD-2 — shutdown() invokes orchestrator.shutdownNonNativeEngines
- **WHEN** `shutdown()` is called with a non-null orchestrator mock
- **THEN** `orchestrator.shutdownNonNativeEngines({ reason: "app-exit", deadlineMs })` is called

#### Scenario: SD-3 — shutdown() calls killAllPtySessions then stopAllCodeServers
- **WHEN** `shutdown()` is called
- **THEN** `killAllPtySessions()` and `stopAllCodeServers()` are both called

#### Scenario: SD-4 — shutdown() with null orchestrator completes without throwing
- **WHEN** `createShutdownHandler(null, opts)` is used and `shutdown()` is called
- **THEN** `killAllPtySessions()` and `stopAllCodeServers()` are still called

---

### Requirement: setupFileLogging patches console and supports clean test teardown
The `setupFileLogging(logDir?)` function SHALL tee `console.log/warn/error` to a rotating log file in `logDir` and SHALL return a `restore()` function that undoes the patches.

#### Scenario: FL-1 — Log file is created when it does not exist
- **WHEN** `setupFileLogging(tmpDir)` is called and no `bun.log` file exists in `tmpDir`
- **THEN** `bun.log` is created and subsequent `console.log` output is written to it

#### Scenario: FL-2 — Existing log is rotated to bun.log.prev
- **WHEN** `setupFileLogging(tmpDir)` is called and `bun.log` already exists
- **THEN** the existing file is renamed to `bun.log.prev` and a fresh `bun.log` is created

#### Scenario: FL-3 — console.log writes timestamped INFO line
- **WHEN** `console.log("hello")` is called after setup
- **THEN** `bun.log` contains a line with `"INFO "` and `"hello"`

#### Scenario: FL-4 — restore() undoes console patches
- **WHEN** `restore()` is called and then `console.log("after")` is called
- **THEN** `bun.log` does NOT contain `"after"` (original console.log is restored)
