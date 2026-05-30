## ADDED Requirements

### Requirement: Workspace and board selections are restored end-to-end after a page reload
Playwright tests SHALL verify that a user who had previously selected a non-default workspace and board returns to those same selections after a full page reload, and that all fallback scenarios are covered.

#### Scenario: BP-E2E-1 — reload restores both workspace and board
- **WHEN** `localStorage` is pre-seeded with `railyn.activeWorkspaceKey` = `"ws-2"` and `railyn.activeBoardId` = `42` via `page.addInitScript`, and the API returns workspace `"ws-2"` and board `42` in the `"ws-2"` workspace
- **THEN** after `page.goto("/")`, the workspace tab for `"ws-2"` has the `is-active` class and the board selector shows board `42`

#### Scenario: BP-E2E-2 — no stored values → defaults to first workspace and first board
- **WHEN** `localStorage` is empty and the page loads
- **THEN** the first workspace tab is active and the first board is selected (existing default behaviour)

#### Scenario: BP-E2E-3 — clicking a workspace tab persists the key to localStorage
- **WHEN** the user clicks a workspace tab for `"ws-2"`
- **THEN** `localStorage.getItem("railyn.activeWorkspaceKey")` equals `'"ws-2"'`

#### Scenario: BP-E2E-4 — selecting a board via the dropdown persists the id to localStorage
- **WHEN** the user selects board `42` from the board dropdown
- **THEN** `localStorage.getItem("railyn.activeBoardId")` contains the id `42`

#### Scenario: BP-E2E-5 — stale workspace key → falls back to first workspace on reload
- **WHEN** `localStorage` contains `railyn.activeWorkspaceKey` = `"deleted-ws"` and the API returns a workspace list that does NOT include `"deleted-ws"`
- **THEN** the first workspace in the list is shown as active

#### Scenario: BP-E2E-6 — stale board id → falls back to first board of active workspace on reload
- **WHEN** `localStorage` contains `railyn.activeBoardId` = `9999` and the boards list returned by the API does NOT contain id `9999`
- **THEN** the first board of the active workspace is selected

### Requirement: Workspace tab click persistence is captured in the workspace-nav test file
The `board-workspace-nav.spec.ts` file SHALL include one test verifying that clicking a workspace tab persists the workspace key to localStorage.

#### Scenario: WS-NAV-3 — switching workspace tabs persists key to localStorage
- **WHEN** the user clicks the tab for workspace `"ws-2"`
- **THEN** `page.evaluate(() => localStorage.getItem("railyn.activeWorkspaceKey"))` returns `'"ws-2"'`
