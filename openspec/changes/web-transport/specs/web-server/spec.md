## ADDED Requirements

### Requirement: Backend exposes all RPC handlers as HTTP POST routes
The system SHALL expose each RPC handler as an HTTP POST endpoint at `/api/<method>` (e.g., `POST /api/tasks.list`). The request body SHALL be a JSON object matching the handler's params type. The response SHALL be a JSON object matching the handler's response type.

#### Scenario: Successful API call
- **WHEN** the frontend sends `POST /api/tasks.list` with body `{"boardId": 1}`
- **THEN** the server returns `200 OK` with a JSON array of tasks

#### Scenario: Unknown route
- **WHEN** a request is made to an unregistered path
- **THEN** the server returns `404 Not Found`

#### Scenario: Handler throws an error
- **WHEN** a registered handler throws an exception
- **THEN** the server returns `500 Internal Server Error` with a JSON body `{"error": "<message>"}`

### Requirement: Backend pushes real-time events over WebSocket
The system SHALL accept WebSocket connections at `/ws`. Once connected, the server SHALL push all stream events, task updates, new messages, and workflow reload notifications to all connected clients as JSON frames.

#### Scenario: Client connects
- **WHEN** a browser client connects to `ws://localhost:<PORT>/ws`
- **THEN** the connection is accepted and the client is registered to receive push events

#### Scenario: Stream event broadcast
- **WHEN** the AI engine emits a `stream.event`
- **THEN** the server sends a JSON frame `{"type": "stream.event", "payload": {...}}` to all connected WS clients

#### Scenario: Task updated broadcast
- **WHEN** a task's state changes (execution started, completed, failed, etc.)
- **THEN** the server sends a JSON frame `{"type": "task.updated", "payload": {...}}` to all connected WS clients

#### Scenario: Client disconnects
- **WHEN** a WS client disconnects
- **THEN** the server removes it from the broadcast set; no error is thrown

### Requirement: Backend serves the frontend as static files
The system SHALL serve the built Vue frontend (`dist/`) as static files from the same Bun process on the same port. Requests to `/` or any non-`/api` and non-`/ws` path SHALL serve `dist/index.html` (SPA fallback).

#### Scenario: Root path request
- **WHEN** a browser requests `GET /`
- **THEN** the server responds with `dist/index.html`

#### Scenario: Asset request
- **WHEN** a browser requests `GET /assets/main-abc123.js`
- **THEN** the server responds with the corresponding file from `dist/assets/`

#### Scenario: SPA deep link fallback
- **WHEN** a browser requests a path like `GET /board`
- **THEN** the server responds with `dist/index.html` so Vue Router handles routing client-side

### Requirement: Server binds to localhost and respects PORT env var
The system SHALL bind to `127.0.0.1` (loopback only) by default to prevent external access. The port SHALL default to `3000` and be overridable via the `PORT` environment variable. The actual bound port SHALL be logged on startup.

#### Scenario: Default port
- **WHEN** `PORT` env var is not set
- **THEN** the server binds to `127.0.0.1:3000`

#### Scenario: Custom port
- **WHEN** `PORT=8080` is set
- **THEN** the server binds to `127.0.0.1:8080`

#### Scenario: Startup log
- **WHEN** the server starts successfully
- **THEN** a line is printed to stdout: `Railyn server listening on http://127.0.0.1:<PORT>`
