## ADDED Requirements

### Requirement: BroadcastChannel encapsulates WebSocket client set
The system SHALL provide a `BroadcastChannel` class in `src/bun/server/broadcast-channel.ts` that owns the `clients: Set<ServerWebSocket<WsData>>` and exposes a `broadcast(msg: object): void` method. A corresponding `IBroadcastChannel` interface SHALL be exported as the DI contract for all consumers.

#### Scenario: Broadcast sends to all connected clients
- **WHEN** `broadcast(msg)` is called with a JSON-serializable object
- **THEN** the message is serialized and sent to every client in the `clients` set

#### Scenario: Broadcast tolerates disconnected clients
- **WHEN** a client has disconnected but not yet been removed from the set
- **THEN** the send error is silently swallowed and the broadcast continues to remaining clients

### Requirement: NotificationService wraps all domain push events
The system SHALL provide a `NotificationService` class in `src/bun/server/notifications.ts` that accepts an `IBroadcastChannel` and exposes typed methods for every push event: `onError`, `notifyTaskUpdated`, `notifyNewMessage`, `notifyWorkflowReloaded`, `notifyChatSessionUpdated`, `broadcastConfigError`.

#### Scenario: Each notify method broadcasts typed payload
- **WHEN** any `notifyX(payload)` method is called
- **THEN** `channel.broadcast({ type: "<event-type>", payload })` is called with the correct RPC event shape

### Requirement: StreamEventProcessor handles enrichment, persistence, and streaming
The system SHALL provide a `StreamEventProcessor` class in `src/bun/server/stream-processor.ts` that:
- Owns the `enrichers: Map<number, StreamEventEnricher>` and `WriteBuffer` internally
- Exposes `onStreamEvent(event)` and `onRawMessageEnqueued(item)` as methods
- Exposes `setMarkClaudeExecution(fn)` as a late-bind setter
- Exposes `start()` to start the WriteBuffer flush interval

#### Scenario: Stream event is enriched and broadcast
- **WHEN** `onStreamEvent(event)` is called
- **THEN** the event is enriched with `seq` and `blockId` via `StreamEventEnricher`, broadcast to clients, and (if persisted type) enqueued to the WriteBuffer

#### Scenario: Raw message is broadcast immediately
- **WHEN** `onRawMessageEnqueued(item)` is called with a Claude or Copilot raw delta
- **THEN** a `stream.event` with `text_chunk` or `reasoning_chunk` type is broadcast immediately without waiting for the WriteBuffer flush

#### Scenario: Circular dependency resolved at startup
- **WHEN** `setMarkClaudeExecution(fn)` is called after Orchestrator construction
- **THEN** subsequent calls to `onRawMessageEnqueued` use the provided function to mark executions

### Requirement: WebSocketHandler encapsulates PTY and push WS lifecycle
The system SHALL provide a `WebSocketHandler` class in `src/bun/server/websocket.ts` that accepts an `IBroadcastChannel` and encapsulates the `ptyDataListeners` and `ptyExitListeners` WeakMaps. It SHALL implement `open`, `close`, and `message` methods compatible with `Bun.serve({ websocket: ... })`.

#### Scenario: Push WS client is tracked on open
- **WHEN** a WebSocket with `data.type === "push"` opens
- **THEN** the socket is added to the channel's clients set

#### Scenario: PTY data is forwarded to WS on open
- **WHEN** a WebSocket with `data.type === "pty"` opens for a known session
- **THEN** scrollback is replayed and data/exit listeners are registered on the PTY session

#### Scenario: Listeners are removed on WS close
- **WHEN** a PTY WebSocket closes
- **THEN** the data and exit listeners are removed from the PTY session and the WeakMaps

### Requirement: createShutdownHandler provides idempotent graceful shutdown
The system SHALL provide a `createShutdownHandler(orchestrator, opts?)` factory in `src/bun/server/shutdown.ts` that returns a `{ shutdown(): Promise<void> }` object. The shutdown function SHALL be idempotent (safe to call multiple times), call `orchestrator.shutdownNonNativeEngines()`, then `killAllPtySessions()` and `stopAllCodeServers()`.

#### Scenario: Shutdown is idempotent
- **WHEN** `shutdown()` is called twice
- **THEN** the shutdown sequence runs only once

#### Scenario: SIGTERM and SIGINT both trigger shutdown
- **WHEN** the process receives `SIGTERM` or `SIGINT`
- **THEN** `shutdown()` is called

### Requirement: setupFileLogging patches console methods for file rotation
The system SHALL provide a `setupFileLogging()` function in `src/bun/server/file-logger.ts` that patches `console.log`, `console.warn`, and `console.error` to tee output to `~/.railyn/logs/bun.log`, rotating the previous session's log to `bun.log.prev` on startup.

#### Scenario: Log file is created on first call
- **WHEN** `setupFileLogging()` is called and no log file exists
- **THEN** `~/.railyn/logs/bun.log` is created and subsequent console output is written to it

#### Scenario: Previous log is rotated
- **WHEN** `setupFileLogging()` is called and a log file already exists
- **THEN** the existing file is renamed to `bun.log.prev` before the new log file is created

### Requirement: index.ts is a linear composition root of ~80 lines
The system SHALL reduce `src/bun/index.ts` to a linear async module of approximately 80 lines that: sets up logging, processes CLI flags, runs DB migrations, wires the notification pipeline via DI, constructs the Orchestrator, starts jobs, and calls `Bun.serve()`. No business logic SHALL remain in `index.ts`.

#### Scenario: All modules are imported and wired in sequence
- **WHEN** the Bun process starts
- **THEN** `setupFileLogging()` is the first call, followed by sequential bootstrap steps, with `Bun.serve()` as the final substantive step

### Requirement: Dead debug-server endpoints are removed
The system SHALL remove all ~650 lines of test-environment endpoints (`/setup-test-env`, `/reset-decisions`, `/test-send-message`, etc.) from `index.ts`. Only the `/shutdown` endpoint and `DEBUG_PORT=` stdout line SHALL be retained within the `if (process.env.RAILYN_DEBUG)` block.

#### Scenario: /shutdown endpoint remains reachable
- **WHEN** `RAILYN_DEBUG=1` and a GET request is made to `/shutdown` on the debug port
- **THEN** the process exits after a 50ms delay and the endpoint returns `{ ok: true }`

#### Scenario: Dead endpoints are not present
- **WHEN** `RAILYN_DEBUG=1` and a request is made to `/setup-test-env`
- **THEN** the server returns a non-200 response (the endpoint does not exist)
