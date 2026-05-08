# Pi Undo Stack Tests

## Purpose

Unit test coverage for `UndoStack` behavioral contracts. Tests instantiate `UndoStack` directly; `beforeContent` values are plain strings.

## Requirements

### Requirement: UndoStack unit test coverage
The test suite SHALL cover all `UndoStack` behavioral contracts at the unit level in `src/bun/test/pi-undo-stack.test.ts`. Tests instantiate `UndoStack` directly; `beforeContent` values are plain strings.

#### Scenario: US-1 Push records snapshot with operationId
- **WHEN** `push({ path, type, beforeContent })` is called
- **THEN** the stack entry is stored with a generated `op:XXXX` 4-char hex id
- **AND** `push` returns the operationId string

#### Scenario: US-2 Undo by path restores most recent write and removes entry
- **WHEN** `peekByPath(path)` is called after a `push` for that path
- **THEN** returns the most recent snapshot for that path
- **AND** `popByPath(path)` removes that entry from the stack

#### Scenario: US-3 Chained undo peels layers
- **WHEN** three writes to the same path are pushed: v1, v2, v3
- **AND** `popByPath(path)` is called three times
- **THEN** the returned `beforeContent` is v2, then v1, then `null` (no more entries for path)

#### Scenario: US-4 Undo by operationId restores specific entry
- **WHEN** `popById("a3f9")` is called
- **THEN** returns the snapshot with that operationId regardless of position in stack
- **AND** removes only that entry

#### Scenario: US-5 FIFO eviction at 50 entries
- **WHEN** 51 entries are pushed
- **THEN** the oldest entry (entry 1) is evicted
- **AND** stack length is 50

#### Scenario: US-6 No entry for path returns null
- **WHEN** `popByPath("never-written.ts")` is called on an empty stack
- **THEN** returns `null` without throwing

#### Scenario: US-7 Snapshot before patch stores full pre-patch content
- **WHEN** `push({ path, type: "patch_file", beforeContent: "full original content" })` is called
- **THEN** `popByPath(path)` returns `{ beforeContent: "full original content", type: "patch_file" }`
