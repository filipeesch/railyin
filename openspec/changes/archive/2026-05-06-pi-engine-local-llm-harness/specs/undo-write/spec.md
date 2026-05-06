## ADDED Requirements

### Requirement: Per-conversation undo stack
An `UndoStack` instance is created per Pi session and destroyed with the session. Maximum 50 entries (FIFO rotation).

### Requirement: Write operations produce operationId
Every successful write tool call returns a result string containing an `op:XXXX` identifier (4-char hex).

#### Scenario: write_file result includes operationId
- **WHEN** `write_file` succeeds
- **THEN** the result string is `"OK: wrote <path> (+N -M) [op:XXXX]"`

#### Scenario: patch_file result includes operationId
- **WHEN** `patch_file` succeeds
- **THEN** the result string includes `[op:XXXX]`

#### Scenario: delete_file result includes operationId
- **WHEN** `delete_file` succeeds
- **THEN** the result string includes `[op:XXXX]`

#### Scenario: rename_file result includes operationId
- **WHEN** `rename_file` succeeds
- **THEN** the result string includes `[op:XXXX]`

### Requirement: undo_write by operationId
The model can revert any write by passing its `operationId`.

#### Scenario: Successful undo by operationId
- **WHEN** `undo_write({ operationId: "a3f9" })` is called and the id is in the stack
- **THEN** the file is restored to its pre-operation state (content overwritten, or file deleted if it was new, or file renamed back)
- **AND** the undo entry is removed from the stack
- **AND** the content hash cache entry for that path is invalidated

#### Scenario: operationId not in stack
- **WHEN** `undo_write({ operationId: "xxxx" })` is called and the id is not found
- **THEN** `"Error: op:xxxx not found in undo history"` is returned
- **AND** no file changes occur

### Requirement: undo_write by path
The model can revert the most recent write to a specific path.

#### Scenario: Undo most recent write to path
- **WHEN** `undo_write({ path: "src/auth.ts" })` is called
- **THEN** the most recent write operation recorded for that path is reverted

#### Scenario: No writes recorded for path
- **WHEN** `undo_write({ path: "src/auth.ts" })` is called with no recorded writes for that path
- **THEN** `"Error: no write history found for src/auth.ts"` is returned

### Requirement: Stack capacity
The undo stack holds at most 50 entries. When the 51st entry is added, the oldest is discarded.

#### Scenario: Oldest entry evicted at capacity
- **WHEN** the 51st write operation occurs
- **THEN** the oldest `WriteSnapshot` is removed from the stack
- **AND** attempting to undo that evicted operationId returns `"Error: op:XXXX is no longer in the undo history (stack limit reached)"`

### Requirement: Snapshot storage per write type
- `write_file`: stores full pre-write file content (or `null` if file was new — undo deletes the file)
- `patch_file`: stores full pre-patch file content
- `delete_file`: stores full file content before deletion (undo re-creates the file)
- `rename_file`: stores `{ fromPath, toPath }` pair (undo renames back)
