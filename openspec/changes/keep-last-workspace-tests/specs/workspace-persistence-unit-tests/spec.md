## ADDED Requirements

### Requirement: Workspace store localStorage persistence is unit-tested
The workspace store's init-from-storage and watch-based write-back behaviour SHALL be covered by Pinia unit tests that seed and inspect `localStorage` directly.

#### Scenario: WS-P-1 — no stored key → initialises to null (falls back to first workspace in loadWorkspaces)
- **WHEN** `localStorage` is empty and the workspace store is initialised
- **THEN** `activeWorkspaceKey` starts as `null`

#### Scenario: WS-P-2 — stored key matches a loaded workspace → restored after loadWorkspaces
- **WHEN** `localStorage` contains `railyn.activeWorkspaceKey` = `"ws-2"` and `loadWorkspaces()` returns a list that includes `"ws-2"`
- **THEN** `activeWorkspaceKey` equals `"ws-2"` after `loadWorkspaces()` resolves

#### Scenario: WS-P-3 — stored key absent from workspace list → falls back to first workspace
- **WHEN** `localStorage` contains `railyn.activeWorkspaceKey` = `"deleted-ws"` and `loadWorkspaces()` returns a list that does NOT include `"deleted-ws"`
- **THEN** `activeWorkspaceKey` equals the key of the first workspace in the list

#### Scenario: WS-P-4 — selecting a workspace persists the key to localStorage
- **WHEN** `selectWorkspace("ws-3")` is called on the store
- **THEN** `localStorage.getItem("railyn.activeWorkspaceKey")` equals `'"ws-3"'` (JSON-encoded string)
