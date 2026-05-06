## ADDED Requirements

### Requirement: Write operations return an operationId for potential undo
The system SHALL embed an `operationId` (format `op:XXXX` where XXXX is a 4-character lowercase hex string) in the success string returned to the model for every `write_file`, `patch_file`, `delete_file`, and `rename_file` call. The `UndoStack` SHALL store a snapshot before each operation. The model can pass the `operationId` to `undo_write` to restore the prior state.

#### Scenario: write_file result includes operationId
- **WHEN** `write_file` succeeds
- **THEN** the result string is `"OK: wrote <path> (+N -M) [op:XXXX]"` and the undo stack contains a snapshot with `{ operationId: "XXXX", type: "write_file", path, snapshotBefore: <prior content or null if new file> }`

#### Scenario: delete_file result includes operationId
- **WHEN** `delete_file` succeeds
- **THEN** the result string is `"OK: deleted <path> (N lines) [op:XXXX]"` and the undo stack snapshot stores the full file content for restoration

#### Scenario: rename_file result includes operationId
- **WHEN** `rename_file` succeeds
- **THEN** the result string is `"OK: renamed <from> → <to> [op:XXXX]"` and the snapshot stores `{ fromPath, toPath }` for reverse rename

### Requirement: undo_write restores the pre-operation state by operationId or path, with chained undo support
The system SHALL provide an `undo_write` tool that accepts `{ operationId: string }` or `{ path: string }`. When given an `operationId`, it SHALL find and apply the matching snapshot. When given a `path`, it SHALL undo the most recent write operation for that path and remove that entry from the stack — successive calls with the same path SHALL peel additional layers (chained undo). On success, the tool SHALL return a confirmation string. On failure (operationId not found, stack expired, no more entries for path), it SHALL return a descriptive error.

#### Scenario: undo by operationId restores prior file content
- **WHEN** `undo_write({ operationId: "a3f9" })` is called and the operationId is in the stack
- **THEN** the file is restored to its pre-operation content, the cache entry for the path is invalidated, and the result is `"OK: reverted <path> to pre-op:a3f9 state"`

#### Scenario: undo by path restores most recent write to that path
- **WHEN** `undo_write({ path: "src/auth.ts" })` is called
- **THEN** the most recent undo stack entry for `src/auth.ts` is applied and removed from the stack

#### Scenario: chained undo by path peels multiple layers
- **WHEN** three writes to `src/auth.ts` are made (v1, v2, v3) and `undo_write({ path })` is called three times
- **THEN** the first call restores v2 content, the second restores v1 content, the third returns `"Error: no more undo history for src/auth.ts"`

#### Scenario: undo of a new-file write_file deletes the file
- **WHEN** `undo_write` is called for a `write_file` operation that created a new file (snapshotBefore is null)
- **THEN** the file is deleted

#### Scenario: undo of a delete_file recreates the file
- **WHEN** `undo_write` is called for a `delete_file` operation
- **THEN** the file is recreated with the content from the snapshot

#### Scenario: expired operationId returns a clear error
- **WHEN** `undo_write` is called with an operationId that has been rotated off the stack (stack exceeded 50 entries)
- **THEN** the tool returns `"Error: op:XXXX is no longer in undo history (stack limit reached)"`

### Requirement: UndoStack is capped at 50 entries with FIFO rotation
The system SHALL cap the `UndoStack` at 50 entries. When a 51st entry is added, the oldest entry SHALL be silently discarded. The stack SHALL be scoped per `HarnessContext` (per Pi session / conversationId).

#### Scenario: Stack rotates at 50 entries
- **WHEN** 51 write operations are performed in the same session
- **THEN** the oldest entry is dropped and only the 50 most recent operations remain undoable
