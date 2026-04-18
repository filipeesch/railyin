## ADDED Requirements

### Requirement: Frontend calls backend via typed fetch wrapper
The system SHALL provide an `api(method, params)` function that sends a `POST /api/<method>` request with the params serialized as JSON and returns a typed Promise of the response. This replaces the previous `electroview.rpc.request[method](params)` pattern.

#### Scenario: Successful request
- **WHEN** a store calls `api("tasks.list", { boardId: 1 })`
- **THEN** a `POST /api/tasks.list` request is made with body `{"boardId":1}` and the response JSON is returned

#### Scenario: Server error response
- **WHEN** the server returns a 5xx response
- **THEN** the `api()` call rejects with an `Error` whose message comes from the response body's `error` field

### Requirement: Frontend receives push events over a single WebSocket connection
The system SHALL establish one WebSocket connection to `/ws` on mount and dispatch incoming JSON frames to the appropriate registered callbacks (`onStreamToken`, `onStreamEvent`, `onTaskUpdated`, `onNewMessage`, `onWorkflowReloaded`).

#### Scenario: Stream event dispatched
- **WHEN** a WS frame `{"type":"stream.event","payload":{...}}` is received
- **THEN** the registered `onStreamEventMessage` callback is called with the payload

#### Scenario: Task update dispatched
- **WHEN** a WS frame `{"type":"task.updated","payload":{...}}` is received
- **THEN** the registered `onTaskUpdated` callback is called with the payload

#### Scenario: WebSocket reconnect on disconnect
- **WHEN** the WS connection drops unexpectedly
- **THEN** the client attempts to reconnect with exponential backoff (1s, 2s, 4s… up to 30s max)

#### Scenario: Reconnect after recovery
- **WHEN** the WS reconnects after a disconnect
- **THEN** normal push event dispatch resumes without requiring a page reload

### Requirement: Push callback API is preserved
The system SHALL export the same callback-registration functions as the previous Electroview adapter: `onStreamToken`, `onStreamError`, `onStreamEventMessage`, `onTaskUpdated`, `onNewMessage`, `onWorkflowReloaded`. Existing callers in App.vue and BoardView.vue SHALL require no changes.

#### Scenario: Callback registration
- **WHEN** a component calls `onTaskUpdated(cb)`
- **THEN** `cb` is invoked whenever a `task.updated` WS frame arrives

### Requirement: Vue Router uses HTML5 history mode
The system SHALL use `createWebHistory()` instead of `createWebHashHistory()`. The backend SPA fallback ensures deep links are served correctly.

#### Scenario: Direct navigation to deep link
- **WHEN** a user navigates directly to `http://localhost:3000/board`
- **THEN** the server returns `index.html` and Vue Router renders the correct view

### Requirement: Vite dev server proxies API and WS to backend
In development, the Vite dev server (`localhost:5173`) SHALL proxy all `/api/*` requests and `/ws` WebSocket upgrades to the Bun backend (`localhost:3000`).

#### Scenario: Dev API proxy
- **WHEN** the frontend (on port 5173) calls `api("tasks.list", {})`
- **THEN** the request is proxied to `http://localhost:3000/api/tasks.list` transparently

#### Scenario: Dev WS proxy
- **WHEN** the frontend (on port 5173) opens a WebSocket to `/ws`
- **THEN** the connection is proxied to `ws://localhost:3000/ws`
