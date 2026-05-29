## ADDED Requirements

### Requirement: Board store localStorage persistence is unit-tested
The board store's init-from-storage, watch-based write-back, stale-id fallback, and cross-workspace guard inside `loadBoards(workspaceKey?)` SHALL be covered by Pinia unit tests.

#### Scenario: BP-1 — no stored id → activeBoardId remains null after loadBoards with no match
- **WHEN** `localStorage` is empty and `loadBoards()` is called
- **THEN** `activeBoardId` is set to the first board's id (existing default behaviour preserved)

#### Scenario: BP-2 — stored id matches a board in the list → restored
- **WHEN** `localStorage` contains `railyn.activeBoardId` = `42` and `loadBoards()` returns a list containing board id `42`
- **THEN** `activeBoardId` equals `42` after `loadBoards()` resolves

#### Scenario: BP-3 — stored id not in board list → falls back to first board
- **WHEN** `localStorage` contains `railyn.activeBoardId` = `999` and `loadBoards()` returns a list that does NOT contain id `999`
- **THEN** `activeBoardId` equals the id of the first board in the list

#### Scenario: BP-4 — stored id belongs to a different workspace → falls back to first board of given workspace
- **WHEN** `localStorage` contains `railyn.activeBoardId` = `42`, board `42` belongs to workspace `"ws-a"`, and `loadBoards("ws-b")` is called
- **THEN** `activeBoardId` equals the id of the first board whose `workspaceKey` is `"ws-b"`

#### Scenario: BP-5 — selecting a board persists the id to localStorage
- **WHEN** `selectBoard(7)` is called on the store
- **THEN** `localStorage.getItem("railyn.activeBoardId")` equals `"7"` (or JSON `"7"`)

#### Scenario: BP-6 — stored id matches board AND correct workspace → restored without change
- **WHEN** `localStorage` contains `railyn.activeBoardId` = `42`, board `42` belongs to `"ws-a"`, and `loadBoards("ws-a")` is called
- **THEN** `activeBoardId` equals `42`
