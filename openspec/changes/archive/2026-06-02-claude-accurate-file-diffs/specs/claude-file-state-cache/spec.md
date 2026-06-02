## ADDED Requirements

### Requirement: FileStateCache captures file content before tool execution
The system SHALL provide a `FileStateCache` interface with `capture(callId, worktreePath, filePath)`, `get(callId)`, `delete(callId)`, and `clear()` methods. The default implementation SHALL read the file synchronously before the tool writes it. If the file does not exist, `capture` SHALL store `null` for that `callId`. If reading fails for any reason, `capture` SHALL store `null` (non-fatal degradation).

#### Scenario: Existing file captured before write
- **WHEN** `capture` is called with a valid path to an existing file
- **THEN** `get(callId)` returns the file's content as a string

#### Scenario: New file captured before write
- **WHEN** `capture` is called with a path to a file that does not yet exist
- **THEN** `get(callId)` returns `null`

#### Scenario: Cache entry is deleted after use
- **WHEN** `delete(callId)` is called
- **THEN** subsequent `get(callId)` returns `undefined`

#### Scenario: Cache is cleared at execution end
- **WHEN** `clear()` is called
- **THEN** all entries are removed from the cache

### Requirement: FileStateCache lifecycle is scoped to a single execution
A `FileStateCache` instance SHALL be created per execution in `ClaudeEngine`, passed through `ClaudeRunConfig` and `translateClaudeMessage` options, and cleared when the execution ends — mirroring the `toolMetaByCallId` lifecycle.

#### Scenario: Separate executions have isolated caches
- **WHEN** two concurrent executions each process a `write` tool call on the same file
- **THEN** each cache holds its own before-content independently without interference
