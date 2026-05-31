## ADDED Requirements

### Requirement: useSessionSyncHandler composable is unit-tested in isolation
The composable SHALL be testable by injecting stub implementations of `onWsReconnect`, `loadSessions`, and `watchKey` without any Pinia store or WsMock setup.

#### Scenario: SS-1 — registers reconnect callback
- **WHEN** `useSessionSyncHandler` is called with a stub `onWsReconnect`
- **THEN** the stub is called exactly once during setup with a callback function

#### Scenario: SS-2 — reconnect triggers loadSessions with current key
- **WHEN** the reconnect callback is invoked and `watchKey` returns `"ws-1"`
- **THEN** `loadSessions` is called with `"ws-1"`

#### Scenario: SS-3 — reconnect fires loadSessions on every reconnect
- **WHEN** the reconnect callback is invoked twice
- **THEN** `loadSessions` is called twice with the current key each time

#### Scenario: SS-4 — null key at reconnect maps to undefined
- **WHEN** the reconnect callback fires and `watchKey` returns `null`
- **THEN** `loadSessions` is called with `undefined`

#### Scenario: SS-5 — workspace key change triggers loadSessions
- **WHEN** the reactive source behind `watchKey` changes to a non-null value after mount
- **THEN** `loadSessions` is called with the new key after `nextTick()`

#### Scenario: SS-6 — workspace key change to null is ignored
- **WHEN** the reactive source behind `watchKey` changes to `null`
- **THEN** `loadSessions` is NOT called

#### Scenario: SS-7 — initial load fires immediately (watch immediate)
- **WHEN** `useSessionSyncHandler` is called with `watchKey` returning `"ws-1"`
- **THEN** `loadSessions` is called synchronously with `"ws-1"` before any `nextTick()`

#### Scenario: SS-8 — reconnect and key change are independent
- **WHEN** a key change fires and then a reconnect fires
- **THEN** `loadSessions` is called once for the key change and once for the reconnect

### Requirement: chat store WS push filter is unit-tested
`onChatSessionUpdated` in the chat store SHALL reject events whose `workspaceKey` does not match `workspaceStore.activeWorkspaceKey`.

#### Scenario: C7a — matching workspace key → session added
- **WHEN** `onChatSessionUpdated` receives a session with `workspaceKey === activeWorkspaceKey`
- **THEN** the session appears in `chatStore.sessions`

#### Scenario: C7b — mismatched workspace key → session ignored
- **WHEN** `onChatSessionUpdated` receives a session with `workspaceKey !== activeWorkspaceKey`
- **THEN** `chatStore.sessions` is unchanged

#### Scenario: C7c — null active workspace key → events pass through
- **WHEN** `activeWorkspaceKey` is `null` and `onChatSessionUpdated` receives a session
- **THEN** the session is added (boot-time guard: no workspace selected yet)

### Requirement: loadSessions idempotency is verified
Calling `chatStore.loadSessions` multiple times SHALL replace the session list, not append to it.

#### Scenario: C8a — repeated calls replace list
- **WHEN** `loadSessions` is called twice with the same key and the API returns the same list both times
- **THEN** `chatStore.sessions` has the same length as one API response (not doubled)

#### Scenario: C8b — correct workspace key is passed to API
- **WHEN** `loadSessions("ws-2")` is called
- **THEN** the API is called with `{ workspaceKey: "ws-2" }`

#### Scenario: C8c — switching workspace key clears old sessions
- **WHEN** `loadSessions("ws-1")` populates sessions, then `loadSessions("ws-2")` is called with a different response
- **THEN** only sessions from the `"ws-2"` response remain in `chatStore.sessions`

### Requirement: Playwright — sidebar re-fetches on workspace switch
The sidebar SHALL call `chatSessions.list` again with the new workspace key when the user switches workspace tabs.

#### Scenario: CS-H-3 — workspace tab click triggers re-fetch
- **WHEN** the user clicks a workspace tab for a different workspace
- **THEN** `chatSessions.list` is called with the new workspace key (verified via `api.capture`)

### Requirement: Playwright — WS push filtered by workspace
The sidebar SHALL not display sessions pushed via WS from a different workspace.

#### Scenario: CS-H-1 — cross-workspace push event ignored
- **WHEN** a `chatSession.updated` WS push arrives with a different `workspaceKey`
- **THEN** the session does NOT appear in the sidebar

#### Scenario: CS-H-2 — same-workspace push event accepted
- **WHEN** a `chatSession.updated` WS push arrives with the matching `workspaceKey`
- **THEN** the session appears in the sidebar

### Requirement: Playwright — count badge on chat toggle button
The toolbar chat toggle button SHALL display a count badge showing non-archived sessions.

#### Scenario: CS-I-1 — badge shows count when sessions exist
- **WHEN** `chatSessions.list` returns 2 non-archived sessions
- **THEN** the toggle button badge is visible and shows `2`

#### Scenario: CS-I-2 — badge hidden when no sessions exist
- **WHEN** `chatSessions.list` returns an empty list
- **THEN** the badge is not rendered (or has `0` hidden)

#### Scenario: CS-I-3 — badge increments on WS push
- **WHEN** a `chatSession.updated` WS push adds a new non-archived session
- **THEN** the badge count increments by 1

#### Scenario: CS-I-4 — archived sessions excluded from badge
- **WHEN** `chatSessions.list` returns 1 non-archived and 1 archived session
- **THEN** the badge shows `1`
